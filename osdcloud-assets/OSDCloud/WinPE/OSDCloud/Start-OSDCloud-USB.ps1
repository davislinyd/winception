$ErrorActionPreference = 'Stop'

$logRoot = 'X:\OSDCloud\Logs'
$logPath = Join-Path $logRoot 'Start-OSDCloud-USB.log'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Start-Transcript -Path $logPath -Force -ErrorAction SilentlyContinue | Out-Null

function Get-WinceptionUsbRoot {
    $roots = Get-PSDrive -PSProvider FileSystem |
        Where-Object { $_.Name -ne 'X' } |
        ForEach-Object { "$($_.Name):\" }

    $matches = @($roots | Where-Object {
        Test-Path -LiteralPath (Join-Path $_ 'OSDCloud\winception-usb-manifest.json') -PathType Leaf
    })
    if ($matches.Count -ne 1) {
        throw "Expected exactly one Winception USB media root, found $($matches.Count)."
    }
    return $matches[0]
}

function Get-WinceptionBootRoot {
    param([Parameter(Mandatory)][string] $DataRoot)

    $hasBootFiles = {
        param([string] $Root)
        (Test-Path -LiteralPath (Join-Path $Root 'sources\boot.wim') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $Root 'efi\boot\bootx64.efi') -PathType Leaf)
    }
    if (& $hasBootFiles $DataRoot) {
        return $DataRoot
    }

    $bootRoots = @(Get-PSDrive -PSProvider FileSystem |
        Where-Object { $_.Name -ne 'X' -and $_.Root -ne $DataRoot } |
        ForEach-Object { $_.Root } |
        Where-Object { & $hasBootFiles $_ })
    if ($bootRoots.Count -ne 1) {
        throw "Expected exactly one Winception boot volume, found $($bootRoots.Count)."
    }

    try {
        $dataPartition = Get-Partition -DriveLetter $DataRoot.Substring(0, 1) -ErrorAction Stop
        $bootPartition = Get-Partition -DriveLetter $bootRoots[0].Substring(0, 1) -ErrorAction Stop
        if ($dataPartition.DiskNumber -ne $bootPartition.DiskNumber) {
            throw 'Winception boot and data volumes are not on the same disk.'
        }
    }
    catch {
        if ($_.Exception.Message -eq 'Winception boot and data volumes are not on the same disk.') {
            throw
        }
    }
    return $bootRoots[0]
}

function Get-UsbInstallDisk {
    param([Parameter(Mandatory)][string] $MediaRoot)

    $mediaDiskNumbers = @()
    try {
        $driveLetter = $MediaRoot.Substring(0, 1)
        $partition = Get-Partition -DriveLetter $driveLetter -ErrorAction Stop
        $mediaDiskNumbers += [int] $partition.DiskNumber
    }
    catch {
    }

    $eligible = @(Get-Disk | Where-Object {
        $_.OperationalStatus -eq 'Online' -and
        -not $_.IsBoot -and
        -not $_.IsSystem -and
        $_.BusType -notin @('USB', 'SD', 'MMC', 'File Backed Virtual') -and
        $_.Number -notin $mediaDiskNumbers -and
        $_.Size -ge 64GB
    })
    if ($eligible.Count -ne 1) {
        $details = ($eligible | ForEach-Object { "disk $($_.Number) $($_.FriendlyName)" }) -join ', '
        throw "Expected exactly one eligible internal install disk, found $($eligible.Count). $details"
    }
    return $eligible[0]
}

function Test-MediaAlreadyApplied {
    param([Parameter(Mandatory)][string] $MediaId)

    foreach ($drive in Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -ne 'X' }) {
        $metadataPath = Join-Path $drive.Root 'ProgramData\OSDCloud\DeploymentStatus.json'
        if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
            continue
        }
        try {
            $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
            if ($metadata.deploymentMode -eq 'usb-offline' -and
                $metadata.mediaId -eq $MediaId -and
                -not [string]::IsNullOrWhiteSpace([string] $metadata.appliedAt)) {
                return $true
            }
        }
        catch {
        }
    }
    return $false
}

function Test-UsbMediaManifest {
    param(
        [Parameter(Mandatory)][string] $DataRoot,
        [Parameter(Mandatory)][string] $BootRoot,
        [Parameter(Mandatory)] $Manifest
    )

    foreach ($record in @($Manifest.files)) {
        $relativePath = ([string] $record.path).Replace('/', '\')
        $root = if ($relativePath.StartsWith('OSDCloud\', [System.StringComparison]::OrdinalIgnoreCase)) { $DataRoot } else { $BootRoot }
        $path = Join-Path $root $relativePath
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "USB media file is missing: $($record.path)"
        }
        $item = Get-Item -LiteralPath $path
        if ([int64] $item.Length -ne [int64] $record.bytes) {
            throw "USB media file size mismatch: $($record.path)"
        }
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($hash -ne ([string] $record.sha256).ToUpperInvariant()) {
            throw "USB media file hash mismatch: $($record.path)"
        }
    }
}

function Get-DeploymentSecret {
    param(
        [Parameter(Mandatory)][object] $Secrets,
        [Parameter(Mandatory)][string] $Name
    )
    $value = [string] $Secrets.$Name
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "USB deployment secret '$Name' is missing."
    }
    return $value
}

function Get-MatchingOfflineDriverPack {
    param([Parameter(Mandatory)][string] $MediaRoot)

    $driverRoot = Join-Path $MediaRoot 'OSDCloud\DriverPacks'
    $cachePath = Join-Path $driverRoot 'driverpack-cache.jsonl'
    if (-not (Test-Path -LiteralPath $cachePath -PathType Leaf)) {
        return $null
    }

    $product = [string] (Get-MyComputerProduct)
    $model = [string] (Get-MyComputerModel)
    $records = @(Get-Content -LiteralPath $cachePath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object {
        $_ | ConvertFrom-Json
    })
    $matches = @($records | Where-Object {
        $_.status -eq 'downloaded' -and
        ((@($_.product) -contains $product) -or ([string] $_.model -eq $model))
    } | Sort-Object { [datetime] $_.timestamp } -Descending)
    if ($matches.Count -eq 0) {
        Write-Host "No cached driver pack matches product '$product' / model '$model'."
        return $null
    }

    $record = $matches[0]
    $path = Join-Path $driverRoot ([string] $record.fileName)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Matched offline driver pack is missing: $path"
    }
    return [pscustomobject]@{
        Record = $record
        Path = $path
    }
}

function Install-MatchingOfflineDriverPack {
    param($DriverPack)

    if (-not $DriverPack) {
        return
    }
    $item = Get-Item -LiteralPath $DriverPack.Path
    $destination = Join-Path 'C:\Drivers\Winception' $item.BaseName
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    switch ($item.Extension.ToLowerInvariant()) {
        '.cab' {
            & expand.exe -R $item.FullName '-F:*' $destination | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "Offline driver CAB extraction failed: $($item.FullName)"
            }
        }
        '.zip' {
            Expand-Archive -LiteralPath $item.FullName -DestinationPath $destination -Force
        }
        '.exe' {
            if ([string] $DriverPack.Record.manufacturer -ne 'Dell') {
                throw "Unsupported offline EXE driver pack manufacturer: $($DriverPack.Record.manufacturer)"
            }
            $process = Start-Process -FilePath $item.FullName -ArgumentList "/s /e=$destination" -PassThru -Wait
            if ($process.ExitCode -ne 0) {
                throw "Offline Dell driver pack extraction failed with exit code $($process.ExitCode)."
            }
        }
        default {
            throw "Unsupported offline driver pack format: $($item.Extension)"
        }
    }
    if (-not (Get-ChildItem -LiteralPath $destination -Filter '*.inf' -File -Recurse | Select-Object -First 1)) {
        throw "Offline driver pack contains no INF files: $($item.FullName)"
    }
    Add-WindowsDriver -Path 'C:\' -Driver $destination -Recurse -ErrorAction Stop | Out-Host
}

try {
    Write-Host "[$(Get-Date -Format G)] Winception USB zero-touch installation" -ForegroundColor Cyan
    $mediaRoot = Get-WinceptionUsbRoot
    $bootRoot = Get-WinceptionBootRoot -DataRoot $mediaRoot
    $manifestPath = Join-Path $mediaRoot 'OSDCloud\winception-usb-manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([int] $manifest.schemaVersion -ne 1 -or [string]::IsNullOrWhiteSpace([string] $manifest.mediaId)) {
        throw "Unsupported or invalid USB manifest: $manifestPath"
    }
    Test-UsbMediaManifest -DataRoot $mediaRoot -BootRoot $bootRoot -Manifest $manifest
    if (Test-MediaAlreadyApplied -MediaId ([string] $manifest.mediaId)) {
        throw "This media ($($manifest.mediaId)) has already been applied to the internal Windows installation. Remove the media and boot Windows."
    }

    $selectedOsPath = Join-Path $mediaRoot 'OSDCloud\OS\selected-os.json'
    $selectedProfilePath = Join-Path $mediaRoot 'OSDCloud\Apps\selected-profile.json'
    $secretsPath = Join-Path $mediaRoot 'OSDCloud\Config\secrets.json'
    $selectedOs = Get-Content -LiteralPath $selectedOsPath -Raw | ConvertFrom-Json
    $selectedProfile = Get-Content -LiteralPath $selectedProfilePath -Raw | ConvertFrom-Json
    $secrets = Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json
    [void] (Get-DeploymentSecret -Secrets $secrets -Name 'windowsUsername')
    [void] (Get-DeploymentSecret -Secrets $secrets -Name 'windowsPassword')

    if ($selectedProfile.profileId -ne $manifest.activeProfileId -or $selectedProfile.osImageId -ne $selectedOs.id) {
        throw 'USB selected profile and selected OS manifests do not match the media manifest.'
    }
    $imagePath = Join-Path $mediaRoot "OSDCloud\OS\$($selectedOs.fileName)"
    if (-not (Test-Path -LiteralPath $imagePath -PathType Leaf)) {
        throw "Selected USB OS image is missing: $imagePath"
    }
    $installDisk = Get-UsbInstallDisk -MediaRoot $mediaRoot

    Import-Module OSD -Force
    Import-Module OSDCloud -Force
    $driverPack = Get-MatchingOfflineDriverPack -MediaRoot $mediaRoot
    $imageFile = Get-Item -LiteralPath $imagePath
    $Global:StartOSDCloud = [ordered]@{
        ImageFileDestination = $imageFile
        ImageFileName = $imageFile.Name
        ImageFileUrl = $null
        OSImageIndex = [int] $selectedOs.imageIndex
        OSEdition = [string] $selectedOs.edition
        OSEditionId = [string] $selectedOs.editionId
        OSLanguage = [string] $selectedOs.language
        OSActivation = [string] $selectedOs.activation
        OSInstallDiskNumber = [int] $installDisk.Number
        OSDiskNumberDefault = [int] $installDisk.Number
        DriverPackName = 'None'
        MSCatalogFirmware = $false
        MSCatalogDiskDrivers = $false
        MSCatalogNetDrivers = $false
        MSCatalogScsiDrivers = $false
        WindowsUpdate = $false
        WindowsUpdateDrivers = $false
        ZTI = $true
        SkipAutopilot = $true
        SkipODT = $true
        Restart = $false
        Shutdown = $false
    }
    $Global:ConfirmPreference = 'None'

    Write-Host "Media ID: $($manifest.mediaId)"
    Write-Host "OS image: $($selectedOs.fileName) index $($selectedOs.imageIndex)"
    Write-Host "Profile: $($selectedProfile.profileId)"
    Write-Host "Install disk: $($installDisk.Number) $($installDisk.FriendlyName)"
    Invoke-OSDCloud
    $oobeScript = 'X:\OSDCloud\Winception\Invoke-OobeCustomization-USB.ps1'
    if (-not (Test-Path -LiteralPath $oobeScript -PathType Leaf)) {
        throw "USB OOBE customization script is missing: $oobeScript"
    }
    & $oobeScript
    Install-MatchingOfflineDriverPack -DriverPack $driverPack

    $targetRoot = Get-PSDrive -PSProvider FileSystem |
        ForEach-Object { $_.Root } |
        Where-Object { Test-Path -LiteralPath (Join-Path $_ 'Windows\System32\Config\SOFTWARE') -PathType Leaf } |
        Select-Object -First 1
    if ($targetRoot) {
        $targetLogs = Join-Path $targetRoot 'ProgramData\OSDCloud\Logs\WinPE'
        New-Item -ItemType Directory -Path $targetLogs -Force | Out-Null
        Copy-Item -LiteralPath $logPath -Destination $targetLogs -Force -ErrorAction SilentlyContinue
        $metadataPath = Join-Path $targetRoot 'ProgramData\OSDCloud\DeploymentStatus.json'
        if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
            $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
            $metadata | Add-Member -NotePropertyName appliedAt -NotePropertyValue ((Get-Date).ToString('o')) -Force
            $metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metadataPath -Encoding UTF8 -Force
        }
    }

    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
    Write-Host 'USB deployment finished. Rebooting to Windows.' -ForegroundColor Green
    Start-Sleep -Seconds 5
    wpeutil reboot
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
    Write-Host 'Installation stopped. No retry will occur automatically.' -ForegroundColor Yellow
    exit 1
}
