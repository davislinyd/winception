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
$server = '192.168.100.1'
$share = "\\$server\OSDCloudiPXE"
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

function Get-SelectedOsManifest {
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
$smbPassword = Get-DeploymentSecret -JsonName 'pxeinstallPassword' -EnvironmentName 'OSDCLOUD_PXEINSTALL_PASSWORD'
$netUse = & net.exe use Z: $share "/user:$server\pxeinstall" $smbPassword /persistent:no 2>&1
$netUse | ForEach-Object { Write-Host $_ }

$osRoot = 'Z:\OSDCloud\OS'
$SelectedOs = Get-SelectedOsManifest -OsRoot $osRoot
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

$imageFile = Get-Item -LiteralPath $imagePath
Write-Host "[$(Get-Date -Format G)] Using mapped SMB image: $($imageFile.FullName)"
Send-DeploymentStatus -Stage 'smb-mounted' -Message "Using mapped SMB image: $($imageFile.FullName)" -Extra (New-NoRedownloadEvidence -SelectedOs $SelectedOs -ImagePath $imagePath -ImageFile $imageFile)
Send-Screenshot -Stage 'smb-mounted'

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
    SkipAutopilot        = $true
    SkipODT              = $true
    Restart              = $false
    Shutdown             = $false
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
