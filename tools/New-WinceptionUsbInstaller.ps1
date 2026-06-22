[CmdletBinding(DefaultParameterSetName = 'Usb')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Usb')]
    [switch] $Usb,

    [Parameter(Mandatory, ParameterSetName = 'Usb')]
    [ValidateRange(0, 255)]
    [int] $DiskNumber,

    [Parameter(Mandatory, ParameterSetName = 'Iso')]
    [switch] $Iso,

    [Parameter(ParameterSetName = 'Iso')]
    [string] $OutputPath,

    [Parameter(ParameterSetName = 'Iso')]
    [switch] $OpenInRufus,

    [Parameter(ParameterSetName = 'Iso')]
    [string] $RufusPath,

    [string] $ConfigPath,
    [switch] $CheckOnly
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

$SourceRoot = Split-Path -Parent $PSScriptRoot
$BootPartitionMinimumBytes = 2GB
$BootPartitionHeadroomBytes = 512MB
$DataHeadroomBytes = 1GB
$StagingHeadroomBytes = 4GB
$IsoOutputHeadroomBytes = 1GB
$Fat32MaximumFileBytes = 4GB - 1
$UsbBootLabel = 'WinPE'
$UsbDataLabel = 'OSDCloudUSB'

function Set-ObjectProperty {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)] $Value
    )
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    }
    else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Merge-ConfigObject {
    param(
        [Parameter(Mandatory)] $Base,
        [Parameter(Mandatory)] $Overlay
    )
    foreach ($property in $Overlay.PSObject.Properties) {
        $baseProperty = $Base.PSObject.Properties[$property.Name]
        $overlayValue = $property.Value
        $canRecurse = $baseProperty -and $baseProperty.Value -is [pscustomobject] -and $overlayValue -is [pscustomobject]
        if ($canRecurse) {
            Merge-ConfigObject -Base $baseProperty.Value -Overlay $overlayValue | Out-Null
        }
        else {
            Set-ObjectProperty -Object $Base -Name $property.Name -Value $overlayValue
        }
    }
    return $Base
}

function Resolve-DefaultConfigPath {
    $candidates = @(
        'C:\OSDCloud\HostTools\State\config\osdcloud-console.json',
        (Join-Path (Split-Path -Parent $SourceRoot) 'State\config\osdcloud-console.json'),
        (Join-Path $SourceRoot 'config\osdcloud-console.json')
    )
    $resolved = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $resolved) {
        throw 'Unable to find osdcloud-console.json. Run Setup-DeploymentServer.cmd first or pass -ConfigPath.'
    }
    return (Get-FullPath $resolved)
}

function Read-MergedConfig {
    param([Parameter(Mandatory)][string] $Path)

    $basePath = Get-FullPath $Path
    if (-not (Test-Path -LiteralPath $basePath -PathType Leaf)) {
        throw "Config not found: $basePath"
    }
    $base = Get-Content -LiteralPath $basePath -Raw | ConvertFrom-Json
    $parsed = [System.IO.Path]::GetFileNameWithoutExtension($basePath)
    $localPath = Join-Path (Split-Path -Parent $basePath) "$parsed.local.json"
    if (Test-Path -LiteralPath $localPath -PathType Leaf) {
        $overlay = Get-Content -LiteralPath $localPath -Raw | ConvertFrom-Json
        $base = Merge-ConfigObject -Base $base -Overlay $overlay
    }
    [pscustomobject]@{
        Value = $base
        BasePath = $basePath
        LocalPath = if (Test-Path -LiteralPath $localPath -PathType Leaf) { $localPath } else { $null }
    }
}

function Resolve-ConfiguredPath {
    param(
        [string] $Path,
        [Parameter(Mandatory)][string] $BaseRoot,
        [Parameter(Mandatory)][string] $Label
    )
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "$Label is not configured."
    }
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return (Get-FullPath $Path)
    }
    return (Get-FullPath (Join-Path $BaseRoot $Path))
}

function Test-PathInsideRoot {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $Path
    )
    $rootFull = (Get-FullPath $Root).TrimEnd('\')
    $pathFull = Get-FullPath $Path
    return $pathFull -eq $rootFull -or $pathFull.StartsWith("$rootFull\", [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-AvailableBytesForPath {
    param([Parameter(Mandatory)][string] $Path)
    $root = [System.IO.Path]::GetPathRoot((Get-FullPath $Path))
    if ([string]::IsNullOrWhiteSpace($root)) {
        throw "Unable to resolve drive for path: $Path"
    }
    return [int64] ([System.IO.DriveInfo]::new($root).AvailableFreeSpace)
}

function Assert-AvailableSpace {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][int64] $RequiredBytes,
        [Parameter(Mandatory)][string] $Label
    )
    $availableBytes = Get-AvailableBytesForPath -Path $Path
    if ($availableBytes -lt $RequiredBytes) {
        throw "$Label has insufficient free space. Required=$RequiredBytes Available=$availableBytes Path=$Path"
    }
}

function Assert-RequiredFile {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Label
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label is missing: $Path"
    }
    return (Get-Item -LiteralPath $Path)
}

function Assert-RequiredDirectory {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Label
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label is missing: $Path"
    }
    return (Get-Item -LiteralPath $Path)
}

function Get-AdkIsoTools {
    $root = 'C:\Program Files (x86)\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg'
    $tools = [pscustomobject]@{
        Oscdimg = Join-Path $root 'oscdimg.exe'
        EtfsBoot = Join-Path $root 'etfsboot.com'
        EfiNoPrompt = Join-Path $root 'efisys_noprompt.bin'
    }
    foreach ($property in $tools.PSObject.Properties) {
        Assert-RequiredFile -Path ([string] $property.Value) -Label "ADK $($property.Name)" | Out-Null
    }
    return $tools
}

function Get-RufusExecutable {
    param([string] $RequestedPath)
    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        return (Assert-RequiredFile -Path (Get-FullPath $RequestedPath) -Label 'Rufus executable').FullName
    }
    $command = Get-Command rufus.exe, rufus -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) {
        throw 'Rufus was not found. Install Rufus or pass -RufusPath. Winception does not download Rufus.'
    }
    return $command.Source
}

function Get-UsbDiskIdentity {
    param([Parameter(Mandatory)][int] $Number)

    $disk = Get-Disk -Number $Number -ErrorAction Stop
    if ($disk.IsBoot -or $disk.IsSystem) {
        throw "Refusing system/boot disk $Number."
    }
    if ([string] $disk.BusType -ne 'USB') {
        throw "Refusing non-USB disk $Number (BusType=$($disk.BusType))."
    }
    if ($disk.OperationalStatus -ne 'Online') {
        throw "USB disk $Number is not online."
    }
    [pscustomobject]@{
        Number = [int] $disk.Number
        FriendlyName = [string] $disk.FriendlyName
        SerialNumber = ([string] $disk.SerialNumber).Trim()
        UniqueId = ([string] $disk.UniqueId).Trim()
        Size = [int64] $disk.Size
        Raw = $disk
    }
}

function Assert-SameUsbDisk {
    param(
        [Parameter(Mandatory)] $Expected,
        [Parameter(Mandatory)] $Actual
    )
    if ($Expected.Number -ne $Actual.Number -or $Expected.Size -ne $Actual.Size) {
        throw 'The target USB disk changed after confirmation.'
    }
    if ($Expected.UniqueId -and $Actual.UniqueId -and $Expected.UniqueId -ne $Actual.UniqueId) {
        throw 'The target USB unique ID changed after confirmation.'
    }
    if ($Expected.SerialNumber -and $Actual.SerialNumber -and $Expected.SerialNumber -ne $Actual.SerialNumber) {
        throw 'The target USB serial number changed after confirmation.'
    }
}

function Get-SourceContext {
    param(
        [Parameter(Mandatory)] $LoadedConfig,
        [Parameter(Mandatory)][string] $Mode
    )

    if (-not (Test-IsAdministrator)) {
        throw 'Run this command from an elevated PowerShell session.'
    }
    foreach ($moduleName in @('OSD', 'OSDCloud')) {
        if (-not (Get-Module -ListAvailable $moduleName | Select-Object -First 1)) {
            throw "Required PowerShell module '$moduleName' is not installed. Rerun Setup-DeploymentServer.cmd."
        }
    }

    $config = $LoadedConfig.Value
    $runtimeRoot = if ($config.runtimeArtifacts.liveRoot) {
        Get-FullPath ([string] $config.runtimeArtifacts.liveRoot)
    }
    elseif ($config.paths.osdCloudRoot) {
        Get-FullPath ([string] $config.paths.osdCloudRoot)
    }
    else {
        'C:\OSDCloud'
    }
    $stateRoot = if ($config.paths.stateRoot) {
        Get-FullPath ([string] $config.paths.stateRoot)
    }
    else {
        Get-FullPath (Join-Path (Split-Path -Parent $LoadedConfig.BasePath) '..')
    }
    Assert-RequiredDirectory -Path $runtimeRoot -Label 'Runtime root' | Out-Null
    Assert-RequiredDirectory -Path $stateRoot -Label 'Host state root' | Out-Null

    $mediaRoot = Join-Path $runtimeRoot 'Media'
    $osRoot = Resolve-ConfiguredPath -Path ([string] $config.osImage.cacheRoot) -BaseRoot $runtimeRoot -Label 'OS image root'
    $appsRoot = Resolve-ConfiguredPath -Path ([string] $config.deploymentProfiles.appsRoot) -BaseRoot $runtimeRoot -Label 'Published Apps root'
    $scriptsRoot = if ($config.deploymentProfiles.customScriptsAppsRoot) {
        Resolve-ConfiguredPath -Path ([string] $config.deploymentProfiles.customScriptsAppsRoot) -BaseRoot $runtimeRoot -Label 'Published Scripts root'
    }
    else {
        Join-Path $runtimeRoot 'Media\OSDCloud\Scripts'
    }
    $driverRoot = if ($config.driverPackCache.root) {
        Resolve-ConfiguredPath -Path ([string] $config.driverPackCache.root) -BaseRoot $runtimeRoot -Label 'Driver pack root'
    }
    else {
        Join-Path $runtimeRoot 'Media\OSDCloud\DriverPacks'
    }
    $profilesRoot = Resolve-ConfiguredPath -Path ([string] $config.deploymentProfiles.profilesRoot) -BaseRoot $stateRoot -Label 'Deployment profiles root'
    $activeProfileId = [string] $config.deploymentProfiles.activeProfile
    if ([string]::IsNullOrWhiteSpace($activeProfileId)) {
        throw 'No active deployment profile is configured.'
    }

    Assert-RequiredDirectory -Path $mediaRoot -Label 'Runtime Media root' | Out-Null
    Assert-RequiredFile -Path (Join-Path $profilesRoot "$activeProfileId.json") -Label 'Active deployment profile' | Out-Null
    $selectedOsPath = Join-Path $osRoot 'selected-os.json'
    $selectedProfilePath = Join-Path $appsRoot 'selected-profile.json'
    Assert-RequiredFile -Path $selectedOsPath -Label 'Selected OS manifest' | Out-Null
    Assert-RequiredFile -Path $selectedProfilePath -Label 'Published profile manifest' | Out-Null
    $selectedOs = Get-Content -LiteralPath $selectedOsPath -Raw | ConvertFrom-Json
    $selectedProfile = Get-Content -LiteralPath $selectedProfilePath -Raw | ConvertFrom-Json
    if ($selectedProfile.profileId -ne $activeProfileId) {
        throw "Published profile is stale: active=$activeProfileId published=$($selectedProfile.profileId). Republish the active profile."
    }
    if ($selectedProfile.osImageId -ne $selectedOs.id) {
        throw "Published OS/profile mismatch: profile=$($selectedProfile.osImageId) selected=$($selectedOs.id). Republish the active profile."
    }
    if ([int] $selectedOs.imageIndex -ne 1) {
        throw "The selected deployable WIM must use image index 1; found $($selectedOs.imageIndex)."
    }
    $selectedWim = Assert-RequiredFile -Path (Join-Path $osRoot ([string] $selectedOs.fileName)) -Label 'Selected deployable WIM'
    if ([string]::IsNullOrWhiteSpace([string] $selectedOs.sha256)) {
        throw 'selected-os.json is missing sha256.'
    }
    $actualWimHash = Get-Sha256Hash -LiteralPath $selectedWim.FullName
    if ($actualWimHash -ne ([string] $selectedOs.sha256).ToUpperInvariant()) {
        throw "Selected WIM SHA-256 mismatch: $($selectedWim.FullName)"
    }

    foreach ($supportFile in @('Install-Apps.ps1', 'Show-DeploymentProgress.ps1')) {
        Assert-RequiredFile -Path (Join-Path $appsRoot $supportFile) -Label "Published $supportFile" | Out-Null
    }
    foreach ($softwareId in @($selectedProfile.selectedSoftware)) {
        Assert-RequiredDirectory -Path (Join-Path $appsRoot ([string] $softwareId)) -Label "Selected software $softwareId" | Out-Null
    }
    foreach ($script in @($selectedProfile.scripts)) {
        Assert-RequiredDirectory -Path (Join-Path $scriptsRoot ([string] $script.id)) -Label "Selected custom script $($script.id)" | Out-Null
    }

    if (Test-Path -LiteralPath $driverRoot -PathType Container) {
        $driverPackFiles = @(Get-ChildItem -LiteralPath $driverRoot -File -Force | Where-Object Extension -in @('.cab', '.zip', '.exe'))
        if ($driverPackFiles.Count -gt 0) {
            $driverCachePath = Join-Path $driverRoot 'driverpack-cache.jsonl'
            Assert-RequiredFile -Path $driverCachePath -Label 'Driver pack cache manifest' | Out-Null
            $driverRecords = @(Get-Content -LiteralPath $driverCachePath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object {
                $_ | ConvertFrom-Json
            })
            foreach ($record in @($driverRecords | Where-Object status -eq 'downloaded')) {
                $driverPack = Assert-RequiredFile -Path (Join-Path $driverRoot ([string] $record.fileName)) -Label "Cached driver pack $($record.fileName)"
                if ([int64] $record.bytes -gt 0 -and [int64] $driverPack.Length -ne [int64] $record.bytes) {
                    throw "Cached driver pack size mismatch: $($driverPack.FullName)"
                }
                if ($driverPack.Extension.ToLowerInvariant() -notin @('.cab', '.zip', '.exe')) {
                    throw "Unsupported cached driver pack format: $($driverPack.FullName)"
                }
            }
        }
    }

    $secretsPath = Join-Path $stateRoot 'config\osdcloud-secrets.json'
    Assert-RequiredFile -Path $secretsPath -Label 'Deployment secrets' | Out-Null
    $secrets = Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json
    foreach ($secretName in @('windowsUsername', 'windowsPassword', 'pxeinstallPassword')) {
        if ([string]::IsNullOrWhiteSpace([string] $secrets.$secretName)) {
            throw "Deployment secrets are incomplete: $secretName is missing."
        }
    }

    $requiredBootFiles = @(
        'boot\BCD',
        'boot\boot.sdi',
        'efi\boot\bootx64.efi',
        'efi\microsoft\boot\BCD',
        'sources\boot.wim'
    )
    foreach ($relative in $requiredBootFiles) {
        Assert-RequiredFile -Path (Join-Path $mediaRoot $relative) -Label "UEFI boot file $relative" | Out-Null
    }
    $efiSignature = Get-AuthenticodeSignature -LiteralPath (Join-Path $mediaRoot 'efi\boot\bootx64.efi')
    if ($efiSignature.Status -ne 'Valid') {
        throw "EFI boot loader signature is not valid: $($efiSignature.Status)"
    }

    $bootFiles = @(Get-ChildItem -LiteralPath $mediaRoot -File -Recurse -Force | Where-Object {
        -not $_.FullName.StartsWith((Join-Path $mediaRoot 'OSDCloud\'), [System.StringComparison]::OrdinalIgnoreCase)
    })
    $oversizedBootFile = $bootFiles | Where-Object { $_.Length -gt $Fat32MaximumFileBytes } | Select-Object -First 1
    if ($oversizedBootFile) {
        throw "FAT32 boot file exceeds 4 GiB: $($oversizedBootFile.FullName)"
    }
    $bootBytes = [int64] (($bootFiles | Measure-Object Length -Sum).Sum)
    $dataFiles = @(
        $selectedWim,
        (Get-Item -LiteralPath $selectedOsPath),
        (Get-Item -LiteralPath $selectedProfilePath),
        (Get-Item -LiteralPath $secretsPath)
    )
    foreach ($supportFile in @('Install-Apps.ps1', 'Show-DeploymentProgress.ps1')) {
        $dataFiles += Get-Item -LiteralPath (Join-Path $appsRoot $supportFile)
    }
    foreach ($softwareId in @($selectedProfile.selectedSoftware)) {
        $dataFiles += Get-ChildItem -LiteralPath (Join-Path $appsRoot ([string] $softwareId)) -File -Recurse -Force
    }
    foreach ($script in @($selectedProfile.scripts)) {
        $dataFiles += Get-ChildItem -LiteralPath (Join-Path $scriptsRoot ([string] $script.id)) -File -Recurse -Force
    }
    if (Test-Path -LiteralPath $driverRoot -PathType Container) {
        $dataFiles += Get-ChildItem -LiteralPath $driverRoot -File -Recurse -Force
    }
    $dataBytes = [int64] (($dataFiles | Sort-Object FullName -Unique | Measure-Object Length -Sum).Sum)
    $bootPartitionBytes = [int64] [math]::Max($BootPartitionMinimumBytes, $bootBytes + $BootPartitionHeadroomBytes)
    $requiredUsbBytes = [int64] ($bootPartitionBytes + $dataBytes + $DataHeadroomBytes)
    $estimatedMediaBytes = [int64] ($bootBytes + $dataBytes + 256MB)

    $adk = if ($Mode -eq 'Iso') { Get-AdkIsoTools } else { $null }
    $package = Get-Content -LiteralPath (Join-Path $SourceRoot 'package.json') -Raw | ConvertFrom-Json
    [pscustomobject]@{
        Config = $config
        ConfigPath = $LoadedConfig.BasePath
        StateRoot = $stateRoot
        RuntimeRoot = $runtimeRoot
        MediaRoot = $mediaRoot
        OsRoot = $osRoot
        AppsRoot = $appsRoot
        ScriptsRoot = $scriptsRoot
        DriverRoot = $driverRoot
        SecretsPath = $secretsPath
        SelectedOsPath = $selectedOsPath
        SelectedOs = $selectedOs
        SelectedWim = $selectedWim
        SelectedProfilePath = $selectedProfilePath
        SelectedProfile = $selectedProfile
        ActiveProfileId = $activeProfileId
        BootBytes = $bootBytes
        DataBytes = $dataBytes
        BootPartitionBytes = $bootPartitionBytes
        RequiredUsbBytes = $requiredUsbBytes
        EstimatedMediaBytes = $estimatedMediaBytes
        Adk = $adk
        Version = [string] $package.version
    }
}

function Invoke-Robocopy {
    param(
        [Parameter(Mandatory)][string] $Source,
        [Parameter(Mandatory)][string] $Destination,
        [string[]] $ExtraArguments = @()
    )
    [System.IO.Directory]::CreateDirectory($Destination) | Out-Null
    $arguments = @($Source, $Destination, '*.*', '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') + $ExtraArguments
    & robocopy.exe @arguments | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Robocopy failed with exit code $LASTEXITCODE. Source=$Source Destination=$Destination"
    }
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory)][string] $Source,
        [Parameter(Mandatory)][string] $Destination
    )
    Invoke-Robocopy -Source $Source -Destination $Destination
}

function Invoke-Dism {
    param([Parameter(Mandatory)][string[]] $Arguments)
    & dism.exe @Arguments | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "DISM failed with exit code ${LASTEXITCODE}: $($Arguments -join ' ')"
    }
}

function Inject-UsbBootWim {
    param(
        [Parameter(Mandatory)] $Context,
        [Parameter(Mandatory)][string] $StageRoot
    )

    $bootWim = Join-Path $StageRoot 'Media\sources\boot.wim'
    $mountRoot = Join-Path $StageRoot 'Mount'
    [System.IO.Directory]::CreateDirectory($mountRoot) | Out-Null
    $mounted = $false
    $commit = $false
    try {
        Invoke-Dism -Arguments @('/English', '/Mount-Wim', "/WimFile:$bootWim", '/Index:1', "/MountDir:$mountRoot")
        $mounted = $true
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'osdcloud-assets\OSDCloud\WinPE\Windows\System32\Startnet-USB.cmd') -Destination (Join-Path $mountRoot 'Windows\System32\Startnet.cmd') -Force
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'osdcloud-assets\OSDCloud\WinPE\OSDCloud\Maximize-Console.ps1') -Destination (Join-Path $mountRoot 'OSDCloud\Maximize-Console.ps1') -Force
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'osdcloud-assets\OSDCloud\WinPE\OSDCloud\Start-OSDCloud-USB.ps1') -Destination (Join-Path $mountRoot 'OSDCloud\Start-OSDCloud-USB.ps1') -Force

        $shutdownRoot = Join-Path $mountRoot 'OSDCloud\Config\Scripts\Shutdown'
        $setupRoot = Join-Path $mountRoot 'OSDCloud\Config\Scripts\SetupComplete'
        $winceptionRoot = Join-Path $mountRoot 'OSDCloud\Winception'
        [System.IO.Directory]::CreateDirectory($shutdownRoot) | Out-Null
        [System.IO.Directory]::CreateDirectory($setupRoot) | Out-Null
        [System.IO.Directory]::CreateDirectory($winceptionRoot) | Out-Null
        Get-ChildItem -LiteralPath $shutdownRoot -File -Filter '*.ps1' -ErrorAction SilentlyContinue | Remove-Item -Force
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'osdcloud-assets\OSDCloud\WinPE\OSDCloud\Invoke-OobeCustomization-USB.ps1') -Destination (Join-Path $shutdownRoot 'Invoke-OobeCustomization.ps1') -Force
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'osdcloud-assets\OSDCloud\Config\Scripts\Shutdown\Invoke-OobeCustomization.ps1') -Destination (Join-Path $winceptionRoot 'Invoke-OobeCustomization-Core.ps1') -Force
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'osdcloud-assets\OSDCloud\Config\Scripts\SetupComplete\SetupComplete.ps1') -Destination (Join-Path $setupRoot 'SetupComplete.ps1') -Force
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'osdcloud-assets\OSDCloud\Config\Scripts\SetupComplete\SetupComplete.cmd') -Destination (Join-Path $setupRoot 'SetupComplete.cmd') -Force
        Copy-Item -LiteralPath $Context.SecretsPath -Destination (Join-Path $mountRoot 'OSDCloud\secrets.json') -Force
        foreach ($moduleName in @('OSD', 'OSDCloud')) {
            $modulePath = Join-Path $mountRoot "Program Files\WindowsPowerShell\Modules\$moduleName"
            if (-not (Test-Path -LiteralPath $modulePath -PathType Container)) {
                throw "Staged boot.wim is missing required WinPE module '$moduleName'. Run Prepare runtime and Endpoint Sync first."
            }
        }
        $commit = $true
    }
    finally {
        if ($mounted) {
            $mode = if ($commit) { '/Commit' } else { '/Discard' }
            Invoke-Dism -Arguments @('/English', '/Unmount-Wim', "/MountDir:$mountRoot", $mode)
        }
    }
}

function Ensure-IsoBootFiles {
    param(
        [Parameter(Mandatory)] $Context,
        [Parameter(Mandatory)][string] $StageMediaRoot
    )
    $bootRoot = Join-Path $StageMediaRoot 'boot'
    $efiRoot = Join-Path $StageMediaRoot 'efi\microsoft\boot'
    [System.IO.Directory]::CreateDirectory($bootRoot) | Out-Null
    [System.IO.Directory]::CreateDirectory($efiRoot) | Out-Null
    Copy-Item -LiteralPath $Context.Adk.EtfsBoot -Destination (Join-Path $bootRoot 'etfsboot.com') -Force
    Copy-Item -LiteralPath $Context.Adk.EfiNoPrompt -Destination (Join-Path $efiRoot 'efisys_noprompt.bin') -Force
}

function New-UsbManifest {
    param(
        [Parameter(Mandatory)] $Context,
        [Parameter(Mandatory)][string] $StageMediaRoot,
        [Parameter(Mandatory)][string] $MediaId
    )
    $files = New-Object System.Collections.Generic.List[object]
    foreach ($file in Get-ChildItem -LiteralPath $StageMediaRoot -File -Recurse -Force | Sort-Object FullName) {
        $relative = $file.FullName.Substring($StageMediaRoot.Length).TrimStart('\').Replace('\', '/')
        if ($relative -eq 'OSDCloud/winception-usb-manifest.json') {
            continue
        }
        $sensitive = $relative -eq 'OSDCloud/Config/secrets.json'
        $record = [ordered]@{
            path = $relative
            bytes = [int64] $file.Length
        }
        if ($sensitive) {
            $record.sensitive = $true
        }
        else {
            $record.sha256 = Get-Sha256Hash -LiteralPath $file.FullName
        }
        $files.Add($record)
    }
    [ordered]@{
        schemaVersion = 1
        mediaId = $MediaId
        generatedAt = (Get-Date).ToUniversalTime().ToString('o')
        winceptionVersion = $Context.Version
        deploymentMode = 'usb-offline'
        architecture = 'amd64'
        secureBoot = $true
        activeProfileId = $Context.ActiveProfileId
        osImage = [ordered]@{
            id = [string] $Context.SelectedOs.id
            fileName = [string] $Context.SelectedOs.fileName
            imageIndex = [int] $Context.SelectedOs.imageIndex
            bytes = [int64] $Context.SelectedWim.Length
            sha256 = ([string] $Context.SelectedOs.sha256).ToUpperInvariant()
        }
        secretsIncluded = $true
        files = @($files.ToArray())
    }
}

function New-StagedMedia {
    param(
        [Parameter(Mandatory)] $Context,
        [Parameter(Mandatory)][string] $Mode
    )
    $stagingParent = Join-Path $Context.StateRoot '.staging\winception-usb'
    [System.IO.Directory]::CreateDirectory($stagingParent) | Out-Null
    $stageRoot = Join-Path $stagingParent ([guid]::NewGuid().ToString('N'))
    $stageMediaRoot = Join-Path $stageRoot 'Media'
    [System.IO.Directory]::CreateDirectory($stageMediaRoot) | Out-Null

    try {

        Invoke-Robocopy -Source $Context.MediaRoot -Destination $stageMediaRoot -ExtraArguments @('/XD', (Join-Path $Context.MediaRoot 'OSDCloud'))
        $stageOsRoot = Join-Path $stageMediaRoot 'OSDCloud\OS'
        $stageAppsRoot = Join-Path $stageMediaRoot 'OSDCloud\Apps'
        $stageScriptsRoot = Join-Path $stageMediaRoot 'OSDCloud\Scripts'
        $stageDriverRoot = Join-Path $stageMediaRoot 'OSDCloud\DriverPacks'
        $stageConfigRoot = Join-Path $stageMediaRoot 'OSDCloud\Config'
        foreach ($directory in @($stageOsRoot, $stageAppsRoot, $stageScriptsRoot, $stageDriverRoot, $stageConfigRoot)) {
            [System.IO.Directory]::CreateDirectory($directory) | Out-Null
        }

        Copy-Item -LiteralPath $Context.SelectedWim.FullName -Destination $stageOsRoot -Force
        Copy-Item -LiteralPath $Context.SelectedOsPath -Destination $stageOsRoot -Force
        foreach ($supportFile in @('Install-Apps.ps1', 'Show-DeploymentProgress.ps1', 'selected-profile.json')) {
            Copy-Item -LiteralPath (Join-Path $Context.AppsRoot $supportFile) -Destination $stageAppsRoot -Force
        }
        foreach ($softwareId in @($Context.SelectedProfile.selectedSoftware)) {
            Copy-DirectoryContents -Source (Join-Path $Context.AppsRoot ([string] $softwareId)) -Destination (Join-Path $stageAppsRoot ([string] $softwareId))
        }
        foreach ($script in @($Context.SelectedProfile.scripts)) {
            Copy-DirectoryContents -Source (Join-Path $Context.ScriptsRoot ([string] $script.id)) -Destination (Join-Path $stageScriptsRoot ([string] $script.id))
        }
        if (Test-Path -LiteralPath $Context.DriverRoot -PathType Container) {
            Copy-DirectoryContents -Source $Context.DriverRoot -Destination $stageDriverRoot
        }
        Copy-Item -LiteralPath $Context.SecretsPath -Destination (Join-Path $stageConfigRoot 'secrets.json') -Force

        Inject-UsbBootWim -Context $Context -StageRoot $stageRoot
        if ($Mode -eq 'Iso') {
            Ensure-IsoBootFiles -Context $Context -StageMediaRoot $stageMediaRoot
        }
        $mediaId = [guid]::NewGuid().ToString('D')
        $manifest = New-UsbManifest -Context $Context -StageMediaRoot $stageMediaRoot -MediaId $mediaId
        $manifestPath = Join-Path $stageMediaRoot 'OSDCloud\winception-usb-manifest.json'
        [System.IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 12) + [Environment]::NewLine), $Utf8NoBom)
        return [pscustomobject]@{
            Root = $stageRoot
            MediaRoot = $stageMediaRoot
            Manifest = $manifest
            ManifestPath = $manifestPath
        }
    }
    catch {
        if (Test-Path -LiteralPath $stageRoot) {
            Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
        throw
    }
}

function Confirm-UsbErase {
    param([Parameter(Mandatory)] $Disk)
    Write-Host ''
    Write-Host 'WARNING: The following USB disk will be permanently erased.' -ForegroundColor Red
    Write-Host "Disk number : $($Disk.Number)"
    Write-Host "Model       : $($Disk.FriendlyName)"
    Write-Host "Serial      : $($Disk.SerialNumber)"
    Write-Host "Size        : $([math]::Round($Disk.Size / 1GB, 2)) GiB"
    Write-Host 'The resulting USB/ISO contains extractable deployment credentials.' -ForegroundColor Yellow
    $expected = "ERASE DISK $($Disk.Number)"
    $confirmation = Read-Host "Type '$expected' to continue"
    if ($confirmation -cne $expected) {
        throw 'USB erase confirmation did not match. No disk changes were made.'
    }
}

function Initialize-UsbPartitions {
    param(
        [Parameter(Mandatory)] $Disk,
        [Parameter(Mandatory)][int64] $BootPartitionBytes
    )
    Clear-Disk -Number $Disk.Number -RemoveData -RemoveOEM -Confirm:$false -ErrorAction Stop
    Initialize-Disk -Number $Disk.Number -PartitionStyle GPT -ErrorAction Stop | Out-Null
    $bootPartition = New-Partition -DiskNumber $Disk.Number -Size $BootPartitionBytes -GptType '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}' -AssignDriveLetter -ErrorAction Stop
    Format-Volume -Partition $bootPartition -FileSystem FAT32 -NewFileSystemLabel $UsbBootLabel -Confirm:$false -Force | Out-Null
    $dataPartition = New-Partition -DiskNumber $Disk.Number -UseMaximumSize -AssignDriveLetter -ErrorAction Stop
    Format-Volume -Partition $dataPartition -FileSystem NTFS -NewFileSystemLabel $UsbDataLabel -Confirm:$false -Force | Out-Null
    [pscustomobject]@{
        BootRoot = "$($bootPartition.DriveLetter):\"
        DataRoot = "$($dataPartition.DriveLetter):\"
    }
}

function Test-MediaFiles {
    param(
        [Parameter(Mandatory)] $Manifest,
        [Parameter(Mandatory)][scriptblock] $ResolvePath
    )
    foreach ($record in @($Manifest.files)) {
        $targetPath = & $ResolvePath ([string] $record.path)
        if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
            throw "Media verification missing file: $($record.path)"
        }
        $item = Get-Item -LiteralPath $targetPath
        if ([int64] $item.Length -ne [int64] $record.bytes) {
            throw "Media verification size mismatch: $($record.path)"
        }
        if (-not $record.sensitive) {
            $hash = Get-Sha256Hash -LiteralPath $targetPath
            if ($hash -ne ([string] $record.sha256).ToUpperInvariant()) {
                throw "Media verification SHA-256 mismatch: $($record.path)"
            }
        }
    }
}

function Write-UsbMedia {
    param(
        [Parameter(Mandatory)] $Context,
        [Parameter(Mandatory)] $Stage,
        [Parameter(Mandatory)] $ConfirmedDisk
    )
    $actualDisk = Get-UsbDiskIdentity -Number $ConfirmedDisk.Number
    Assert-SameUsbDisk -Expected $ConfirmedDisk -Actual $actualDisk
    $volumes = Initialize-UsbPartitions -Disk $actualDisk -BootPartitionBytes $Context.BootPartitionBytes
    Invoke-Robocopy -Source $Stage.MediaRoot -Destination $volumes.BootRoot -ExtraArguments @('/XD', (Join-Path $Stage.MediaRoot 'OSDCloud'))
    Copy-DirectoryContents -Source (Join-Path $Stage.MediaRoot 'OSDCloud') -Destination (Join-Path $volumes.DataRoot 'OSDCloud')
    Test-MediaFiles -Manifest $Stage.Manifest -ResolvePath {
        param($relative)
        if ($relative.StartsWith('OSDCloud/', [System.StringComparison]::OrdinalIgnoreCase)) {
            return (Join-Path $volumes.DataRoot ($relative.Replace('/', '\')))
        }
        return (Join-Path $volumes.BootRoot ($relative.Replace('/', '\')))
    }
    [pscustomobject]@{
        Mode = 'Usb'
        DiskNumber = $actualDisk.Number
        BootRoot = $volumes.BootRoot
        DataRoot = $volumes.DataRoot
        MediaId = $Stage.Manifest.mediaId
    }
}

function New-UsbIso {
    param(
        [Parameter(Mandatory)] $Context,
        [Parameter(Mandatory)] $Stage,
        [Parameter(Mandatory)][string] $Path
    )
    $isoPath = Get-FullPath $Path
    if (Test-Path -LiteralPath $isoPath) {
        throw "ISO output already exists: $isoPath"
    }
    try {
        [System.IO.Directory]::CreateDirectory((Split-Path -Parent $isoPath)) | Out-Null
        $etfsBoot = Join-Path $Stage.MediaRoot 'boot\etfsboot.com'
        $efiNoPrompt = Join-Path $Stage.MediaRoot 'efi\microsoft\boot\efisys_noprompt.bin'
        $bootData = '2#p0,e,b"{0}"#pEF,e,b"{1}"' -f $etfsBoot, $efiNoPrompt
        $arguments = @('-m', '-o', '-u2', "-bootdata:$bootData", '-udfver102', '-lWINCEPTION', $Stage.MediaRoot, $isoPath)
        $process = Start-Process -FilePath $Context.Adk.Oscdimg -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden
        if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $isoPath -PathType Leaf)) {
            throw "oscdimg failed with exit code $($process.ExitCode)."
        }

        $before = @(Get-Volume | Where-Object DriveLetter | Select-Object -ExpandProperty DriveLetter)
        $mounted = Mount-DiskImage -ImagePath $isoPath -PassThru -ErrorAction Stop
        try {
            Start-Sleep -Seconds 2
            $after = @(Get-Volume | Where-Object DriveLetter | Select-Object -ExpandProperty DriveLetter)
            $driveLetter = Compare-Object -ReferenceObject $before -DifferenceObject $after |
                Where-Object SideIndicator -eq '=>' |
                Select-Object -First 1 -ExpandProperty InputObject
            if (-not $driveLetter) {
                $driveLetter = ($mounted | Get-Volume | Select-Object -First 1 -ExpandProperty DriveLetter)
            }
            if (-not $driveLetter) {
                throw 'Unable to resolve mounted ISO drive letter.'
            }
            $isoRoot = "${driveLetter}:\"
            Test-MediaFiles -Manifest $Stage.Manifest -ResolvePath {
                param($relative)
                Join-Path $isoRoot ($relative.Replace('/', '\'))
            }
        }
        finally {
            Dismount-DiskImage -ImagePath $isoPath -ErrorAction SilentlyContinue | Out-Null
        }
        return (Get-Item -LiteralPath $isoPath)
    }
    catch {
        if (Test-Path -LiteralPath $isoPath -PathType Leaf) {
            Remove-Item -LiteralPath $isoPath -Force -ErrorAction SilentlyContinue
        }
        throw
    }
}

function Write-PreflightSummary {
    param(
        [Parameter(Mandatory)] $Context,
        [Parameter(Mandatory)][string] $Mode,
        $Disk = $null,
        [string] $IsoPath = ''
    )
    Write-Host ''
    Write-Host 'Winception USB installer preflight passed.' -ForegroundColor Green
    Write-Host "Mode            : $Mode"
    Write-Host "Runtime root    : $($Context.RuntimeRoot)"
    Write-Host "Active profile  : $($Context.ActiveProfileId)"
    Write-Host "Selected image  : $($Context.SelectedOs.fileName)"
    Write-Host "Boot bytes      : $($Context.BootBytes)"
    Write-Host "Snapshot bytes  : $($Context.DataBytes)"
    Write-Host "Estimated media : $($Context.EstimatedMediaBytes)"
    if ($Disk) {
        Write-Host "USB disk        : $($Disk.Number) $($Disk.FriendlyName)"
        Write-Host "USB size        : $($Disk.Size)"
        Write-Host "Required bytes  : $($Context.RequiredUsbBytes)"
    }
    if ($IsoPath) {
        Write-Host "ISO output      : $IsoPath"
    }
    Write-Host 'Security        : output media contains extractable deployment credentials' -ForegroundColor Yellow
}

$stage = $null
try {
    if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        $ConfigPath = Resolve-DefaultConfigPath
    }
    $loadedConfig = Read-MergedConfig -Path $ConfigPath
    $mode = if ($PSCmdlet.ParameterSetName -eq 'Usb') { 'Usb' } else { 'Iso' }
    $context = Get-SourceContext -LoadedConfig $loadedConfig -Mode $mode

    if ($mode -eq 'Usb') {
        $targetDisk = Get-UsbDiskIdentity -Number $DiskNumber
        if ($targetDisk.Size -lt $context.RequiredUsbBytes) {
            throw "USB disk is too small. Required=$($context.RequiredUsbBytes) Actual=$($targetDisk.Size)"
        }
        $stagingPath = Join-Path $context.StateRoot '.staging\winception-usb'
        Assert-AvailableSpace -Path $stagingPath -RequiredBytes ($context.EstimatedMediaBytes + $StagingHeadroomBytes) -Label 'USB staging volume'
        Write-PreflightSummary -Context $context -Mode $mode -Disk $targetDisk
        if ($CheckOnly) {
            exit 0
        }
        Confirm-UsbErase -Disk $targetDisk
        $stage = New-StagedMedia -Context $context -Mode $mode
        $result = Write-UsbMedia -Context $context -Stage $stage -ConfirmedDisk $targetDisk
        $result | Format-List
    }
    else {
        if ([string]::IsNullOrWhiteSpace($OutputPath)) {
            $OutputPath = Join-Path $context.RuntimeRoot ("Exports\Winception-USB-{0}.iso" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
        }
        if (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
            throw "ISO output path must be absolute: $OutputPath"
        }
        $OutputPath = Get-FullPath $OutputPath
        if (Test-PathInsideRoot -Root $SourceRoot -Path $OutputPath) {
            throw "ISO output must stay outside the Git workspace: $OutputPath"
        }
        $stagingPath = Join-Path $context.StateRoot '.staging\winception-usb'
        $stagingDrive = [System.IO.Path]::GetPathRoot((Get-FullPath $stagingPath))
        $outputDrive = [System.IO.Path]::GetPathRoot($OutputPath)
        if ($stagingDrive -eq $outputDrive) {
            $combinedBytes = [int64] (($context.EstimatedMediaBytes * 2) + $StagingHeadroomBytes + $IsoOutputHeadroomBytes)
            Assert-AvailableSpace -Path $stagingPath -RequiredBytes $combinedBytes -Label 'Combined ISO staging/output volume'
        }
        else {
            Assert-AvailableSpace -Path $stagingPath -RequiredBytes ($context.EstimatedMediaBytes + $StagingHeadroomBytes) -Label 'ISO staging volume'
            Assert-AvailableSpace -Path $OutputPath -RequiredBytes ($context.EstimatedMediaBytes + $IsoOutputHeadroomBytes) -Label 'ISO output volume'
        }
        $resolvedRufus = if ($OpenInRufus) { Get-RufusExecutable -RequestedPath $RufusPath } else { $null }
        Write-PreflightSummary -Context $context -Mode $mode -IsoPath $OutputPath
        if ($CheckOnly) {
            exit 0
        }
        $stage = New-StagedMedia -Context $context -Mode $mode
        $isoItem = New-UsbIso -Context $context -Stage $stage -Path $OutputPath
        Write-Host "Created and verified ISO: $($isoItem.FullName)" -ForegroundColor Green
        if ($OpenInRufus) {
            Start-Process -FilePath $resolvedRufus -ArgumentList @('--gui', "--iso=$($isoItem.FullName)", '--filesystem=NTFS') | Out-Null
            Write-Host 'Opened Rufus with the ISO and NTFS preference. Select the target disk and start the write in Rufus.'
        }
    }
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
finally {
    if ($stage -and $stage.Root -and (Test-Path -LiteralPath $stage.Root)) {
        $safeStage = Assert-ChildPath -Root (Join-Path $context.StateRoot '.staging\winception-usb') -Path $stage.Root -Label 'USB staging cleanup'
        Remove-Item -LiteralPath $safeStage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
