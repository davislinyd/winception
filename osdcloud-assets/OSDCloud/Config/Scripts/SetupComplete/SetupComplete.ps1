$ErrorActionPreference = 'Continue'
$LogDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Start-Transcript -Path (Join-Path $LogDir 'oobe-customization-transcript.log') -Append -ErrorAction SilentlyContinue

$UserName = $null

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

    $secretPath = 'C:\ProgramData\OSDCloud\secrets.json'
    if (Test-Path -LiteralPath $secretPath -PathType Leaf) {
        try {
            $secrets = Get-Content -LiteralPath $secretPath -Raw | ConvertFrom-Json
            $value = $secrets.$JsonName
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                return [string] $value
            }
        }
        catch {
            Write-Warning "Unable to read deployment secrets from $secretPath`: $($_.Exception.Message)"
        }
    }

    throw "Missing required deployment secret '$JsonName'. Provide $secretPath or set $EnvironmentName before SetupComplete runs."
}

$UserName = Get-DeploymentSecret -JsonName 'windowsUsername' -EnvironmentName 'OSDCLOUD_WINDOWS_USERNAME'
$PlainPassword = Get-DeploymentSecret -JsonName 'windowsPassword' -EnvironmentName 'OSDCLOUD_WINDOWS_PASSWORD'
$SecurePassword = ConvertTo-SecureString $PlainPassword -AsPlainText -Force
$DeploymentMetadataPath = 'C:\ProgramData\OSDCloud\DeploymentStatus.json'
$DefaultStatusUrl = 'http://192.168.77.1/osdcloud/status'
function Get-DeploymentMetadata {
    if (Test-Path -LiteralPath $DeploymentMetadataPath -PathType Leaf) {
        try {
            return Get-Content -LiteralPath $DeploymentMetadataPath -Raw | ConvertFrom-Json
        }
        catch {
        }
    }

    [pscustomobject]@{
        runId = "windows-$env:COMPUTERNAME-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        clientId = $env:COMPUTERNAME
        statusUrl = $DefaultStatusUrl
    }
}

$DeploymentMetadata = Get-DeploymentMetadata

function Get-SelectedOsMetadata {
    if ($DeploymentMetadata.selectedOs) {
        return $DeploymentMetadata.selectedOs
    }

    [pscustomobject]@{
        id = 'unpublished'
        language = 'zh-tw'
        uiLanguage = 'zh-TW'
        locale = 'zh-TW'
        timeZone = 'Taipei Standard Time'
        edition = 'Pro'
        editionId = 'Professional'
        imageIndex = 1
    }
}

$SelectedOs = Get-SelectedOsMetadata
$TargetDisplayLanguage = if ($SelectedOs.uiLanguage) { [string] $SelectedOs.uiLanguage } elseif ($SelectedOs.language) { [string] $SelectedOs.language } else { 'zh-TW' }
$TargetLocale = if ($SelectedOs.locale) { [string] $SelectedOs.locale } else { $TargetDisplayLanguage }
$TargetTimeZone = if ($SelectedOs.timeZone) { [string] $SelectedOs.timeZone } else { '' }
if ([string]::IsNullOrWhiteSpace($TargetTimeZone)) {
    throw 'Deployment metadata is missing an explicit Windows time zone.'
}

function Send-DeploymentStatus {
    param(
        [string] $Stage,
        [string] $Message,
        [Nullable[double]] $Percent = $null,
        [hashtable] $Extra = @{}
    )

    $statusUrl = if ($DeploymentMetadata.statusUrl) { [string] $DeploymentMetadata.statusUrl } else { $DefaultStatusUrl }
    $payload = [ordered]@{
        timestamp = (Get-Date).ToString('o')
        runId = [string] $DeploymentMetadata.runId
        clientId = [string] $DeploymentMetadata.clientId
        stage = $Stage
        message = $Message
        percent = $Percent
        source = 'windows'
        computerName = $env:COMPUTERNAME
        selectedOs = $SelectedOs
    }

    foreach ($key in $Extra.Keys) {
        $payload[$key] = $Extra[$key]
    }

    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    try {
        Invoke-WebRequest -Uri $statusUrl -Method Post -ContentType 'application/json' -Body $json -UseBasicParsing -TimeoutSec 5 | Out-Null
        return $true
    }
    catch {
    }

    try {
        $req = [System.Net.HttpWebRequest]::Create($statusUrl)
        $req.Method = 'POST'
        $req.ContentType = 'application/json'
        $req.Timeout = 5000
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $req.ContentLength = $bytes.Length
        $stream = $req.GetRequestStream()
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Close()
        $req.GetResponse().Close()
        return $true
    }
    catch {
    }

    return $false
}

function Get-FirstObjectPropertyValue {
    param(
        [object] $InputObject,
        [string[]] $Names
    )

    if ($null -eq $InputObject) {
        return $null
    }

    foreach ($name in $Names) {
        $property = $InputObject.PSObject.Properties[$name]
        if ($property -and $null -ne $property.Value -and -not [string]::IsNullOrWhiteSpace([string] $property.Value)) {
            return $property.Value
        }
    }

    return $null
}

function Get-DriverPackCacheMetadata {
    $driverRoot = 'C:\Drivers'
    $driverPacks = @()

    if (-not (Test-Path -LiteralPath $driverRoot -PathType Container)) {
        return @()
    }

    $metadataFiles = @(Get-ChildItem -LiteralPath $driverRoot -Filter '*.json' -File -ErrorAction SilentlyContinue)
    foreach ($metadataFile in $metadataFiles) {
        try {
            $metadata = Get-Content -LiteralPath $metadataFile.FullName -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            continue
        }

        $fileName = Get-FirstObjectPropertyValue -InputObject $metadata -Names @('fileName', 'FileName')
        $url = Get-FirstObjectPropertyValue -InputObject $metadata -Names @('url', 'Url', 'URL')
        if ([string]::IsNullOrWhiteSpace([string] $fileName) -or [string]::IsNullOrWhiteSpace([string] $url)) {
            continue
        }

        $product = Get-FirstObjectPropertyValue -InputObject $metadata -Names @('product', 'Product')
        $productList = @()
        if ($null -ne $product) {
            $productList = @($product) | Where-Object { -not [string]::IsNullOrWhiteSpace([string] $_) }
        }

        $driverPacks += [ordered]@{
            manufacturer = Get-FirstObjectPropertyValue -InputObject $metadata -Names @('manufacturer', 'Manufacturer')
            model = Get-FirstObjectPropertyValue -InputObject $metadata -Names @('model', 'Model')
            product = @($productList)
            name = Get-FirstObjectPropertyValue -InputObject $metadata -Names @('name', 'Name')
            packageId = Get-FirstObjectPropertyValue -InputObject $metadata -Names @('packageId', 'PackageID', 'PackageId')
            fileName = [string] $fileName
            url = [string] $url
            metadataPath = $metadataFile.FullName
        }
    }

    return @($driverPacks)
}

function Send-DriverPackCacheRequest {
    try {
        $driverPacks = @(Get-DriverPackCacheMetadata)
        if ($driverPacks.Count -eq 0) {
            return $false
        }

        return (Send-DeploymentStatus -Stage 'windows-driverpack-cache-request' -Message "Requesting host driver pack cache backfill for $($driverPacks.Count) driver pack(s)." -Percent 95 -Extra @{
            driverPacks = @($driverPacks)
        })
    }
    catch {
        return $false
    }
}

function Resolve-TargetUserProfilePath {
    param(
        [Parameter(Mandatory)][string] $TargetUser
    )

    $profileList = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList'
    if (-not (Test-Path -LiteralPath $profileList)) {
        return $null
    }

    Get-ChildItem -LiteralPath $profileList -ErrorAction SilentlyContinue |
        ForEach-Object {
            Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
        } |
        Where-Object {
            $_.ProfileImagePath -and (Split-Path -Leaf $_.ProfileImagePath) -ieq $TargetUser
        } |
        Select-Object -ExpandProperty ProfileImagePath -First 1
}

function Set-TargetUserEnvironment {
    param(
        [Parameter(Mandatory)][string] $TargetUser
    )

    $profilePath = Resolve-TargetUserProfilePath -TargetUser $TargetUser
    $desktopPath = if ($profilePath) {
        Join-Path $profilePath 'Desktop'
    }
    else {
        Join-Path $env:SystemDrive 'Users\Default\Desktop'
    }

    New-Item -ItemType Directory -Path $desktopPath -Force -ErrorAction SilentlyContinue | Out-Null
    [Environment]::SetEnvironmentVariable('OSDCloudTargetUser', $TargetUser, 'Process')
    [Environment]::SetEnvironmentVariable('OSDCloudTargetProfilePath', $profilePath, 'Process')
    [Environment]::SetEnvironmentVariable('OSDCloudTargetDesktopPath', $desktopPath, 'Process')

    [ordered]@{
        targetUser = $TargetUser
        targetUserProfilePath = $profilePath
        targetUserDesktopPath = $desktopPath
    }
}

function Get-TextFileTail {
    param(
        [Parameter(Mandatory)][string] $Path,
        [int] $Count = 40
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return @()
    }

    return @(Get-Content -LiteralPath $Path -Tail $Count -ErrorAction SilentlyContinue)
}

function Get-TextFileTailText {
    param(
        [Parameter(Mandatory)][string] $Path,
        [int] $Count = 40
    )

    [string]::Join("`n", @(Get-TextFileTail -Path $Path -Count $Count))
}

function Get-JsonFileObject {
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        return $null
    }
}

function Get-InstallSequenceFailureDetails {
    param([Parameter(Mandatory)][string] $LogRoot)

    $summaryPath = Join-Path $LogRoot 'install-sequence-summary.json'
    $summary = Get-JsonFileObject -Path $summaryPath
    if ($null -eq $summary) {
        return @{}
    }

    $failedStep = $summary.failedStep
    if ($null -eq $failedStep -and $summary.steps) {
        $failedStep = @($summary.steps | Where-Object { $_.status -ne 'succeeded' } | Select-Object -First 1)
        if ($failedStep.Count -gt 0) {
            $failedStep = $failedStep[0]
        }
    }

    if ($null -eq $failedStep) {
        return @{
            sequenceSummaryPath = $summaryPath
            statePath = $summary.statePath
        }
    }

    @{
        sequenceSummaryPath = $summaryPath
        statePath = $summary.statePath
        stepIndex = $failedStep.stepIndex
        stepType = $failedStep.stepType
        stepId = $failedStep.stepId
        stepStatus = $failedStep.status
        reason = $failedStep.reason
        timeoutSeconds = $failedStep.timeoutSeconds
        stepLogPath = $failedStep.logPath
        stepStdoutTailText = $failedStep.stdoutTailText
        stepStderrTailText = $failedStep.stderrTailText
    }
}

function Invoke-ClientAppInstallers {
    $appsRoot = 'C:\ProgramData\OSDCloud\Apps'
    $installer = Join-Path $appsRoot 'Install-Apps.ps1'
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        return [ordered]@{
            found = $false
            root = $appsRoot
        }
    }

    [void] (Send-DeploymentStatus -Stage 'windows-apps-start' -Message 'Installing client applications.' -Percent 94.5 -Extra @{
        appsRoot = $appsRoot
    })

    $powerShellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $argumentList = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$installer`""
    $stdoutPath = Join-Path $LogDir 'apps-install.stdout.log'
    $stderrPath = Join-Path $LogDir 'apps-install.stderr.log'
    $transcriptPath = Join-Path $LogDir 'apps-install.log'
    $sequenceSummaryPath = Join-Path $LogDir 'install-sequence-summary.json'
    $statePath = Join-Path $LogDir 'install-sequence-state.json'
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

    $AppInstallerTimeoutSeconds = 90 * 60
    $AppInstallerHeartbeatSeconds = 30

    $process = Start-Process -FilePath $powerShellPath -ArgumentList $argumentList -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

    $pollStart = Get-Date
    $timedOut = $false
    while (-not $process.HasExited) {
        $elapsedSeconds = [int] ((Get-Date) - $pollStart).TotalSeconds
        if ($elapsedSeconds -ge $AppInstallerTimeoutSeconds) {
            try { taskkill.exe /PID $process.Id /T /F 2>$null } catch {}
            $timedOut = $true
            break
        }
        [void] (Send-DeploymentStatus -Stage 'windows-apps-progress' `
            -Message "Installing client applications... ($elapsedSeconds s elapsed)." `
            -Percent 94.5)
        Start-Sleep -Seconds $AppInstallerHeartbeatSeconds
    }
    if (-not $timedOut) {
        $process.WaitForExit()
    }
    $process.Refresh()

    # Start-Process -PassThru in Windows PowerShell 5.1 can return null ExitCode even after
    # WaitForExit(). Fall back to the sequence summary JSON written by Install-Apps.ps1.
    $appExitCode = $process.ExitCode
    if ($null -eq $appExitCode) {
        $summaryObj = Get-JsonFileObject -Path $sequenceSummaryPath
        $appExitCode = if ($null -ne $summaryObj -and
                           $summaryObj.PSObject.Properties['failedStep'] -and
                           $null -ne $summaryObj.failedStep) { 1 } else { 0 }
    }

    $result = [ordered]@{
        found = $true
        root = $appsRoot
        script = $installer
        exitCode = $appExitCode
        stdoutLog = $stdoutPath
        stderrLog = $stderrPath
        transcriptLog = $transcriptPath
        sequenceSummaryPath = $sequenceSummaryPath
        statePath = $statePath
        stdoutTailText = Get-TextFileTailText -Path $stdoutPath -Count 80
        stderrTailText = Get-TextFileTailText -Path $stderrPath -Count 80
        transcriptTailText = Get-TextFileTailText -Path $transcriptPath -Count 80
    }
    $failureDetails = Get-InstallSequenceFailureDetails -LogRoot $LogDir
    foreach ($key in $failureDetails.Keys) {
        $result[$key] = $failureDetails[$key]
    }

    if ($timedOut) {
        $timeoutMessage = "Client application installer exceeded timeout of $([int]($AppInstallerTimeoutSeconds / 60)) minutes and was terminated."
        [void] (Send-DeploymentStatus -Stage 'windows-apps-error' -Message $timeoutMessage -Percent 94.9 -Extra $result)
        throw $timeoutMessage
    }

    if ($appExitCode -ne 0) {
        $message = if ($result.stepStatus -eq 'timed_out') {
            "Client application installer timed out at step $($result.stepIndex) ($($result.stepType):$($result.stepId))."
        }
        elseif ($result.stepId) {
            "Client application installer failed at step $($result.stepIndex) ($($result.stepType):$($result.stepId)): $($result.reason)"
        }
        else {
            "Client application installer failed with exit code $($process.ExitCode)."
        }
        [void] (Send-DeploymentStatus -Stage 'windows-apps-error' -Message $message -Percent 94.9 -Extra $result)
        throw $message
    }

    [void] (Send-DeploymentStatus -Stage 'windows-apps-finished' -Message 'Client applications installed.' -Percent 95.5 -Extra $result)
    return $result
}

function Install-DesktopReadyReporter {
    $programData = 'C:\ProgramData\OSDCloud'
    New-Item -ItemType Directory -Path $programData -Force | Out-Null
    $reporterPath = Join-Path $programData 'Report-DesktopReady.ps1'
    $taskName = 'OSDCloudDesktopReadyReport'
    $reporter = @'
$ErrorActionPreference = 'Continue'
$metadataPath = 'C:\ProgramData\OSDCloud\DeploymentStatus.json'
$defaultStatusUrl = 'http://192.168.77.1/osdcloud/status'
$taskName = 'OSDCloudDesktopReadyReport'
$targetUser = 'TARGET_USER_PLACEHOLDER'
$logDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Start-Transcript -Path (Join-Path $logDir 'desktop-ready-reporter.log') -Append -ErrorAction SilentlyContinue | Out-Null

function Get-Metadata {
    if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
        try {
            return Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
        }
        catch {
        }
    }

    [pscustomobject]@{
        runId = "windows-$env:COMPUTERNAME-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        clientId = $env:COMPUTERNAME
        statusUrl = $defaultStatusUrl
    }
}

$metadata = Get-Metadata

function Send-Status {
    param(
        [string] $Stage,
        [string] $Message,
        [Nullable[double]] $Percent = $null,
        [hashtable] $Extra = @{}
    )

    $statusUrl = if ($metadata.statusUrl) { [string] $metadata.statusUrl } else { $defaultStatusUrl }
    $payload = [ordered]@{
        timestamp = (Get-Date).ToString('o')
        runId = [string] $metadata.runId
        clientId = [string] $metadata.clientId
        stage = $Stage
        message = $Message
        percent = $Percent
        source = 'windows'
        computerName = $env:COMPUTERNAME
        runAs = "$env:USERDOMAIN\$env:USERNAME"
    }

    if ($metadata.selectedOs) {
        $payload.selectedOs = $metadata.selectedOs
    }

    foreach ($key in $Extra.Keys) {
        $payload[$key] = $Extra[$key]
    }

    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    try {
        Invoke-WebRequest -Uri $statusUrl -Method Post -ContentType 'application/json' -Body $json -UseBasicParsing -TimeoutSec 5 | Out-Null
        return $true
    }
    catch {
    }

    try {
        $req = [System.Net.HttpWebRequest]::Create($statusUrl)
        $req.Method = 'POST'
        $req.ContentType = 'application/json'
        $req.Timeout = 5000
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $req.ContentLength = $bytes.Length
        $stream = $req.GetRequestStream()
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Close()
        $req.GetResponse().Close()
        return $true
    }
    catch {
    }

    return $false
}

function Test-TargetUserIdentity {
    param([string] $Identity)

    if ([string]::IsNullOrWhiteSpace($Identity)) {
        return $false
    }

    return ($Identity -ieq $targetUser -or $Identity -match "\\$([regex]::Escape($targetUser))$")
}

function Get-LoggedOnUser {
    try {
        return (Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop).UserName
    }
    catch {
        return $null
    }
}

function Get-ExplorerOwner {
    try {
        $owners = @(Get-CimInstance Win32_Process -Filter "name = 'explorer.exe'" -ErrorAction Stop |
            ForEach-Object {
                $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
                if ($owner -and $owner.ReturnValue -eq 0 -and $owner.User) {
                    if ($owner.Domain) {
                        "$($owner.Domain)\$($owner.User)"
                    }
                    else {
                        $owner.User
                    }
                }
            } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

        $targetOwner = @($owners | Where-Object { Test-TargetUserIdentity -Identity $_ } | Select-Object -First 1)
        if ($targetOwner.Count -gt 0) {
            return $targetOwner[0]
        }

        return @($owners | Select-Object -First 1)[0]
    }
    catch {
        return $null
    }
}

function Get-TargetUserProfilePath {
    $profileList = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList'
    if (-not (Test-Path -LiteralPath $profileList)) {
        return $null
    }

    Get-ChildItem -LiteralPath $profileList -ErrorAction SilentlyContinue |
        ForEach-Object {
            Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
        } |
        Where-Object {
            $_.ProfileImagePath -and (Split-Path -Leaf $_.ProfileImagePath) -ieq $targetUser
        } |
        Select-Object -ExpandProperty ProfileImagePath -First 1
}

function Get-TargetUserDesktopPath {
    $profilePath = Get-TargetUserProfilePath
    if ([string]::IsNullOrWhiteSpace($profilePath)) {
        return $null
    }

    return (Join-Path $profilePath 'Desktop')
}

function Set-DesktopReadyMarker {
    param([string] $DesktopPath)

    if ([string]::IsNullOrWhiteSpace($DesktopPath)) {
        return $null
    }

    New-Item -ItemType Directory -Path $DesktopPath -Force -ErrorAction SilentlyContinue | Out-Null
    $markerPath = Join-Path $DesktopPath 'OSDCloud-Desktop-Ready.txt'
    "OSDCloud desktop ready $(Get-Date -Format o)" | Out-File $markerPath -Encoding ascii -Force
    return $markerPath
}

function Get-DesktopReadyFacts {
    $oobe = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE'
    $au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
    $currentVersion = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    $explorer = @(Get-Process explorer -ErrorAction SilentlyContinue)
    $oobeProcesses = @(Get-Process CloudExperienceHost, msoobe -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName })
    $loggedOnUser = Get-LoggedOnUser
    $explorerOwner = Get-ExplorerOwner
    $interactiveUserIsTarget = ((Test-TargetUserIdentity -Identity $loggedOnUser) -or (Test-TargetUserIdentity -Identity $explorerOwner))
    $targetUserProfilePath = Get-TargetUserProfilePath
    $targetUserDesktopPath = Get-TargetUserDesktopPath
    $desktopReadyFilePath = $null
    $uiLanguageOverride = Get-WinUILanguageOverride
    $inputLanguages = @(Get-WinUserLanguageList | ForEach-Object { $_.LanguageTag })

    if ($interactiveUserIsTarget -and -not [string]::IsNullOrWhiteSpace($targetUserDesktopPath)) {
        $desktopReadyFilePath = Set-DesktopReadyMarker -DesktopPath $targetUserDesktopPath
    }
    elseif (-not [string]::IsNullOrWhiteSpace($targetUserDesktopPath)) {
        $desktopReadyFilePath = Join-Path $targetUserDesktopPath 'OSDCloud-Desktop-Ready.txt'
    }

    [ordered]@{
        explorerRunning = ($explorer.Count -gt 0)
        desktopReadyFile = (-not [string]::IsNullOrWhiteSpace($desktopReadyFilePath) -and (Test-Path -LiteralPath $desktopReadyFilePath))
        loggedOnUser = $loggedOnUser
        explorerOwner = $explorerOwner
        interactiveUserIsTarget = $interactiveUserIsTarget
        targetUserProfilePath = $targetUserProfilePath
        targetUserDesktopPath = $targetUserDesktopPath
        desktopReadyFilePath = $desktopReadyFilePath
        oobeProcesses = @($oobeProcesses)
        launchUserOobe = (Get-ItemProperty -Path $oobe -Name LaunchUserOOBE -ErrorAction SilentlyContinue).LaunchUserOOBE
        skipUserOobe = (Get-ItemProperty -Path $oobe -Name SkipUserOOBE -ErrorAction SilentlyContinue).SkipUserOOBE
        noAutoUpdate = (Get-ItemProperty -Path $au -Name NoAutoUpdate -ErrorAction SilentlyContinue).NoAutoUpdate
        displayVersion = (Get-ItemProperty -Path $currentVersion -Name DisplayVersion -ErrorAction SilentlyContinue).DisplayVersion
        currentBuild = (Get-ItemProperty -Path $currentVersion -Name CurrentBuild -ErrorAction SilentlyContinue).CurrentBuild
        editionId = (Get-ItemProperty -Path $currentVersion -Name EditionID -ErrorAction SilentlyContinue).EditionID
        displayLanguage = if ($uiLanguageOverride) { $uiLanguageOverride.Name } else { $null }
        culture = (Get-Culture).Name
        timeZone = (Get-TimeZone).Id
        inputLanguages = $inputLanguages
    }
}

try {
    [void] (Send-Status -Stage 'windows-logon-start' -Message 'Desktop ready reporter started after TARGET_USER_PLACEHOLDER logon.' -Percent 98)
    $deadline = (Get-Date).AddMinutes(30)
    $desktopReadyReported = $false
    do {
        $facts = Get-DesktopReadyFacts
        if ($facts.explorerRunning -and $facts.interactiveUserIsTarget -and $facts.desktopReadyFile -and @($facts.oobeProcesses).Count -eq 0) {
            if (Send-Status -Stage 'windows-desktop-ready' -Message 'Windows desktop is ready for TARGET_USER_PLACEHOLDER.' -Percent 100 -Extra $facts) {
                $desktopReadyReported = $true
                Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
                break
            }
        }

        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)

    if (-not $desktopReadyReported -and (Get-Date) -ge $deadline) {
        [void] (Send-Status -Stage 'windows-desktop-timeout' -Message 'Timed out waiting for Explorer and desktop marker or status upload.' -Extra (Get-DesktopReadyFacts))
    }
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
'@

    $reporterContent = $reporter.Replace('TARGET_USER_PLACEHOLDER', $UserName)
    Set-Content -LiteralPath $reporterPath -Value $reporterContent -Encoding UTF8 -Force
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$reporterPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 35)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    return $reporterPath
}

[void] (Send-DeploymentStatus -Stage 'windows-setupcomplete-start' -Message 'SetupComplete started in deployed Windows.' -Percent 94)

try {
    if (-not (Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue)) {
        New-LocalUser -Name $UserName -Password $SecurePassword -FullName $UserName -Description 'Local deployment administrator' -PasswordNeverExpires -UserMayNotChangePassword:$false
    }
    else {
        Set-LocalUser -Name $UserName -Password $SecurePassword -PasswordNeverExpires $true
        Enable-LocalUser -Name $UserName
    }

    Add-LocalGroupMember -Group 'Administrators' -Member $UserName -ErrorAction SilentlyContinue

    if (Get-LocalUser -Name 'defaultuser0' -ErrorAction SilentlyContinue) {
        Remove-LocalUser -Name 'defaultuser0' -ErrorAction SilentlyContinue
    }

    # Disable the built-in Administrator account (SID ending in -500),
    # unless it is the account chosen for deployment (otherwise the only
    # usable login on the machine would be disabled).
    $adminUser = Get-LocalUser | Where-Object { $_.SID.Value -like '*-500' }
    if ($adminUser -and $adminUser.Name -ine $UserName) {
        Disable-LocalUser -Name $adminUser.Name -ErrorAction SilentlyContinue
    }

    Set-WinSystemLocale -SystemLocale $TargetDisplayLanguage
    Set-WinUILanguageOverride -Language $TargetDisplayLanguage
    Set-Culture $TargetLocale
    if (-not (Get-Command Copy-UserInternationalSettingsToSystem -ErrorAction SilentlyContinue)) {
        throw 'Copy-UserInternationalSettingsToSystem is unavailable; Windows 11 or later is required.'
    }
    Copy-UserInternationalSettingsToSystem -WelcomeScreen $true -NewUser $true
    Set-TimeZone -Id $TargetTimeZone

    $Oobe = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE'
    New-Item -Path $Oobe -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name LaunchUserOOBE -PropertyType DWord -Value 0 -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name SkipMachineOOBE -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name SkipUserOOBE -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name HideOnlineAccountScreens -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name HideEULAPage -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $Oobe -Name HideWirelessSetupInOOBE -PropertyType DWord -Value 1 -Force | Out-Null

    $WindowsUpdate = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
    $AutomaticUpdates = Join-Path $WindowsUpdate 'AU'
    New-Item -Path $AutomaticUpdates -Force | Out-Null
    New-ItemProperty -Path $AutomaticUpdates -Name NoAutoUpdate -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $AutomaticUpdates -Name AUOptions -PropertyType DWord -Value 2 -Force | Out-Null
    Stop-Service -Name wuauserv, UsoSvc, bits -Force -ErrorAction SilentlyContinue

    $Winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    New-ItemProperty -Path $Winlogon -Name AutoAdminLogon -PropertyType String -Value '1' -Force | Out-Null
    New-ItemProperty -Path $Winlogon -Name ForceAutoLogon -PropertyType String -Value '1' -Force | Out-Null
    New-ItemProperty -Path $Winlogon -Name DefaultUserName -PropertyType String -Value $UserName -Force | Out-Null
    New-ItemProperty -Path $Winlogon -Name DefaultPassword -PropertyType String -Value $PlainPassword -Force | Out-Null
    New-ItemProperty -Path $Winlogon -Name DefaultDomainName -PropertyType String -Value $env:COMPUTERNAME -Force | Out-Null
    New-ItemProperty -Path $Winlogon -Name AutoLogonCount -PropertyType DWord -Value 5 -Force | Out-Null

    $LogonUI = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\LogonUI'
    if (Test-Path $LogonUI) {
        $Sid = (Get-LocalUser -Name $UserName).SID.Value
        New-ItemProperty -Path $LogonUI -Name LastLoggedOnUser -PropertyType String -Value "$env:COMPUTERNAME\$UserName" -Force | Out-Null
        New-ItemProperty -Path $LogonUI -Name LastLoggedOnSAMUser -PropertyType String -Value "$env:COMPUTERNAME\$UserName" -Force | Out-Null
        New-ItemProperty -Path $LogonUI -Name SelectedUserSID -PropertyType String -Value $Sid -Force | Out-Null
    }

    $targetUserEnvironment = Set-TargetUserEnvironment -TargetUser $UserName
    $clientAppsResult = Invoke-ClientAppInstallers
    $reporterPath = Install-DesktopReadyReporter
    $driverPackCacheRequestSent = Send-DriverPackCacheRequest
    [void] (Send-DeploymentStatus -Stage 'windows-setupcomplete-finished' -Message 'SetupComplete finished; desktop ready reporter installed.' -Percent 96 -Extra @{
        reporterPath = $reporterPath
        clientApps = $clientAppsResult
        targetUserEnvironment = $targetUserEnvironment
        driverPackCacheRequestSent = $driverPackCacheRequestSent
        selectedOs = $SelectedOs
    })
}
catch {
    [void] (Send-DeploymentStatus -Stage 'windows-setupcomplete-error' -Message $_.Exception.Message -Extra @{ script = 'SetupComplete.ps1' })
    throw
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue
}

shutdown.exe /r /t 10 /c "OSDCloud $UserName desktop autologon"
