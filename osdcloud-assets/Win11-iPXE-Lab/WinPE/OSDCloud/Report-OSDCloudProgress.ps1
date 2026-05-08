param(
    [string] $StatusUrl = 'http://192.168.100.100/osdcloud/status',
    [string] $RunId = '',
    [string] $ClientId = '',
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

while (-not (Test-Path -LiteralPath $StopFile)) {
    if (((Get-Date) - $started).TotalSeconds -gt $MaxSeconds) {
        Send-Status -Stage 'reporter-timeout' -Message "Reporter stopped after $MaxSeconds seconds."
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
        $lastSignature = $signature
        $lastSent = Get-Date
    }

    Start-Sleep -Seconds $IntervalSeconds
}

Send-Status -Stage 'reporter-stop' -Message 'OSDCloud progress reporter stopped.'
