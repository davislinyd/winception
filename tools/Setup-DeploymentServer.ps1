[CmdletBinding()]
param(
    [string] $LiveRoot = 'C:\OSDCloud',
    [string] $InterfaceAlias,
    [string] $ServerIp = '192.168.88.1',
    [int] $PrefixLength = 24,
    [string] $SmbShareName = 'OSDCloudiPXE',
    [string] $SmbUserName = 'pxeinstall',
    [switch] $UseExistingSecrets,
    [switch] $SkipNpmInstall,
    [switch] $SkipSmoke,
    [switch] $SkipHostShareSetup,
    [switch] $NoLaunch,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $RepoRoot 'config\osdcloud-console.json'
$LocalConfigPath = Join-Path $RepoRoot 'config\osdcloud-console.local.json'
$SecretsPath = Join-Path $RepoRoot 'config\osdcloud-secrets.json'
$SetupStatePath = Join-Path $RepoRoot 'config\deployment-server-setup.local.json'

function Write-Step {
    param([Parameter(Mandatory)][string] $Message)
    Write-Host ''
    Write-Host "== $Message =="
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory)][string] $FilePath,
        [string[]] $ArgumentList = @()
    )

    Push-Location -LiteralPath $RepoRoot
    try {
        Write-Host "+ $FilePath $($ArgumentList -join ' ')"
        if (-not $DryRun) {
            & $FilePath @ArgumentList
            if ($LASTEXITCODE -ne 0) {
                throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
            }
        }
    }
    finally {
        Pop-Location
    }
}

function ConvertFrom-SecureStringToPlainText {
    param([Parameter(Mandatory)] [securestring] $Value)

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Read-SecretValue {
    param([Parameter(Mandatory)][string] $Prompt)

    ConvertFrom-SecureStringToPlainText -Value (Read-Host -Prompt $Prompt -AsSecureString)
}

function Read-ExistingSecrets {
    if (-not (Test-Path -LiteralPath $SecretsPath -PathType Leaf)) {
        return $null
    }
    Get-Content -Raw -LiteralPath $SecretsPath | ConvertFrom-Json
}

function Get-DeploymentSecrets {
    $existing = Read-ExistingSecrets
    if (-not [string]::IsNullOrWhiteSpace($env:OSDCLOUD_DAVIS_PASSWORD) -and -not [string]::IsNullOrWhiteSpace($env:OSDCLOUD_PXEINSTALL_PASSWORD)) {
        return [ordered]@{
            davisPassword = [string] $env:OSDCLOUD_DAVIS_PASSWORD
            pxeinstallPassword = [string] $env:OSDCLOUD_PXEINSTALL_PASSWORD
        }
    }

    if ($existing -and $UseExistingSecrets) {
        return [ordered]@{
            davisPassword = [string] $existing.davisPassword
            pxeinstallPassword = [string] $existing.pxeinstallPassword
        }
    }

    if ($existing) {
        $answer = Read-Host -Prompt "Existing local secrets file found. Keep it? [Y/n]"
        if ([string]::IsNullOrWhiteSpace($answer) -or $answer.Trim().ToLowerInvariant().StartsWith('y')) {
            return [ordered]@{
                davisPassword = [string] $existing.davisPassword
                pxeinstallPassword = [string] $existing.pxeinstallPassword
            }
        }
    }

    [ordered]@{
        davisPassword = Read-SecretValue -Prompt 'Enter local davis account password'
        pxeinstallPassword = Read-SecretValue -Prompt 'Enter WinPE SMB pxeinstall password'
    }
}

function ConvertTo-IPv4UInt {
    param([Parameter(Mandatory)][string] $Address)

    $parts = $Address.Split('.')
    if ($parts.Count -ne 4) {
        throw "Invalid IPv4 address: $Address"
    }
    $value = [uint64]0
    foreach ($part in $parts) {
        $byte = [int] $part
        if ($byte -lt 0 -or $byte -gt 255) {
            throw "Invalid IPv4 address: $Address"
        }
        $value = (($value -shl 8) -bor [uint64] $byte) -band [uint64]4294967295
    }
    $value
}

function ConvertFrom-IPv4UInt {
    param([Parameter(Mandatory)][uint64] $Value)

    @(
        (($Value -shr 24) -band 0xff),
        (($Value -shr 16) -band 0xff),
        (($Value -shr 8) -band 0xff),
        ($Value -band 0xff)
    ) -join '.'
}

function Get-SubnetMaskUInt {
    param([Parameter(Mandatory)][int] $PrefixLength)

    if ($PrefixLength -lt 0 -or $PrefixLength -gt 32) {
        throw "Invalid prefix length: $PrefixLength"
    }
    if ($PrefixLength -eq 0) {
        return [uint64]0
    }
    (([uint64]4294967295 -shl (32 - $PrefixLength)) -band [uint64]4294967295)
}

function Test-IPv4InPrefix {
    param(
        [Parameter(Mandatory)][string] $Address,
        [Parameter(Mandatory)][string] $NetworkAddress,
        [Parameter(Mandatory)][int] $PrefixLength
    )

    $mask = Get-SubnetMaskUInt -PrefixLength $PrefixLength
    ((ConvertTo-IPv4UInt $Address) -band $mask) -eq ((ConvertTo-IPv4UInt $NetworkAddress) -band $mask)
}

function Get-DhcpLeaseRange {
    param(
        [Parameter(Mandatory)][string] $ServerIp,
        [Parameter(Mandatory)][int] $PrefixLength
    )

    $address = ConvertTo-IPv4UInt $ServerIp
    $mask = Get-SubnetMaskUInt -PrefixLength $PrefixLength
    $network = $address -band $mask
    $hostMask = ([uint64]4294967295 -bxor $mask) -band [uint64]4294967295
    $broadcast = $network -bor $hostMask
    $firstUsable = if ($PrefixLength -ge 31) { $network } else { $network + 1 }
    $lastUsable = if ($PrefixLength -ge 31) { $broadcast } else { $broadcast - 1 }
    $preferredStart = $network + 200
    $preferredEnd = $network + 250

    if ($preferredStart -ge $firstUsable -and $preferredEnd -le $lastUsable -and ($address -lt $preferredStart -or $address -gt $preferredEnd)) {
        return [pscustomobject]@{
            Start = ConvertFrom-IPv4UInt $preferredStart
            End = ConvertFrom-IPv4UInt $preferredEnd
        }
    }

    $end = if ($lastUsable -eq $address) { $address - 1 } else { $lastUsable }
    $start = [Math]::Max([double] $firstUsable, [double] ($end - 50))
    if ($address -ge $start -and $address -le $end) {
        if ($address -eq $start) {
            $start += 1
        }
        else {
            $end = $address - 1
        }
    }
    if ($start -gt $end) {
        throw "No DHCP lease range available outside server IP $ServerIp/$PrefixLength"
    }

    [pscustomobject]@{
        Start = ConvertFrom-IPv4UInt ([uint64] $start)
        End = ConvertFrom-IPv4UInt ([uint64] $end)
    }
}

function Get-SubnetCidr {
    param(
        [Parameter(Mandatory)][string] $ServerIp,
        [Parameter(Mandatory)][int] $PrefixLength
    )

    $network = (ConvertTo-IPv4UInt $ServerIp) -band (Get-SubnetMaskUInt -PrefixLength $PrefixLength)
    "$(ConvertFrom-IPv4UInt $network)/$PrefixLength"
}

function Get-SubnetMask {
    param([Parameter(Mandatory)][int] $PrefixLength)

    ConvertFrom-IPv4UInt (Get-SubnetMaskUInt -PrefixLength $PrefixLength)
}

function Get-ServiceInterfaceChoice {
    $records = @(Get-NetAdapter | Sort-Object Name | ForEach-Object {
        $adapter = $_
        $addresses = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -and -not $_.IPAddress.StartsWith('169.254.') } |
            ForEach-Object { "$($_.IPAddress)/$($_.PrefixLength)" })
        [pscustomobject]@{
            Name = $adapter.Name
            Status = $adapter.Status
            LinkSpeed = $adapter.LinkSpeed
            IPv4 = if ($addresses.Count) { $addresses -join ', ' } else { '' }
            Description = $adapter.InterfaceDescription
        }
    })

    $records | Format-Table -AutoSize | Out-Host
    if ([string]::IsNullOrWhiteSpace($InterfaceAlias)) {
        $script:InterfaceAlias = Read-Host -Prompt 'Enter the PXE/client service interface name'
    }
    if ([string]::IsNullOrWhiteSpace($InterfaceAlias)) {
        throw 'Service interface name is required.'
    }
    if (-not $DryRun -and -not (Get-NetAdapter -Name $InterfaceAlias -ErrorAction SilentlyContinue)) {
        throw "Network adapter not found: $InterfaceAlias"
    }

    $ipAnswer = Read-Host -Prompt "Service IP to record [$ServerIp]"
    if (-not [string]::IsNullOrWhiteSpace($ipAnswer)) {
        $script:ServerIp = $ipAnswer.Trim()
    }
    $prefixAnswer = Read-Host -Prompt "Prefix length to record [$PrefixLength]"
    if (-not [string]::IsNullOrWhiteSpace($prefixAnswer)) {
        $script:PrefixLength = [int] $prefixAnswer
    }
}

function Write-LocalConfigOverlay {
    $base = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
    $imageName = [string] $base.paths.imageNamePattern
    if ([string]::IsNullOrWhiteSpace($imageName)) {
        $imageName = '*'
    }
    $gateway = if (-not [string]::IsNullOrWhiteSpace([string] $base.adapter.defaultGateway) -and (Test-IPv4InPrefix -Address ([string] $base.adapter.defaultGateway) -NetworkAddress $ServerIp -PrefixLength $PrefixLength)) {
        [string] $base.adapter.defaultGateway
    }
    else {
        $ServerIp
    }
    $range = Get-DhcpLeaseRange -ServerIp $ServerIp -PrefixLength $PrefixLength
    $share = "\\$ServerIp\$SmbShareName"
    $overlay = [ordered]@{
        adapter = [ordered]@{
            interfaceAlias = $InterfaceAlias
            serverIp = $ServerIp
            prefixLength = $PrefixLength
            defaultGateway = $gateway
            remoteSubnet = Get-SubnetCidr -ServerIp $ServerIp -PrefixLength $PrefixLength
        }
        dhcp = [ordered]@{
            listenIp = $ServerIp
            leaseStartIp = $range.Start
            leaseEndIp = $range.End
            subnetMask = Get-SubnetMask -PrefixLength $PrefixLength
            router = $gateway
            ipxeBootUrl = "http://$ServerIp/osdcloud/boot.ipxe"
        }
        tftp = [ordered]@{
            listenIp = $ServerIp
        }
        http = [ordered]@{
            host = $ServerIp
        }
        smb = [ordered]@{
            share = $share
            imagePath = "$share\OSDCloud\OS\$imageName"
        }
    }

    if ($DryRun) {
        Write-Host "[dry-run] write local config overlay: $LocalConfigPath"
        $overlay | ConvertTo-Json -Depth 8 | Write-Host
        return
    }
    $overlay | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $LocalConfigPath -Encoding UTF8 -Force
}

function Set-FolderReadAccess {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $AccountName
    )

    $acl = Get-Acl -LiteralPath $Path
    $rights = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute -bor
        [System.Security.AccessControl.FileSystemRights]::Synchronize
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $AccountName,
        $rights,
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Ensure-HostSkeletonAndShare {
    param([Parameter(Mandatory)][string] $PxePassword)

    $mediaRoot = Join-Path $LiveRoot 'Win11-iPXE-Lab\Media'
    $osRoot = Join-Path $mediaRoot 'OSDCloud\OS'
    $appsRoot = Join-Path $mediaRoot 'OSDCloud\Apps'
    $scriptsRoot = Join-Path $mediaRoot 'OSDCloud\Scripts'

    if ($DryRun) {
        Write-Host "[dry-run] create $osRoot, $appsRoot, $scriptsRoot"
        Write-Host "[dry-run] create/update local user $SmbUserName and SMB share $SmbShareName at $mediaRoot"
        return
    }

    New-Item -ItemType Directory -Path $osRoot, $appsRoot, $scriptsRoot -Force | Out-Null

    $securePassword = ConvertTo-SecureString $PxePassword -AsPlainText -Force
    $localAccount = "$env:COMPUTERNAME\$SmbUserName"
    $user = Get-LocalUser -Name $SmbUserName -ErrorAction SilentlyContinue
    if ($user) {
        Set-LocalUser -Name $SmbUserName -Password $securePassword -PasswordNeverExpires $true
        Enable-LocalUser -Name $SmbUserName
    }
    else {
        New-LocalUser -Name $SmbUserName -Password $securePassword -Description 'OSDCloud WinPE SMB read-only account' -PasswordNeverExpires | Out-Null
    }

    Set-FolderReadAccess -Path $mediaRoot -AccountName $localAccount
    $share = Get-SmbShare -Name $SmbShareName -ErrorAction SilentlyContinue
    if ($share -and -not ([string] $share.Path).Equals($mediaRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-SmbShare -Name $SmbShareName -Force
        $share = $null
    }
    if (-not $share) {
        New-SmbShare -Name $SmbShareName -Path $mediaRoot -ReadAccess $localAccount -CachingMode None -FolderEnumerationMode AccessBased | Out-Null
    }
    else {
        $existingAccess = @(Get-SmbShareAccess -Name $SmbShareName -ErrorAction Stop | Where-Object {
            $_.AccountName -eq $localAccount -and
            $_.AccessControlType -eq 'Allow' -and
            $_.AccessRight -in @('Read', 'Change', 'Full')
        })
        if ($existingAccess.Count -eq 0) {
            Grant-SmbShareAccess -Name $SmbShareName -AccountName $localAccount -AccessRight Read -Force | Out-Null
        }
    }
}

function Write-SetupState {
    $state = [ordered]@{
        schemaVersion = 1
        generatedAt = (Get-Date).ToUniversalTime().ToString('o')
        repoRoot = $RepoRoot
        liveRoot = $LiveRoot
        interfaceAlias = $InterfaceAlias
        serverIp = $ServerIp
        prefixLength = $PrefixLength
        localConfigPath = $LocalConfigPath
        web = 'http://127.0.0.1:8080'
    }
    if ($DryRun) {
        Write-Host "[dry-run] write setup state: $SetupStatePath"
        return
    }
    $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $SetupStatePath -Encoding UTF8 -Force
}

function Start-WebConsole {
    if ($NoLaunch -or $DryRun) {
        Write-Host 'Web console launch skipped.'
        return
    }
    $escapedRepo = $RepoRoot.Replace("'", "''")
    $command = "Set-Location -LiteralPath '$escapedRepo'; npm run web"
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-NoExit',
        '-Command',
        $command
    )
    Start-Sleep -Seconds 2
    Start-Process 'http://127.0.0.1:8080'
}

try {
    Write-Step 'Checking setup prerequisites'
    if (-not $DryRun -and -not (Test-IsAdministrator)) {
        throw 'Run setup from an elevated PowerShell session or use Setup-DeploymentServer.cmd.'
    }
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        throw "Missing repo config: $ConfigPath"
    }
    Invoke-ExternalCommand -FilePath 'node' -ArgumentList @('--version')
    Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('--version')
    Invoke-ExternalCommand -FilePath 'git' -ArgumentList @('status', '--short', '--branch')

    if (-not $SkipNpmInstall) {
        Write-Step 'Installing Web console dependencies'
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('install')
    }
    if (-not $SkipSmoke) {
        Write-Step 'Running Web console smoke test'
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('run', 'smoke')
    }

    Write-Step 'Collecting local deployment settings'
    $secrets = Get-DeploymentSecrets
    if ([string]::IsNullOrWhiteSpace([string] $secrets.davisPassword) -or [string]::IsNullOrWhiteSpace([string] $secrets.pxeinstallPassword)) {
        throw 'Both davisPassword and pxeinstallPassword are required.'
    }
    if (-not $DryRun) {
        $secrets | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $SecretsPath -Encoding UTF8 -Force
    }

    Get-ServiceInterfaceChoice
    Write-LocalConfigOverlay

    if (-not $SkipHostShareSetup) {
        Write-Step 'Preparing local runtime skeleton and SMB share'
        Ensure-HostSkeletonAndShare -PxePassword ([string] $secrets.pxeinstallPassword)
    }

    Write-SetupState

    Write-Step 'Starting Web console'
    Start-WebConsole

    Write-Step 'Setup completed'
    Write-Host 'Runtime artifacts are not downloaded during setup.'
    Write-Host 'Use the Web console Runtime Readiness panel to prepare runtime artifacts, then sync endpoint and run preflight.'
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
