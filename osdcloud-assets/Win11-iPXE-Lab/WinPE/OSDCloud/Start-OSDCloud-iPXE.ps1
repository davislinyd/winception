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
$server = '192.168.100.100'
$share = "\\$server\OSDCloudiPXE"
$statusUrl = "http://$server/osdcloud/status"

function Get-DeploymentClientId {
    try {
        $serial = (Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop).SerialNumber
        if (-not [string]::IsNullOrWhiteSpace($serial)) {
            return $serial
        }
    }
    catch {
    }

    return $env:COMPUTERNAME
}

$clientId = Get-DeploymentClientId
$runId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$($clientId -replace '[^A-Za-z0-9_.-]', '_')"
$stopProgressPath = Join-Path $logRoot 'Stop-OSDCloudProgressReporter.txt'

function Send-DeploymentStatus {
    param(
        [string] $Stage,
        [string] $Message,
        [Nullable[double]] $Percent = $null,
        [hashtable] $Extra = @{}
    )

    $payload = [ordered]@{
        timestamp = (Get-Date).ToString('o')
        runId = $runId
        clientId = $clientId
        stage = $Stage
        message = $Message
        percent = $Percent
    }

    foreach ($key in $Extra.Keys) {
        $payload[$key] = $Extra[$key]
    }

    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    try {
        Invoke-WebRequest -Uri $statusUrl -Method Post -ContentType 'application/json' -Body $json -UseBasicParsing -TimeoutSec 5 | Out-Null
        return
    }
    catch {
    }

    try {
        $client = [System.Net.WebClient]::new()
        $client.Headers['Content-Type'] = 'application/json'
        [void] $client.UploadString($statusUrl, 'POST', $json)
    }
    catch {
    }
    finally {
        if ($client) {
            $client.Dispose()
        }
    }
}

Remove-Item -LiteralPath $stopProgressPath -Force -ErrorAction SilentlyContinue
Send-DeploymentStatus -Stage 'winpe-start' -Message 'Start-OSDCloud iPXE custom image deployment started.'

$progressReporter = Join-Path $PSScriptRoot 'Report-OSDCloudProgress.ps1'
if (Test-Path -LiteralPath $progressReporter -PathType Leaf) {
    $reporterArgs = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $progressReporter,
        '-StatusUrl', $statusUrl,
        '-RunId', $runId,
        '-ClientId', $clientId,
        '-TranscriptPath', $logPath,
        '-StopFile', $stopProgressPath,
        '-IntervalSeconds', '3',
        '-HeartbeatSeconds', '15'
    )
    try {
        Start-Process -FilePath 'powershell.exe' -ArgumentList $reporterArgs -WindowStyle Hidden | Out-Null
        Write-Host "Progress status: $statusUrl runId=$runId"
    }
    catch {
        Write-Warning "Unable to start progress reporter: $($_.Exception.Message)"
        Send-DeploymentStatus -Stage 'reporter-error' -Message "Unable to start progress reporter: $($_.Exception.Message)"
    }
}
else {
    Write-Warning "Progress reporter not found: $progressReporter"
    Send-DeploymentStatus -Stage 'reporter-missing' -Message "Progress reporter not found: $progressReporter"
}

Write-Host "Image source: $share\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd"
Write-Host "OSImageIndex: 6"

Import-Module OSD -Force

$imagePath = 'Z:\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd'

cmd.exe /c 'net use Z: /delete /y' | Out-Null
$netUse = cmd.exe /c "net use Z: $share /user:$server\pxeinstall password /persistent:no"
$netUse | ForEach-Object { Write-Host $_ }

if (-not (Test-Path -LiteralPath $imagePath)) {
    Write-Warning "Unable to access Windows image at $imagePath"
    Send-DeploymentStatus -Stage 'image-missing' -Message "Unable to access Windows image at $imagePath"
    Write-Warning 'Press Ctrl+C to exit OSDCloud'
    Start-Sleep -Seconds 86400
    exit 1
}

$imageFile = Get-Item -LiteralPath $imagePath
Write-Host "[$(Get-Date -Format G)] Using mapped SMB image: $($imageFile.FullName)"
Send-DeploymentStatus -Stage 'smb-mounted' -Message "Using mapped SMB image: $($imageFile.FullName)"

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
    Restart              = $false
    Shutdown             = $false
}

$deploymentSucceeded = $false
try {
    Send-DeploymentStatus -Stage 'osdcloud-start' -Message 'Invoke-OSDCloud starting.'
    Invoke-OSDCloud
    $deploymentSucceeded = $true
    Send-DeploymentStatus -Stage 'osdcloud-finished' -Message 'Invoke-OSDCloud returned successfully. WinPE will reboot.'
}
catch {
    Send-DeploymentStatus -Stage 'osdcloud-error' -Message $_.Exception.Message
    throw
}
finally {
    New-Item -ItemType File -Path $stopProgressPath -Force | Out-Null
    Start-Sleep -Seconds 2
    try {
        Stop-Transcript | Out-Null
    }
    catch {
    }
}

if ($deploymentSucceeded) {
    Send-DeploymentStatus -Stage 'rebooting' -Message 'WinPE is rebooting in 10 seconds.'
    Start-Sleep -Seconds 10
    wpeutil reboot
}
