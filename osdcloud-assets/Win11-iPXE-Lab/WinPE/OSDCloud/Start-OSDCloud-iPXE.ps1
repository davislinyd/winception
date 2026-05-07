$ErrorActionPreference = 'Continue'

$logRoot = 'X:\OSDCloud\Logs'
$logPath = Join-Path $logRoot 'Start-OSDCloud-iPXE.log'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

try {
    Start-Transcript -Path $logPath -Force | Out-Null
}
catch {
    Write-Warning "Unable to start transcript: $($_.Exception.Message)"
}

Write-Host "[$(Get-Date -Format G)] Start-OSDCloud iPXE custom image deployment"
Write-Host "Image source: \\192.168.100.1\OSDCloudiPXE\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd"
Write-Host "OSImageIndex: 6"

Import-Module OSD -Force

$share = '\\192.168.100.1\OSDCloudiPXE'
$imagePath = 'Z:\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd'

cmd.exe /c 'net use Z: /delete /y' | Out-Null
$netUse = cmd.exe /c "net use Z: $share /user:192.168.100.1\pxeinstall password /persistent:no"
$netUse | ForEach-Object { Write-Host $_ }

if (-not (Test-Path -LiteralPath $imagePath)) {
    Write-Warning "Unable to access Windows image at $imagePath"
    Write-Warning 'Press Ctrl+C to exit OSDCloud'
    Start-Sleep -Seconds 86400
    exit 1
}

$imageFile = Get-Item -LiteralPath $imagePath
Write-Host "[$(Get-Date -Format G)] Using mapped SMB image: $($imageFile.FullName)"

$Global:StartOSDCloud = [ordered]@{
    LaunchMethod         = 'OSDCloudCLI'
    ImageFileDestination = $imageFile
    ImageFileName        = $imageFile.Name
    ImageFileUrl         = $null
    OSImageIndex         = 6
    OSEdition            = 'Pro'
    OSEditionId          = 'Professional'
    OSLanguage           = 'zh-tw'
    OSActivation         = 'Retail'
    ZTI                  = $true
    SkipAutopilot        = $true
    SkipODT              = $true
    Shutdown             = $true
}

Invoke-OSDCloud

try {
    Stop-Transcript | Out-Null
}
catch {
}
