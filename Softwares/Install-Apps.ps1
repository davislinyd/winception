$ErrorActionPreference = 'Stop'

$LogDir = if ($env:OSDCloudLogDir) { $env:OSDCloudLogDir } else { 'C:\Windows\Temp\osdcloud-logs' }
$DefaultTimeoutSeconds = 900
$StatePath = Join-Path $LogDir 'install-sequence-state.json'
$SequenceSummaryPath = Join-Path $LogDir 'install-sequence-summary.json'
$CustomScriptSummaryPath = Join-Path $LogDir 'custom-scripts-summary.json'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Start-Transcript -Path (Join-Path $LogDir 'apps-install.log') -Append -ErrorAction SilentlyContinue | Out-Null

function Write-Utf8File {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Content
    )

    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function ConvertTo-PositiveIntegerValue {
    param(
        $Value,
        [Parameter(Mandatory)][string] $Label,
        [switch] $Optional,
        [int] $Min = 1
    )

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string] $Value)) {
        if ($Optional) {
            return $null
        }
        throw "Missing required $Label."
    }

    $number = 0
    if (-not [int]::TryParse([string] $Value, [ref] $number) -or $number -lt $Min) {
        throw "Invalid ${Label}: $Value"
    }

    return $number
}

function Test-SafePackageId {
    param([Parameter(Mandatory)][string] $Id)
    return $Id -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
}

function Resolve-PackageScript {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $PackageId,
        [Parameter(Mandatory)][string] $ScriptName,
        [Parameter(Mandatory)][string] $Label
    )

    if (-not (Test-SafePackageId -Id $PackageId)) {
        throw "Unsafe $Label id in selected profile: $PackageId"
    }

    $rootFullPath = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    $packageRoot = [System.IO.Path]::GetFullPath((Join-Path $rootFullPath $PackageId))
    $rootPrefix = "$rootFullPath\"
    if (-not $packageRoot.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label path escapes root: $PackageId"
    }

    $script = Join-Path $packageRoot $ScriptName
    if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
        throw "Selected $Label script not found: $PackageId ($script)"
    }

    return $script
}

function Get-SelectedProfile {
    param([Parameter(Mandatory)][string] $AppsRoot)

    $profilePath = Join-Path $AppsRoot 'selected-profile.json'
    if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
        return $null
    }
    return Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
}

function Get-SelectedSoftwareIds {
    param(
        [Parameter(Mandatory)][string] $AppsRoot,
        $Profile
    )

    if (-not $Profile) {
        Write-Host "selected-profile.json not found; installing all app folders for backward compatibility."
        return @(Get-ChildItem -LiteralPath $AppsRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne 'Scripts' } |
            Sort-Object Name |
            ForEach-Object { $_.Name })
    }

    $ids = @()
    if ($Profile.selectedSoftware) {
        $ids = @($Profile.selectedSoftware)
    }
    elseif ($Profile.software) {
        $ids = @($Profile.software | ForEach-Object {
            if ($_.id) { $_.id } else { $_ }
        })
    }

    return @($ids | ForEach-Object { [string] $_ })
}

function Get-InstallSequence {
    param(
        [Parameter(Mandatory)][string] $AppsRoot,
        $Profile
    )

    if ($Profile -and $Profile.installSequence) {
        return @($Profile.installSequence)
    }

    $sequence = @()
    foreach ($softwareId in @(Get-SelectedSoftwareIds -AppsRoot $AppsRoot -Profile $Profile)) {
        $sequence += [pscustomobject]@{ type = 'software'; id = $softwareId }
    }
    return @($sequence)
}

function Get-ExecutionConfig {
    param($Profile)

    $defaultTimeout = $DefaultTimeoutSeconds
    if ($Profile -and $Profile.execution) {
        $defaultTimeout = ConvertTo-PositiveIntegerValue -Value $Profile.execution.defaultTimeoutSeconds -Label 'selected-profile.execution.defaultTimeoutSeconds' -Optional
        if ($null -eq $defaultTimeout) {
            $defaultTimeout = $DefaultTimeoutSeconds
        }
    }

    [ordered]@{
        defaultTimeoutSeconds = $defaultTimeout
    }
}

function Get-StepTimeoutSeconds {
    param(
        [Parameter(Mandatory)] $Entry,
        [Parameter(Mandatory)] $Execution
    )

    $stepTimeout = ConvertTo-PositiveIntegerValue -Value $Entry.timeoutSeconds -Label "installSequence[$([string] $Entry.id)].timeoutSeconds" -Optional
    if ($null -ne $stepTimeout) {
        return $stepTimeout
    }
    return [int] $Execution.defaultTimeoutSeconds
}

function Resolve-TargetUserProfilePath {
    param([Parameter(Mandatory)][string] $TargetUser)

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

function Initialize-TargetUserEnvironment {
    $targetUser = if ($env:OSDCloudTargetUser) { $env:OSDCloudTargetUser } else { 'Administrator' }
    $profilePath = if ($env:OSDCloudTargetProfilePath) { $env:OSDCloudTargetProfilePath } else { Resolve-TargetUserProfilePath -TargetUser $targetUser }
    $desktopPath = if ($env:OSDCloudTargetDesktopPath) {
        $env:OSDCloudTargetDesktopPath
    }
    elseif ($profilePath) {
        Join-Path $profilePath 'Desktop'
    }
    else {
        Join-Path $env:SystemDrive 'Users\Default\Desktop'
    }

    New-Item -ItemType Directory -Path $desktopPath -Force -ErrorAction SilentlyContinue | Out-Null
    [Environment]::SetEnvironmentVariable('OSDCloudTargetUser', $targetUser, 'Process')
    [Environment]::SetEnvironmentVariable('OSDCloudTargetProfilePath', $profilePath, 'Process')
    [Environment]::SetEnvironmentVariable('OSDCloudTargetDesktopPath', $desktopPath, 'Process')
}

function Initialize-InstallStateFile {
    param([Parameter(Mandatory)][string] $Path)

    Write-Utf8File -Path $Path -Content '{}'
}

function Assert-ValidInstallStateFile {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label install sequence state file not found: $Path"
    }

    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($raw)) {
        throw "$Label install sequence state file is empty: $Path"
    }

    try {
        $null = $raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "$Label install sequence state file contains invalid JSON: $($_.Exception.Message)"
    }
}

function Get-TextFileTailText {
    param(
        [Parameter(Mandatory)][string] $Path,
        [int] $Count = 80
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return ''
    }

    [string]::Join("`n", @(Get-Content -LiteralPath $Path -Tail $Count -ErrorAction SilentlyContinue))
}

function New-StepLogPath {
    param(
        [Parameter(Mandatory)][string] $StepId,
        [Parameter(Mandatory)][string] $StepType,
        [Parameter(Mandatory)][int] $StepIndex
    )

    $stepLogRoot = Join-Path $LogDir 'install-sequence'
    New-Item -ItemType Directory -Path $stepLogRoot -Force | Out-Null
    $safeId = $StepId -replace '[^A-Za-z0-9._-]', '_'
    $safeType = $StepType -replace '[^A-Za-z0-9._-]', '_'
    $safeSequenceIndex = '{0:D3}' -f $StepIndex
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    Join-Path $stepLogRoot "$safeSequenceIndex-$safeType-$safeId-$stamp.log"
}

function Write-StepLog {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Message
    )

    Add-Content -LiteralPath $Path -Value $Message -Encoding UTF8
}

function Set-StepEnvironment {
    param(
        [Parameter(Mandatory)][string] $StatePathValue,
        [Parameter(Mandatory)][string] $StepId,
        [Parameter(Mandatory)][string] $StepType,
        [Parameter(Mandatory)][int] $StepIndex,
        [Parameter(Mandatory)][int] $TimeoutSeconds
    )

    $names = @(
        'OSDCloudInstallStatePath',
        'OSDCloudStepId',
        'OSDCloudStepType',
        'OSDCloudStepIndex',
        'OSDCloudStepTimeoutSeconds'
    )
    $previous = @{}
    foreach ($name in $names) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }

    [Environment]::SetEnvironmentVariable('OSDCloudInstallStatePath', $StatePathValue, 'Process')
    [Environment]::SetEnvironmentVariable('OSDCloudStepId', $StepId, 'Process')
    [Environment]::SetEnvironmentVariable('OSDCloudStepType', $StepType, 'Process')
    [Environment]::SetEnvironmentVariable('OSDCloudStepIndex', [string] $StepIndex, 'Process')
    [Environment]::SetEnvironmentVariable('OSDCloudStepTimeoutSeconds', [string] $TimeoutSeconds, 'Process')

    return $previous
}

function Restore-StepEnvironment {
    param([Parameter(Mandatory)][hashtable] $Previous)

    foreach ($name in $Previous.Keys) {
        [Environment]::SetEnvironmentVariable($name, $Previous[$name], 'Process')
    }
}

function Stop-StepProcessTree {
    param([Parameter(Mandatory)][int] $ProcessId)

    if ($ProcessId -le 0) {
        return
    }

    $taskKillPath = Join-Path $env:WINDIR 'System32\taskkill.exe'
    if (Test-Path -LiteralPath $taskKillPath -PathType Leaf) {
        try {
            & $taskKillPath /PID $ProcessId /T /F *> $null
            return
        }
        catch {
        }
    }

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
    catch {
    }
}

function Invoke-StepProcess {
    param(
        [Parameter(Mandatory)][string] $ScriptPath,
        [Parameter(Mandatory)][string] $StatePathValue,
        [Parameter(Mandatory)][string] $StepId,
        [Parameter(Mandatory)][string] $StepType,
        [Parameter(Mandatory)][int] $StepIndex,
        [Parameter(Mandatory)][int] $TimeoutSeconds,
        [Parameter(Mandatory)][string] $LogPath
    )

    $powerShellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    $bootstrapPath = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(), '.ps1')
    $failureMarkerPath = Join-Path ([System.IO.Path]::GetTempPath()) ("osdcloud-step-failure-{0}.marker" -f ([guid]::NewGuid().ToString('N')))
    $escapedScriptPath = $ScriptPath.Replace("'", "''")
    $escapedFailureMarkerPath = $failureMarkerPath.Replace("'", "''")
    $bootstrapContent = @"
`$ErrorActionPreference = 'Stop'
try {
    & '$escapedScriptPath'
    if (`$LASTEXITCODE -is [int] -and `$LASTEXITCODE -ne 0) {
        exit `$LASTEXITCODE
    }
    exit 0
}
catch {
    [System.IO.File]::WriteAllText('$escapedFailureMarkerPath', 'failed')
    Write-Error -ErrorRecord `$_
    exit 1
}
"@
    Write-Utf8File -Path $bootstrapPath -Content $bootstrapContent
    $previousEnvironment = Set-StepEnvironment -StatePathValue $StatePathValue -StepId $StepId -StepType $StepType -StepIndex $StepIndex -TimeoutSeconds $TimeoutSeconds
    try {
        $process = Start-Process -FilePath $powerShellPath -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $bootstrapPath) -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
        if ($timedOut) {
            Write-StepLog -Path $LogPath -Message "TimeoutSeconds: $TimeoutSeconds"
            Write-StepLog -Path $LogPath -Message "Timeout: process exceeded timeout and will be terminated."
            Stop-StepProcessTree -ProcessId $process.Id
        }

        try {
            $process.WaitForExit() | Out-Null
        }
        catch {
        }
        $process.Refresh()

        $stdoutTailText = Get-TextFileTailText -Path $stdoutPath -Count 80
        $stderrTailText = Get-TextFileTailText -Path $stderrPath -Count 80
        $hasPowerShellErrorOutput = -not [string]::IsNullOrWhiteSpace($stderrTailText) -and (
            $stderrTailText -match 'CategoryInfo\s+:' -or
            $stderrTailText -match 'FullyQualifiedErrorId\s+:'
        )

        if (-not [string]::IsNullOrWhiteSpace($stdoutTailText)) {
            Write-StepLog -Path $LogPath -Message '--- stdout tail ---'
            Write-StepLog -Path $LogPath -Message $stdoutTailText.TrimEnd()
        }
        if (-not [string]::IsNullOrWhiteSpace($stderrTailText)) {
            Write-StepLog -Path $LogPath -Message '--- stderr tail ---'
            Write-StepLog -Path $LogPath -Message $stderrTailText.TrimEnd()
        }

        $effectiveExitCode = if (-not $timedOut -and $process.ExitCode -eq 0 -and ((Test-Path -LiteralPath $failureMarkerPath -PathType Leaf) -or $hasPowerShellErrorOutput)) { 1 } else { $process.ExitCode }

        [ordered]@{
            timedOut = $timedOut
            exitCode = if ($timedOut) { $null } else { [int] $effectiveExitCode }
            stdoutTailText = $stdoutTailText
            stderrTailText = $stderrTailText
        }
    }
    finally {
        Restore-StepEnvironment -Previous $previousEnvironment
        Remove-Item -LiteralPath $stdoutPath, $stderrPath, $bootstrapPath, $failureMarkerPath -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-SequenceStep {
    param(
        [Parameter(Mandatory)][string] $AppsRoot,
        [Parameter(Mandatory)][string] $ScriptsRoot,
        [Parameter(Mandatory)] $Entry,
        [Parameter(Mandatory)][int] $StepIndex,
        [Parameter(Mandatory)] $Execution,
        [Parameter(Mandatory)][string] $StatePathValue
    )

    $stepType = [string] $Entry.type
    $stepId = [string] $Entry.id
    $timeoutSeconds = Get-StepTimeoutSeconds -Entry $Entry -Execution $Execution
    $started = Get-Date
    $logPath = New-StepLogPath -StepId $stepId -StepType $stepType -StepIndex $StepIndex
    $result = [ordered]@{
        stepIndex = $StepIndex
        sequenceIndex = $StepIndex
        type = $stepType
        stepType = $stepType
        id = $stepId
        stepId = $stepId
        name = if ($Entry.name) { [string] $Entry.name } else { $null }
        status = 'running'
        startedAt = $started.ToString('o')
        endedAt = $null
        durationSeconds = $null
        timeoutSeconds = $timeoutSeconds
        script = $null
        logPath = $logPath
        statePath = $StatePathValue
        exitCode = $null
        reason = $null
        error = $null
        stdoutTailText = ''
        stderrTailText = ''
    }

    Write-Host "Running $stepType (#$StepIndex): $stepId"
    Write-StepLog -Path $logPath -Message "StartedAt: $($result.startedAt)"
    Write-StepLog -Path $logPath -Message "StepIndex: $StepIndex"
    Write-StepLog -Path $logPath -Message "Type: $stepType"
    Write-StepLog -Path $logPath -Message "Id: $stepId"
    Write-StepLog -Path $logPath -Message "Name: $($result.name)"
    Write-StepLog -Path $logPath -Message "TimeoutSeconds: $timeoutSeconds"
    Write-StepLog -Path $logPath -Message "StatePath: $StatePathValue"
    try {
        Assert-ValidInstallStateFile -Path $StatePathValue -Label "Before step $StepIndex"

        switch ($stepType) {
            'software' {
                $scriptPath = Resolve-PackageScript -Root $AppsRoot -PackageId $stepId -ScriptName 'install.ps1' -Label 'app'
            }
            'script' {
                $scriptPath = Resolve-PackageScript -Root $ScriptsRoot -PackageId $stepId -ScriptName 'run.ps1' -Label 'custom script'
            }
            default {
                throw "Unsupported install sequence entry type: $stepType"
            }
        }

        $result.script = $scriptPath
        Write-StepLog -Path $logPath -Message "Script: $scriptPath"

        $processResult = Invoke-StepProcess -ScriptPath $scriptPath -StatePathValue $StatePathValue -StepId $stepId -StepType $stepType -StepIndex $StepIndex -TimeoutSeconds $timeoutSeconds -LogPath $logPath
        $result.stdoutTailText = $processResult.stdoutTailText
        $result.stderrTailText = $processResult.stderrTailText
        $hasPowerShellErrorOutput = -not [string]::IsNullOrWhiteSpace($processResult.stderrTailText) -and (
            $processResult.stderrTailText -match 'CategoryInfo\s+:' -or
            $processResult.stderrTailText -match 'FullyQualifiedErrorId\s+:'
        )

        if ($processResult.timedOut) {
            $result.status = 'timed_out'
            $result.reason = "Step timed out after $timeoutSeconds seconds"
            $result.error = $result.reason
            Write-Host "Timed out ${stepType}: $stepId"
            return [pscustomobject] $result
        }

        $result.exitCode = if ($processResult.exitCode -eq 0 -and $hasPowerShellErrorOutput) { 1 } else { $processResult.exitCode }
        Assert-ValidInstallStateFile -Path $StatePathValue -Label "After step $StepIndex"
        if ($result.exitCode -eq 0) {
            $result.status = 'succeeded'
            Write-Host "Completed ${stepType}: $stepId"
        }
        else {
            $result.status = 'failed'
            $result.reason = "Step exited with code $($result.exitCode)"
            $result.error = $result.reason
            Write-Host "Failed $stepType ${stepId}: $($result.reason)"
        }
    }
    catch {
        if ($_.Exception.Message -match 'not found') {
            $result.status = 'missing'
        }
        else {
            $result.status = 'failed'
        }
        $result.reason = $_.Exception.Message
        $result.error = $_.Exception.Message
        Write-Host "Failed $stepType ${stepId}: $($_.Exception.Message)"
        Write-StepLog -Path $logPath -Message "Exception: $($_.Exception.Message)"
    }
    finally {
        $ended = Get-Date
        $result.endedAt = $ended.ToString('o')
        $result.durationSeconds = [Math]::Round(($ended - $started).TotalSeconds, 3)
        Write-StepLog -Path $logPath -Message "EndedAt: $($result.endedAt)"
        Write-StepLog -Path $logPath -Message "DurationSeconds: $($result.durationSeconds)"
        Write-StepLog -Path $logPath -Message "Status: $($result.status)"
        if ($null -ne $result.exitCode) {
            Write-StepLog -Path $logPath -Message "ExitCode: $($result.exitCode)"
        }
        if ($result.reason) {
            Write-StepLog -Path $logPath -Message "Reason: $($result.reason)"
        }
    }

    return [pscustomobject] $result
}

function Write-InstallSequenceSummary {
    param(
        [Parameter(Mandatory)][System.Collections.ArrayList] $Results,
        [Parameter(Mandatory)] $Execution,
        [Parameter(Mandatory)][string] $StatePathValue
    )

    $steps = @($Results)
    $failedStep = @($steps | Where-Object { $_.status -ne 'succeeded' } | Select-Object -First 1)
    $summary = [ordered]@{
        generatedAt = (Get-Date).ToString('o')
        total = $steps.Count
        succeeded = @($steps | Where-Object { $_.status -eq 'succeeded' }).Count
        failed = @($steps | Where-Object { $_.status -eq 'failed' }).Count
        missing = @($steps | Where-Object { $_.status -eq 'missing' }).Count
        timedOut = @($steps | Where-Object { $_.status -eq 'timed_out' }).Count
        statePath = $StatePathValue
        execution = $Execution
        failedStep = if ($failedStep.Count -gt 0) { $failedStep[0] } else { $null }
        steps = $steps
    }
    Write-Utf8File -Path $SequenceSummaryPath -Content ($summary | ConvertTo-Json -Depth 8)
    return $SequenceSummaryPath
}

function Write-CustomScriptSummary {
    param([Parameter(Mandatory)][System.Collections.ArrayList] $Results)

    $scripts = @($Results | Where-Object { $_.type -eq 'script' })
    if ($scripts.Count -eq 0) {
        return $null
    }

    $summary = [ordered]@{
        generatedAt = (Get-Date).ToString('o')
        total = $scripts.Count
        succeeded = @($scripts | Where-Object { $_.status -eq 'succeeded' }).Count
        failed = @($scripts | Where-Object { $_.status -eq 'failed' }).Count
        missing = @($scripts | Where-Object { $_.status -eq 'missing' }).Count
        timedOut = @($scripts | Where-Object { $_.status -eq 'timed_out' }).Count
        scripts = $scripts
    }
    Write-Utf8File -Path $CustomScriptSummaryPath -Content ($summary | ConvertTo-Json -Depth 8)
    return $CustomScriptSummaryPath
}

try {
    $appsRoot = $PSScriptRoot
    $scriptsRoot = Join-Path (Split-Path -Parent $appsRoot) 'Scripts'
    $results = New-Object System.Collections.ArrayList
    Initialize-TargetUserEnvironment

    $profile = Get-SelectedProfile -AppsRoot $appsRoot
    $execution = Get-ExecutionConfig -Profile $profile
    Initialize-InstallStateFile -Path $StatePath
    Assert-ValidInstallStateFile -Path $StatePath -Label 'Initial'
    $installSequence = @(Get-InstallSequence -AppsRoot $appsRoot -Profile $profile)
    if ($installSequence.Count -eq 0) {
        Write-Host 'No client applications selected by deployment profile.'
    }

    $failedStep = $null
    $stepIndex = 0
    foreach ($entry in $installSequence) {
        $stepIndex += 1
        $result = Invoke-SequenceStep -AppsRoot $appsRoot -ScriptsRoot $scriptsRoot -Entry $entry -StepIndex $stepIndex -Execution $execution -StatePathValue $StatePath
        [void] $results.Add($result)
        if ($result.status -ne 'succeeded') {
            $failedStep = $result
            break
        }
    }

    $summaryPath = Write-InstallSequenceSummary -Results $results -Execution $execution -StatePathValue $StatePath
    Write-Host "Install sequence summary: $summaryPath"
    $customScriptSummaryPath = Write-CustomScriptSummary -Results $results
    if ($customScriptSummaryPath) {
        Write-Host "Custom script summary: $customScriptSummaryPath"
    }

    if ($failedStep) {
        throw "Install sequence failed at step $($failedStep.stepIndex) ($($failedStep.type):$($failedStep.id)): $($failedStep.reason)"
    }
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
