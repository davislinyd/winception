$ErrorActionPreference = 'Stop'

function Get-UsbTargetWindowsRoot {
    Get-PSDrive -PSProvider FileSystem |
        Where-Object { $_.Name -ne 'X' } |
        ForEach-Object { "$($_.Name):\" } |
        Where-Object { Test-Path -LiteralPath (Join-Path $_ 'Windows\System32\Config\SOFTWARE') -PathType Leaf } |
        Select-Object -First 1
}

function Get-WinceptionUsbRoot {
    Get-PSDrive -PSProvider FileSystem |
        Where-Object { $_.Name -ne 'X' } |
        ForEach-Object { "$($_.Name):\" } |
        Where-Object { Test-Path -LiteralPath (Join-Path $_ 'OSDCloud\winception-usb-manifest.json') -PathType Leaf } |
        Select-Object -First 1
}

$windowsRoot = Get-UsbTargetWindowsRoot
if ([string]::IsNullOrWhiteSpace($windowsRoot)) {
    throw 'Unable to locate the deployed Windows volume for USB deployment metadata.'
}

$mediaRoot = Get-WinceptionUsbRoot
if ([string]::IsNullOrWhiteSpace($mediaRoot)) {
    throw 'Unable to locate Winception USB media during OOBE customization.'
}

$manifest = Get-Content -LiteralPath (Join-Path $mediaRoot 'OSDCloud\winception-usb-manifest.json') -Raw | ConvertFrom-Json
$selectedOs = Get-Content -LiteralPath (Join-Path $mediaRoot 'OSDCloud\OS\selected-os.json') -Raw | ConvertFrom-Json
$selectedProfile = Get-Content -LiteralPath (Join-Path $mediaRoot 'OSDCloud\Apps\selected-profile.json') -Raw | ConvertFrom-Json

$selectedOs | Add-Member -NotePropertyName uiLanguage -NotePropertyValue ([string] $selectedProfile.displayLanguage) -Force
$selectedOs | Add-Member -NotePropertyName locale -NotePropertyValue ([string] $selectedProfile.locale) -Force
$selectedOs | Add-Member -NotePropertyName inputLanguage -NotePropertyValue ([string] $selectedProfile.inputLanguage) -Force
$selectedOs | Add-Member -NotePropertyName timeZone -NotePropertyValue ([string] $selectedProfile.timeZone) -Force

$metadataRoot = Join-Path $windowsRoot 'ProgramData\OSDCloud'
New-Item -ItemType Directory -Path $metadataRoot -Force | Out-Null
$metadata = [ordered]@{
    deploymentMode = 'usb-offline'
    statusTransport = 'local'
    mediaId = [string] $manifest.mediaId
    imagePath = Join-Path $mediaRoot "OSDCloud\OS\$($selectedOs.fileName)"
    imageFileUrl = ''
    osImageIndex = [int] $selectedOs.imageIndex
    selectedOs = $selectedOs
    createdAt = (Get-Date).ToString('o')
}
$metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $metadataRoot 'DeploymentStatus.json') -Encoding UTF8 -Force

$coreScript = 'X:\OSDCloud\Winception\Invoke-OobeCustomization-Core.ps1'
if (-not (Test-Path -LiteralPath $coreScript -PathType Leaf)) {
    throw "USB OOBE customization core is missing: $coreScript"
}

& $coreScript
