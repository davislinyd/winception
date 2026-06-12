param(
    [string] $StatusUrl = 'http://192.168.77.1/osdcloud/status',
    [string] $RunId = '',
    [string] $ClientId = '',
    [string] $ScreenshotUrl = '',
    [string] $TranscriptPath = 'X:\OSDCloud\Logs\Start-OSDCloud-iPXE.log',
    [string] $StopFile = 'X:\OSDCloud\Logs\Stop-OSDCloudProgressReporter.txt',
    [int] $IntervalSeconds = 3,
    [int] $HeartbeatSeconds = 15,
    [int] $MaxSeconds = 7200
)

$ErrorActionPreference = 'Continue'

if ([string]::IsNullOrWhiteSpace($RunId)) {
    $RunId = Get-Date -Format 'yyyyMMdd-HHmmss'
}

if ([string]::IsNullOrWhiteSpace($ClientId)) {
    try {
        $ClientId = (Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop).SerialNumber
    }
    catch {
        $ClientId = $env:COMPUTERNAME
    }
}

function Send-Status {
    param(
        [string] $Stage,
        [string] $Message,
        [Nullable[double]] $Percent = $null,
        [string[]] $LogTail = @(),
        [hashtable] $Extra = @{}
    )

    $payload = [ordered]@{
        timestamp = (Get-Date).ToString('o')
        runId = $RunId
        clientId = $ClientId
        stage = $Stage
        message = $Message
        percent = $Percent
        logTail = @($LogTail)
    }

    foreach ($key in $Extra.Keys) {
        $payload[$key] = $Extra[$key]
    }

    $json = $payload | ConvertTo-Json -Depth 8 -Compress

    try {
        Invoke-WebRequest -Uri $StatusUrl -Method Post -ContentType 'application/json' -Body $json -UseBasicParsing -TimeoutSec 5 | Out-Null
        return
    }
    catch {
    }

    try {
        $client = [System.Net.WebClient]::new()
        $client.Headers['Content-Type'] = 'application/json'
        [void] $client.UploadString($StatusUrl, 'POST', $json)
    }
    catch {
    }
    finally {
        if ($client) {
            $client.Dispose()
        }
    }
}

function Get-ScreenshotUrl {
    if (-not [string]::IsNullOrWhiteSpace($ScreenshotUrl)) {
        return $ScreenshotUrl
    }

    return ($StatusUrl -replace '/status$', '/screenshot')
}

function New-ScreenshotUri {
    param(
        [string] $Stage,
        [string] $Source = 'winpe'
    )

    $query = [ordered]@{
        runId = $RunId
        clientId = $ClientId
        stage = $Stage
        source = $Source
        timestamp = (Get-Date).ToString('o')
    }

    $pairs = foreach ($item in $query.GetEnumerator()) {
        '{0}={1}' -f [Uri]::EscapeDataString($item.Key), [Uri]::EscapeDataString([string] $item.Value)
    }

    return "$(Get-ScreenshotUrl)`?$($pairs -join '&')"
}

function Capture-Screenshot {
    param(
        [string] $Stage
    )

    $root = Split-Path -Parent $TranscriptPath
    if ([string]::IsNullOrWhiteSpace($root)) {
        $root = 'X:\OSDCloud\Logs'
    }
    $screenRoot = Join-Path $root 'Screenshots'
    New-Item -ItemType Directory -Path $screenRoot -Force | Out-Null
    $safeStage = $Stage -replace '[^A-Za-z0-9_.-]', '_'
    $path = Join-Path $screenRoot ("{0}-{1}.png" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $safeStage)

    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    if ($bounds.Width -le 0 -or $bounds.Height -le 0) {
        throw "Invalid screen bounds: $($bounds.Width)x$($bounds.Height)"
    }

    $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        return $path
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Send-Screenshot {
    param(
        [string] $Stage,
        [string] $Source = 'winpe'
    )

    $path = $null
    try {
        $path = Capture-Screenshot -Stage $Stage
        $uri = New-ScreenshotUri -Stage $Stage -Source $Source
        try {
            Invoke-WebRequest -Uri $uri -Method Post -ContentType 'image/png' -InFile $path -UseBasicParsing -TimeoutSec 10 | Out-Null
            return
        }
        catch {
        }

        $client = [System.Net.WebClient]::new()
        try {
            $client.Headers['Content-Type'] = 'image/png'
            [void] $client.UploadFile($uri, 'POST', $path)
        }
        finally {
            $client.Dispose()
        }
    }
    catch {
        Write-Warning "Screenshot upload failed for stage '$Stage': $($_.Exception.Message)"
    }
    finally {
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-LogPaths {
    $paths = @(
        $TranscriptPath,
        'X:\OSDCloud\Logs\OSDCloud.log',
        'X:\Windows\Logs\DISM\dism.log',
        'C:\OSDCloud\Logs\OSDCloud.log',
        'C:\OSDCloud\Logs\OSDCloud.json',
        'C:\OSDCloud\Logs\DISM-WinPE.log'
    )

    $paths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
}

function Get-RecentLogLines {
    $lines = [System.Collections.Generic.List[string]]::new()

    foreach ($path in Get-LogPaths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            continue
        }

        try {
            $tail = Get-Content -LiteralPath $path -Tail 25 -ErrorAction Stop
            foreach ($line in $tail) {
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    $lines.Add("$path :: $line")
                }
            }
        }
        catch {
        }
    }

    $lines | Select-Object -Last 30
}

function Find-Percent {
    param([string[]] $Lines)

    for ($i = $Lines.Count - 1; $i -ge 0; $i--) {
        $line = $Lines[$i]
        if ($line -match '(\d{1,3}(?:\.\d+)?)\s*%') {
            $value = [double] $Matches[1]
            if ($value -ge 0 -and $value -le 100) {
                return $value
            }
        }
    }

    return $null
}

function Get-Stage {
    param([string[]] $Lines)

    $text = ($Lines -join "`n")
    if ($text -match 'OSDCloud Finished|Completed in') { return 'osdcloud-finished' }
    if ($text -match 'SetupComplete|Config Shutdown Scripts|Shutdown Scripts') { return 'post-apply-scripts' }
    if ($text -match 'Expand-WindowsImage|Apply(ing)? Image|WIM|ESD|DISM') { return 'apply-image' }
    if ($text -match 'Driver|Firmware') { return 'drivers' }
    if ($text -match 'New-OSDisk|Clear-Disk|Partition|Format') { return 'disk' }
    if ($text -match 'Download Operating System') { return 'unexpected-download' }
    return 'running'
}

Send-Status -Stage 'reporter-start' -Message 'OSDCloud progress reporter started.'

$started = Get-Date
$lastSignature = ''
$lastSent = Get-Date '2000-01-01'
$lastScreenshotStage = ''
$lastApplyImageCheckpoint = 0

function Get-ApplyImageCheckpoint {
    param([Nullable[double]] $Percent)

    if (-not $Percent.HasValue) {
        return 0
    }

    foreach ($checkpoint in @(100, 75, 50, 25)) {
        if ($Percent.Value -ge $checkpoint) {
            return $checkpoint
        }
    }

    return 0
}

function Should-CaptureScreenshot {
    param(
        [string] $Stage,
        [Nullable[double]] $Percent = $null
    )

    if ($Stage -eq 'apply-image') {
        if ($lastScreenshotStage -ne $Stage) {
            $script:lastScreenshotStage = $Stage
            $checkpoint = Get-ApplyImageCheckpoint -Percent $Percent
            if ($checkpoint -gt $script:lastApplyImageCheckpoint) {
                $script:lastApplyImageCheckpoint = $checkpoint
            }
            return $true
        }

        $checkpoint = Get-ApplyImageCheckpoint -Percent $Percent
        if ($checkpoint -gt $script:lastApplyImageCheckpoint) {
            $script:lastApplyImageCheckpoint = $checkpoint
            return $true
        }

        return $false
    }

    $captureStages = @(
        'disk',
        'post-apply-scripts',
        'osdcloud-finished',
        'reporter-error',
        'reporter-timeout'
    )

    if ($Stage -in $captureStages -and $lastScreenshotStage -ne $Stage) {
        $script:lastScreenshotStage = $Stage
        return $true
    }

    return $false
}

while (-not (Test-Path -LiteralPath $StopFile)) {
    if (((Get-Date) - $started).TotalSeconds -gt $MaxSeconds) {
        Send-Status -Stage 'reporter-timeout' -Message "Reporter stopped after $MaxSeconds seconds."
        Send-Screenshot -Stage 'reporter-timeout'
        break
    }

    $lines = @(Get-RecentLogLines)
    $percent = Find-Percent -Lines $lines
    $stage = Get-Stage -Lines $lines
    $message = ($lines | Select-Object -Last 1)
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = 'Waiting for OSDCloud log output.'
    }

    $signature = "$stage|$percent|$message"
    $shouldSend = ($signature -ne $lastSignature) -or (((Get-Date) - $lastSent).TotalSeconds -ge $HeartbeatSeconds)
    if ($shouldSend) {
        $extra = @{
            elapsedSeconds = [int] ((Get-Date) - $started).TotalSeconds
        }
        Send-Status -Stage $stage -Message $message -Percent $percent -LogTail $lines -Extra $extra
        if (Should-CaptureScreenshot -Stage $stage -Percent $percent) {
            Send-Screenshot -Stage $stage
        }
        $lastSignature = $signature
        $lastSent = Get-Date
    }

    Start-Sleep -Seconds $IntervalSeconds
}

Send-Status -Stage 'reporter-stop' -Message 'OSDCloud progress reporter stopped.'
