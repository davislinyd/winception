[CmdletBinding()]
param(
    [string] $ConfigPath,
    [ValidateSet('All', 'SecureBoot', 'Ipxe', 'FirmwareCorners')]
    [string] $Mode = 'All',
    [switch] $ValidateOnly,
    [switch] $NetworkAcceptance,
    [switch] $BootstrapRouter
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')
. (Join-Path $PSScriptRoot 'lib\LabRouter.ps1')
. (Join-Path $PSScriptRoot 'lib\LabNetworkAcceptance.ps1')
. (Join-Path $PSScriptRoot 'lib\Acceptance.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:AppRoot = $script:RepoRoot
$script:StateRoot = $null
$script:RuntimeRoot = $null
$script:EvidenceRoot = $null
$script:Config = $null
$script:WebBaseUri = $null
$script:WebWasHealthy = $false
$script:LabMutex = $null
$script:CleanupComplete = $false
$script:CleanupErrors = New-Object System.Collections.Generic.List[string]
$script:Secrets = $null
$script:RoundDhcpMode = 'server'
$script:AcceptanceProfileId = $null
$script:AcceptanceOriginalProfile = $null
$script:AcceptanceSavedState = $null
$script:MutationStarted = $false
$script:RouterReadyCreatedThisRun = $false
$script:RoundClientMacs = @()
$script:LastFleetWaitHeartbeatAt = [DateTimeOffset]::MinValue
$script:SavedEnvironment = @{}
$script:SelectedVms = @()

function Get-OptionalProperty {
    param(
        [Parameter(Mandatory)][AllowNull()] $Object,
        [Parameter(Mandatory)][string] $Name
    )

    if ($null -eq $Object) {
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($property) {
        return $property.Value
    }
    return $null
}

function Test-ConsoleIsIdle {
    param([Parameter(Mandatory)] $State)

    $operation = Get-OptionalProperty -Object $State -Name 'operation'
    $fleet = Get-OptionalProperty -Object $State -Name 'fleet'
    $services = Get-OptionalProperty -Object $State -Name 'services'
    $operationRunning = [bool] (Get-OptionalProperty -Object $operation -Name 'running')
    $activeRuns = [object[]] @((Get-OptionalProperty -Object $fleet -Name 'runs') | Where-Object { $_.status -in @('running','awaiting-windows','windows-running') })
    $runningServices = if ($services) {
        [object[]] @($services.PSObject.Properties | Where-Object { [bool] (Get-OptionalProperty -Object $_.Value -Name 'running') })
    }
    else {
        [object[]] @()
    }
    -not $operationRunning -and (@($activeRuns).Count -eq 0) -and (@($runningServices).Count -eq 0)
}

function ConvertTo-ObjectList {
    param($Value)

    $list = New-Object System.Collections.Generic.List[object]
    if ($null -eq $Value) {
        return ,$list
    }
    if ($Value -is [string]) {
        $list.Add($Value)
        return ,$list
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        foreach ($item in $Value) {
            $list.Add($item)
        }
        return ,$list
    }
    $list.Add($Value)
    ,$list
}

function Get-FirmwareBootOrderEntries {
    param($Firmware)

    if ($null -eq $Firmware) {
        return ,(New-Object System.Collections.Generic.List[object])
    }
    ConvertTo-ObjectList -Value (Get-OptionalProperty -Object $Firmware -Name 'BootOrder')
}

function Get-FirmwareBootType {
    param($Entry)

    if ($null -eq $Entry) {
        return ''
    }
    [string] (Get-OptionalProperty -Object $Entry -Name 'BootType')
}

function Get-FirmwareBootDeviceId {
    param($Entry)

    if ($null -eq $Entry) {
        return ''
    }
    $device = Get-OptionalProperty -Object $Entry -Name 'Device'
    if ($null -eq $device) {
        return ''
    }
    [string] (Get-OptionalProperty -Object $device -Name 'Id')
}

function Get-FirmwareNetworkBootSource {
    param($BootOrder)

    foreach ($entry in (ConvertTo-ObjectList -Value $BootOrder)) {
        if ((Get-FirmwareBootType -Entry $entry) -eq 'Network') {
            return $entry
        }
    }
    $null
}

function Test-FirmwareNetworkFirst {
    param($BootOrder)

    $entries = ConvertTo-ObjectList -Value $BootOrder
    if ($entries.Count -eq 0) {
        return $false
    }
    (Get-FirmwareBootType -Entry $entries[0]) -eq 'Network'
}

function Convert-FirmwareBootOrderEvidence {
    param($BootOrder)

    $records = New-Object System.Collections.Generic.List[object]
    foreach ($entry in (ConvertTo-ObjectList -Value $BootOrder)) {
        $description = ''
        if ($null -ne $entry) {
            $description = [string] (Get-OptionalProperty -Object $entry -Name 'Description')
        }
        $records.Add([ordered]@{
            bootType = Get-FirmwareBootType -Entry $entry
            description = $description
            deviceId = Get-FirmwareBootDeviceId -Entry $entry
        })
    }
    ,$records
}

function Get-WindowsFamilyFromBuild {
    param([string] $CurrentBuild)

    $buildNumber = 0
    if (-not [int]::TryParse($CurrentBuild, [ref] $buildNumber)) {
        return ''
    }
    if ($buildNumber -ge 22000) {
        return 'Windows 11'
    }
    'Windows 10'
}

function Get-RequiredProperty {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)][string] $Name
    )

    $value = Get-OptionalProperty -Object $Object -Name $Name
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string] $value)) {
        throw "Lab configuration is missing '$Name'."
    }
    $value
}

function Read-LabConfig {
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Lab configuration was not found: $Path"
    }
    Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Assert-Ipv4 {
    param([Parameter(Mandatory)][string] $Address)

    $parsed = $null
    if (-not [System.Net.IPAddress]::TryParse($Address, [ref] $parsed) -or $parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
        throw "Lab address is not a valid IPv4 address: $Address"
    }
}

function Assert-PathOutside {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string[]] $Roots,
        [Parameter(Mandatory)][string] $Label
    )

    $candidate = Get-FullPath $Path
    foreach ($root in $Roots) {
        if ([string]::IsNullOrWhiteSpace($root)) {
            continue
        }
        $rootFull = (Get-FullPath $root).TrimEnd('\')
        if ($candidate -eq $rootFull -or $candidate.StartsWith("$rootFull\", [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "$Label must not be inside protected root '$rootFull': $candidate"
        }
    }
    $candidate
}

function Assert-LabConfig {
    param([Parameter(Mandatory)] $Config)

    if ([int] (Get-RequiredProperty -Object $Config -Name 'schemaVersion') -ne 1) {
        throw "Unsupported Lab configuration schema: $($Config.schemaVersion)"
    }
    $switchName = [string] (Get-RequiredProperty -Object $Config -Name 'switchName')
    $interfaceAlias = [string] (Get-RequiredProperty -Object $Config -Name 'serviceInterfaceAlias')
    $serviceIp = [string] (Get-RequiredProperty -Object $Config -Name 'serviceIp')
    $runtimeRoot = [string] (Get-RequiredProperty -Object $Config -Name 'runtimeRoot')
    $appRoot = [string] (Get-RequiredProperty -Object $Config -Name 'appRoot')
    $stateRoot = [string] (Get-RequiredProperty -Object $Config -Name 'stateRoot')
    $evidenceRoot = [string] (Get-RequiredProperty -Object $Config -Name 'evidenceRoot')
    Assert-Ipv4 -Address $serviceIp
    if ([int] $Config.prefixLength -lt 1 -or [int] $Config.prefixLength -gt 30) {
        throw 'Lab prefixLength must be between 1 and 30.'
    }
    if ($switchName -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,62}$') {
        throw "Lab switch name contains unsupported characters: $switchName"
    }
    if ($interfaceAlias -ne "vEthernet ($switchName)") {
        throw "serviceInterfaceAlias must be vEthernet ($switchName)."
    }
    if (-not ([string] $Config.web.host).Equals('127.0.0.1', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Lab Web Console must bind to 127.0.0.1.'
    }
    if ([int] $Config.web.port -lt 1 -or [int] $Config.web.port -gt 65535) {
        throw 'Lab Web Console port is invalid.'
    }
    $servicePorts = Get-OptionalProperty -Object $Config -Name 'servicePorts'
    if ($null -eq $servicePorts) {
        throw 'Lab servicePorts is required.'
    }
    foreach ($portName in @('http', 'tftp', 'dhcp', 'torrent')) {
        $portValue = [int] (Get-OptionalProperty -Object $servicePorts -Name $portName)
        if ($portValue -lt 1 -or $portValue -gt 65535) {
            throw "Lab service port is invalid: $portName"
        }
    }
    $secureBootVms = @($Config.secureBootVms)
    $allVms = $secureBootVms + @([string] $Config.ipxeVm)
    $invalidVms = @($allVms | Where-Object {
        [string]::IsNullOrWhiteSpace([string] $_) -or $_ -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,99}$'
    })
    if ($secureBootVms.Count -ne 4 -or $allVms.Count -ne 5 -or $invalidVms.Count -gt 0) {
        throw 'Lab configuration must contain four secureboot VM names and one iPXE VM name.'
    }
    if (@($allVms | Sort-Object -Unique).Count -ne 5) {
        throw 'Lab VM names must be unique.'
    }
    $firmware = Get-OptionalProperty -Object $Config -Name 'firmware'
    if ($null -ne $firmware) {
        $sbTpmOn = @((Get-OptionalProperty -Object $firmware -Name 'secureBootTpmOn'))
        $unknownSb = @($sbTpmOn | Where-Object { $_ -and $_ -notin $secureBootVms })
        if ($unknownSb.Count -gt 0) {
            throw 'firmware.secureBootTpmOn contains a VM that is not a Secure Boot Lab VM.'
        }
        $sbTpmOff = [string] (Get-OptionalProperty -Object $firmware -Name 'secureBootTpmOff')
        if ($sbTpmOff -and $sbTpmOff -notin $secureBootVms) {
            throw 'firmware.secureBootTpmOff must be one of the Secure Boot Lab VMs.'
        }
        $ipxeTpmOff = [string] (Get-OptionalProperty -Object $firmware -Name 'ipxeTpmOff')
        if ($ipxeTpmOff -and $ipxeTpmOff -ne [string] $Config.ipxeVm) {
            throw 'firmware.ipxeTpmOff must be the iPXE Lab VM.'
        }
        $ipxeTpmOn = [string] (Get-OptionalProperty -Object $firmware -Name 'ipxeTpmOn')
        if ($ipxeTpmOn -and $ipxeTpmOn -ne [string] $Config.ipxeVm) {
            throw 'firmware.ipxeTpmOn must be the iPXE Lab VM.'
        }
    }
    $checkpoint = [string] (Get-RequiredProperty -Object $Config -Name 'checkpointName')
    if ($checkpoint -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,99}$') {
        throw "Invalid Lab checkpoint name: $checkpoint"
    }
    $cache = Get-OptionalProperty -Object $Config -Name 'cache'
    if ($null -eq $cache -or [string]::IsNullOrWhiteSpace([string] (Get-OptionalProperty -Object $cache -Name 'manifestPath'))) {
        throw 'Lab cache.manifestPath is required.'
    }
    if (-not (Test-IsAdministrator)) {
        throw 'Invoke-WinceptionLabRegression.ps1 requires an elevated PowerShell session.'
    }

    $script:AppRoot = Get-FullPath $appRoot
    $script:StateRoot = Get-FullPath $stateRoot
    $script:RuntimeRoot = Get-FullPath $runtimeRoot
    $script:EvidenceRoot = Assert-ChildPath -Root $script:StateRoot -Path $evidenceRoot -Label 'evidence root'
    if ($script:RuntimeRoot -eq $script:StateRoot -or $script:RuntimeRoot.StartsWith("$($script:StateRoot)\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Runtime root must be outside HostTools State.'
    }
    Assert-PathOutside -Path $script:AppRoot -Roots @($script:RepoRoot) -Label 'app root' | Out-Null
    Assert-PathOutside -Path $script:StateRoot -Roots @($script:RepoRoot) -Label 'state root' | Out-Null
    Assert-PathOutside -Path $script:RuntimeRoot -Roots @($script:RepoRoot) -Label 'runtime root' | Out-Null
}

function Get-SecretStorePath {
    $configured = [string] (Get-OptionalProperty -Object $script:Config -Name 'secretStorePath')
    if ([string]::IsNullOrWhiteSpace($configured)) {
        $configured = Join-Path $script:StateRoot 'config\osdcloud-secrets.json'
    }
    $full = Get-FullPath $configured
    Assert-PathOutside -Path $full -Roots @($script:RepoRoot, $script:AppRoot) -Label 'secret store path' | Out-Null
    Assert-ChildPath -Root $script:StateRoot -Path $full -Label 'secret store path'
}

function Assert-SecretStoreAcl {
    param([Parameter(Mandatory)][string] $Path)

    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    $broadIdentities = @('Everyone', 'BUILTIN\Users', 'Users', 'Authenticated Users')
    $broadAccess = @($acl.Access | Where-Object {
        $_.AccessControlType -eq 'Allow' -and
        $broadIdentities -contains ([string] $_.IdentityReference)
    })
    if ($broadAccess.Count -gt 0) {
        throw "Secret store ACL is too broad: $Path"
    }
}

function Read-LabSecrets {
    $storePath = Get-SecretStorePath
    $fileSecrets = $null
    if (Test-Path -LiteralPath $storePath -PathType Leaf) {
        Assert-SecretStoreAcl -Path $storePath
        $fileSecrets = Get-Content -LiteralPath $storePath -Raw | ConvertFrom-Json
    }

    $readValue = {
        param([string] $Name, [string] $EnvironmentName)
        $fromFile = if ($fileSecrets) { [string] (Get-OptionalProperty -Object $fileSecrets -Name $Name) } else { '' }
        if (-not [string]::IsNullOrWhiteSpace($fromFile)) {
            return $fromFile
        }
        [Environment]::GetEnvironmentVariable($EnvironmentName, 'Process')
    }
    $username = & $readValue 'windowsUsername' 'OSDCLOUD_WINDOWS_USERNAME'
    $windowsPassword = & $readValue 'windowsPassword' 'OSDCLOUD_WINDOWS_PASSWORD'
    $pxePassword = & $readValue 'pxeinstallPassword' 'OSDCLOUD_PXEINSTALL_PASSWORD'
    if ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrWhiteSpace($windowsPassword) -or [string]::IsNullOrWhiteSpace($pxePassword)) {
        throw "Lab secret store is missing required deployment credentials: $storePath"
    }
    [pscustomobject]@{
        storePath = $storePath
        windowsUsername = [string] $username
        windowsPassword = [string] $windowsPassword
        pxeinstallPassword = [string] $pxePassword
    }
}

function Set-SecretEnvironment {
    param([Parameter(Mandatory)] $Secrets)

    foreach ($name in @('OSDCLOUD_WINDOWS_USERNAME', 'OSDCLOUD_WINDOWS_PASSWORD', 'OSDCLOUD_PXEINSTALL_PASSWORD')) {
        $script:SavedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $env:OSDCLOUD_WINDOWS_USERNAME = $Secrets.windowsUsername
    $env:OSDCLOUD_WINDOWS_PASSWORD = $Secrets.windowsPassword
    $env:OSDCLOUD_PXEINSTALL_PASSWORD = $Secrets.pxeinstallPassword
}

function Restore-SecretEnvironment {
    foreach ($name in $script:SavedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $script:SavedEnvironment[$name], 'Process')
    }
}

function Write-SafeJson {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)] $Value
    )

    $json = $Value | ConvertTo-Json -Depth 20
    $json = [regex]::Replace(
        $json,
        '(?im)"(?:windowsPassword|pxeinstallPassword|password|secret|token|cookie|credential)[^"]*"\s*:\s*"[^"]*"',
        '"REDACTED":"REDACTED"'
    )
    [System.IO.File]::WriteAllText($Path, ($json + [Environment]::NewLine), $Utf8NoBom)
}

function Write-Evidence {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)] $Value
    )

    $safeName = $Name -replace '[^A-Za-z0-9_.-]', '_'
    $path = Join-ChildPath -Root $script:EvidenceRoot -RelativePath $safeName -Label 'evidence file'
    New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
    Write-SafeJson -Path $path -Value $Value
    $path
}

function Write-SafeText {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Text
    )

    $safe = [regex]::Replace(
        $Text,
        '(?im)((?:windowsPassword|pxeinstallPassword|password|secret|token|cookie)\s*["'']?\s*(?:=|:)\s*["'']?)[^"''\s,;]+',
        '$1[REDACTED]'
    )
    [System.IO.File]::WriteAllText($Path, $safe, $Utf8NoBom)
}

function Collect-SafeRuntimeEvidence {
    if (-not $script:EvidenceRoot -or -not (Test-Path -LiteralPath $script:RuntimeRoot -PathType Container)) {
        return
    }
    $sourceRoots = @(
        (Join-Path $script:RuntimeRoot 'logs'),
        (Join-Path $script:RuntimeRoot 'PXE-HttpRoot\status')
    )
    $destinationRoot = Join-Path $script:EvidenceRoot 'runtime'
    foreach ($sourceRoot in $sourceRoots) {
        if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
            continue
        }
        foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
            $_.Extension -in @('.log', '.json', '.jsonl', '.txt')
        }) {
            $relative = $file.FullName.Substring($script:RuntimeRoot.Length).TrimStart('\')
            $destination = Join-ChildPath -Root $destinationRoot -RelativePath $relative -Label 'runtime evidence path'
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            try {
                Write-SafeText -Path $destination -Text (Get-Content -LiteralPath $file.FullName -Raw)
            }
            catch {
                $script:CleanupErrors.Add("Unable to collect runtime evidence: $relative") | Out-Null
            }
        }
    }
}

function Get-SafeState {
    param([Parameter(Mandatory)] $State)

    $profile = Get-OptionalProperty -Object $State -Name 'profile'
    $osImage = Get-OptionalProperty -Object $State -Name 'osImage'
    $config = Get-OptionalProperty -Object $State -Name 'config'
    $runtime = Get-OptionalProperty -Object $State -Name 'runtime'
    [ordered]@{
        generatedAt = Get-OptionalProperty -Object $State -Name 'generatedAt'
        app = Get-OptionalProperty -Object $State -Name 'app'
        host = [ordered]@{ elevated = Get-OptionalProperty -Object (Get-OptionalProperty -Object $State -Name 'host') -Name 'elevated' }
        web = Get-OptionalProperty -Object $State -Name 'web'
        config = [ordered]@{
            workspace = Get-OptionalProperty -Object $config -Name 'workspace'
            adapter = Get-OptionalProperty -Object $config -Name 'adapter'
            dhcp = Get-OptionalProperty -Object $config -Name 'dhcp'
            http = Get-OptionalProperty -Object $config -Name 'http'
            tftp = Get-OptionalProperty -Object $config -Name 'tftp'
            torrent = Get-OptionalProperty -Object $config -Name 'torrent'
            network = Get-OptionalProperty -Object $config -Name 'network'
        }
        runtime = [ordered]@{
            ready = Get-OptionalProperty -Object $runtime -Name 'ready'
            missing = Get-OptionalProperty -Object $runtime -Name 'missing'
        }
        profile = [ordered]@{
            activeProfile = Get-OptionalProperty -Object $profile -Name 'activeProfile'
            profiles = @((Get-OptionalProperty -Object $profile -Name 'profiles') | Select-Object id, name, osImageId, installSequence, selectedSoftware, selectedScripts)
        }
        osImage = [ordered]@{
            activeImageId = Get-OptionalProperty -Object $osImage -Name 'activeImageId'
            activeLabel = Get-OptionalProperty -Object $osImage -Name 'activeLabel'
            selectedOsPath = Get-OptionalProperty -Object $osImage -Name 'selectedOsPath'
        }
        preflight = @(Get-OptionalProperty -Object $State -Name 'preflight')
        services = Get-OptionalProperty -Object $State -Name 'services'
        operation = Get-OptionalProperty -Object $State -Name 'operation'
        fleet = Get-OptionalProperty -Object $State -Name 'fleet'
        validation = Get-OptionalProperty -Object $State -Name 'validation'
    }
}

function Assert-CommandAvailable {
    param([Parameter(Mandatory)][string] $Name)
    if (-not (Get-Command -Name $Name -ErrorAction SilentlyContinue)) {
        throw "Required command is not available: $Name"
    }
}

function Assert-LabRunnerGuard {
    $switchName = [string] $script:Config.switchName
    $interfaceAlias = [string] $script:Config.serviceInterfaceAlias
    $allVms = @($script:Config.secureBootVms) + @([string] $script:Config.ipxeVm)
    $switch = Get-VMSwitch -Name $switchName -ErrorAction Stop
    if ([string] $switch.SwitchType -ne 'Internal') {
        throw "Lab switch '$switchName' is not Internal."
    }
    $adapter = Get-NetAdapter -Name $interfaceAlias -ErrorAction Stop
    if ($adapter.Status -ne 'Up') {
        throw "Lab adapter is not Up: $interfaceAlias"
    }
    $addresses = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue)
    $matching = @($addresses | Where-Object {
        $_.IPAddress -eq [string] $script:Config.serviceIp -and [int] $_.PrefixLength -eq [int] $script:Config.prefixLength
    })
    if ($matching.Count -ne 1) {
        throw "Lab adapter does not have the exact service address $($script:Config.serviceIp)/$($script:Config.prefixLength)."
    }
    $network = Get-NetIPConfiguration -InterfaceIndex $adapter.ifIndex -ErrorAction Stop
    if ($network.IPv4DefaultGateway) {
        throw 'Lab adapter has a default gateway; refusing to touch a routed network.'
    }

    $labAdapters = @(Get-VMNetworkAdapter -All | Where-Object {
        [string] $_.SwitchName -eq $switchName -and -not [bool] $_.IsManagementOS
    })
    $allowedRouter = @()
    if (Get-VM -Name winception-autolab-router -ErrorAction SilentlyContinue) {
        Assert-LabRouterOwnership -Config $script:Config -Ready:($NetworkAcceptance -and -not $BootstrapRouter) | Out-Null
        if ((Get-VM -Name winception-autolab-router).State -ne 'Off') {throw 'Router must be Off before the Lab run.'}
        $allowedRouter = @('winception-autolab-router')
    } elseif ($NetworkAcceptance -or $BootstrapRouter) {throw 'Dedicated router VM is missing.'}
    $unexpectedAdapters = @($labAdapters | Where-Object { [string] $_.VMName -notin ($allVms + $allowedRouter) })
    if ($unexpectedAdapters.Count -gt 0) {
        throw "Unexpected VM is connected to isolated Lab switch: $($unexpectedAdapters[0].VMName)"
    }

    $vmResults = New-Object System.Collections.Generic.List[object]
    foreach ($vmName in $allVms) {
        $vm = Get-VM -Name $vmName -ErrorAction Stop
        if ($vm.Generation -ne 2) {
            throw "$vmName is not Generation 2."
        }
        if ([string] $vm.State -ne 'Off') {
            throw "$vmName must be Off before the Lab run."
        }
        $memory = Get-VMMemory -VMName $vmName -ErrorAction Stop
        if ($memory.DynamicMemoryEnabled -eq $true -or [int64] $memory.Startup -ne [int64] 4GB) {
            throw "$vmName must use fixed 4 GiB startup memory with Dynamic Memory disabled."
        }
        $adapters = @(Get-VMNetworkAdapter -VMName $vmName)
        if ($adapters.Count -ne 1 -or [string] $adapters[0].SwitchName -ne $switchName) {
            throw "$vmName must have exactly one adapter connected to '$switchName'."
        }
        $checkpoint = Get-VMSnapshot -VMName $vmName -Name ([string] $script:Config.checkpointName) -ErrorAction SilentlyContinue
        if (-not $checkpoint) {
            throw "$vmName is missing checkpoint '$($script:Config.checkpointName)'."
        }
        $firmware = Get-VMFirmware -VMName $vmName
        $expectedSecureBoot = if ($vmName -in @($script:Config.secureBootVms)) { 'On' } else { 'Off' }
        if ([string] $firmware.SecureBoot -ne $expectedSecureBoot) {
            throw "$vmName Secure Boot is $($firmware.SecureBoot); expected $expectedSecureBoot."
        }
        if ($expectedSecureBoot -eq 'On' -and [string] $firmware.SecureBootTemplate -ne 'MicrosoftWindows') {
            throw "$vmName must use the MicrosoftWindows Secure Boot template."
        }
        $security = Get-VMSecurity -VMName $vmName -ErrorAction Stop
        $vmResults.Add([ordered]@{
            name = $vmName
            generation = [int] $vm.Generation
            state = [string] $vm.State
            secureBoot = [string] $firmware.SecureBoot
            tpmEnabled = [bool] $security.TpmEnabled
            checkpoint = [string] $script:Config.checkpointName
        })
    }

    $dhcpService = Get-Service -Name 'DHCPServer' -ErrorAction SilentlyContinue
    if ($dhcpService -and $dhcpService.Status -eq 'Running') {
        throw 'Windows DHCP Server service is running on the runner; refusing to start the Lab responder.'
    }
    $bindingCommand = Get-Command -Name Get-DhcpServerv4Binding -ErrorAction SilentlyContinue
    if ($bindingCommand) {
        $foreignBindings = @(Get-DhcpServerv4Binding -ErrorAction SilentlyContinue | Where-Object {
            $_.BindingState -eq $true -and [string] $_.InterfaceAlias -ne $interfaceAlias
        })
        if ($foreignBindings.Count -gt 0) {
            throw "DHCP Server has an active binding outside the Lab adapter: $($foreignBindings[0].InterfaceAlias)"
        }
    }

    [pscustomobject]@{
        switch = [ordered]@{ name = $switch.Name; type = [string] $switch.SwitchType }
        adapter = [ordered]@{
            name = $adapter.Name
            status = [string] $adapter.Status
            ip = [string] $script:Config.serviceIp
            prefixLength = [int] $script:Config.prefixLength
            defaultGateway = $false
        }
        vms = @($vmResults.ToArray())
    }
}

function Get-LabPorts {
    $ports = New-Object System.Collections.Generic.List[object]
    $servicePorts = $script:Config.servicePorts
    $ports.Add([ordered]@{ protocol = 'TCP'; port = [int] $servicePorts.http; label = 'HTTP' })
    $ports.Add([ordered]@{ protocol = 'UDP'; port = [int] $servicePorts.tftp; label = 'TFTP' })
    $ports.Add([ordered]@{ protocol = 'UDP'; port = [int] $servicePorts.dhcp; label = 'DHCP' })
    $ports.Add([ordered]@{ protocol = 'TCP'; port = [int] $servicePorts.torrent; label = 'Torrent' })
    @($ports.ToArray())
}

function Test-LabPortBindingConflicts {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string] $LocalAddress,
        [Parameter(Mandatory)][string] $ServiceIp
    )

    if ([string]::IsNullOrWhiteSpace($LocalAddress)) {
        return $true
    }
    if ($LocalAddress -eq $ServiceIp) {
        return $true
    }
    if ($LocalAddress -in @('0.0.0.0', '::', '::0')) {
        return $true
    }
    if ($LocalAddress -eq ('::ffff:{0}' -f $ServiceIp)) {
        return $true
    }
    $false
}

function Assert-LabPortsFree {
    $serviceIp = [string] $script:Config.serviceIp
    $occupied = New-Object System.Collections.Generic.List[object]
    foreach ($entry in Get-LabPorts) {
        if ($entry.protocol -eq 'TCP') {
            $connections = @(Get-NetTCPConnection -LocalPort ([int] $entry.port) -State Listen -ErrorAction SilentlyContinue)
        }
        else {
            $connections = @(Get-NetUDPEndpoint -LocalPort ([int] $entry.port) -ErrorAction SilentlyContinue)
        }
        foreach ($connection in $connections) {
            $localAddress = [string] $connection.LocalAddress
            if (-not (Test-LabPortBindingConflicts -LocalAddress $localAddress -ServiceIp $serviceIp)) {
                continue
            }
            $occupied.Add([ordered]@{
                protocol = $entry.protocol
                port = [int] $entry.port
                label = $entry.label
                localAddress = $localAddress
                owningProcess = [int] $connection.OwningProcess
            })
        }
    }
    if ($occupied.Count -gt 0) {
        $first = $occupied[0]
        throw "A Lab service port is already occupied: $($first.protocol)/$($first.port) $($first.localAddress) PID=$($first.owningProcess)"
    }
}

function Get-CacheRecords {
    $cache = $script:Config.cache
    $records = New-Object System.Collections.Generic.List[object]
    foreach ($entry in @($cache.requiredPaths)) {
        $path = [string] (Get-OptionalProperty -Object $entry -Name 'path')
        if ([string]::IsNullOrWhiteSpace($path)) {
            throw 'cache.requiredPaths contains an empty path.'
        }
        $fullPath = Get-FullPath $path
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            throw "Required Lab cache file is missing: $fullPath"
        }
        $item = Get-Item -LiteralPath $fullPath
        $records.Add([ordered]@{
            path = $fullPath
            length = [int64] $item.Length
            sha256 = Get-Sha256Hash -LiteralPath $fullPath
        })
    }
    @($records.ToArray())
}

function Test-CacheManifest {
    param([Parameter(Mandatory)][string] $ManifestPath)

    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        return [pscustomobject]@{ valid = $false; reason = 'manifest_missing'; records = @() }
    }
    try {
        $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
        $records = @($manifest.files)
        if ([int] $manifest.schemaVersion -ne 1 -or $records.Count -eq 0) {
            return [pscustomobject]@{ valid = $false; reason = 'manifest_schema'; records = $records }
        }
        $manifestPaths = @($records | ForEach-Object { Get-FullPath ([string] $_.path) })
        foreach ($required in @($script:Config.cache.requiredPaths)) {
            $requiredPath = Get-FullPath ([string] $required.path)
            if ($requiredPath -notin $manifestPaths) {
                return [pscustomobject]@{ valid = $false; reason = "manifest_missing:$requiredPath"; records = $records }
            }
        }
        $requiredFull = @($script:Config.cache.requiredPaths | ForEach-Object { Get-FullPath ([string] $_.path) })
        foreach ($record in $records) {
            $path = Get-FullPath ([string] $record.path)
            if ($path -notin $requiredFull) {
                continue
            }
            $item = Get-Item -LiteralPath $path -ErrorAction Stop
            if ([int64] $item.Length -ne [int64] $record.length -or (Get-Sha256Hash -LiteralPath $path) -ne ([string] $record.sha256).ToUpperInvariant()) {
                return [pscustomobject]@{ valid = $false; reason = "hash_mismatch:$path"; records = $records }
            }
        }
        [pscustomobject]@{ valid = $true; reason = 'ok'; records = $records }
    }
    catch {
        [pscustomobject]@{ valid = $false; reason = 'manifest_unreadable'; records = @() }
    }
}

function Write-CacheManifest {
    param([Parameter(Mandatory)][string] $ManifestPath)

    $manifestRoot = Split-Path -Parent (Get-FullPath $ManifestPath)
    Assert-PathOutside -Path $manifestRoot -Roots @($script:RepoRoot) -Label 'cache manifest root' | Out-Null
    New-Item -ItemType Directory -Path $manifestRoot -Force | Out-Null
    $records = Get-CacheRecords
    Write-SafeJson -Path $ManifestPath -Value ([ordered]@{
        schemaVersion = 1
        generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
        files = $records
    })
    $records
}

function Invoke-CacheRefresh {
    $restoreScript = Join-Path $script:RepoRoot 'tools\Restore-DeploymentArtifacts.ps1'
    if (-not (Test-Path -LiteralPath $restoreScript -PathType Leaf)) {
        throw "Cache refresh script is missing: $restoreScript"
    }
    Write-Host 'Cache manifest is missing or stale; invoking the existing runtime restore flow once.'
    $stateConfigPath = Join-Path $script:StateRoot 'config\osdcloud-console.json'
    $restoreArgs = @(
        '-LiveRoot', $script:RuntimeRoot,
        '-SkipPrerequisiteCheck'
    )
    if (Test-Path -LiteralPath $stateConfigPath -PathType Leaf) {
        $restoreArgs += @('-ConfigPath', $stateConfigPath)
    }
    Invoke-ExternalPowerShell -ScriptPath $restoreScript -Arguments $restoreArgs
}

function Ensure-LabCache {
    $manifestPath = Get-FullPath ([string] $script:Config.cache.manifestPath)
    $status = Test-CacheManifest -ManifestPath $manifestPath
    if (-not $status.valid) {
        if (-not [bool] $script:Config.cache.allowNetworkRefresh) {
            throw "Lab cache validation failed ($($status.reason)); network refresh is disabled."
        }
        Invoke-CacheRefresh
        $status = Test-CacheManifest -ManifestPath $manifestPath
        if (-not $status.valid) {
            Write-CacheManifest -ManifestPath $manifestPath | Out-Null
            $status = Test-CacheManifest -ManifestPath $manifestPath
        }
    }
    if (-not $status.valid) {
        throw "Lab cache validation failed after refresh: $($status.reason)"
    }
    Write-Evidence -Name 'cache-manifest.json' -Value (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json) | Out-Null
    $status
}

function Invoke-ExternalPowerShell {
    param(
        [Parameter(Mandatory)][string] $ScriptPath,
        [Parameter(Mandatory)][string[]] $Arguments
    )

    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath) + $Arguments
    $output = & powershell.exe @args 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "PowerShell helper failed: $([System.IO.Path]::GetFileName($ScriptPath)) exit=$LASTEXITCODE"
    }
    $null = $output
}

function Get-WebBaseUri {
    $webHost = [string] $script:Config.web.host
    $port = [int] $script:Config.web.port
    "http://{0}:{1}" -f $webHost, $port
}

function Test-WebConsoleHealthy {
    try {
        $response = Invoke-RestMethod -Uri "$($script:WebBaseUri)/api/state" -TimeoutSec 3 -ErrorAction Stop
        return $response.ok -eq $true
    }
    catch {
        return $false
    }
}

function Wait-WebConsole {
    param([int] $TimeoutSeconds)

    $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
    do {
        if (Test-WebConsoleHealthy) {
            return $true
        }
        Start-Sleep -Seconds 2
    } while ([DateTimeOffset]::Now -lt $deadline)
    $false
}

function Wait-ConsoleIdle {
    param([int] $TimeoutSec = 0)

    if ($TimeoutSec -le 0) {
        $TimeoutSec = Get-ConsoleTimeoutSec
    }
    if (-not $script:WebBaseUri -or -not (Test-WebConsoleHealthy)) {
        return
    }
    $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSec)
    do {
        $state = Get-ConsoleState
        $operation = Get-OptionalProperty -Object $state -Name 'operation'
        $running = $false
        if ($null -ne $operation) {
            $running = [bool] (Get-OptionalProperty -Object $operation -Name 'running')
        }
        if (-not $running) {
            return
        }
        if ([DateTimeOffset]::Now -ge $deadline) {
            throw 'Web Console operation did not become idle before later cleanup.'
        }
        Start-Sleep -Seconds 2
    } while ($true)
}

function Ensure-WebConsole {
    $script:WebBaseUri = Get-WebBaseUri
    $script:WebWasHealthy = Test-WebConsoleHealthy
    if (-not $script:WebWasHealthy) {
        $launcher = Join-Path $script:AppRoot 'tools\Start-InstalledWebConsole.ps1'
        Invoke-ExternalPowerShell -ScriptPath $launcher -Arguments @('-NoBrowser')
    }
    if (-not (Wait-WebConsole -TimeoutSeconds ([int] $script:Config.timeouts.webReadySeconds))) {
        throw 'Installed Web Console did not become ready.'
    }
}

function Get-ConsoleTimeoutSec {
    param([int] $FallbackSeconds = 30)

    try {
        $minutes = [int] $script:Config.timeouts.preflightMinutes
        if ($minutes -gt 0) {
            return [Math]::Max(60, $minutes * 60)
        }
    }
    catch {
    }
    $FallbackSeconds
}

function Invoke-ConsoleJson {
    param(
        [Parameter(Mandatory)][ValidateSet('GET', 'POST')][string] $Method,
        [Parameter(Mandatory)][string] $Path,
        $Body,
        [int] $TimeoutSec = 30
    )

    try {
        $parameters = @{
            Uri = "$($script:WebBaseUri)$Path"
            Method = $Method
            TimeoutSec = $TimeoutSec
            ErrorAction = 'Stop'
        }
        $auth=Invoke-RestMethod "$($script:WebBaseUri)/api/auth/status" -TimeoutSec 30 -ErrorAction Stop
        if($auth.required){
            $token=Get-Content -LiteralPath (Join-Path $script:StateRoot 'config\web-console-token.json') -Raw|ConvertFrom-Json
            $parameters.Headers=@{'X-Winception-Token'=[string]$token.token}
        }
        if ($Method -eq 'POST') {
            $parameters.Body = ($Body | ConvertTo-Json -Depth 12 -Compress)
            $parameters.ContentType = 'application/json'
        }
        $response = Invoke-RestMethod @parameters
        if ($response.ok -eq $false) {
            throw 'Web Console returned ok=false.'
        }
        $response
    }
    catch {
        throw "Web Console request failed: $Method $Path : $($_.Exception.Message)"
    }
}

function Get-ConsoleState {
    $response = Invoke-ConsoleJson -Method GET -Path '/api/state'
    if (-not $response.state) {
        throw 'Web Console state response was incomplete.'
    }
    $response.state
}

function Save-ConsoleStateEvidence {
    param([string] $Name = 'state.json')
    $state = Get-ConsoleState
    Write-Evidence -Name $Name -Value (Get-SafeState -State $state) | Out-Null
    $state
}

function Assert-ConsoleEndpoint {
    param([Parameter(Mandatory)] $State)

    $adapter = $State.config.adapter
    $dhcp = $State.config.dhcp
    if ([string] $adapter.interfaceAlias -ne [string] $script:Config.serviceInterfaceAlias -or
        [string] $adapter.serverIp -ne [string] $script:Config.serviceIp -or
        [int] $adapter.prefixLength -ne [int] $script:Config.prefixLength) {
        throw 'Installed Web Console endpoint does not match the isolated Lab adapter.'
    }
    if ([string] $dhcp.listenIp -ne [string] $script:Config.serviceIp -or
        [string] $dhcp.leaseStartIp -ne [string] $script:Config.dhcp.leaseStartIp -or
        [string] $dhcp.leaseEndIp -ne [string] $script:Config.dhcp.leaseEndIp) {
        throw 'Installed Web Console DHCP configuration does not match the isolated Lab subnet.'
    }
}

function Set-ConsoleEndpoint {
    $response = Invoke-ConsoleJson -Method POST -Path '/api/endpoint' -TimeoutSec (Get-ConsoleTimeoutSec) -Body @{
        interfaceAlias = [string] $script:Config.serviceInterfaceAlias
        ipAddress = [string] $script:Config.serviceIp
        prefixLength = [int] $script:Config.prefixLength
        gateway = [string] $script:Config.dhcp.router
        dhcpMode = $script:RoundDhcpMode
        leaseStartIp = [string] $script:Config.dhcp.leaseStartIp
        leaseEndIp = [string] $script:Config.dhcp.leaseEndIp
        dnsServers = @('1.1.1.1','8.8.8.8')
    }
    $state = $response.state
    Assert-ConsoleEndpoint -State $state
    Write-Evidence -Name 'endpoint-sync.json' -Value @{
        endpoint = @{
            interfaceAlias = [string] $script:Config.serviceInterfaceAlias
            ipAddress = [string] $script:Config.serviceIp
            prefixLength = [int] $script:Config.prefixLength
        }
        status = @($response.result.endpointUpdateStatus)
        preflight = @($response.result.preflight)
    } | Out-Null
    $state
}

function Set-ConsoleMode {
    param([Parameter(Mandatory)][ValidateSet('secureboot', 'ipxe')][string] $BootMode)

    $response = Invoke-ConsoleJson -Method POST -Path '/api/boot-mode' -Body @{ mode = $BootMode }
    if ([string] $response.result.bootMode -ne $BootMode) {
        throw "Web Console did not apply boot mode $BootMode."
    }
    $response.state
}

function Set-ConsoleDhcpServerMode {
    param([ValidateSet('server','proxy')][string]$Mode='server')
    $response = Invoke-ConsoleJson -Method POST -Path '/api/dhcp-mode' -Body @{ mode = $Mode }
    if ([string] $response.result.dhcpMode -ne $Mode) {
        throw 'Web Console did not apply DHCP server mode.'
    }
    $response.state
}

function Get-ActiveProfileId {
    param([Parameter(Mandatory)] $State)

    $configured = [string] (Get-OptionalProperty -Object $script:Config -Name 'profileId')
    if (-not [string]::IsNullOrWhiteSpace($configured)) {
        return $configured
    }
    $active = Get-OptionalProperty -Object $State.profile -Name 'activeProfile'
    $profileId = [string] (Get-OptionalProperty -Object $active -Name 'id')
    if ([string]::IsNullOrWhiteSpace($profileId)) {
        throw 'No active deployment profile is available for Lab regression.'
    }
    $profileId
}

function Publish-ActiveProfile {
    param([Parameter(Mandatory)] $State)

    $profileId = Get-ActiveProfileId -State $State
    $response = Invoke-ConsoleJson -Method POST -Path '/api/profile' -TimeoutSec (Get-ConsoleTimeoutSec) -Body @{ profileId = $profileId }
    if ([string] $response.result.profile.id -ne $profileId) {
        throw "Web Console published an unexpected profile: $profileId"
    }
    Write-Evidence -Name 'published-profile.json' -Value @{
        profileId = $profileId
        profile = $response.result.profile
        osImage = $response.result.osImage
        preflight = @($response.result.preflight)
    } | Out-Null
    $response.state
}

function Invoke-ServerPreflight {
    $scriptPath = Join-Path $script:AppRoot 'tools\osdcloud-console\src\serverPreflight.js'
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        throw "Installed server preflight entry point is missing: $scriptPath"
    }
    $stateConfigPath = Join-Path $script:StateRoot 'config\osdcloud-console.json'
    $previousConfig = [Environment]::GetEnvironmentVariable('OSDCLOUD_CONSOLE_CONFIG', 'Process')
    try {
        if (Test-Path -LiteralPath $stateConfigPath -PathType Leaf) {
            $env:OSDCLOUD_CONSOLE_CONFIG = $stateConfigPath
        }
        $output = (& node $scriptPath '--json' 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($output)) {
            throw 'server:preflight returned a failure.'
        }
        $result = $output | ConvertFrom-Json
        if ($result.ok -ne $true) {
            throw 'server:preflight reported a blocking failure.'
        }
        Write-Evidence -Name 'server-preflight.json' -Value $result | Out-Null
        $result
    }
    catch {
        throw 'server:preflight failed; DHCP will not be started.'
    }
    finally {
        [Environment]::SetEnvironmentVariable('OSDCLOUD_CONSOLE_CONFIG', $previousConfig, 'Process')
    }
}

function Invoke-ApiPreflight {
    $response = Invoke-ConsoleJson -Method POST -Path '/api/preflight' -TimeoutSec (Get-ConsoleTimeoutSec) -Body @{}
    $checks = @($response.result)
    $failures = @($checks | Where-Object { $_.ok -ne $true })
    Write-Evidence -Name 'api-preflight.json' -Value $checks | Out-Null
    if ($failures.Count -gt 0) {
        throw "API preflight has blocking failures: $($failures.name -join ', ')"
    }
    $checks
}

function Clear-DeploymentStatus {
    $response = Invoke-ConsoleJson -Method POST -Path '/api/status/clear' -Body @{}
    Write-Evidence -Name 'status-clear.json' -Value @{ ok = $response.ok } | Out-Null
}

function Start-LabServices {
    $state = Get-ConsoleState
    Assert-ConsoleEndpoint -State $state
    if (-not $script:PreflightPassed) {
        throw 'Internal guard refused to start services before preflight passed.'
    }
    $body=@{}
    if($script:RoundClientMacs.Count){$body.acceptanceClients=$script:RoundClientMacs}
    $response = Invoke-ConsoleJson -Method POST -Path '/api/services/start-all' -TimeoutSec (Get-ConsoleTimeoutSec) -Body $body
    $services = $response.state.services
    if ($services.http.running -ne $true -or $services.tftp.running -ne $true -or $services.dhcp.running -ne $true) {
        throw 'One or more deployment services did not start.'
    }
    Write-Evidence -Name 'services-started.json' -Value $services | Out-Null
    $services
}

function Stop-KnownLabProcesses {
    $appPattern = [regex]::Escape($script:AppRoot)
    $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessId -ne $PID -and
        $_.Name -in @('node.exe', 'powershell.exe', 'pwsh.exe') -and
        [string] $_.CommandLine -match $appPattern -and
        [string] $_.CommandLine -match '(?i)(webServer\.js|Start-WebConsoleTray\.ps1|osdcloud-console)'
    })
    foreach ($process in $processes) {
        Stop-Process -Id ([int] $process.ProcessId) -Force -ErrorAction SilentlyContinue
    }
}

function Stop-LabServices {
    $stoppedViaApi = $false
    try {
        if ($script:WebBaseUri -and (Test-WebConsoleHealthy)) {
            $response = Invoke-ConsoleJson -Method POST -Path '/api/services/stop-all' -Body @{}
            Write-Evidence -Name 'services-stopped.json' -Value $response.state.services | Out-Null
            if(-not $response.state.services -or @($response.state.services.psobject.Properties|Where-Object {$_.Value.running}).Count){throw 'Lab services did not stop completely.'}
            $stoppedViaApi = $true
        }
    }
    catch {
        $script:CleanupErrors.Add('Web Console service stop failed.') | Out-Null
    }
    finally {
        if (-not $stoppedViaApi) {
            Stop-KnownLabProcesses
        }
    }
}

function Get-LabFirmwareConfig {
    $firmware = Get-OptionalProperty -Object $script:Config -Name 'firmware'
    $secureBootVms = @($script:Config.secureBootVms)
    $ipxeVm = [string] $script:Config.ipxeVm
    [pscustomobject]@{
        secureBootTpmOn = if ($firmware -and (Get-OptionalProperty -Object $firmware -Name 'secureBootTpmOn')) { @($firmware.secureBootTpmOn) } else { $secureBootVms }
        secureBootTpmOff = if ($firmware -and (Get-OptionalProperty -Object $firmware -Name 'secureBootTpmOff')) { [string] $firmware.secureBootTpmOff } else { [string] $secureBootVms[0] }
        ipxeTpmOff = if ($firmware -and (Get-OptionalProperty -Object $firmware -Name 'ipxeTpmOff')) { [string] $firmware.ipxeTpmOff } else { $ipxeVm }
        ipxeTpmOn = if ($firmware -and (Get-OptionalProperty -Object $firmware -Name 'ipxeTpmOn')) { [string] $firmware.ipxeTpmOn } else { $ipxeVm }
    }
}

function Set-LabVmTpmEnabled {
    # Winception-Clean does not keep Hyper-V TPM; apply the requested TPM state after firmware.
    param(
        [Parameter(Mandatory)][string] $VmName,
        [Parameter(Mandatory)][bool] $Enabled
    )

    $security = Get-VMSecurity -VMName $VmName -ErrorAction Stop
    $tpmOn = $false
    $tpmProp = $security.PSObject.Properties['TpmEnabled']
    if ($tpmProp -and $null -ne $tpmProp.Value) {
        $tpmOn = [bool] $tpmProp.Value
    }
    if ($Enabled) {
        if (-not $tpmOn) {
            $protector = Get-VMKeyProtector -VMName $VmName -ErrorAction SilentlyContinue
            $protectorLength = 0
            if ($protector -is [byte[]]) {
                $protectorLength = $protector.Length
            }
            if ($protectorLength -lt 32) {
                Set-VMKeyProtector -VMName $VmName -NewLocalKeyProtector -ErrorAction Stop
            }
            Enable-VMTPM -VMName $VmName -ErrorAction Stop
            $security = Get-VMSecurity -VMName $VmName -ErrorAction Stop
            $tpmProp = $security.PSObject.Properties['TpmEnabled']
            $tpmOn = $tpmProp -and $null -ne $tpmProp.Value -and [bool] $tpmProp.Value
        }
        if (-not $tpmOn) {
            throw "$VmName TPM is off; expected TPM on after firmware apply."
        }
        return
    }

    if ($tpmOn) {
        Disable-VMTPM -VMName $VmName -ErrorAction Stop
        $security = Get-VMSecurity -VMName $VmName -ErrorAction Stop
        $tpmProp = $security.PSObject.Properties['TpmEnabled']
        $tpmOn = $tpmProp -and $null -ne $tpmProp.Value -and [bool] $tpmProp.Value
    }
    if ($tpmOn) {
        throw "$VmName TPM is on; expected TPM off after firmware apply."
    }
}

function Set-VmFirmwareMode {
    param(
        [Parameter(Mandatory)][string] $VmName,
        [Parameter(Mandatory)][bool] $SecureBoot,
        [Parameter(Mandatory)][bool] $Tpm
    )

    if ($SecureBoot) {
        Set-VMFirmware -VMName $VmName -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows
    }
    else {
        Set-VMFirmware -VMName $VmName -EnableSecureBoot Off
    }
    Set-LabVmTpmEnabled -VmName $VmName -Enabled $Tpm
    $firmware = Get-VMFirmware -VMName $VmName -ErrorAction Stop
    $bootOrder = Get-FirmwareBootOrderEntries -Firmware $firmware
    if (-not (Test-FirmwareNetworkFirst -BootOrder $bootOrder)) {
        $networkSource = Get-FirmwareNetworkBootSource -BootOrder $bootOrder
        if (-not $networkSource) { throw "$VmName has no Network firmware boot source." }
        $adapter = Get-VMNetworkAdapter -VMName $VmName -ErrorAction Stop | Select-Object -First 1
        if ((Get-FirmwareBootDeviceId -Entry $networkSource) -ne [string] $adapter.Id) { throw "$VmName firmware Network source does not match its current adapter." }
        Set-VMFirmware -VMName $VmName -FirstBootDevice $networkSource -ErrorAction Stop
    }
    $firmware = Get-VMFirmware -VMName $VmName -ErrorAction Stop
    if (-not (Test-FirmwareNetworkFirst -BootOrder (Get-FirmwareBootOrderEntries -Firmware $firmware))) { throw "$VmName is not Network-first after firmware apply." }
}

function Restore-LabCheckpoint {
    param(
        [Parameter(Mandatory)][string[]] $VmNames,
        $RoundFirmware = $null
    )

    $failures = New-Object System.Collections.Generic.List[string]
    foreach ($vmName in $VmNames) {
        try {
            $vm = Get-VM -Name $vmName -ErrorAction Stop
            if ([string] $vm.State -ne 'Off') {
                Stop-VM -Name $vmName -TurnOff -Force -Confirm:$false -ErrorAction Stop | Out-Null
            }
        } catch { $failures.Add("$vmName stop failed: $($_.Exception.Message)") }
    }
    foreach ($vmName in $VmNames) {
        try {
            $startedAt = Get-Date
            if ([string] (Get-VM -Name $vmName -ErrorAction Stop).State -ne 'Off') { throw 'VM is not Off.' }
            # Hyper-V may still be committing the preceding stop/configuration transaction.
            # Let VMMS settle before asking it to switch checkpoint storage.
            Start-Sleep -Seconds 2
            Restore-VMSnapshot -VMName $vmName -Name ([string] $script:Config.checkpointName) -Confirm:$false -ErrorAction Stop
            $settled = $false
            $previousSource = ''
            for ($attempt = 0; $attempt -lt 15; $attempt++) {
                $vm = Get-VM -Name $vmName -ErrorAction Stop
                $firmware = Get-VMFirmware -VMName $vmName -ErrorAction Stop
                $adapter = Get-VMNetworkAdapter -VMName $vmName -ErrorAction Stop | Select-Object -First 1
                $network = Get-FirmwareNetworkBootSource -BootOrder (Get-FirmwareBootOrderEntries -Firmware $firmware)
                if ($network -and [string] $vm.State -eq 'Off' -and (Get-FirmwareBootDeviceId -Entry $network) -eq [string] $adapter.Id) {
                    if ($previousSource -eq [string] $adapter.Id) { $settled = $true; break }
                    $previousSource = [string] $adapter.Id
                } else { $previousSource = '' }
                Start-Sleep -Seconds 1
            }
            if (-not $settled) { throw 'Network firmware source did not settle within 15 seconds.' }
            $secureBoot = $vmName -in @($script:Config.secureBootVms) -or $vmName -eq 'winception-autolab-router'
            $tpm = $secureBoot
            if ($null -ne $RoundFirmware) {
                $secureBoot = [bool] $RoundFirmware.secureBoot
                $tpm = [bool] $RoundFirmware.tpm
            }
            Set-VmFirmwareMode -VmName $vmName -SecureBoot $secureBoot -Tpm $tpm
            $firmware = Get-VMFirmware -VMName $vmName -ErrorAction Stop
            $expectedSecureBoot = if ($secureBoot) { 'On' } else { 'Off' }
            if ([string] $firmware.SecureBoot -ne $expectedSecureBoot -or [bool] (Get-VMSecurity -VMName $vmName -ErrorAction Stop).TpmEnabled -ne $tpm) { throw 'Restored firmware does not match its expected role.' }
        } catch {
            $failureMessage = [string] $_.Exception.Message
            $failures.Add("$vmName restore failed: $failureMessage")
            try {
                if (Get-Command Write-Evidence -ErrorAction SilentlyContinue) {
                    Write-Evidence -Name ("restore-failed-$vmName.json") -Value @{
                        vmName = $vmName
                        error = $failureMessage
                        stage = 'checkpoint-restore-and-firmware'
                        bootOrder = Convert-FirmwareBootOrderEvidence -BootOrder (Get-FirmwareBootOrderEntries -Firmware (Get-VMFirmware -VMName $vmName -ErrorAction SilentlyContinue))
                        adapterIds = @(Get-VMNetworkAdapter -VMName $vmName | Select-Object -ExpandProperty Id)
                        vmms = @(Get-WinEvent -FilterHashtable @{ LogName='Microsoft-Windows-Hyper-V-VMMS-Admin'; StartTime=$startedAt } -ErrorAction SilentlyContinue | Where-Object { $_.Message -like "*$vmName*" } | Select-Object TimeCreated,Id,Message)
                    } | Out-Null
                }
            } catch {}
        }
    }
    if ($failures.Count) { throw ($failures -join '; ') }
}

function Start-LabVms {
    param([Parameter(Mandatory)][string[]] $VmNames)

    foreach ($vmName in $VmNames) {
        Start-VM -Name $vmName -ErrorAction Stop | Out-Null
    }
}

function Set-LabDeployedDiskFirst {
    param(
        [Parameter(Mandatory)][string] $VmName,
        [Parameter(Mandatory)][string] $Reason
    )

    $vm = Get-VM -Name $VmName -ErrorAction Stop
    $before = Get-VMFirmware -VMName $VmName -ErrorAction Stop
    $disk = Get-VMHardDiskDrive -VMName $VmName -ErrorAction Stop
    if (@($disk).Count -ne 1) {
        throw "$VmName does not have one deployed hard disk to boot."
    }
    if ([string]$vm.State -ne 'Off') {
        Stop-VM -Name $VmName -TurnOff -Force -Confirm:$false -ErrorAction Stop
    }
    Set-VMFirmware -VMName $VmName -FirstBootDevice $disk -ErrorAction Stop
    $after = Get-VMFirmware -VMName $VmName -ErrorAction Stop
    $entries = Get-FirmwareBootOrderEntries -Firmware $after
    $first = if ($entries.Count -gt 0) { $entries[0] } else { $null }
    if ($null -eq $first -or (Get-FirmwareBootDeviceId -Entry $first) -ne [string]$disk.Id) {
        throw "$VmName deployed hard disk was not made the first firmware boot device."
    }
    $safeName = $VmName -replace '[^A-Za-z0-9_-]', '_'
    Write-Evidence -Name ("deployed-disk-boot-$safeName.json") -Value ([ordered]@{
        capturedAt = [DateTimeOffset]::Now.ToString('o')
        vmName = $VmName
        reason = $Reason
        vmStateBefore = [string]$vm.State
        hardDiskId = [string]$disk.Id
        before = Convert-FirmwareBootOrderEvidence -BootOrder (Get-FirmwareBootOrderEntries -Firmware $before)
        after = Convert-FirmwareBootOrderEvidence -BootOrder (Get-FirmwareBootOrderEntries -Firmware $after)
    }) | Out-Null
    Start-VM -Name $VmName -ErrorAction Stop | Out-Null
}

function Get-FirstValue {
    param(
        $Value,
        [Parameter(Mandatory)][string[]] $Names,
        $Default = $null
    )

    foreach ($name in $Names) {
        if ($Value -and $Value.PSObject.Properties[$name] -and $null -ne $Value.$name) {
            return $Value.$name
        }
    }
    $Default
}

function Write-GuestEvidenceHeartbeat {
    param(
        [Parameter(Mandatory)][string] $VmName,
        [Parameter(Mandatory)][string] $Phase,
        [int] $Attempt = 0,
        [int] $ElapsedSeconds = 0,
        [string] $Stage = '',
        [bool] $SessionEstablished = $false
    )

    $evidenceRoot = Get-Variable -Name EvidenceRoot -Scope Script -ErrorAction SilentlyContinue
    if (-not $evidenceRoot -or [string]::IsNullOrWhiteSpace([string] $evidenceRoot.Value) -or
        -not (Get-Command Write-Evidence -ErrorAction SilentlyContinue)) {
        return
    }
    Write-Evidence -Name 'guest-evidence-heartbeat.json' -Value ([ordered]@{
        capturedAt = [DateTimeOffset]::Now.ToString('o')
        vmName = $VmName
        phase = $Phase
        attempt = $Attempt
        elapsedSeconds = $ElapsedSeconds
        stage = $Stage
        sessionEstablished = $SessionEstablished
    }) | Out-Null
}

function Invoke-LabGuestEvidenceCommand {
    param(
        [Parameter(Mandatory)] $Session,
        [Parameter(Mandatory)][scriptblock] $ScriptBlock,
        [object[]] $ArgumentList,
        [Parameter(Mandatory)][string] $VmName,
        [int] $TimeoutSec = 60
    )

    $job = $null
    try {
        $job = Invoke-Command -Session $Session -ScriptBlock $ScriptBlock -ArgumentList $ArgumentList -AsJob -ErrorAction Stop
        if (-not (Wait-Job -Job $job -Timeout $TimeoutSec)) {
            Write-GuestEvidenceHeartbeat -VmName $VmName -Phase 'guest-command-timeout' -Stage 'windows-awaiting' -SessionEstablished $true
            throw "Guest evidence command timed out: $VmName"
        }
        if ($job.State -eq 'Failed') {
            throw "Guest evidence command failed: $VmName"
        }
        Receive-Job -Job $job -ErrorAction Stop
    }
    finally {
        if ($job) {
            Stop-Job -Job $job -ErrorAction SilentlyContinue
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-GuestEvidence {
    param(
        [Parameter(Mandatory)][string] $VmName,
        [Parameter(Mandatory)][pscredential] $Credential
    )

    $startedAt = [DateTimeOffset]::Now
    $deadline = $startedAt.AddMinutes([int] $script:Config.timeouts.guestMinutes)
    $session = $null
    $attempt = 0
    do {
        $attempt++
        Write-GuestEvidenceHeartbeat -VmName $VmName -Phase 'powershell-direct-session' -Attempt $attempt -ElapsedSeconds ([int](([DateTimeOffset]::Now - $startedAt).TotalSeconds))
        try {
            $session = New-PSSession -VMName $VmName -Credential $Credential -ErrorAction Stop
            break
        }
        catch {
            Start-Sleep -Seconds 5
        }
    } while ([DateTimeOffset]::Now -lt $deadline)
    if (-not $session) {
        throw "PowerShell Direct timeout: $VmName"
    }

    try {
        $result = $null
        $attempt = 0
        do {
            $attempt++
            $heartbeatStage = 'windows-awaiting'
            if ($result) {
                $heartbeatStage = [string] $result.stage
            }
            Write-GuestEvidenceHeartbeat -VmName $VmName -Phase 'desktop-readiness' -Attempt $attempt -ElapsedSeconds ([int](([DateTimeOffset]::Now - $startedAt).TotalSeconds)) -Stage $heartbeatStage -SessionEstablished $true
            try {
                $result = Invoke-LabGuestEvidenceCommand -VmName $VmName -Session $session -ArgumentList ([string] $script:Secrets.windowsUsername) -ScriptBlock {
                param([string] $TargetUser)
                $statusPath = 'C:\ProgramData\OSDCloud\DeploymentStatus.json'
                $progressPath = 'C:\ProgramData\OSDCloud\deployment-progress.json'
                $profilePath = 'C:\ProgramData\OSDCloud\Apps\selected-profile.json'
                $status = if (Test-Path -LiteralPath $statusPath) {
                    Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
                } else { $null }
                $progress = if (Test-Path -LiteralPath $progressPath) {
                    Get-Content -LiteralPath $progressPath -Raw | ConvertFrom-Json
                } else { $null }
                $profile = if (Test-Path -LiteralPath $profilePath) {
                    Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
                } else { $null }
                $currentVersion = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue
                $desktopPath = Join-Path "C:\Users\$TargetUser\Desktop" 'OSDCloud-Desktop-Ready.txt'
                $oobe = @(Get-Process -Name 'msoobe', 'CloudExperienceHost', 'FirstLogonAnimator' -ErrorAction SilentlyContinue)
                function Get-RemoteValue {
                    param($Value, [string[]] $Names, $Default = $null)
                    foreach ($name in $Names) {
                        if ($Value -and $Value.PSObject.Properties[$name] -and $null -ne $Value.$name) {
                            return $Value.$name
                        }
                    }
                    $Default
                }
                $steps = @()
                if ($progress -and $progress.PSObject.Properties['completedSteps']) {
                    $steps = @($progress.completedSteps | ForEach-Object {
                        [ordered]@{
                            id = [string] (Get-RemoteValue -Value $_ -Names @('id', 'stepId') -Default '')
                            type = [string] (Get-RemoteValue -Value $_ -Names @('type', 'stepType') -Default '')
                            name = [string] (Get-RemoteValue -Value $_ -Names @('name', 'id', 'stepId') -Default '')
                            status = [string] (Get-RemoteValue -Value $_ -Names @('status') -Default '')
                        }
                    })
                }
                $confirmSecureBootUEFI = $false
                try {
                    $confirmSecureBootUEFI = [bool] (Confirm-SecureBootUEFI)
                }
                catch {
                    $confirmSecureBootUEFI = $false
                }
                $tpmPresent = $false
                $tpmReady = $false
                $tpmEnabled = $false
                $tpmActivated = $false
                try {
                    $tpm = Get-Tpm
                    $tpmPresent = [bool] $tpm.TpmPresent
                    $tpmReady = [bool] $tpm.TpmReady
                    $tpmEnabled = [bool] $tpm.TpmEnabled
                    $tpmActivated = [bool] $tpm.TpmActivated
                }
                catch {
                }
                [ordered]@{
                    computerName = $env:COMPUTERNAME
                    clientId = [string] (Get-RemoteValue -Value $status -Names @('clientId', 'computerName') -Default $env:COMPUTERNAME)
                    runId = [string] (Get-RemoteValue -Value $status -Names @('runId') -Default '')
                    stage = [string] (Get-RemoteValue -Value $status -Names @('stage', 'latestStage', 'status') -Default '')
                    status = [string] (Get-RemoteValue -Value $status -Names @('status') -Default '')
                    desktopReadyFile = Test-Path -LiteralPath $desktopPath
                    explorerRunning = @(
                        Get-Process -Name explorer -ErrorAction SilentlyContinue
                    ).Count -gt 0
                    oobeProcesses = @($oobe | Select-Object -ExpandProperty ProcessName)
                    displayVersion = [string] (Get-RemoteValue -Value $currentVersion -Names @('DisplayVersion', 'ReleaseId') -Default '')
                    currentBuild = [string] (Get-RemoteValue -Value $currentVersion -Names @('CurrentBuild', 'CurrentBuildNumber') -Default '')
                    productName = [string] (Get-RemoteValue -Value $currentVersion -Names @('ProductName') -Default '')
                    profileId = [string] (Get-RemoteValue -Value $status -Names @('profileId', 'selectedProfileId') -Default (Get-RemoteValue -Value $progress -Names @('profileId', 'selectedProfileId') -Default (Get-RemoteValue -Value $profile -Names @('profileId') -Default '')))
                    installSteps = $steps
                    progressStatus = [string] (Get-RemoteValue -Value $progress -Names @('status') -Default '')
                    confirmSecureBootUEFI = $confirmSecureBootUEFI
                    tpmPresent = $tpmPresent
                    tpmReady = $tpmReady
                    tpmEnabled = $tpmEnabled
                    tpmActivated = $tpmActivated
                }
                }
            }
            catch {
                $result = $null
            }
            if ($result -and $result.desktopReadyFile -and $result.explorerRunning -and $result.oobeProcesses.Count -eq 0 -and
                ([string] $result.stage -eq 'windows-desktop-ready' -or [string] $result.status -eq 'completed' -or [string] $result.progressStatus -eq 'completed' -or [string] $result.progressStatus -eq 'succeeded')) {
                $firmware = Get-VMFirmware -VMName $VmName
                $security = Get-VMSecurity -VMName $VmName -ErrorAction Stop
                $result = [pscustomobject] $result
                $result | Add-Member -NotePropertyName vmName -NotePropertyValue $VmName -Force
                $result | Add-Member -NotePropertyName windowsFamily -NotePropertyValue (Get-WindowsFamilyFromBuild -CurrentBuild ([string] $result.currentBuild)) -Force
                $result | Add-Member -NotePropertyName hostSecureBoot -NotePropertyValue ([string] $firmware.SecureBoot) -Force
                $result | Add-Member -NotePropertyName hostSecureBootTemplate -NotePropertyValue ([string] $firmware.SecureBootTemplate) -Force
                $result | Add-Member -NotePropertyName hostTpmEnabled -NotePropertyValue ([bool] $security.TpmEnabled) -Force
                return $result
            }
            Start-Sleep -Seconds 5
        } while ([DateTimeOffset]::Now -lt $deadline)
        throw "Guest did not reach windows-desktop-ready: $VmName"
    }
    finally {
        if ($session) {
            Remove-PSSession -Session $session -ErrorAction SilentlyContinue
        }
    }
}

function Assert-GuestEvidence {
    param(
        [Parameter(Mandatory)] $Evidence,
        [Parameter(Mandatory)][string] $ExpectedProfileId,
        [Parameter(Mandatory)][bool] $ExpectedSecureBoot,
        [Parameter(Mandatory)][bool] $ExpectedTpm
    )

    if (-not $Evidence.desktopReadyFile -or -not $Evidence.explorerRunning -or @($Evidence.oobeProcesses).Count -gt 0) {
        throw "Guest evidence failed desktop/OOBE gate: $($Evidence.computerName)"
    }
    if ([string]::IsNullOrWhiteSpace([string] $Evidence.currentBuild) -or
        [string]::IsNullOrWhiteSpace([string] $Evidence.productName) -or
        [string]::IsNullOrWhiteSpace([string] $Evidence.displayVersion)) {
        throw "Guest evidence is missing Windows version data: $($Evidence.computerName)"
    }
    $windowsFamily = Get-WindowsFamilyFromBuild -CurrentBuild ([string] $Evidence.currentBuild)
    if ($windowsFamily -ne 'Windows 11' -or [string] (Get-OptionalProperty -Object $Evidence -Name 'windowsFamily') -ne 'Windows 11') {
        throw "Guest is not Windows 11 (build $($Evidence.currentBuild), product $($Evidence.productName)): $($Evidence.computerName)"
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedProfileId) -and
        [string] $Evidence.profileId -ne $ExpectedProfileId) {
        throw "Guest profile evidence mismatch: $($Evidence.computerName)"
    }
    if ($ExpectedSecureBoot) {
        if (-not [bool] $Evidence.confirmSecureBootUEFI) {
            throw "Guest Secure Boot is off: $($Evidence.computerName)"
        }
        if ([string] $Evidence.hostSecureBoot -ne 'On' -or [string] $Evidence.hostSecureBootTemplate -ne 'MicrosoftWindows') {
            throw "Host Secure Boot firmware is not MicrosoftWindows On: $($Evidence.computerName)"
        }
    }
    else {
        if ([bool] $Evidence.confirmSecureBootUEFI) {
            throw "Guest Secure Boot is on; expected off: $($Evidence.computerName)"
        }
        if ([string] $Evidence.hostSecureBoot -eq 'On') {
            throw "Host Secure Boot is On; expected Off: $($Evidence.computerName)"
        }
    }
    if ($ExpectedTpm) {
        if (-not [bool] $Evidence.tpmPresent -or -not [bool] $Evidence.tpmReady -or -not [bool] $Evidence.tpmEnabled -or -not [bool] $Evidence.tpmActivated) {
            throw "Guest TPM is not Present/Ready/Enabled/Activated: $($Evidence.computerName)"
        }
        if (-not [bool] $Evidence.hostTpmEnabled) {
            throw "Host Hyper-V TPM is off: $($Evidence.computerName)"
        }
    }
    else {
        if ([bool] $Evidence.hostTpmEnabled) {
            throw "Host Hyper-V TPM is on; expected off: $($Evidence.computerName)"
        }
    }
}

function Get-LatestClientStatusText {
    $latestPath = Join-Path $script:RuntimeRoot 'PXE-HttpRoot\status\latest.json'
    if (-not (Test-Path -LiteralPath $latestPath -PathType Leaf)) {
        return ''
    }
    try {
        $latest = Get-Content -LiteralPath $latestPath -Raw | ConvertFrom-Json
        $parts = New-Object System.Collections.Generic.List[string]
        foreach ($name in @('stage', 'message')) {
            $value = [string] (Get-OptionalProperty -Object $latest -Name $name)
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                $parts.Add($value)
            }
        }
        $tail = Get-OptionalProperty -Object $latest -Name 'logTail'
        if ($tail) {
            $parts.Add((@($tail) -join "`n"))
        }
        return ($parts -join "`n")
    }
    catch {
        return ''
    }
}

function Test-ClientTerminalFailureText {
    param([string] $Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $false
    }
    $normalized = $Text
    # Ignore torrent RPC timeouts only when telemetry or peer-progress context is present.
    $hasTorrentTelemetryWarning = $normalized -match 'Torrent progress telemetry unavailable; download continues'
    $hasPeerTransferProgress = $normalized -match '(?i)(?:Uploading to:|Downloading from:).*\[[Pp]eer\]'
    if ($hasTorrentTelemetryWarning -or $hasPeerTransferProgress) {
        $normalized = [regex]::Replace($normalized, '(?m)^.*TerminatingError\(Invoke-RestMethod\).*$(\r?\n)?', '')
    }
    $normalized -match '(?i)selected-os\.json did not produce|usable OS selection|TerminatingError\(|ParameterArgumentValidationErrorNullNotAllowed|SMB map to Z: failed|OS root path is empty|selected-os\.json not found|Boot session did not provide|System error 86|post-apply-customization-error|windows-metadata-error|UnattendSearchExplicitPath:[^\r\n]*(?:unable to deserialize|error)|Callback_Unattend_InitEngine:[^\r\n]*(?:internal error|error occurred)|Windows Setup encountered an internal error[^\r\n]*unattend answer file'
}

function Write-FleetWaitHeartbeat {
    param(
        [Parameter(Mandatory)][string[]] $VmNames,
        [AllowEmptyCollection()][Parameter(Mandatory)][object[]] $Runs
    )

    if (-not $script:LastFleetWaitHeartbeatAt) {
        $script:LastFleetWaitHeartbeatAt = [DateTimeOffset]::MinValue
    }
    if (([DateTimeOffset]::Now - $script:LastFleetWaitHeartbeatAt).TotalSeconds -lt 15) {
        return
    }

    $vmSnapshot = @($VmNames | ForEach-Object {
        $vm = Get-VM -Name $_ -ErrorAction SilentlyContinue
        $heartbeatService = @()
        if ($vm) {
            $heartbeatService = @(Get-VMIntegrationService -VMName $_ -Name 'Heartbeat' -ErrorAction SilentlyContinue | Select-Object -First 1)
        }
        $heartbeatText = ''
        if ($heartbeatService.Count -gt 0) {
            $heartbeatProperty = $heartbeatService[0].PSObject.Properties['PrimaryStatusDescription']
            if ($heartbeatProperty) {
                $heartbeatText = [string] $heartbeatProperty.Value
            }
        }
        [ordered]@{
            vmName = $_
            state = if ($vm) { [string] $vm.State } else { 'Missing' }
            heartbeat = $heartbeatText
        }
    })
    $runSnapshot = @($Runs | ForEach-Object {
        [ordered]@{
            runId = [string] $_.runId
            status = [string] $_.status
            latestStage = [string] $_.latestStage
        }
    })
    Write-Evidence -Name 'fleet-wait-heartbeat.json' -Value ([ordered]@{
        observedAt = [DateTimeOffset]::Now.ToString('o')
        phase = 'fleet-wait'
        vmNames = @($VmNames)
        runs = $runSnapshot
        vms = $vmSnapshot
    }) | Out-Null
    $script:LastFleetWaitHeartbeatAt = [DateTimeOffset]::Now
}

function Wait-FleetCompletion {
    param(
        [Parameter(Mandatory)][string[]] $VmNames,
        [Parameter(Mandatory)][int] $TimeoutMinutes,
        [switch] $PreferDeployedDisk
    )

    $deadline = [DateTimeOffset]::Now.AddMinutes($TimeoutMinutes)
    $deployedDiskPrepared = @{}
    do {
        $clientText = Get-LatestClientStatusText
        if (Test-ClientTerminalFailureText -Text $clientText) {
            throw "Client reported a terminal WinPE failure: $($clientText.Substring(0, [Math]::Min(300, $clientText.Length)))"
        }
        $state = Get-ConsoleState
        if (-not $state.services.http.running -or -not $state.services.tftp.running -or -not $state.services.dhcp.running) {throw 'Deployment services stopped while waiting for Fleet; aborting this round.'}
        if ($script:RoundDhcpMode -eq 'proxy') {Invoke-LabPairingDecision -VmNames $VmNames | Out-Null}
        $runs = @($state.fleet.runs | Where-Object {
            [string] $_.status -in @('running', 'completed', 'failed', 'stale', 'windows-running', 'awaiting-windows')
        })
        $relevant = @($runs | Sort-Object startedAt -Descending | Select-Object -First $VmNames.Count)
        Write-FleetWaitHeartbeat -VmNames $VmNames -Runs $relevant
        $failures = @($relevant | Where-Object { [string] $_.status -in @('failed', 'stale') })
        if ($failures.Count -gt 0) {
            throw "Fleet reported failure: $($failures[0].runId)"
        }
        if ($PreferDeployedDisk) {
            for ($index = 0; $index -lt $VmNames.Count; $index++) {
                $vmName = $VmNames[$index]
                $run = $relevant | Where-Object { [string]$_.latestStage -eq 'rebooting' } | Select-Object -First 1
                if ($run -and -not $deployedDiskPrepared.ContainsKey($vmName)) {
                    Set-LabDeployedDiskFirst -VmName $vmName -Reason 'router-bootstrap-post-winpe'
                    $deployedDiskPrepared[$vmName] = $true
                }
            }
        }
        $runText = @($relevant | ForEach-Object { [string] $_.latestMessage }) -join "`n"
        if (Test-ClientTerminalFailureText -Text $runText) {
            throw "Fleet latest message is a terminal WinPE failure: $($runText.Substring(0, [Math]::Min(300, $runText.Length)))"
        }
        $ready = @($relevant | Where-Object {
            [string] $_.status -eq 'completed' -and [string] $_.latestStage -eq 'windows-desktop-ready'
        })
        if ($relevant.Count -ge $VmNames.Count -and $ready.Count -eq $VmNames.Count) {
            return $relevant
        }
        Start-Sleep -Seconds 5
    } while ([DateTimeOffset]::Now -lt $deadline)
    throw "Fleet did not reach windows-desktop-ready for $($VmNames.Count) VM(s) within the timeout."
}

function Assert-IpxeArtifacts {
    $httpRoot = Join-Path $script:RuntimeRoot 'PXE-HttpRoot'
    $tftpRoot = Join-Path $script:RuntimeRoot 'PXE-TFTP'
    $bootIpxe = Join-Path $httpRoot 'osdcloud\boot.ipxe'
    $wimboot = Join-Path $httpRoot 'osdcloud\wimboot'
    $snponly = Join-Path $tftpRoot 'ipxeboot\x86_64-sb\snponly.efi'
    if (-not (Test-Path -LiteralPath $bootIpxe -PathType Leaf) -or
        -not (Test-Path -LiteralPath $wimboot -PathType Leaf) -or
        -not (Test-Path -LiteralPath $snponly -PathType Leaf)) {
        throw 'iPXE runtime artifacts are incomplete.'
    }
    $bootText = Get-Content -LiteralPath $bootIpxe -Raw
    $evidence = [ordered]@{
        bootIpxe = $true
        wimboot = $true
        snponly = $true
        bootIpxeContainsWimboot = $bootText -match '(?i)wimboot'
        bootIpxeContainsServiceIp = $bootText -match [regex]::Escape([string] $script:Config.serviceIp)
        expectedUrl = "http://{0}/osdcloud/boot.ipxe" -f [string] $script:Config.serviceIp
    }
    if (-not $evidence.bootIpxeContainsWimboot) {
        throw 'boot.ipxe does not reference wimboot.'
    }
    Write-Evidence -Name 'ipxe-artifacts.json' -Value $evidence | Out-Null
    $evidence
}

function Sync-LabNetworkBootAfterMac {
    param([Parameter(Mandatory)][string] $VmName)

    $adapter = @(Get-VMNetworkAdapter -VMName $VmName -ErrorAction Stop | Where-Object { $_.SwitchName -eq 'Winception-AutoLab' })
    if ($adapter.Count -ne 1) {
        throw "$VmName has no unique Winception-AutoLab adapter after MAC assign."
    }
    $firmware = Get-VMFirmware -VMName $VmName -ErrorAction Stop
    $networkSource = Get-FirmwareNetworkBootSource -BootOrder (Get-FirmwareBootOrderEntries -Firmware $firmware)
    if (-not $networkSource) {
        throw "$VmName has no Network firmware boot source after MAC assign."
    }
    if ((Get-FirmwareBootDeviceId -Entry $networkSource) -ne [string] $adapter[0].Id) {
        throw "$VmName firmware Network source does not match its current adapter after MAC assign."
    }
    Set-VMFirmware -VMName $VmName -FirstBootDevice $networkSource -ErrorAction Stop
    $firmware = Get-VMFirmware -VMName $VmName -ErrorAction Stop
    if (-not (Test-FirmwareNetworkFirst -BootOrder (Get-FirmwareBootOrderEntries -Firmware $firmware))) {
        throw "$VmName is not Network-first after MAC assign."
    }
}

function Set-LabRoundClientScope {
    param([string[]]$VmNames)
    $script:RoundClientMacs=@($VmNames|ForEach-Object {
        $vm=Get-VM -Name $_
        $nic=@(Get-VMNetworkAdapter -VMName $_|Where-Object SwitchName -eq 'Winception-AutoLab')
        if($vm.State -ne 'Off' -or $nic.Count -ne 1){throw 'Round MAC requires one powered-off owned Lab adapter'}
        $mac='00155D'+$vm.Id.ToString('N').Substring(0,6).ToUpperInvariant()
        if(@(Get-VM|Get-VMNetworkAdapter|Where-Object {$_.VMName -ne $vm.Name -and $_.MacAddress -eq $mac}).Count){throw 'Deterministic Lab MAC collides with another VM'}
        Set-VMNetworkAdapter -VMNetworkAdapter $nic[0] -StaticMacAddress $mac
        Sync-LabNetworkBootAfterMac -VmName $vm.Name
        $mac -replace '(.{2})(?!$)','$1-'
    })
}

function Invoke-LabRound {
    param(
        [Parameter(Mandatory)][string] $RoundId,
        [Parameter(Mandatory)][ValidateSet('secureboot', 'ipxe')][string] $BootMode,
        [Parameter(Mandatory)][string[]] $VmNames,
        [Parameter(Mandatory)][bool] $SecureBoot,
        [Parameter(Mandatory)][bool] $Tpm,
        [Parameter(Mandatory)][pscredential] $Credential,
        [Parameter(Mandatory)][string] $ProfileId,
        [ValidateSet('server','proxy')][string] $DhcpMode='server',
        [switch]$CheckNetwork,
        [switch]$KeepGuest
    )

    Write-Host "Starting $RoundId ($BootMode, secureBoot=$SecureBoot, tpm=$Tpm) for $($VmNames.Count) VM(s)."
    Restore-LabCheckpoint -VmNames $VmNames -RoundFirmware @{
        secureBoot = $SecureBoot
        tpm = $Tpm
    }
    Set-LabRoundClientScope -VmNames $VmNames
    Set-ConsoleMode -BootMode $BootMode | Out-Null
    $script:RoundDhcpMode=$DhcpMode
    Set-ConsoleEndpoint | Out-Null
    Set-ConsoleDhcpServerMode -Mode $DhcpMode | Out-Null
    $cliPreflight = Invoke-ServerPreflight
    $apiPreflight = Invoke-ApiPreflight
    $script:PreflightPassed = $true
    Clear-DeploymentStatus
    Start-LabServices | Out-Null
    try {
        Start-LabVms -VmNames $VmNames
        $fleet = Wait-FleetCompletion -VmNames $VmNames -TimeoutMinutes ([int] $script:Config.timeouts.deploymentMinutes) -PreferDeployedDisk:$KeepGuest
        $guest = New-Object System.Collections.Generic.List[object]
        foreach ($vmName in $VmNames) {
            $result = Get-GuestEvidence -VmName $vmName -Credential $Credential
            Assert-GuestEvidence -Evidence $result -ExpectedProfileId $ProfileId -ExpectedSecureBoot $SecureBoot -ExpectedTpm $Tpm
            $guest.Add($result)
        }
        $fleetRunIds = @($fleet | ForEach-Object { [string] $_.runId })
        $guestRunIds = @($guest | ForEach-Object { [string] $_.runId } | Where-Object { $_ })
        $missingRunEvidence = @($guestRunIds | Where-Object { $_ -notin $fleetRunIds })
        if ($missingRunEvidence.Count -gt 0) {
            throw 'PowerShell Direct guest run IDs did not match Fleet evidence.'
        }
        if ($BootMode -eq 'ipxe') {
            Assert-IpxeArtifacts | Out-Null
        }
        $guestRecords = ConvertTo-ObjectList -Value $guest
        $hostFirmware = New-Object System.Collections.Generic.List[object]
        foreach ($item in $guestRecords) {
            $hostFirmware.Add([ordered]@{
                vmName = [string] (Get-OptionalProperty -Object $item -Name 'vmName')
                hostSecureBoot = [string] (Get-OptionalProperty -Object $item -Name 'hostSecureBoot')
                hostSecureBootTemplate = [string] (Get-OptionalProperty -Object $item -Name 'hostSecureBootTemplate')
                hostTpmEnabled = [bool] (Get-OptionalProperty -Object $item -Name 'hostTpmEnabled')
            })
        }
        $missingHostFirmware = ConvertTo-ObjectList -Value ($hostFirmware | Where-Object { [string]::IsNullOrWhiteSpace([string] $_.vmName) })
        if ($hostFirmware.Count -ne $VmNames.Count -or $missingHostFirmware.Count -gt 0) {
            throw 'Host firmware evidence is incomplete.'
        }
        $round = [ordered]@{
            roundId = $RoundId
            bootMode = $BootMode
            secureBoot = $SecureBoot
            tpm = $Tpm
            vmNames = $VmNames
            fleet = @($fleet)
            guest = $guestRecords
            hostFirmware = $hostFirmware
            preflight = [ordered]@{
                cli = $cliPreflight
                api = $apiPreflight
            }
        }
        if ($CheckNetwork) {
            $expectedDhcp=if($DhcpMode -eq 'proxy'){'192.168.177.254'}else{'192.168.177.1'}
            $before=Get-LabNetworkEvidence -VmName $VmNames[0] -Credential $Credential -ExpectedDhcp $expectedDhcp
            Stop-LabServices
            $after=Get-LabNetworkEvidence -VmName $VmNames[0] -Credential $Credential -ExpectedDhcp $expectedDhcp
            $round.network=@{status='Passed';beforeStop=$before;afterStop=$after}
        }
        Write-Evidence -Name ("round-{0}.json" -f $RoundId) -Value $round | Out-Null
        return $round
    }
    finally {
        Stop-LabServices
        if ($CheckNetwork) {Stop-LabRouter -Config $script:Config}
        if (-not $KeepGuest) {Restore-LabCheckpoint -VmNames $VmNames}
        $script:PreflightPassed = $false
        if($script:CleanupErrors.Count -gt 0){throw 'Lab cleanup failed; no next round is permitted.'}
    }
}

function Acquire-LabLock {
    $script:LabMutex = [System.Threading.Mutex]::new($false, 'Global\Winception-AutoLab')
    if (-not $script:LabMutex.WaitOne(0)) {
        throw 'Winception AutoLab is already running; refusing concurrent mutation.'
    }
}

function Release-LabLock {
    if ($script:LabMutex) {
        try {
            $script:LabMutex.ReleaseMutex() | Out-Null
        }
        catch {
        }
        $script:LabMutex.Dispose()
        $script:LabMutex = $null
    }
}

function Invoke-LabCleanup {
    if ($script:CleanupComplete) {
        return
    }
    $script:CleanupComplete = $true
    if ($ValidateOnly -or -not $script:MutationStarted) {
        try { Restore-SecretEnvironment } catch { $script:CleanupErrors.Add('secret environment cleanup failed.') | Out-Null }
        Release-LabLock
        return
    }
    try { Stop-LabServices } catch { $script:CleanupErrors.Add('service cleanup failed.') | Out-Null }
    if ($script:Config) {try {Stop-LabRouter -Config $script:Config -SkipReadyRestore:$script:RouterReadyCreatedThisRun} catch {$script:CleanupErrors.Add('Router cleanup failed.')|Out-Null}}
    if ($script:AcceptanceProfileId) {
        try {
            Wait-ConsoleIdle
            Invoke-ConsoleJson -Method POST -Path '/api/profile' -TimeoutSec (Get-ConsoleTimeoutSec) -Body @{profileId=$script:AcceptanceOriginalProfile}|Out-Null
            Wait-ConsoleIdle
            Invoke-ConsoleJson -Method POST -Path '/api/profiles/delete' -TimeoutSec (Get-ConsoleTimeoutSec) -Body @{profileId=$script:AcceptanceProfileId}|Out-Null
        } catch {$script:CleanupErrors.Add("Test profile restoration failed: $($_.Exception.Message)")|Out-Null}
        try { Wait-ConsoleIdle } catch { $script:CleanupErrors.Add('console idle wait failed.') | Out-Null }
    }
    if ($script:AcceptanceSavedState) {
        try {
            $old=$script:AcceptanceSavedState.config
            Invoke-ConsoleJson -Method POST -Path '/api/endpoint' -TimeoutSec (Get-ConsoleTimeoutSec) -Body @{interfaceAlias=$old.adapter.interfaceAlias;ipAddress=$old.adapter.serverIp;prefixLength=$old.adapter.prefixLength;dhcpMode=$old.dhcp.dhcpMode;leaseStartIp=$old.dhcp.leaseStartIp;leaseEndIp=$old.dhcp.leaseEndIp;gateway=$old.dhcp.router;dnsServers=@($old.dhcp.dnsServers)}|Out-Null
        } catch {$script:CleanupErrors.Add('Endpoint restoration failed.')|Out-Null}
        try { Wait-ConsoleIdle } catch { $script:CleanupErrors.Add('console idle wait failed.') | Out-Null }
    }
    try {
        if ($script:WebBaseUri -and (Test-WebConsoleHealthy)) {
            Set-ConsoleMode -BootMode 'secureboot' | Out-Null
        }
    }
    catch {
        $script:CleanupErrors.Add('secureboot default restore failed.') | Out-Null
    }
    try { Collect-SafeRuntimeEvidence } catch { $script:CleanupErrors.Add('runtime evidence collection failed.') | Out-Null }
    try {
        if ($script:WebBaseUri -and (Test-WebConsoleHealthy)) {
            Clear-DeploymentStatus
        }
    }
    catch {
        $script:CleanupErrors.Add('status cleanup failed.') | Out-Null
    }
    try {
        if ($script:Config) {
            Restore-LabCheckpoint -VmNames (@($script:Config.secureBootVms) + @([string] $script:Config.ipxeVm))
        }
    }
    catch {
        $script:CleanupErrors.Add("VM checkpoint cleanup failed: $($_.Exception.Message)") | Out-Null
    }
    try { Restore-SecretEnvironment } catch { $script:CleanupErrors.Add('secret environment cleanup failed.') | Out-Null }
    Release-LabLock
}

function Register-LabExitCleanup {
    Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
        try { Invoke-LabCleanup } catch {}
    } | Out-Null
}

function New-DeploymentCredential {
    $securePassword = ConvertTo-SecureString -String ([string] $script:Secrets.windowsPassword) -AsPlainText -Force
    [pscredential]::new([string] $script:Secrets.windowsUsername, $securePassword)
}

$script:PreflightPassed = $false
try {
    Assert-CommandAvailable -Name 'Get-VMSwitch'
    Assert-CommandAvailable -Name 'Get-VM'
    Assert-CommandAvailable -Name 'Get-VMSnapshot'
    Assert-CommandAvailable -Name 'Get-VMFirmware'
    Assert-CommandAvailable -Name 'Get-VMMemory'
    Assert-CommandAvailable -Name 'Get-VMSecurity'
    Assert-CommandAvailable -Name 'Set-VMKeyProtector'
    Assert-CommandAvailable -Name 'Get-VMKeyProtector'
    Assert-CommandAvailable -Name 'Enable-VMTPM'
    Assert-CommandAvailable -Name 'Disable-VMTPM'
    Assert-CommandAvailable -Name 'New-PSSession'

    if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        $candidate = Join-Path $script:RepoRoot 'config\lab-regression.json'
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $candidate = Join-Path $script:RepoRoot 'config\lab-regression.example.json'
        }
        $ConfigPath = $candidate
    }
    $script:Config = Read-LabConfig -Path (Resolve-Path -LiteralPath $ConfigPath -ErrorAction Stop).ProviderPath
    Assert-LabConfig -Config $script:Config
    $script:WebBaseUri = Get-WebBaseUri
    $script:SelectedVms = @($script:Config.secureBootVms) + @([string] $script:Config.ipxeVm)
    Acquire-LabLock
    Register-LabExitCleanup
    $guard = Assert-LabRunnerGuard
    Assert-LabPortsFree
    if (-not $ValidateOnly) {
        $stateBackup=New-AcceptanceStateBackup $script:StateRoot
        if(-not (Test-WebConsoleHealthy)){throw 'Installed Console must be ready before preserving the acceptance endpoint.'}
        $script:AcceptanceSavedState=Get-ConsoleState
        if (-not (Test-ConsoleIsIdle -State $script:AcceptanceSavedState)) { throw 'Installed host must be idle before acceptance mutation.' }
        $script:MutationStarted=$true
        Stop-LabServices
        Restore-LabCheckpoint -VmNames $script:SelectedVms
    }
    $script:Secrets = Read-LabSecrets
    Set-SecretEnvironment -Secrets $script:Secrets
    if (-not $ValidateOnly) {
        New-Item -ItemType Directory -Path $script:EvidenceRoot -Force | Out-Null
        Write-Evidence -Name 'runner-guard.json' -Value $guard | Out-Null
    }

    if ($ValidateOnly) {
        $cacheStatus = Test-CacheManifest -ManifestPath (Get-FullPath ([string] $script:Config.cache.manifestPath))
        Write-Evidence -Name 'validate-only.json' -Value @{
            validateOnly = $true
            guard = $guard
            cache = $cacheStatus
            secretStore = [ordered]@{ path = $script:Secrets.storePath; ready = $true }
        } | Out-Null
        if (-not $cacheStatus.valid) {
            throw "ValidateOnly cache check failed: $($cacheStatus.reason)"
        }
        [pscustomobject]@{ ok = $true; validateOnly = $true; evidenceRoot = $script:EvidenceRoot } | ConvertTo-Json -Depth 8
        exit 0
    }

    Write-Evidence -Name 'state-backup.json' -Value @{path=$stateBackup}|Out-Null
    Invoke-ExternalPowerShell -ScriptPath (Join-Path $script:RepoRoot 'tools\Initialize-DeploymentServer.ps1') -Arguments @(
        '-LiveRoot', $script:RuntimeRoot,
        '-StateRoot', $script:StateRoot,
        '-InterfaceAlias', [string] $script:Config.serviceInterfaceAlias,
        '-ServerIp', [string] $script:Config.serviceIp,
        '-PrefixLength', [string] $script:Config.prefixLength,
        '-ClientGateway', [string] $script:Config.dhcp.router,
        '-SkipTests',
        '-SkipPreflight',
        '-NoLaunch',
        '-NoAdkAutoInstall'
    )
    Ensure-LabCache | Out-Null
    Ensure-WebConsole
    $state = Save-ConsoleStateEvidence -Name 'state-after-start.json'
    $state = Set-ConsoleEndpoint
    $profileId = New-LabAcceptanceProfile

    $rounds = New-Object System.Collections.Generic.List[object]
    $credential = New-DeploymentCredential
    if ($BootstrapRouter) {
        $rounds.Add((Invoke-LabRound -RoundId router-bootstrap -BootMode secureboot -VmNames @('winception-autolab-router') -SecureBoot $true -Tpm $true -Credential $credential -ProfileId $profileId -KeepGuest))
        Initialize-LabRouterGuest -Config $script:Config -Credential $credential -SourceRoot $script:RepoRoot
        $script:RouterReadyCreatedThisRun = $true
    }
    if (-not $BootstrapRouter -and $Mode -in @('All', 'SecureBoot')) {
        $rounds.Add((Invoke-LabRound -RoundId 'secureboot-tpm-on' -BootMode 'secureboot' -VmNames @($script:Config.secureBootVms) -SecureBoot $true -Tpm $true -Credential $credential -ProfileId $profileId))
    }
    if (-not $BootstrapRouter -and $Mode -in @('All', 'Ipxe')) {
        $rounds.Add((Invoke-LabRound -RoundId 'ipxe-tpm-off' -BootMode 'ipxe' -VmNames @([string] $script:Config.ipxeVm) -SecureBoot $false -Tpm $false -Credential $credential -ProfileId $profileId))
    }
    if (-not $BootstrapRouter -and $Mode -in @('All', 'FirmwareCorners')) {
        $firmwareRoles = Get-LabFirmwareConfig
        $rounds.Add((Invoke-LabRound -RoundId 'secureboot-tpm-off' -BootMode 'secureboot' -VmNames @([string] $firmwareRoles.secureBootTpmOff) -SecureBoot $true -Tpm $false -Credential $credential -ProfileId $profileId))
        $rounds.Add((Invoke-LabRound -RoundId 'ipxe-tpm-on' -BootMode 'ipxe' -VmNames @([string] $firmwareRoles.ipxeTpmOn) -SecureBoot $false -Tpm $true -Credential $credential -ProfileId $profileId))
    }
    if ($NetworkAcceptance -and -not $BootstrapRouter) {foreach ($networkRound in @(Invoke-LabNetworkRounds -Credential $credential -ProfileId $profileId)) {$rounds.Add($networkRound)}}
    Invoke-LabCleanup
    if ($script:CleanupErrors.Count -gt 0) {
        throw "Lab cleanup failed: $($script:CleanupErrors -join '; ')"
    }
    $result = [ordered]@{
        ok = $true
        layer = 'AutoLab'
        status = 'Passed'
        cleanup = 'Passed'
        physical = 'NotRun'
        human = 'NotRun'
        sourceCommit = [string] (& git -C $script:RepoRoot rev-parse HEAD)
        installedHash = (Get-FileHash (Join-Path $script:AppRoot 'tools\osdcloud-console\src\httpServer.js')).Hash
        winpeHash = (Get-FileHash (Join-Path $script:RuntimeRoot 'PXE-HttpRoot\osdcloud\boot.wim')).Hash
        commit = [string] (Get-OptionalProperty -Object $script:Config -Name 'commit')
        mode = $Mode
        rounds = @($rounds.ToArray())
        evidenceRoot = $script:EvidenceRoot
        completedAt = [DateTimeOffset]::UtcNow.ToString('o')
    }
    Write-Evidence -Name 'result.json' -Value $result | Out-Null
    [IO.File]::WriteAllText((Join-Path $script:EvidenceRoot 'result.html'),('<!doctype html><meta charset="utf-8"><h1>Winception AutoLab</h1><pre>'+[Net.WebUtility]::HtmlEncode(($result|ConvertTo-Json -Depth 20))+'</pre>'))
    $result | ConvertTo-Json -Depth 20
}
catch {
    Invoke-LabCleanup
    $errorRecord = [ordered]@{
        ok = $false
        layer = 'AutoLab'
        status = $(if($script:MutationStarted){'Failed'}else{'Blocked'})
        cleanup = $(if($script:CleanupErrors.Count){'Failed'}elseif($script:MutationStarted){'Passed'}else{'NotRun'})
        physical = 'NotRun'
        human = 'NotRun'
        error = 'Winception Lab regression failed.'
        detail = [string] $_.Exception.Message
        stage = $_.InvocationInfo.ScriptLineNumber
        cleanupErrors = @($script:CleanupErrors.ToArray())
        evidenceRoot = $script:EvidenceRoot
        failedAt = [DateTimeOffset]::UtcNow.ToString('o')
    }
    if ($script:EvidenceRoot -and -not $ValidateOnly) {
        try { Write-Evidence -Name 'result.json' -Value $errorRecord | Out-Null } catch {}
        try {[IO.File]::WriteAllText((Join-Path $script:EvidenceRoot 'result.html'),('<!doctype html><meta charset="utf-8"><h1>Winception AutoLab</h1><pre>'+[Net.WebUtility]::HtmlEncode(($errorRecord|ConvertTo-Json -Depth 20))+'</pre>'))}catch{}
    }
    Write-Error $errorRecord.error -ErrorAction Continue
    $errorRecord | ConvertTo-Json -Depth 20
    exit 1
}
finally {
    Invoke-LabCleanup
}
