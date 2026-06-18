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

# Dynamic deployment server detection
$candidates = [System.Collections.Generic.List[string]]::new()
try {
    # Check active interfaces DHCP/Gateway/DNS
    $adapters = Get-CimInstance -ClassName Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled }
    foreach ($adapter in $adapters) {
        if ($adapter.DHCPServer) { $candidates.Add($adapter.DHCPServer) }
        if ($adapter.DefaultIPGateway) { $candidates.AddRange($adapter.DefaultIPGateway) }
        if ($adapter.DNSServerSearchOrder) { $candidates.AddRange($adapter.DNSServerSearchOrder) }
    }
} catch {
    Write-Warning "Unable to query network adapter configuration: $($_.Exception.Message)"
}
# Fallback to standard defaults
$candidates.Add('192.168.100.1')
$candidates.Add('192.168.88.1')

$server = '192.168.77.1' # Default fallback
foreach ($ip in ($candidates | Select-Object -Unique)) {
    if ([string]::IsNullOrWhiteSpace($ip) -or $ip -eq '0.0.0.0') { continue }
    try {
        $testUrl = "http://$ip/osdcloud/status"
        # Test connection quickly
        $resp = Invoke-WebRequest -Uri $testUrl -Method Head -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $server = $ip
        Write-Host "Detected active deployment server at $server"
        break
    } catch {}
}

# Fetch dynamic boot configuration from the detected server
$bootConfigUrl = "http://$server/osdcloud/boot-config"
Write-Host "Fetching dynamic boot configuration from $bootConfigUrl..."
$bootConfig = $null
try {
    $bootConfig = Invoke-RestMethod -Uri $bootConfigUrl -Method Get -TimeoutSec 5 -ErrorAction Stop
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
        Invoke-WebRequest -Uri ([string] $BootConfig.torrentUrl) -OutFile $torrentPath -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop

        $targetWim = Join-Path $osDir $fileName
        $controlFile = "$targetWim.aria2"
        Remove-Item -LiteralPath $targetWim -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $controlFile -Force -ErrorAction SilentlyContinue

        $seedMinutes = 30
        if ($BootConfig.PSObject.Properties['seedMinutes'] -and [int] $BootConfig.seedMinutes -ge 0) {
            $seedMinutes = [int] $BootConfig.seedMinutes
        }

        # Peers MUST accept INBOUND BitTorrent connections for P2P to offload the
        # host: VM<->VM peering needs each VM to accept inbound TCP on the aria2
        # listen range. (VM->host works because the host accepts; if every VM
        # blocks inbound, no VM<->VM link forms and each pulls a full copy from
        # the seeder -> ~Nx, no offload.) Disable the firewall by every available
        # method, add an explicit allow rule, then report the resulting state so
        # the host can confirm inbound is actually open.
        $fwReport = @()
        try { $null = & netsh advfirewall set allprofiles state off 2>&1; $fwReport += 'advfirewall=off' } catch { $fwReport += "advfirewall-err=$($_.Exception.Message)" }
        try { $null = & netsh advfirewall firewall add rule name='aria2-in' dir=in action=allow protocol=TCP localport=6881-6999 2>&1; $fwReport += 'rule=added' } catch {}
        try { $null = & netsh firewall set opmode mode=disable 2>&1; $fwReport += 'legacy=disabled' } catch {}
        try {
            $svc = Get-Service -Name MpsSvc -ErrorAction SilentlyContinue
            $fwReport += "MpsSvc=$(if ($svc) { $svc.Status } else { 'absent' })"
        } catch {}
        try {
            $state = (& netsh advfirewall show allprofiles state 2>&1 | Where-Object { $_ -match 'State|ON|OFF' }) -join ' '
            if ($state) { $fwReport += "state: $state" }
        } catch {}
        Send-DeploymentStatus -Stage 'torrent-firewall' -Message ($fwReport -join ' | ')

        Send-DeploymentStatus -Stage 'torrent-download' -Message "Starting BitTorrent download of $fileName (tracker + peers + host seed)." -Extra @{ torrentUrl = [string] $BootConfig.torrentUrl }
        Send-Screenshot -Stage 'torrent-download'

        # No HTTP webseed is embedded in the torrent on purpose; the data comes
        # from the host BitTorrent seeder and from peers, so the host uploads
        # roughly one copy while clients redistribute pieces to each other.
        $aria2Args = @(
            "--dir=$osDir",
            '--check-integrity=true',
            "--seed-time=$seedMinutes",
            '--seed-ratio=0.0',
            '--file-allocation=falloc',
            '--bt-save-metadata=false',
            '--enable-dht=false',
            '--enable-dht6=false',
            '--listen-port=6881-6999',
            '--console-log-level=warn',
            '--summary-interval=0',
            "--log=$logRoot\aria2.log",
            '--log-level=info',
            $torrentPath
        )
        $downloadStartTime = Get-Date
        $proc = Start-Process -FilePath $aria2 -ArgumentList $aria2Args -WindowStyle Hidden -PassThru

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

        Send-DeploymentStatus -Stage 'torrent-verify' -Message 'Verifying downloaded image SHA-256.'
        $actual = (Get-FileHash -LiteralPath $targetWim -Algorithm SHA256).Hash.ToUpperInvariant()
        $expected = ([string] $BootConfig.osWimSha256).ToUpperInvariant()
        if ($actual -ne $expected) {
            throw "SHA-256 mismatch (actual=$actual expected=$expected)."
        }

        # Count VM peer IPs in the aria2 log (info-level records peer IP:port).
        # Filters to the same /24 as the host seeder ($server) and excludes the
        # host itself — remaining IPs are other VMs that this client exchanged
        # pieces with, confirming VM<->VM BT links formed (firewall is open).
        $peerDiag = 'peers=0'
        try {
            $subnet = $server -replace '\.\d+$', '.'
            $logLines = Get-Content "$logRoot\aria2.log" -ErrorAction SilentlyContinue -TotalCount 100000
            if ($logLines) {
                $vmPeerIps = $logLines |
                    Select-String -Pattern '(\b(?:\d{1,3}\.){3}\d{1,3}\b)' -AllMatches |
                    ForEach-Object { $_.Matches | ForEach-Object { $_.Groups[1].Value } } |
                    Where-Object { $_.StartsWith($subnet) -and $_ -ne $server } |
                    Sort-Object -Unique
                $n = @($vmPeerIps).Count
                $peerDiag = "peers=$n$(if ($n -gt 0) { " ips=$(($vmPeerIps | Select-Object -First 8) -join ',')" })"
            }
        } catch {}
        Send-DeploymentStatus -Stage 'torrent-peers' -Message $peerDiag

        $item = Get-Item -LiteralPath $targetWim
        $durationSeconds = [math]::Round(((Get-Date) - $downloadStartTime).TotalSeconds, 1)
        $avgSpeedMiBps   = if ($durationSeconds -gt 0) { [math]::Round($item.Length / 1MB / $durationSeconds, 1) } else { 0 }
        Send-DeploymentStatus -Stage 'torrent-download' -Message "P2P download complete; seeding to peers (up to $seedMinutes min)." -Percent 100 -Extra @{ fileName = $fileName; bytes = $item.Length; durationSeconds = $durationSeconds; avgSpeedMiBps = $avgSpeedMiBps }
        Send-Screenshot -Stage 'torrent-download'
        return $item
    }
    catch {
        Send-DeploymentStatus -Stage 'torrent-fallback' -Message "Torrent path failed; falling back to SMB-direct apply. $($_.Exception.Message)"
        Send-Screenshot -Stage 'torrent-fallback'
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
$torrentImageFile = Invoke-TorrentOsImageDownload -BootConfig $bootConfig -ExpectedFileName ([string] $SelectedOs.fileName)
if ($torrentImageFile) {
    $imageFile = $torrentImageFile
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
    Send-DeploymentStatus -Stage 'osdcloud-start' -Message 'Invoke-OSDCloud starting.' -Extra (New-NoRedownloadEvidence -SelectedOs $SelectedOs -ImagePath $imagePath -ImageFile $imageFile)
    Send-Screenshot -Stage 'osdcloud-start'
    Invoke-OSDCloud
    $deploymentSucceeded = $true
    Save-DeploymentStatusMetadata
    Send-DeploymentStatus -Stage 'osdcloud-finished' -Message 'Invoke-OSDCloud returned successfully. WinPE will reboot.' -Extra (New-NoRedownloadEvidence -SelectedOs $SelectedOs -ImagePath $imagePath -ImageFile $imageFile)
    Send-Screenshot -Stage 'osdcloud-finished'
}
catch {
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
