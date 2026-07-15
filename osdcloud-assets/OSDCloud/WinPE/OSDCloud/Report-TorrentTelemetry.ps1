param(
    [Parameter(Mandatory)][string] $ContextPath
)

$ErrorActionPreference = 'Continue'
$rpcWarningShown = $false

function Invoke-Aria2Rpc {
    param([string] $Method, [object] $Context)

    $params = [System.Collections.ArrayList]::new()
    [void] $params.Add("token:$($Context.rpcSecret)")
    [void] $params.Add([string] $Context.gid)
    $keys = if ($Method -eq 'aria2.tellStatus') {
        @('totalLength', 'completedLength', 'uploadLength', 'downloadSpeed', 'uploadSpeed')
    } else { $null }
    if ($keys) { [void] $params.Add([string[]] $keys) }
    $body = [ordered]@{
        jsonrpc = '2.0'
        id = [guid]::NewGuid().ToString('N')
        method = $Method
        params = $params.ToArray()
    } | ConvertTo-Json -Depth 5 -Compress
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:6800/jsonrpc' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 2 -ErrorAction Stop
    if ($response.error) { throw $response.error.message }
    $response.result
}

while ($true) {
    Start-Sleep -Seconds 5
    if (-not (Test-Path -LiteralPath $ContextPath -PathType Leaf)) { break }
    try {
        $context = Get-Content -LiteralPath $ContextPath -Raw | ConvertFrom-Json
        if ($context.stopPath -and (Test-Path -LiteralPath ([string] $context.stopPath))) { break }
        $status = Invoke-Aria2Rpc -Method 'aria2.tellStatus' -Context $context
        $peers = @(Invoke-Aria2Rpc -Method 'aria2.getPeers' -Context $context)
        $total = [double] $status.totalLength
        $completed = [double] $status.completedLength
        $speed = [double] $status.downloadSpeed
        $sources = @($peers | Where-Object { [double] $_.downloadSpeed -gt 0 } | ForEach-Object {
            '{0}:{1} [{2}]' -f $_.ip, $_.port, $(if ([string] $_.seeder -eq 'true') { 'Seeder' } else { 'Peer' })
        } | Sort-Object -Unique | Select-Object -First 16)
        $receivers = @($peers | Where-Object { [double] $_.uploadSpeed -gt 0 } | ForEach-Object {
            '{0}:{1} [{2}]' -f $_.ip, $_.port, $(if ([string] $_.seeder -eq 'true') { 'Seeder' } else { 'Peer' })
        } | Sort-Object -Unique | Select-Object -First 16)
        $payload = [ordered]@{
            runId = [string] $context.runId
            clientId = [string] $context.clientId
            phase = [string] $context.phase
            totalLength = [long] $total
            completedLength = [long] $completed
            uploadLength = [long] ([double] $status.uploadLength)
            downloadSpeed = [long] $speed
            uploadSpeed = [long] ([double] $status.uploadSpeed)
            etaSeconds = if ($speed -gt 0 -and $completed -lt $total) { [math]::Ceiling(($total - $completed) / $speed) } else { 0 }
            sources = $sources
            receivers = $receivers
            fallback = [bool] $context.fallback
        }
        if ($context.PSObject.Properties['seedBaseMinutes']) { $payload.seedBaseMinutes = [int] $context.seedBaseMinutes }
        if ($context.PSObject.Properties['seedLocalExtensionMinutes']) { $payload.seedLocalExtensionMinutes = [int] $context.seedLocalExtensionMinutes }
        if ($context.PSObject.Properties['seedHostExtensionMinutes']) { $payload.seedHostExtensionMinutes = [int] $context.seedHostExtensionMinutes }
        if ($context.PSObject.Properties['seedStartTimestamp'] -and $context.PSObject.Properties['seedBaseMinutes']) {
            $totalSeconds = 60 * ([int] $context.seedBaseMinutes + [int] $context.seedLocalExtensionMinutes + [int] $context.seedHostExtensionMinutes)
            $elapsedSeconds = ([System.Diagnostics.Stopwatch]::GetTimestamp() - [long] $context.seedStartTimestamp) / [double] [System.Diagnostics.Stopwatch]::Frequency
            $payload.seedSecondsRemaining = [math]::Max(0, [math]::Ceiling($totalSeconds - $elapsedSeconds))
        }
        $body = $payload | ConvertTo-Json -Depth 5 -Compress
        $lastError = $null
        $response = $null
        foreach ($attempt in 1..2) {
            try {
                $response = Invoke-RestMethod -Uri ([string] $context.telemetryUrl) -Method Post -ContentType 'application/json' -DisableKeepAlive -Body $body -TimeoutSec 3 -ErrorAction Stop
                break
            }
            catch {
                $lastError = $_
                if ($attempt -lt 2) { Start-Sleep -Milliseconds 250 }
            }
        }
        if (-not $response) { throw $lastError }
        if ($context.statePath) {
            $temp = "$($context.statePath).tmp"
            $response | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temp -Encoding UTF8 -Force
            Move-Item -LiteralPath $temp -Destination ([string] $context.statePath) -Force
        }
    }
    catch {
        if (-not $rpcWarningShown) {
            Write-Warning "Torrent telemetry reporter unavailable; seeding continues. $($_.Exception.Message)"
            $rpcWarningShown = $true
        }
    }
}
