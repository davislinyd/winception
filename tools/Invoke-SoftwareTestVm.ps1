[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Validate', 'Run')]
    [string]$Mode,
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._ -]{0,62}$')]
    [string]$VmName,
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._ -]{0,126}$')]
    [string]$CheckpointName,
    [string]$TargetUser,
    [string]$PayloadRoot,
    [string]$RunRoot,
    [string]$RunId,
    [string]$SecretsPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Utf8Json {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Value
    )

    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [System.IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
}

function Write-Result {
    param([Parameter(Mandatory)]$Value)

    Write-Output ('WINCEPTION_SOFTWARE_TEST_RESULT:' + ($Value | ConvertTo-Json -Compress -Depth 10))
}

function Assert-SoftwareTestVm {
    $vm = Get-VM -Name $VmName -ErrorAction Stop
    if ($vm.Generation -ne 2) {
        throw 'Dedicated software test VM must be Generation 2.'
    }
    if ($vm.State -ne 'Off') {
        throw 'Dedicated software test VM must be off before registration or a new test run.'
    }
    $checkpoint = Get-VMSnapshot -VMName $VmName -Name $CheckpointName -ErrorAction Stop
    if ($null -eq $checkpoint) {
        throw 'Dedicated software test VM clean checkpoint was not found.'
    }
    return $vm
}

function Test-SoftwareTestVmRegistration {
    try {
        $vm = Get-VM -Name $VmName -ErrorAction Stop
    }
    catch {
        return [ordered]@{ valid = $false; reason = 'vm_not_found' }
    }
    if ($vm.Generation -ne 2) {
        return [ordered]@{ valid = $false; reason = 'vm_wrong_generation' }
    }
    if ($vm.State -ne 'Off') {
        return [ordered]@{ valid = $false; reason = 'vm_not_off' }
    }
    try {
        $checkpoint = Get-VMSnapshot -VMName $VmName -Name $CheckpointName -ErrorAction Stop
    }
    catch {
        return [ordered]@{ valid = $false; reason = 'checkpoint_not_found' }
    }
    if ($null -eq $checkpoint) {
        return [ordered]@{ valid = $false; reason = 'checkpoint_not_found' }
    }
    return [ordered]@{ valid = $true; vmName = $VmName; checkpointName = $CheckpointName }
}

function Get-DeploymentCredential {
    $secrets = @{}
    if ($SecretsPath -and (Test-Path -LiteralPath $SecretsPath -PathType Leaf)) {
        $secrets = Get-Content -LiteralPath $SecretsPath -Raw | ConvertFrom-Json
    }
    $username = if ($secrets.windowsUsername) { [string]$secrets.windowsUsername } else { [string]$env:OSDCLOUD_WINDOWS_USERNAME }
    $password = if ($secrets.windowsPassword) { [string]$secrets.windowsPassword } else { [string]$env:OSDCLOUD_WINDOWS_PASSWORD }
    if ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrWhiteSpace($password)) {
        throw 'Deployment Windows credentials are required for the dedicated software test VM.'
    }
    $securePassword = ConvertTo-SecureString -String $password -AsPlainText -Force
    return [pscredential]::new($username, $securePassword)
}

function Get-FirstValue {
    param(
        $Value,
        [string[]]$Names,
        $Default
    )

    foreach ($name in $Names) {
        if ($Value -and $Value.PSObject.Properties[$name] -and $null -ne $Value.$name) {
            return $Value.$name
        }
    }
    return $Default
}

function Connect-SoftwareTestVm {
    param([Parameter(Mandatory)][pscredential]$Credential)

    $deadline = (Get-Date).AddMinutes(5)
    do {
        if (Test-AbortRequested) {
            throw 'software_test_aborted'
        }
        try {
            return New-PSSession -VMName $VmName -Credential $Credential -ErrorAction Stop
        }
        catch {
            Start-Sleep -Seconds 5
        }
    } while ((Get-Date) -lt $deadline)
    throw 'Dedicated software test VM did not accept PowerShell Direct within five minutes.'
}

function Get-SafeStep {
    param($Step)

    if ($null -eq $Step) {
        return $null
    }
    return [ordered]@{
        index = [int](Get-FirstValue -Value $Step -Names @('index', 'stepIndex') -Default 0)
        type = [string](Get-FirstValue -Value $Step -Names @('type', 'stepType') -Default '')
        id = [string](Get-FirstValue -Value $Step -Names @('id', 'stepId') -Default '')
        name = [string](Get-FirstValue -Value $Step -Names @('name', 'id', 'stepId') -Default '')
        status = [string](Get-FirstValue -Value $Step -Names @('status') -Default '')
        durationSeconds = if ($Step.PSObject.Properties['durationSeconds'] -and $null -ne $Step.durationSeconds) { [double]$Step.durationSeconds } else { $null }
        timeoutSeconds = if ($Step.PSObject.Properties['timeoutSeconds'] -and $null -ne $Step.timeoutSeconds) { [int]$Step.timeoutSeconds } else { $null }
        networkWaitSeconds = if ($Step.PSObject.Properties['networkWaitSeconds'] -and $null -ne $Step.networkWaitSeconds) { [double]$Step.networkWaitSeconds } else { 0 }
        rebootRecommended = [bool](Get-FirstValue -Value $Step -Names @('rebootRecommended') -Default $false)
    }
}

function Get-SafeProgress {
    param($Progress)

    if ($null -eq $Progress) {
        return $null
    }
    $steps = @($Progress.completedSteps | ForEach-Object { Get-SafeStep $_ })
    if ($Progress.currentStep) {
        $steps += @(Get-SafeStep $Progress.currentStep)
    }
    return [ordered]@{
        status = [string](Get-FirstValue -Value $Progress -Names @('status') -Default 'running')
        phase = [string](Get-FirstValue -Value $Progress -Names @('phase') -Default '')
        elapsedSeconds = if ($null -ne $Progress.elapsedSeconds) { [double]$Progress.elapsedSeconds } else { $null }
        rebootCount = if ($null -ne $Progress.rebootCount) { [int]$Progress.rebootCount } else { 0 }
        steps = $steps
        failure = if ($Progress.failure) {
            [ordered]@{
                category = [string](Get-FirstValue -Value $Progress.failure -Names @('category') -Default '')
                stepId = [string](Get-FirstValue -Value $Progress.failure.step -Names @('id', 'stepId') -Default '')
                stepType = [string](Get-FirstValue -Value $Progress.failure.step -Names @('type', 'stepType') -Default '')
            }
        }
        else {
            $null
        }
    }
}

function Write-SafeStatus {
    param(
        [Parameter(Mandatory)][string]$Status,
        [Parameter(Mandatory)][string]$Phase,
        [Parameter(Mandatory)][string]$Cleanup,
        [string]$Detail,
        $Progress,
        [string]$StartedAt,
        [string]$FinishedAt,
        [string]$CleanupReason,
        [string]$CleanupAction
    )

    $safeProgress = Get-SafeProgress $Progress
    $elapsedSeconds = if ($safeProgress) { $safeProgress.elapsedSeconds } else { $null }
    $rebootCount = if ($safeProgress) { $safeProgress.rebootCount } else { 0 }
    $steps = if ($safeProgress) { @($safeProgress.steps) } else { @() }
    $failure = if ($safeProgress) { $safeProgress.failure } else { $null }
    $abortRequestedAt = Get-AbortRequestedAt
    $record = [ordered]@{
        runId = $RunId
        profileId = [string]$script:ProfileId
        profileName = [string]$script:ProfileName
        status = $Status
        phase = $Phase
        startedAt = $StartedAt
        finishedAt = $FinishedAt
        abortRequestedAt = $abortRequestedAt
        elapsedSeconds = $elapsedSeconds
        rebootCount = $rebootCount
        cleanup = $Cleanup
        cleanupReason = $CleanupReason
        cleanupAction = $CleanupAction
        detail = $Detail
        steps = $steps
        failure = $failure
    }
    Write-Utf8Json -Path (Join-Path $RunRoot 'status.json') -Value $record
    Write-Utf8Json -Path (Join-Path (Split-Path -Parent $RunRoot) 'latest.json') -Value $record
    return $record
}

function Get-AbortRequest {
    if ([string]::IsNullOrWhiteSpace($script:AbortRequestPath) -or -not (Test-Path -LiteralPath $script:AbortRequestPath -PathType Leaf)) {
        return $null
    }
    try {
        return Get-Content -LiteralPath $script:AbortRequestPath -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        return [ordered]@{ requestedAt = '' }
    }
}

function Test-AbortRequested {
    return $null -ne (Get-AbortRequest)
}

function Get-AbortRequestedAt {
    $request = Get-AbortRequest
    if ($request -and $request.PSObject.Properties['requestedAt']) {
        return [string]$request.requestedAt
    }
    return $null
}

function Get-CleanupFailure {
    param([Parameter(Mandatory)][string]$Reason)

    switch ($Reason) {
        'checkpoint_not_found' {
            return [ordered]@{
                reason = 'checkpoint_not_found'
                action = 'Rebuild or select the clean checkpoint in Hyper-V Manager, power off the dedicated VM, then use Test VM Settings and Register and verify.'
            }
        }
        'vm_not_off' {
            return [ordered]@{
                reason = 'vm_not_off'
                action = 'In Hyper-V Manager, shut down the dedicated VM. Saved and Paused states are not supported. Then use Test VM Settings and Register and verify.'
            }
        }
        'restore_failed' {
            return [ordered]@{
                reason = 'restore_failed'
                action = 'Restore the clean checkpoint manually in Hyper-V Manager, power off the dedicated VM, then use Test VM Settings and Register and verify.'
            }
        }
        default {
            return [ordered]@{
                reason = 'cleanup_failed'
                action = 'Check System Log, restore the dedicated clean checkpoint, power off the VM, then use Test VM Settings and Register and verify.'
            }
        }
    }
}

function Write-RunnerDiagnostic {
    param(
        [Parameter(Mandatory)][string]$Stage,
        [Parameter(Mandatory)]$ErrorRecord
    )

    $path = Join-Path $RunRoot 'runner-diagnostic.log'
    $entry = "[$((Get-Date).ToString('o'))] $Stage`r`n$($ErrorRecord | Out-String)`r`n"
    Add-Content -LiteralPath $path -Value $entry -Encoding UTF8
}

function Stop-SoftwareTestVmForCleanup {
    $vm = Get-VM -Name $VmName -ErrorAction Stop
    if ($vm.State -eq 'Off') {
        return
    }
    Stop-VM -Name $VmName -TurnOff -Force -Confirm:$false -ErrorAction Stop
    $deadline = (Get-Date).AddMinutes(2)
    do {
        $vm = Get-VM -Name $VmName -ErrorAction Stop
        if ($vm.State -eq 'Off') {
            return
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    throw 'vm_not_off'
}

function Stop-RemoteInstallerTask {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Runspaces.PSSession]$Session,
        [Parameter(Mandatory)][string]$TaskName
    )

    Invoke-Command -Session $Session -ScriptBlock {
        param($Name)
        Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    } -ArgumentList $TaskName -ErrorAction Stop
}

function Stop-SoftwareTestForAbort {
    param(
        [System.Management.Automation.Runspaces.PSSession]$Session,
        [string]$TaskName,
        $Progress,
        [string]$StartedAt
    )

    Write-SafeStatus -Status 'running' -Phase 'stopping-installer' -Cleanup 'pending' -Detail 'Stopping the software test installer.' -Progress $Progress -StartedAt $StartedAt | Out-Null
    if ($Session -and -not [string]::IsNullOrWhiteSpace($TaskName)) {
        try {
            Stop-RemoteInstallerTask -Session $Session -TaskName $TaskName
        }
        catch {
            Write-RunnerDiagnostic -Stage 'abort-stop-installer' -ErrorRecord $_
        }
    }
    throw 'software_test_aborted'
}

function Read-RemoteProgress {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Runspaces.PSSession]$Session,
        [Parameter(Mandatory)][string]$ProgressPath
    )

    Invoke-Command -Session $Session -ScriptBlock {
        param($Path)
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
            return $null
        }
        try {
            Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            return $null
        }
    } -ArgumentList $ProgressPath
}

function Start-RemoteInstallerTask {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Runspaces.PSSession]$Session,
        [Parameter(Mandatory)][string]$RemoteRoot,
        [Parameter(Mandatory)][string]$TaskName,
        [Parameter(Mandatory)][string]$ConfiguredTargetUser
    )

    Invoke-Command -Session $Session -ScriptBlock {
        param($Root, $Name, $User)
        $wrapperPath = Join-Path $Root 'Run-InstallApps.ps1'
        $wrapperContent = @'
$ErrorActionPreference = 'Stop'
$env:OSDCloudLogDir = Join-Path $PSScriptRoot 'logs'
$env:OSDCloudProgressPath = Join-Path $env:OSDCloudLogDir 'deployment-progress.json'
$env:OSDCloudTargetUser = '__WINCEPTION_TARGET_USER__'
& (Join-Path $PSScriptRoot 'Apps\Install-Apps.ps1')
exit $LASTEXITCODE
'@.Replace('__WINCEPTION_TARGET_USER__', $User)
        Set-Content -LiteralPath $wrapperPath -Value $wrapperContent -Encoding UTF8
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
        $powerShellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $action = New-ScheduledTaskAction -Execute $powerShellPath -Argument ('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $wrapperPath + '"')
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 8) -MultipleInstances IgnoreNew -StartWhenAvailable
        Register-ScheduledTask -TaskName $Name -Action $action -Principal $principal -Settings $settings -Force | Out-Null
        Start-ScheduledTask -TaskName $Name
    } -ArgumentList $RemoteRoot, $TaskName, $ConfiguredTargetUser
}

function Get-RemoteTaskState {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Runspaces.PSSession]$Session,
        [Parameter(Mandatory)][string]$TaskName
    )

    Invoke-Command -Session $Session -ScriptBlock {
        param($Name)
        $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
        [string]$task.State
    } -ArgumentList $TaskName
}

function Copy-RemoteLogs {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Runspaces.PSSession]$Session,
        [Parameter(Mandatory)][string]$RemoteRoot
    )

    $destination = Join-Path $RunRoot 'raw-logs'
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    try {
        Copy-Item -FromSession $Session -Path (Join-Path $RemoteRoot 'logs\*') -Destination $destination -Recurse -Force -ErrorAction Stop
    }
    catch {
    }
}

if ($Mode -eq 'Validate') {
    $validation = Test-SoftwareTestVmRegistration
    Write-Result $validation
    if (-not $validation.valid) {
        exit 1
    }
    exit 0
}

if ([string]::IsNullOrWhiteSpace($PayloadRoot) -or [string]::IsNullOrWhiteSpace($RunRoot) -or [string]::IsNullOrWhiteSpace($RunId) -or [string]::IsNullOrWhiteSpace($TargetUser)) {
    throw 'Software test run requires payload, run, id, and target user values.'
}

$startedAt = (Get-Date).ToString('o')
$script:AbortRequestPath = Join-Path $RunRoot 'abort-request.json'
$script:ProfileId = ''
$script:ProfileName = ''
$session = $null
$remoteRoot = 'C:\ProgramData\OSDCloud\SoftwareTest\' + $RunId
$taskName = 'WinceptionSoftwareTest-' + $RunId
$result = $null
$cleanup = 'pending'
$cleanupReason = ''
$cleanupAction = ''
$progress = $null

try {
    $manifestPath = Join-Path $PayloadRoot 'Apps\selected-profile.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $script:ProfileId = [string]$manifest.profileId
    $script:ProfileName = [string]$manifest.profileName
    $maximumReboots = [Math]::Max(1, @($manifest.installSequence).Count)

    if (Test-AbortRequested) {
        throw 'software_test_aborted'
    }

    $vm = Assert-SoftwareTestVm
    if ($vm.State -ne 'Off') {
        throw 'Dedicated software test VM must be off before a new test run.'
    }
    Write-SafeStatus -Status 'running' -Phase 'restoring-checkpoint' -Cleanup 'pending' -Detail 'Restoring the dedicated clean checkpoint.' -StartedAt $startedAt | Out-Null
    Restore-VMSnapshot -VMName $VmName -Name $CheckpointName -Confirm:$false -ErrorAction Stop

    if (Test-AbortRequested) {
        throw 'software_test_aborted'
    }

    $credential = Get-DeploymentCredential
    Write-SafeStatus -Status 'running' -Phase 'starting-vm' -Cleanup 'pending' -Detail 'Starting the dedicated software test VM.' -StartedAt $startedAt | Out-Null
    Start-VM -Name $VmName -ErrorAction Stop | Out-Null
    $session = Connect-SoftwareTestVm -Credential $credential

    if (Test-AbortRequested) {
        Stop-SoftwareTestForAbort -Session $session -Progress $progress -StartedAt $startedAt
    }

    Invoke-Command -Session $session -ScriptBlock {
        param($Root)
        Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Path $Root -Force | Out-Null
    } -ArgumentList $remoteRoot
    if (Test-AbortRequested) {
        Stop-SoftwareTestForAbort -Session $session -Progress $progress -StartedAt $startedAt
    }
    Copy-Item -ToSession $session -Path (Join-Path $PayloadRoot 'Apps') -Destination $remoteRoot -Recurse -Force
    if (Test-AbortRequested) {
        Stop-SoftwareTestForAbort -Session $session -Progress $progress -StartedAt $startedAt
    }
    $scriptsPath = Join-Path $PayloadRoot 'Scripts'
    if (Test-Path -LiteralPath $scriptsPath -PathType Container) {
        Copy-Item -ToSession $session -Path $scriptsPath -Destination $remoteRoot -Recurse -Force
        if (Test-AbortRequested) {
            Stop-SoftwareTestForAbort -Session $session -Progress $progress -StartedAt $startedAt
        }
    }

    $reboots = 0
    do {
        if (Test-AbortRequested) {
            Stop-SoftwareTestForAbort -Session $session -TaskName $taskName -Progress $progress -StartedAt $startedAt
        }
        Write-SafeStatus -Status 'running' -Phase 'running-installer' -Cleanup 'pending' -Detail 'Running the published software sequence as SYSTEM.' -Progress $progress -StartedAt $startedAt | Out-Null
        Start-RemoteInstallerTask -Session $session -RemoteRoot $remoteRoot -TaskName $taskName -ConfiguredTargetUser $TargetUser
        $taskDeadline = (Get-Date).AddHours(8)
        do {
            Start-Sleep -Seconds 2
            if (Test-AbortRequested) {
                Stop-SoftwareTestForAbort -Session $session -TaskName $taskName -Progress $progress -StartedAt $startedAt
            }
            $progress = Read-RemoteProgress -Session $session -ProgressPath (Join-Path $remoteRoot 'logs\deployment-progress.json')
            if ($progress) {
                Write-SafeStatus -Status 'running' -Phase 'running-installer' -Cleanup 'pending' -Detail 'Running the published software sequence as SYSTEM.' -Progress $progress -StartedAt $startedAt | Out-Null
            }
            $taskState = Get-RemoteTaskState -Session $session -TaskName $taskName
        } while ($taskState -eq 'Running' -and (Get-Date) -lt $taskDeadline)

        $progress = Read-RemoteProgress -Session $session -ProgressPath (Join-Path $remoteRoot 'logs\deployment-progress.json')
        if ($progress -and [string]$progress.status -eq 'reboot_pending') {
            if ($reboots -ge $maximumReboots) {
                throw 'Software test reboot limit reached before the sequence completed.'
            }
            $reboots += 1
            Write-SafeStatus -Status 'running' -Phase 'rebooting' -Cleanup 'pending' -Detail 'Installer requested reboot; resuming the next sequence step.' -Progress $progress -StartedAt $startedAt | Out-Null
            if (Test-AbortRequested) {
                Stop-SoftwareTestForAbort -Session $session -TaskName $taskName -Progress $progress -StartedAt $startedAt
            }
            Invoke-Command -Session $session -ScriptBlock { Restart-Computer -Force } -ErrorAction SilentlyContinue
            Remove-PSSession -Session $session -ErrorAction SilentlyContinue
            $session = Connect-SoftwareTestVm -Credential $credential
        }
        else {
            break
        }
    } while ($true)

    Copy-RemoteLogs -Session $session -RemoteRoot $remoteRoot
    if ($progress -and [string]$progress.status -eq 'succeeded') {
        $result = Write-SafeStatus -Status 'succeeded' -Phase 'completed' -Cleanup 'pending' -Detail 'Software test completed successfully.' -Progress $progress -StartedAt $startedAt -FinishedAt ((Get-Date).ToString('o'))
    }
    else {
        $result = Write-SafeStatus -Status 'failed' -Phase 'completed' -Cleanup 'pending' -Detail 'Software test installer did not complete successfully.' -Progress $progress -StartedAt $startedAt -FinishedAt ((Get-Date).ToString('o'))
    }
}
catch {
    $wasAborted = $_.Exception.Message -eq 'software_test_aborted' -or (Test-AbortRequested)
    if ($session -and -not $wasAborted) {
        Copy-RemoteLogs -Session $session -RemoteRoot $remoteRoot
    }
    if ($wasAborted) {
        $result = Write-SafeStatus -Status 'aborted' -Phase 'cancelled' -Cleanup 'pending' -Detail 'Software test was stopped by the operator.' -Progress $progress -StartedAt $startedAt -FinishedAt ((Get-Date).ToString('o'))
    }
    else {
        $result = Write-SafeStatus -Status 'failed' -Phase 'failed' -Cleanup 'pending' -Detail 'Software test runner failed before completion.' -Progress $progress -StartedAt $startedAt -FinishedAt ((Get-Date).ToString('o'))
    }
}
finally {
    if ($session) {
        Remove-PSSession -Session $session -ErrorAction SilentlyContinue
    }
    try {
        $wasAborted = ($result -and [string]$result.status -eq 'aborted') -or (Test-AbortRequested)
        if ($wasAborted) {
            Write-SafeStatus -Status 'running' -Phase 'restoring-checkpoint' -Cleanup 'pending' -Detail 'Stopping test and restoring the clean checkpoint.' -Progress $progress -StartedAt $startedAt | Out-Null
        }
        Stop-SoftwareTestVmForCleanup
        try {
            $cleanupCheckpoint = Get-VMSnapshot -VMName $VmName -Name $CheckpointName -ErrorAction Stop
        }
        catch {
            throw 'checkpoint_not_found'
        }
        if ($null -eq $cleanupCheckpoint) {
            throw 'checkpoint_not_found'
        }
        try {
            Restore-VMSnapshot -VMName $VmName -Name $CheckpointName -Confirm:$false -ErrorAction Stop
        }
        catch {
            Write-RunnerDiagnostic -Stage 'restore-checkpoint' -ErrorRecord $_
            throw 'restore_failed'
        }
        $cleanup = 'succeeded'
    }
    catch {
        $cleanup = 'failed'
        $cleanupFailure = Get-CleanupFailure -Reason ([string]$_.Exception.Message)
        $cleanupReason = $cleanupFailure.reason
        $cleanupAction = $cleanupFailure.action
        Write-RunnerDiagnostic -Stage 'cleanup' -ErrorRecord $_
    }
    if ($result) {
        $result.cleanup = $cleanup
        if ($cleanup -eq 'failed') {
            $result.status = 'failed'
            $result.phase = 'cleanup-failed'
            $result.cleanupReason = $cleanupReason
            $result.cleanupAction = $cleanupAction
            $result.detail = 'Software test cleanup failed. ' + $cleanupAction
        }
        if (-not $result.finishedAt) {
            $result.finishedAt = (Get-Date).ToString('o')
        }
        Write-Utf8Json -Path (Join-Path $RunRoot 'status.json') -Value $result
        Write-Result $result
    }
}
