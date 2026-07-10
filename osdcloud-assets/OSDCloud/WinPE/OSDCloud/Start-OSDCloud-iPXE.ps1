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

function Ensure-ConsoleMaximized {
    $nativeMethodsType = 'OSDCloudWin32.NativeMethods' -as [type]
    if (-not $nativeMethodsType) {
        try {
            Add-Type -Namespace OSDCloudWin32 -Name NativeMethods -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern System.IntPtr GetConsoleWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsZoomed(System.IntPtr hWnd);
'@ -ErrorAction Stop
            $nativeMethodsType = 'OSDCloudWin32.NativeMethods' -as [type]
        }
        catch {
            Write-Warning "Unable to load console maximize helpers: $($_.Exception.Message)"
            return
        }
    }

    try {
        $mainWindowHandle = $nativeMethodsType::GetConsoleWindow()
        if ($mainWindowHandle -eq [System.IntPtr]::Zero) {
            return
        }

        if (-not $nativeMethodsType::IsZoomed($mainWindowHandle)) {
            [void] $nativeMethodsType::ShowWindow($mainWindowHandle, 3)
        }
    }
    catch {
        Write-Warning "Unable to maximize WinPE console window: $($_.Exception.Message)"
    }
}

Ensure-ConsoleMaximized
Write-Host "[$(Get-Date -Format G)] Start-OSDCloud iPXE custom image deployment"

function Get-DeploymentServerCandidates {
    param([string] $PreferredServer)

    $candidates = [System.Collections.Generic.List[string]]::new()
    if (-not [string]::IsNullOrWhiteSpace($PreferredServer)) { $candidates.Add($PreferredServer) }
    try {
        $adapters = Get-CimInstance -ClassName Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled }
        foreach ($adapter in $adapters) {
            if ($adapter.DHCPServer) { $candidates.Add($adapter.DHCPServer) }
            if ($adapter.DefaultIPGateway) { $candidates.AddRange($adapter.DefaultIPGateway) }
            if ($adapter.DNSServerSearchOrder) { $candidates.AddRange($adapter.DNSServerSearchOrder) }
        }
    } catch {
        Write-Warning "Unable to query network adapter configuration: $($_.Exception.Message)"
    }

    $candidates.Add('192.168.100.1')
    $candidates.Add('192.168.88.1')
    $candidates.Add('192.168.77.1')
    return @($candidates | Where-Object {
        -not [string]::IsNullOrWhiteSpace([string] $_) -and [string] $_ -ne '0.0.0.0'
    } | Select-Object -Unique)
}

function Test-DeploymentServer {
    param([Parameter(Mandatory)][string] $IpAddress)

    try {
        $testUrl = "http://$IpAddress/osdcloud/health"
        $resp = Invoke-WebRequest -Uri $testUrl -Method Get -DisableKeepAlive -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return $resp.StatusCode -eq 204
    } catch {
        return $false
    }
}

$server = '192.168.77.1' # Default fallback
$serverDetected = $false
$maxDetectionAttempts = 6
for ($attempt = 1; $attempt -le $maxDetectionAttempts; $attempt++) {
    foreach ($ip in (Get-DeploymentServerCandidates -PreferredServer $server)) {
        if (Test-DeploymentServer -IpAddress $ip) {
            $server = $ip
            $serverDetected = $true
            Write-Host "Detected active deployment server at $server"
            break
        }
    }

    if ($serverDetected) {
        break
    }

    if ($attempt -lt $maxDetectionAttempts) {
        Write-Host "Deployment server health endpoint unavailable; renewing DHCP and retrying ($attempt/$maxDetectionAttempts)."
        try { ipconfig /renew | Out-Null } catch {}
        Start-Sleep -Seconds 5
    }
}

if (-not $serverDetected) {
    Write-Warning "Using fallback deployment server at $server."
}

# Fetch dynamic boot configuration from the detected server
$bootConfigUrl = "http://$server/osdcloud/boot-config"
Write-Host "Fetching dynamic boot configuration from $bootConfigUrl..."
$bootConfig = $null
try {
    $bootConfig = Invoke-RestMethod -Uri $bootConfigUrl -Method Get -DisableKeepAlive -TimeoutSec 5 -ErrorAction Stop
    Write-Host "Successfully loaded boot configuration from server."
} catch {
    Write-Warning "Failed to load dynamic boot configuration from HTTP server: $($_.Exception.Message)"
}

# Map variables based on boot config, falling back to local/default settings
if ($bootConfig -and $bootConfig.ok) {
    $server = $bootConfig.server
    $share = $bootConfig.share
    $smbUser = $bootConfig.smbUser
    $smbPassword = $bootConfig.smbPassword
    $windowsUsername = $bootConfig.windowsUsername
    $windowsPassword = $bootConfig.windowsPassword

    # Dynamically write secrets.json to RAM disk so other scripts can read them
    $ramSecretsPath = Join-Path $PSScriptRoot 'secrets.json'
    [ordered]@{
        pxeinstallPassword = $smbPassword
        windowsUsername = $windowsUsername
        windowsPassword = $windowsPassword
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ramSecretsPath -Encoding UTF8 -Force
} else {
    Write-Warning "Using static/fallback variables for deployment."
    $share = "\\$server\OSDCloudiPXE"
    $smbUser = "pxeinstall"
    $smbPassword = ""
    $windowsUsername = "davis"
    $windowsPassword = ""
}

$statusUrl = "http://$server/osdcloud/status"
$screenshotUrl = "http://$server/osdcloud/screenshot"
$torrentTelemetryUrl = "http://$server/osdcloud/torrent-telemetry"
$torrentControlUrl = "http://$server/osdcloud/torrent-control"


function Get-DeploymentSecretPathCandidates {
    $candidates = @()
    if ($PSScriptRoot) {
        $candidates += Join-Path $PSScriptRoot 'secrets.json'
        $candidates += Join-Path $PSScriptRoot 'Config\secrets.json'
    }

    $candidates += Get-PSDrive -PSProvider FileSystem |
        Where-Object { $_.Name -ne 'C' -and $_.Name -ne 'X' } |
        ForEach-Object {
            "$($_.Name):\OSDCloud\secrets.json"
            "$($_.Name):\OSDCloud\Config\secrets.json"
        }

    $candidates | Where-Object { $_ } | Select-Object -Unique
}

function Get-DeploymentSecret {
    param(
        [Parameter(Mandatory)][string] $JsonName,
        [Parameter(Mandatory)][string] $EnvironmentName
    )

    foreach ($scope in @('Process', 'Machine')) {
        $value = [Environment]::GetEnvironmentVariable($EnvironmentName, $scope)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return [string] $value
        }
    }

    foreach ($candidate in Get-DeploymentSecretPathCandidates) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            continue
        }

        try {
            $secrets = Get-Content -LiteralPath $candidate -Raw | ConvertFrom-Json
            $value = $secrets.$JsonName
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                return [string] $value
            }
        }
        catch {
            Write-Warning "Unable to read deployment secrets from $candidate`: $($_.Exception.Message)"
        }
    }

    throw "Missing required deployment secret '$JsonName'. Provide an untracked secrets.json in the OSDCloud runtime or set $EnvironmentName."
}

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
        Invoke-WebRequest -Uri $statusUrl -Method Post -ContentType 'application/json' -DisableKeepAlive -Body $json -UseBasicParsing -TimeoutSec 5 | Out-Null
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

function New-ScreenshotUri {
    param(
        [string] $Stage,
        [string] $Source = 'winpe'
    )

    $query = [ordered]@{
        runId = $runId
        clientId = $clientId
        stage = $Stage
        source = $Source
        timestamp = (Get-Date).ToString('o')
    }

    $pairs = foreach ($item in $query.GetEnumerator()) {
        '{0}={1}' -f [Uri]::EscapeDataString($item.Key), [Uri]::EscapeDataString([string] $item.Value)
    }

    return "$screenshotUrl`?$($pairs -join '&')"
}

function Capture-Screenshot {
    param(
        [string] $Stage
    )

    $screenRoot = Join-Path $logRoot 'Screenshots'
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
            Invoke-WebRequest -Uri $uri -Method Post -ContentType 'image/png' -DisableKeepAlive -InFile $path -UseBasicParsing -TimeoutSec 10 | Out-Null
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

function Get-DeployedWindowsRoot {
    $preferred = @('C:\') + @(
        Get-PSDrive -PSProvider FileSystem |
            Where-Object { $_.Name -notin @('C', 'X', 'Z') } |
            ForEach-Object { "$($_.Name):\" }
    )

    foreach ($root in ($preferred | Select-Object -Unique)) {
        if (Test-Path -LiteralPath (Join-Path $root 'Windows\System32\Config\SOFTWARE')) {
            return $root
        }
    }

    return $null
}

function Get-LabSelectedOsManifest {
    param(
        [string] $OsRoot
    )

    $manifestPath = Join-Path $OsRoot 'selected-os.json'
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        try {
            $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
            if ($manifest.fileName -and $manifest.imageIndex) {
                return $manifest
            }
            throw "selected-os.json is missing fileName or imageIndex: $manifestPath"
        }
        catch {
            throw "Unable to read selected OS manifest $manifestPath`: $($_.Exception.Message)"
        }
    }
    else {
        throw "selected-os.json not found: $manifestPath. Use Web OS Image Cache to export a deployable WIM and publish selected-os.json before deployment."
    }
}

function Get-SelectedOsStatusPayload {
    param(
        [object] $SelectedOs
    )

    [ordered]@{
        id = [string] $SelectedOs.id
        name = [string] $SelectedOs.name
        version = [string] $SelectedOs.version
        releaseId = [string] $SelectedOs.releaseId
        build = [string] $SelectedOs.build
        architecture = [string] $SelectedOs.architecture
        language = [string] $SelectedOs.language
        locale = [string] $SelectedOs.locale
        inputLanguage = [string] $SelectedOs.inputLanguage
        timeZone = [string] $SelectedOs.timeZone
        edition = [string] $SelectedOs.edition
        editionId = [string] $SelectedOs.editionId
        activation = [string] $SelectedOs.activation
        imageIndex = [int] $SelectedOs.imageIndex
        fileName = [string] $SelectedOs.fileName
    }
}

function Get-ImageDestinationDisplayRoot {
    param(
        [object] $ImageFile
    )

    try {
        if ($ImageFile -and $ImageFile.PSDrive -and -not [string]::IsNullOrWhiteSpace([string] $ImageFile.PSDrive.DisplayRoot)) {
            return [string] $ImageFile.PSDrive.DisplayRoot
        }

        $imageFullName = if ($ImageFile -and $ImageFile.FullName) { [string] $ImageFile.FullName } else { [string] $ImageFile }
        $driveRoot = [System.IO.Path]::GetPathRoot($imageFullName)
        if (-not [string]::IsNullOrWhiteSpace($driveRoot)) {
            $driveName = $driveRoot.TrimEnd('\').TrimEnd(':')
            if (-not [string]::IsNullOrWhiteSpace($driveName)) {
                $drive = Get-PSDrive -Name $driveName -ErrorAction Stop
                if ($drive.DisplayRoot) {
                    return [string] $drive.DisplayRoot
                }
            }
        }
    }
    catch {
    }

    return $share
}

function New-NoRedownloadEvidence {
    param(
        [object] $SelectedOs,
        [string] $ImagePath,
        [object] $ImageFile = $null
    )

    $selectedOsPayload = Get-SelectedOsStatusPayload -SelectedOs $SelectedOs
    $destination = if ($ImageFile -and $ImageFile.FullName) { [string] $ImageFile.FullName } else { [string] $ImagePath }
    [ordered]@{
        selectedOs = $selectedOsPayload
        imagePath = $destination
        imageFileUrl = ''
        imageFileDestination = $destination
        imageFileDestinationDisplayRoot = Get-ImageDestinationDisplayRoot -ImageFile $ImageFile
        osImageIndex = [int] $SelectedOs.imageIndex
    }
}

function Save-DeploymentStatusMetadata {
    $targetRoot = Get-DeployedWindowsRoot
    if ([string]::IsNullOrWhiteSpace($targetRoot)) {
        Send-DeploymentStatus -Stage 'windows-metadata-error' -Message 'Unable to locate deployed Windows root for status metadata.'
        return
    }

    try {
        $metadataRoot = Join-Path $targetRoot 'ProgramData\OSDCloud'
        New-Item -ItemType Directory -Path $metadataRoot -Force | Out-Null
        $metadataPath = Join-Path $metadataRoot 'DeploymentStatus.json'
        $metadata = [ordered]@{
            runId = $runId
            clientId = $clientId
            statusUrl = $statusUrl
            screenshotUrl = $screenshotUrl
            server = $server
            share = $share
            imagePath = $imagePath
            imageFileUrl = ''
            imageFileDestination = $imageFile.FullName
            imageFileDestinationDisplayRoot = Get-ImageDestinationDisplayRoot -ImageFile $imageFile
            osImageIndex = [int] $SelectedOs.imageIndex
            selectedOs = Get-SelectedOsStatusPayload -SelectedOs $SelectedOs
            createdAt = (Get-Date).ToString('o')
        }

        $metadata | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $metadataPath -Encoding UTF8 -Force
        Send-DeploymentStatus -Stage 'windows-metadata-written' -Message "Deployment status metadata written to $metadataPath" -Extra @{ targetRoot = $targetRoot }
    }
    catch {
        Send-DeploymentStatus -Stage 'windows-metadata-error' -Message $_.Exception.Message -Extra @{ targetRoot = $targetRoot }
    }
}

function Invoke-Aria2Rpc {
    param(
        [Parameter(Mandatory)][string] $Method,
        [Parameter(Mandatory)][string] $Secret,
        [string] $Gid,
        [string[]] $Keys,
        [switch] $Global
    )

    $rpcParameters = [System.Collections.ArrayList]::new()
    [void] $rpcParameters.Add("token:$Secret")
    if (-not $Global) {
        if ([string]::IsNullOrWhiteSpace($Gid)) { throw "aria2 RPC $Method requires a GID" }
        [void] $rpcParameters.Add($Gid)
    }
    if ($Keys) {
        [void] $rpcParameters.Add([string[]] $Keys)
    }

    $body = [ordered]@{
        jsonrpc = '2.0'
        id = [guid]::NewGuid().ToString('N')
        method = $Method
        params = $rpcParameters.ToArray()
    } | ConvertTo-Json -Depth 6 -Compress

    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:6800/jsonrpc' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 2 -ErrorAction Stop
    if ($response.error) {
        throw "aria2 RPC $Method failed: $($response.error.message)"
    }
    return $response.result
}

function Format-TorrentEta {
    param([double] $Seconds)

    if ($Seconds -le 0 -or [double]::IsInfinity($Seconds) -or [double]::IsNaN($Seconds)) {
        return '--'
    }
    $remaining = [timespan]::FromSeconds([math]::Ceiling($Seconds))
    if ($remaining.TotalHours -ge 1) {
        return '{0}:{1:00}:{2:00}' -f [math]::Floor($remaining.TotalHours), $remaining.Minutes, $remaining.Seconds
    }
    return '{0}:{1:00}' -f $remaining.Minutes, $remaining.Seconds
}

function Send-TorrentTelemetry {
    param(
        [object] $Status,
        [object[]] $Peers,
        [string] $Phase,
        [bool] $Fallback = $false,
        [object] $Context = $null
    )

    $total = [double] $Status.totalLength
    $completed = [double] $Status.completedLength
    $speed = [double] $Status.downloadSpeed
    $sources = @($Peers | Where-Object { [double] $_.downloadSpeed -gt 0 } | ForEach-Object {
        '{0}:{1} [{2}]' -f $_.ip, $_.port, $(if ([string] $_.seeder -eq 'true') { 'Seeder' } else { 'Peer' })
    } | Sort-Object -Unique | Select-Object -First 16)
    $receivers = @($Peers | Where-Object { [double] $_.uploadSpeed -gt 0 } | ForEach-Object {
        '{0}:{1} [{2}]' -f $_.ip, $_.port, $(if ([string] $_.seeder -eq 'true') { 'Seeder' } else { 'Peer' })
    } | Sort-Object -Unique | Select-Object -First 16)
    $payload = [ordered]@{
        runId = $runId
        clientId = $clientId
        phase = $Phase
        totalLength = [long] $total
        completedLength = [long] $completed
        uploadLength = [long] ([double] $Status.uploadLength)
        downloadSpeed = [long] $speed
        uploadSpeed = [long] ([double] $Status.uploadSpeed)
        etaSeconds = if ($speed -gt 0 -and $completed -lt $total) { [math]::Ceiling(($total - $completed) / $speed) } else { 0 }
        sources = $sources
        receivers = $receivers
        fallback = $Fallback
    }
    if ($Context) {
        $payload.seedBaseMinutes = [int] $Context.seedBaseMinutes
        $payload.seedLocalExtensionMinutes = [int] $Context.seedLocalExtensionMinutes
        $payload.seedHostExtensionMinutes = [int] $Context.seedHostExtensionMinutes
        $payload.seedDeadline = $Context.seedDeadline.ToString('o')
    }
    $body = $payload | ConvertTo-Json -Depth 5 -Compress
    $lastError = $null
    foreach ($attempt in 1..2) {
        try {
            return Invoke-RestMethod -Uri $torrentTelemetryUrl -Method Post -ContentType 'application/json' -DisableKeepAlive -Body $body -TimeoutSec 3 -ErrorAction Stop
        }
        catch {
            $lastError = $_
            if ($attempt -lt 2) { Start-Sleep -Milliseconds 250 }
        }
    }
    throw $lastError
}

function Set-TorrentTransferPhase {
    param([object] $Context, [string] $Phase, [bool] $Fallback = $false)
    if (-not $Context) { return }
    $Context.phase = $Phase
    $Context.fallback = $Fallback
    try {
        $temp = "$($Context.contextPath).tmp"
        $Context | Select-Object runId, clientId, gid, rpcSecret, phase, fallback, telemetryUrl, controlUrl, statePath, stopPath, completedAt, seedDeadline, seedBaseMinutes, seedLocalExtensionMinutes, seedHostExtensionMinutes, maxSeedMinutes |
            ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temp -Encoding UTF8 -Force
        Move-Item -LiteralPath $temp -Destination $Context.contextPath -Force
    }
    catch {
        Write-Warning "Unable to update torrent telemetry context; transfer continues. $($_.Exception.Message)"
    }
}

function Stop-TorrentTransfer {
    param([object] $Context)
    if (-not $Context) { return }
    New-Item -ItemType File -Path $Context.stopPath -Force | Out-Null
    if ($Context.reporterProcess -and -not $Context.reporterProcess.HasExited) {
        [void] $Context.reporterProcess.WaitForExit(7000)
        if (-not $Context.reporterProcess.HasExited) {
            Stop-Process -Id $Context.reporterProcess.Id -Force -ErrorAction SilentlyContinue
        }
    }
    if ($Context.process -and -not $Context.process.HasExited) {
        try {
            Invoke-Aria2Rpc -Method 'aria2.shutdown' -Secret $Context.rpcSecret -Global | Out-Null
            [void] $Context.process.WaitForExit(5000)
        }
        catch {
            Stop-Process -Id $Context.process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $Context.contextPath, $Context.stopPath -Force -ErrorAction SilentlyContinue
}

function Wait-TorrentSeedWindow {
    param([object] $Context)
    if (-not $Context) { return }

    Set-TorrentTransferPhase -Context $Context -Phase 'waiting'
    Send-DeploymentStatus -Stage 'torrent-seed-wait' -Message 'Windows apply complete; waiting for torrent receivers before reboot.' -Extra @{
        seedDeadline = $Context.seedDeadline.ToString('o')
    }
    Write-Host ''
    Write-Host 'Torrent seed wait. Press E to extend time, or Enter to continue to reboot now.' -ForegroundColor Cyan
    $reason = 'deadline'
    $graceDeadline = $null
    $lastDisplay = [datetime]::MinValue
    $lastUpload = [double] 0
    while ($true) {
        if ($Context.process.HasExited) { $reason = 'aria2-exit'; break }
        try {
            $control = Invoke-RestMethod -Uri "$torrentControlUrl`?runId=$([Uri]::EscapeDataString($runId))" -Method Get -DisableKeepAlive -TimeoutSec 2 -ErrorAction Stop
            if ($control.released) { $reason = 'host-release'; break }
            $requestedHostMinutes = if ($control.PSObject.Properties['extensionMinutes']) { [int] $control.extensionMinutes } else { 0 }
            $hostDelta = $requestedHostMinutes - [int] $Context.seedHostExtensionMinutes
            if ($hostDelta -gt 0) {
                if (($Context.seedBaseMinutes + $Context.seedLocalExtensionMinutes + $Context.seedHostExtensionMinutes + $hostDelta) -gt $Context.maxSeedMinutes) {
                    throw "Host extension exceeds the $($Context.maxSeedMinutes)-minute seed wait limit."
                }
                $Context.seedHostExtensionMinutes += $hostDelta
                $Context.seedDeadline = $Context.seedDeadline.AddMinutes($hostDelta)
                $graceDeadline = $null
                Set-TorrentTransferPhase -Context $Context -Phase 'waiting' -Fallback ([bool] $Context.fallback)
                Send-DeploymentStatus -Stage 'torrent-seed-wait' -Message "Host extended torrent seed wait by $hostDelta minute(s)." -Extra @{ seedDeadline = $Context.seedDeadline.ToString('o') }
                Write-Host "Host extended torrent seed wait by $hostDelta minute(s)." -ForegroundColor Cyan
            }
        } catch {}
        try {
            if ([Console]::KeyAvailable) {
                $key = [Console]::ReadKey($true).Key
                if ($key -eq [ConsoleKey]::Enter) {
                    $reason = 'client-enter'
                    break
                }
                if ($key -eq [ConsoleKey]::E) {
                    $requested = Read-Host 'Additional torrent seed minutes (1-1440)'
                    $additional = 0
                    if (-not [int]::TryParse($requested, [ref] $additional) -or $additional -lt 1 -or $additional -gt 1440) {
                        Write-Warning 'Extension must be an integer from 1 to 1440 minutes.'
                    }
                    elseif (($Context.seedBaseMinutes + $Context.seedLocalExtensionMinutes + $Context.seedHostExtensionMinutes + $additional) -gt $Context.maxSeedMinutes) {
                        Write-Warning "Torrent seed wait cannot exceed $($Context.maxSeedMinutes) minutes after download completion."
                    }
                    else {
                        $Context.seedLocalExtensionMinutes += $additional
                        $Context.seedDeadline = $Context.seedDeadline.AddMinutes($additional)
                        $graceDeadline = $null
                        Set-TorrentTransferPhase -Context $Context -Phase 'waiting' -Fallback ([bool] $Context.fallback)
                        Send-DeploymentStatus -Stage 'torrent-seed-wait' -Message "Client extended torrent seed wait by $additional minute(s)." -Extra @{ seedDeadline = $Context.seedDeadline.ToString('o') }
                    }
                }
            }
        } catch {}
        $now = Get-Date
        if ($now -ge $Context.seedDeadline) {
            if (-not $graceDeadline) {
                $graceDeadline = $now.AddSeconds(60)
                Write-Host 'Seed wait reached. Press E to extend or Enter to reboot; auto reboot in 60 seconds.' -ForegroundColor Yellow
            }
            elseif ($now -ge $graceDeadline) { break }
        }
        if (((Get-Date) - $lastDisplay).TotalSeconds -ge 5) {
            try {
                $status = Invoke-Aria2Rpc -Method 'aria2.tellStatus' -Secret $Context.rpcSecret -Gid $Context.gid -Keys @('uploadLength', 'uploadSpeed')
                $peers = @(Invoke-Aria2Rpc -Method 'aria2.getPeers' -Secret $Context.rpcSecret -Gid $Context.gid)
                $lastUpload = [math]::Max($lastUpload, [double] $status.uploadLength)
                $receivers = @($peers | Where-Object { [double] $_.uploadSpeed -gt 0 } | ForEach-Object { "$($_.ip):$($_.port)" } | Sort-Object -Unique)
                $remaining = if ($graceDeadline) { $graceDeadline - (Get-Date) } else { $Context.seedDeadline - (Get-Date) }
                $totalWaitMinutes = $Context.seedBaseMinutes + $Context.seedLocalExtensionMinutes + $Context.seedHostExtensionMinutes
                Write-Progress -Id 23 -Activity 'Torrent seed wait' -Status ("remaining {0} | uploaded {1:N2} GiB | receivers {2}" -f (Format-TorrentEta -Seconds $remaining.TotalSeconds), ($lastUpload / 1GB), $receivers.Count) -PercentComplete ([math]::Max(0, [math]::Min(100, 100 - (($remaining.TotalSeconds / [math]::Max(1, $totalWaitMinutes * 60)) * 100))))
            } catch {}
            $lastDisplay = Get-Date
        }
        Start-Sleep -Seconds 1
    }
    Write-Progress -Id 23 -Activity 'Torrent seed wait' -Completed
    Set-TorrentTransferPhase -Context $Context -Phase 'released'
    try {
        $finalStatus = Invoke-Aria2Rpc -Method 'aria2.tellStatus' -Secret $Context.rpcSecret -Gid $Context.gid -Keys @('totalLength', 'completedLength', 'uploadLength', 'downloadSpeed', 'uploadSpeed')
        $finalPeers = @(Invoke-Aria2Rpc -Method 'aria2.getPeers' -Secret $Context.rpcSecret -Gid $Context.gid)
        Send-TorrentTelemetry -Status $finalStatus -Peers $finalPeers -Phase 'released' -Fallback ([bool] $Context.fallback) -Context $Context | Out-Null
    } catch {}
    Stop-TorrentTransfer -Context $Context
    if ($reason -eq 'host-release' -or $reason -eq 'client-enter') {
        Send-DeploymentStatus -Stage 'torrent-release' -Message "Torrent seed wait released early: $reason." -Extra @{ reason = $reason }
    }
    Send-DeploymentStatus -Stage 'torrent-seed-wait-finished' -Message "Torrent seed wait ended: $reason." -Extra @{ reason = $reason; uploadedBytes = [long] $lastUpload }
}

function Invoke-TorrentOsImageDownload {
    <#
        Attempt to acquire the OS WIM over BitTorrent so the transfer load is
        shared across the client fleet instead of every client streaming the WIM
        from the host SMB share. Returns a FileInfo for a locally staged, hash-
        verified WIM on a freshly partitioned target disk, or $null to fall back
        to the unchanged SMB-direct apply path.

        Because the multi-GB WIM must land on a volume that survives OSDCloud's
        disk wipe, we partition the target disk here (New-OSDisk) and download to
        C:\OSDCloud\OS. The caller then sets $StartOSDCloud.SkipAllDiskSteps so
        Invoke-OSDCloud reuses this disk instead of re-partitioning.
    #>
    param(
        [object] $BootConfig,
        [string] $ExpectedFileName
    )

    if (-not $BootConfig -or -not $BootConfig.torrentEnabled) {
        return $null
    }

    $aria2 = Join-Path $PSScriptRoot 'aria2c.exe'
    if (-not (Test-Path -LiteralPath $aria2 -PathType Leaf)) {
        Send-DeploymentStatus -Stage 'torrent-fallback' -Message 'aria2c.exe not present in WinPE; using SMB-direct apply.'
        return $null
    }

    $fileName = [string] $BootConfig.osWimFileName
    if ([string]::IsNullOrWhiteSpace($fileName) -or ($ExpectedFileName -and $fileName -ne $ExpectedFileName)) {
        Send-DeploymentStatus -Stage 'torrent-fallback' -Message "Torrent image name mismatch ('$fileName' vs '$ExpectedFileName'); using SMB-direct apply."
        return $null
    }
    if ([string]::IsNullOrWhiteSpace([string] $BootConfig.torrentUrl) -or [string]::IsNullOrWhiteSpace([string] $BootConfig.osWimSha256)) {
        Send-DeploymentStatus -Stage 'torrent-fallback' -Message 'Torrent metadata incomplete in boot-config; using SMB-direct apply.'
        return $null
    }

    try {
        Send-DeploymentStatus -Stage 'partition-target' -Message 'Partitioning target disk for P2P image staging.'
        Send-Screenshot -Stage 'partition-target'
        Write-Host ''
        Write-Host 'WARNING: Disk will be wiped and repartitioned. Press Ctrl+C to abort.' -ForegroundColor Yellow
        for ($secs = 5; $secs -gt 0; $secs--) {
            Write-Host "  Proceeding in $secs..." -ForegroundColor Yellow
            Start-Sleep -Seconds 1
        }
        $Global:ConfirmPreference = 'None'
        New-OSDisk -PartitionStyle GPT -Force -ErrorAction Stop
        Start-Sleep -Seconds 5
        if (-not (Get-PSDrive -Name 'C' -ErrorAction SilentlyContinue)) {
            throw 'New-OSDisk did not produce a C: volume.'
        }

        $osDir = 'C:\OSDCloud\OS'
        New-Item -ItemType Directory -Path $osDir -Force | Out-Null
        $torrentPath = Join-Path $osDir "$fileName.torrent"
        Invoke-WebRequest -Uri ([string] $BootConfig.torrentUrl) -DisableKeepAlive -OutFile $torrentPath -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop

        $targetWim = Join-Path $osDir $fileName
        $controlFile = "$targetWim.aria2"
        Remove-Item -LiteralPath $targetWim -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $controlFile -Force -ErrorAction SilentlyContinue

        $seedMinutes = 15
        if ($BootConfig.PSObject.Properties['seedMinutes'] -and [int] $BootConfig.seedMinutes -ge 0 -and [int] $BootConfig.seedMinutes -le 1440) {
            $seedMinutes = [int] $BootConfig.seedMinutes
        }

        # Peers MUST accept INBOUND BitTorrent connections for P2P to offload the
        # host: VM<->VM peering needs each VM to accept inbound TCP on the aria2
        # listen range. (VM->host works because the host accepts; if every VM
        # blocks inbound, no VM<->VM link forms and each pulls a full copy from
        # the seeder -> ~Nx, no offload.) Disable the firewall by every available
        # method, add an explicit allow rule, then report the resulting state so
        # the host can confirm inbound is actually open.
        $clientIPv4 = $null
        try {
            $serverPrefix = $server -replace '\.\d+$', '.'
            $clientIPv4 = Get-CimInstance -ClassName Win32_NetworkAdapterConfiguration |
                Where-Object { $_.IPEnabled } |
                ForEach-Object { $_.IPAddress } |
                Where-Object { $_ -match '^\d{1,3}(?:\.\d{1,3}){3}$' -and $_.StartsWith($serverPrefix) -and $_ -ne $server } |
                Select-Object -First 1
        } catch {}
        $listenPort = if ($clientIPv4) { 7000 + [int] (($clientIPv4 -split '\.')[-1]) } else { Get-Random -Minimum 7001 -Maximum 7255 }

        $fwReport = @()
        try {
            $fwOutput = & wpeutil DisableFirewall 2>&1
            $fwReport += "wpeutil=$LASTEXITCODE"
            if ($LASTEXITCODE -ne 0 -and $fwOutput) { $fwReport += "wpeutil-output=$($fwOutput -join ' ')" }
        } catch { $fwReport += "wpeutil-err=$($_.Exception.Message)" }
        try {
            $null = & netsh advfirewall set allprofiles state off 2>&1
            $fwReport += "advfirewall=$LASTEXITCODE"
        } catch { $fwReport += "advfirewall-err=$($_.Exception.Message)" }
        try {
            $null = & netsh advfirewall firewall add rule name='aria2-in' dir=in action=allow protocol=TCP localport=7001-7254 2>&1
            $fwReport += "rule=$LASTEXITCODE"
        } catch { $fwReport += "rule-err=$($_.Exception.Message)" }
        try {
            $null = & netsh firewall set opmode mode=disable 2>&1
            $fwReport += "legacy=$LASTEXITCODE"
        } catch { $fwReport += "legacy-err=$($_.Exception.Message)" }
        try {
            $svc = Get-Service -Name MpsSvc -ErrorAction SilentlyContinue
            $fwReport += "MpsSvc=$(if ($svc) { $svc.Status } else { 'absent' })"
        } catch {}
        try {
            $state = (& netsh advfirewall show allprofiles state 2>&1 | Where-Object { $_ -match 'State|ON|OFF' }) -join ' '
            if ($state) { $fwReport += "state: $state" }
        } catch {}
        $clientEndpoint = if ($clientIPv4) { $clientIPv4 } else { 'unknown' }
        $fwReport += "client=${clientEndpoint}:$listenPort"
        Send-DeploymentStatus -Stage 'torrent-firewall' -Message ($fwReport -join ' | ')

        Send-DeploymentStatus -Stage 'torrent-download' -Message "Starting BitTorrent download of $fileName (tracker + peers + host seed)." -Extra @{ torrentUrl = [string] $BootConfig.torrentUrl }
        Send-Screenshot -Stage 'torrent-download'

        # No HTTP webseed is embedded in the torrent on purpose; the data comes
        # from the host BitTorrent seeder and from peers, so the host uploads
        # roughly one copy while clients redistribute pieces to each other.
        $aria2Gid = ([guid]::NewGuid().ToString('N')).Substring(0, 16)
        $aria2RpcSecret = [guid]::NewGuid().ToString('N')
        $aria2Args = @(
            "--dir=$osDir",
            '--check-integrity=true',
            '--seed-time=1441',
            '--seed-ratio=0.0',
            '--file-allocation=falloc',
            '--bt-save-metadata=false',
            '--enable-dht=false',
            '--enable-dht6=false',
            '--bt-enable-lpd=true',
            '--enable-peer-exchange=true',
            '--bt-tracker-interval=5',
            "--listen-port=$listenPort",
            "--gid=$aria2Gid",
            '--enable-rpc=true',
            '--rpc-listen-all=false',
            '--rpc-listen-port=6800',
            "--rpc-secret=$aria2RpcSecret",
            '--console-log-level=warn',
            '--summary-interval=0',
            "--log=$logRoot\aria2.log",
            '--log-level=info',
            $torrentPath
        )
        if ($clientIPv4) {
            $aria2Args = @(
                "--bt-external-ip=$clientIPv4",
                "--bt-lpd-interface=$clientIPv4"
            ) + $aria2Args
        }
        $downloadStartTime = Get-Date
        $proc = Start-Process -FilePath $aria2 -ArgumentList $aria2Args -WindowStyle Hidden -PassThru
        $rpcWarningShown = $false
        $hostTelemetryWarningShown = $false
        $lastDownloadPeers = $null
        $lastUploadPeers = $null
        $observedDownloadPeers = @{}
        $observedUploadPeers = @{}
        $lastUploadLength = [double] 0
        $emergencyFallback = $false

        # aria2 removes the .aria2 control file once the download completes, then
        # keeps running to seed to peers. Poll for completion; do not block on the
        # seeding window (the apply proceeds while this client keeps seeding).
        # No intermediate stall check: file-size and file-mtime are both unreliable
        # for BT (falloc pre-fills to full size; rarest-first writes are non-sequential;
        # Windows delays LastWriteTime until file close). aria2 has its own retry/
        # reconnect logic; a 30-min outer deadline covers genuine hung downloads.
        $deadline = (Get-Date).AddMinutes(30)
        while ($true) {
            Start-Sleep -Seconds 5
            $downloadComplete = (Test-Path -LiteralPath $targetWim) -and (-not (Test-Path -LiteralPath $controlFile))

            try {
                $status = Invoke-Aria2Rpc -Method 'aria2.tellStatus' -Secret $aria2RpcSecret -Gid $aria2Gid -Keys @(
                    'totalLength',
                    'completedLength',
                    'uploadLength',
                    'downloadSpeed',
                    'uploadSpeed'
                )
                $peers = @(Invoke-Aria2Rpc -Method 'aria2.getPeers' -Secret $aria2RpcSecret -Gid $aria2Gid)
                try {
                    $telemetryResponse = Send-TorrentTelemetry -Status $status -Peers $peers -Phase 'downloading' -Fallback $emergencyFallback
                    if ($telemetryResponse.emergency -and -not $emergencyFallback) {
                        $emergencyFallback = $true
                        Send-DeploymentStatus -Stage 'torrent-emergency-fallback' -Message 'Torrent progress stalled for 3 minutes; host emergency fallback enabled.'
                    }
                }
                catch {
                    if (-not $hostTelemetryWarningShown) {
                        Write-Warning "Host torrent telemetry unavailable; local progress continues. $($_.Exception.Message)"
                        $hostTelemetryWarningShown = $true
                    }
                }

                $totalBytes = [double] $status.totalLength
                $completedBytes = [double] $status.completedLength
                $downloadSpeed = [double] $status.downloadSpeed
                $uploadSpeed = [double] $status.uploadSpeed
                $lastUploadLength = [math]::Max($lastUploadLength, [double] $status.uploadLength)
                $percent = if ($totalBytes -gt 0) { [math]::Min(100, [math]::Floor(($completedBytes / $totalBytes) * 100)) } else { 0 }
                $eta = if ($downloadSpeed -gt 0 -and $totalBytes -gt $completedBytes) {
                    Format-TorrentEta -Seconds (($totalBytes - $completedBytes) / $downloadSpeed)
                } else {
                    '--'
                }
                $progressStatus = '{0:N2}/{1:N2} GiB | down {2:N1} MiB/s | up {3:N1} MiB/s | ETA {4}' -f (
                    $completedBytes / 1GB
                ), (
                    $totalBytes / 1GB
                ), (
                    $downloadSpeed / 1MB
                ), (
                    $uploadSpeed / 1MB
                ), $eta
                Write-Progress -Id 22 -Activity "Torrent OS image: $fileName" -Status $progressStatus -PercentComplete $percent

                $downloadingFrom = @($peers | Where-Object { [double] $_.downloadSpeed -gt 0 } | ForEach-Object {
                    '{0}:{1} [{2}]' -f $_.ip, $_.port, $(if ([string] $_.seeder -eq 'true') { 'Seeder' } else { 'Peer' })
                } | Sort-Object -Unique)
                $uploadingTo = @($peers | Where-Object { [double] $_.uploadSpeed -gt 0 } | ForEach-Object {
                    '{0}:{1} [{2}]' -f $_.ip, $_.port, $(if ([string] $_.seeder -eq 'true') { 'Seeder' } else { 'Peer' })
                } | Sort-Object -Unique)

                foreach ($peer in $downloadingFrom) { $observedDownloadPeers[$peer] = $true }
                foreach ($peer in $uploadingTo) { $observedUploadPeers[$peer] = $true }

                $downloadPeerKey = $downloadingFrom -join '|'
                if ($downloadPeerKey -ne $lastDownloadPeers) {
                    Write-Host "Downloading from: $(if ($downloadingFrom.Count) { $downloadingFrom -join ', ' } else { 'waiting for active sources' })" -ForegroundColor Cyan
                    $lastDownloadPeers = $downloadPeerKey
                }
                $uploadPeerKey = $uploadingTo -join '|'
                if ($uploadPeerKey -ne $lastUploadPeers) {
                    Write-Host "Uploading to: $(if ($uploadingTo.Count) { $uploadingTo -join ', ' } else { 'no active receivers' })" -ForegroundColor DarkCyan
                    $lastUploadPeers = $uploadPeerKey
                }
            }
            catch {
                if (-not $rpcWarningShown) {
                    Write-Warning "Torrent progress telemetry unavailable; download continues. $($_.Exception.Message)"
                    $rpcWarningShown = $true
                }
            }

            if ($downloadComplete) {
                break
            }
            if ($proc.HasExited) {
                throw "aria2c exited (code $($proc.ExitCode)) before completing the download."
            }
            if ((Get-Date) -gt $deadline) {
                throw 'BitTorrent download timed out (30 min).'
            }
        }
        Write-Progress -Id 22 -Activity "Torrent OS image: $fileName" -Completed

        Send-DeploymentStatus -Stage 'torrent-verify' -Message 'Verifying downloaded image SHA-256.'
        Write-Host 'Verifying downloaded image SHA-256...'
        $actual = (Get-FileHash -LiteralPath $targetWim -Algorithm SHA256).Hash.ToUpperInvariant()
        $expected = ([string] $BootConfig.osWimSha256).ToUpperInvariant()
        if ($actual -ne $expected) {
            throw "SHA-256 mismatch (actual=$actual expected=$expected)."
        }

        # Completion-only transfer evidence. RPC-observed endpoints avoid the old
        # aria2 log scan, which could misclassify this client's own address as a peer.
        $peerSources = @($observedDownloadPeers.Keys | Where-Object { $_ -notmatch "^$([regex]::Escape($server)):" } | Sort-Object)
        $peerReceivers = @($observedUploadPeers.Keys | Sort-Object)
        $peerDiag = "peerSources=$($peerSources.Count) receivers=$($peerReceivers.Count) uploadedBytes=$([long] $lastUploadLength)"
        if ($peerSources.Count) { $peerDiag += " sourceEndpoints=$(($peerSources | Select-Object -First 8) -join ',')" }
        if ($peerReceivers.Count) { $peerDiag += " receiverEndpoints=$(($peerReceivers | Select-Object -First 8) -join ',')" }
        Send-DeploymentStatus -Stage 'torrent-peers' -Message $peerDiag

        $item = Get-Item -LiteralPath $targetWim
        $durationSeconds = [math]::Round(((Get-Date) - $downloadStartTime).TotalSeconds, 1)
        $avgSpeedMiBps   = if ($durationSeconds -gt 0) { [math]::Round($item.Length / 1MB / $durationSeconds, 1) } else { 0 }
        $sourceSummary = @($observedDownloadPeers.Keys | Sort-Object)
        $receiverSummary = @($observedUploadPeers.Keys | Sort-Object)
        Write-Host ''
        Write-Host 'Torrent transfer complete.' -ForegroundColor Green
        Write-Host ("  Downloaded: {0:N2} GiB in {1:N1}s (average {2:N1} MiB/s)" -f ($item.Length / 1GB), $durationSeconds, $avgSpeedMiBps)
        Write-Host ("  Uploaded: {0:N2} GiB" -f ($lastUploadLength / 1GB))
        Write-Host "  Sources used: $(if ($sourceSummary.Count) { $sourceSummary -join ', ' } else { 'none observed' })"
        Write-Host "  Uploaded to: $(if ($receiverSummary.Count) { $receiverSummary -join ', ' } else { 'none observed' })"
        $completedAt = Get-Date
        $seedDeadline = $completedAt.AddMinutes($seedMinutes)
        $contextPath = Join-Path $logRoot 'TorrentTransferContext.json'
        $telemetryStatePath = Join-Path $logRoot 'TorrentTelemetryState.json'
        $telemetryStopPath = Join-Path $logRoot 'Stop-TorrentTelemetry.txt'
        Remove-Item -LiteralPath $telemetryStopPath, $telemetryStatePath -Force -ErrorAction SilentlyContinue
        $transferContext = [pscustomobject]@{
            imageFile = $item
            process = $proc
            rpcSecret = $aria2RpcSecret
            gid = $aria2Gid
            completedAt = $completedAt
            seedDeadline = $seedDeadline
            seedBaseMinutes = $seedMinutes
            seedLocalExtensionMinutes = 0
            seedHostExtensionMinutes = 0
            maxSeedMinutes = 1440
            phase = 'seeding'
            fallback = $emergencyFallback
            runId = $runId
            clientId = $clientId
            telemetryUrl = $torrentTelemetryUrl
            controlUrl = $torrentControlUrl
            contextPath = $contextPath
            statePath = $telemetryStatePath
            stopPath = $telemetryStopPath
            reporterProcess = $null
        }
        Set-TorrentTransferPhase -Context $transferContext -Phase 'seeding' -Fallback $emergencyFallback
        $telemetryReporter = Join-Path $PSScriptRoot 'Report-TorrentTelemetry.ps1'
        if (Test-Path -LiteralPath $telemetryReporter -PathType Leaf) {
            try {
                $transferContext.reporterProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
                    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $telemetryReporter, '-ContextPath', $contextPath
                ) -WindowStyle Hidden -PassThru
            }
            catch {
                Write-Warning "Torrent telemetry reporter could not start; seeding continues. $($_.Exception.Message)"
            }
        }
        Send-DeploymentStatus -Stage 'torrent-download' -Message "P2P download complete; seeding to peers until $($seedDeadline.ToString('o'))." -Percent 100 -Extra @{ fileName = $fileName; bytes = $item.Length; durationSeconds = $durationSeconds; avgSpeedMiBps = $avgSpeedMiBps; seedDeadline = $seedDeadline.ToString('o') }
        Send-Screenshot -Stage 'torrent-download'
        return $transferContext
    }
    catch {
        Write-Progress -Id 22 -Activity "Torrent OS image: $fileName" -Completed -ErrorAction SilentlyContinue
        Send-DeploymentStatus -Stage 'torrent-fallback' -Message "Torrent path failed; falling back to SMB-direct apply. $($_.Exception.Message)"
        Send-Screenshot -Stage 'torrent-fallback'
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
        return $null
    }
}

Remove-Item -LiteralPath $stopProgressPath -Force -ErrorAction SilentlyContinue
Send-DeploymentStatus -Stage 'winpe-start' -Message 'Start-OSDCloud iPXE custom image deployment started.'
Send-Screenshot -Stage 'winpe-start'

$progressReporter = Join-Path $PSScriptRoot 'Report-OSDCloudProgress.ps1'
if (Test-Path -LiteralPath $progressReporter -PathType Leaf) {
    $reporterArgs = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $progressReporter,
        '-StatusUrl', $statusUrl,
        '-RunId', $runId,
        '-ClientId', $clientId,
        '-ScreenshotUrl', $screenshotUrl,
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
        Send-Screenshot -Stage 'reporter-error'
    }
}
else {
    Write-Warning "Progress reporter not found: $progressReporter"
    Send-DeploymentStatus -Stage 'reporter-missing' -Message "Progress reporter not found: $progressReporter"
    Send-Screenshot -Stage 'reporter-error'
}

Import-Module OSD -Force

cmd.exe /c 'net use Z: /delete /y' | Out-Null
if ([string]::IsNullOrWhiteSpace($smbPassword)) {
    $smbPassword = Get-DeploymentSecret -JsonName 'pxeinstallPassword' -EnvironmentName 'OSDCLOUD_PXEINSTALL_PASSWORD'
}
if ([string]::IsNullOrWhiteSpace($smbUser)) {
    $smbUser = 'pxeinstall'
}
$netUse = & net.exe use Z: $share "/user:$server\$smbUser" $smbPassword /persistent:no 2>&1
$netUse | ForEach-Object { Write-Host $_ }


$osRoot = 'Z:\OSDCloud\OS'
$SelectedOs = Get-LabSelectedOsManifest -OsRoot $osRoot
if (-not $SelectedOs -or [string]::IsNullOrWhiteSpace([string] $SelectedOs.fileName) -or -not $SelectedOs.imageIndex) {
    throw "selected-os.json did not produce a usable OS selection from $osRoot"
}

# Apply independent profile international settings from selected-profile.json.
# displayLanguage is kept separate from the WIM language metadata and is validated
# against that single-language WIM before the profile is published.
$profileManifestPath = 'Z:\OSDCloud\Apps\selected-profile.json'
if (Test-Path -LiteralPath $profileManifestPath -PathType Leaf) {
    try {
        $profileManifest = Get-Content -LiteralPath $profileManifestPath -Raw | ConvertFrom-Json
        if (-not [string]::IsNullOrWhiteSpace([string] $profileManifest.displayLanguage)) {
            $SelectedOs | Add-Member -NotePropertyName uiLanguage -NotePropertyValue ([string] $profileManifest.displayLanguage) -Force
            Write-Host "Profile display language override: $($profileManifest.displayLanguage)"
        }
        if (-not [string]::IsNullOrWhiteSpace([string] $profileManifest.locale)) {
            $SelectedOs | Add-Member -NotePropertyName locale -NotePropertyValue ([string] $profileManifest.locale) -Force
            Write-Host "Profile locale override: $($profileManifest.locale)"
        }
        if (-not [string]::IsNullOrWhiteSpace([string] $profileManifest.inputLanguage)) {
            $SelectedOs | Add-Member -NotePropertyName inputLanguage -NotePropertyValue ([string] $profileManifest.inputLanguage) -Force
            Write-Host "Profile input language override: $($profileManifest.inputLanguage)"
        }
        if (-not [string]::IsNullOrWhiteSpace([string] $profileManifest.timeZone)) {
            $SelectedOs | Add-Member -NotePropertyName timeZone -NotePropertyValue ([string] $profileManifest.timeZone) -Force
            Write-Host "Profile timeZone override: $($profileManifest.timeZone)"
        }
    }
    catch {
        Write-Warning "Unable to read profile manifest international settings: $($_.Exception.Message)"
    }
}

$imagePath = Join-Path $osRoot ([string] $SelectedOs.fileName)
Write-Host "Selected OS: $($SelectedOs.id) $($SelectedOs.language) $($SelectedOs.edition) index $($SelectedOs.imageIndex)"
Write-Host "Image source: $share\OSDCloud\OS\$($SelectedOs.fileName)"
Write-Host "OSImageIndex: $($SelectedOs.imageIndex)"
Send-DeploymentStatus -Stage 'os-image-selected' -Message "Selected OS image $($SelectedOs.id)." -Extra (New-NoRedownloadEvidence -SelectedOs $SelectedOs -ImagePath $imagePath)

if (-not (Test-Path -LiteralPath $imagePath)) {
    Write-Warning "Unable to access Windows image at $imagePath"
    Send-DeploymentStatus -Stage 'image-missing' -Message "Unable to access Windows image at $imagePath" -Extra (New-NoRedownloadEvidence -SelectedOs $SelectedOs -ImagePath $imagePath)
    Send-Screenshot -Stage 'image-missing'
    Write-Warning 'Press Ctrl+C to exit OSDCloud'
    Start-Sleep -Seconds 86400
    exit 1
}

$smbImageFile = Get-Item -LiteralPath $imagePath
Write-Host "[$(Get-Date -Format G)] Mapped SMB image available: $($smbImageFile.FullName)"
Send-DeploymentStatus -Stage 'smb-mounted' -Message "Using mapped SMB image: $($smbImageFile.FullName)" -Extra (New-NoRedownloadEvidence -SelectedOs $SelectedOs -ImagePath $imagePath -ImageFile $smbImageFile)
Send-Screenshot -Stage 'smb-mounted'

# Default-enabled BitTorrent P2P acceleration. On success the WIM is staged
# locally on a freshly partitioned disk and disk steps are skipped; on any
# failure we transparently fall back to the proven SMB-direct apply.
$imageFile = $smbImageFile
$skipDiskSteps = $false
$torrentTransfer = Invoke-TorrentOsImageDownload -BootConfig $bootConfig -ExpectedFileName ([string] $SelectedOs.fileName)
if ($torrentTransfer) {
    $imageFile = $torrentTransfer.imageFile
    $skipDiskSteps = $true
    Write-Host "[$(Get-Date -Format G)] Using P2P-staged local image: $($imageFile.FullName)"
}

$Global:StartOSDCloud = [ordered]@{
    LaunchMethod         = 'OSDCloudCLI'
    ImageFileDestination = $imageFile
    ImageFileName        = $imageFile.Name
    ImageFileUrl         = $null
    OSImageIndex         = [int] $SelectedOs.imageIndex
    OSEdition            = [string] $SelectedOs.edition
    OSEditionId          = [string] $SelectedOs.editionId
    OSLanguage           = [string] $SelectedOs.language
    OSActivation         = [string] $SelectedOs.activation
    DriverPackName       = 'None'
    MSCatalogFirmware    = $false
    MSCatalogDiskDrivers = $false
    MSCatalogNetDrivers  = $false
    MSCatalogScsiDrivers = $false
    WindowsUpdate        = $false
    WindowsUpdateDrivers = $false
    ZTI                  = $true
    SkipAllDiskSteps     = $skipDiskSteps
    SkipAutopilot        = $true
    SkipODT              = $true
    Restart              = $false
    Shutdown             = $false
}

# When the torrent path already partitioned the disk, Invoke-OSDCloud skips the
# wipe. When it hasn't (non-torrent path), show a countdown so the operator can
# abort, then suppress the Clear-Disk confirmation dialog that would otherwise block.
if (-not $skipDiskSteps) {
    Write-Host ''
    Write-Host 'WARNING: Disk will be wiped and repartitioned. Press Ctrl+C to abort.' -ForegroundColor Yellow
    for ($secs = 5; $secs -gt 0; $secs--) {
        Write-Host "  Proceeding in $secs..." -ForegroundColor Yellow
        Start-Sleep -Seconds 1
    }
    $Global:ConfirmPreference = 'None'
}

$deploymentSucceeded = $false
try {
    if ($torrentTransfer) {
        Set-TorrentTransferPhase -Context $torrentTransfer -Phase 'applying' -Fallback ([bool] $torrentTransfer.fallback)
    }
    Send-DeploymentStatus -Stage 'osdcloud-start' -Message 'Invoke-OSDCloud starting.' -Extra (New-NoRedownloadEvidence -SelectedOs $SelectedOs -ImagePath $imagePath -ImageFile $imageFile)
    Send-Screenshot -Stage 'osdcloud-start'
    Invoke-OSDCloud
    $deploymentSucceeded = $true
    Save-DeploymentStatusMetadata
    if ($torrentTransfer) {
        if ($torrentTransfer.seedBaseMinutes -gt 0) {
            Wait-TorrentSeedWindow -Context $torrentTransfer
        }
        else {
            Stop-TorrentTransfer -Context $torrentTransfer
        }
    }
    Send-DeploymentStatus -Stage 'osdcloud-finished' -Message 'Invoke-OSDCloud returned successfully. WinPE will reboot.' -Extra (New-NoRedownloadEvidence -SelectedOs $SelectedOs -ImagePath $imagePath -ImageFile $imageFile)
    Send-Screenshot -Stage 'osdcloud-finished'
}
catch {
    if ($torrentTransfer) {
        Stop-TorrentTransfer -Context $torrentTransfer
    }
    Send-DeploymentStatus -Stage 'osdcloud-error' -Message $_.Exception.Message
    Send-Screenshot -Stage 'osdcloud-error'
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
    Send-Screenshot -Stage 'rebooting'
    Start-Sleep -Seconds 10
    wpeutil reboot
}
