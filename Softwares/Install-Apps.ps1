$ErrorActionPreference = 'Stop'

$LogDir = if ($env:OSDCloudLogDir) { $env:OSDCloudLogDir } else { 'C:\Windows\Temp\osdcloud-logs' }
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Start-Transcript -Path (Join-Path $LogDir 'apps-install.log') -Append -ErrorAction SilentlyContinue | Out-Null

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

function Get-CustomScripts {
    param($Profile, [string] $Phase)

    if (-not $Profile -or -not $Profile.customScripts) {
        return @()
    }
    return @($Profile.customScripts | Where-Object { $_.phase -eq $Phase })
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
    foreach ($entry in @(Get-CustomScripts -Profile $Profile -Phase 'before')) {
        $sequence += [pscustomobject]@{ type = 'script'; id = $entry.id; name = $entry.name; phase = $entry.phase }
    }
    foreach ($softwareId in @(Get-SelectedSoftwareIds -AppsRoot $AppsRoot -Profile $Profile)) {
        $sequence += [pscustomobject]@{ type = 'software'; id = $softwareId }
    }
    foreach ($entry in @(Get-CustomScripts -Profile $Profile -Phase 'after')) {
        $sequence += [pscustomobject]@{ type = 'script'; id = $entry.id; name = $entry.name; phase = $entry.phase }
    }
    return @($sequence)
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
    $targetUser = if ($env:OSDCloudTargetUser) { $env:OSDCloudTargetUser } else { 'davis' }
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

function New-CustomScriptLogPath {
    param(
        [Parameter(Mandatory)][string] $ScriptId,
        [Parameter(Mandatory)][string] $Phase
    )

    $scriptLogRoot = Join-Path $LogDir 'custom-scripts'
    New-Item -ItemType Directory -Path $scriptLogRoot -Force | Out-Null
    $safeId = $ScriptId -replace '[^A-Za-z0-9._-]', '_'
    $safePhase = $Phase -replace '[^A-Za-z0-9._-]', '_'
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    Join-Path $scriptLogRoot "$safeId-$safePhase-$stamp.log"
}

function Write-CustomScriptLog {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Message
    )

    Add-Content -LiteralPath $Path -Value $Message -Encoding UTF8
}

function Invoke-CustomScriptProcess {
    param(
        [Parameter(Mandatory)][string] $Script,
        [Parameter(Mandatory)][string] $LogPath
    )

    $powerShellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$Script`""
    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        $process = Start-Process -FilePath $powerShellPath -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $stdout = if (Test-Path -LiteralPath $stdoutPath -PathType Leaf) { Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue } else { '' }
        $stderr = if (Test-Path -LiteralPath $stderrPath -PathType Leaf) { Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue } else { '' }

        if (-not [string]::IsNullOrWhiteSpace($stdout)) {
            Write-CustomScriptLog -Path $LogPath -Message '--- stdout ---'
            Write-CustomScriptLog -Path $LogPath -Message $stdout.TrimEnd()
        }
        if (-not [string]::IsNullOrWhiteSpace($stderr)) {
            Write-CustomScriptLog -Path $LogPath -Message '--- stderr ---'
            Write-CustomScriptLog -Path $LogPath -Message $stderr.TrimEnd()
        }

        return $process.ExitCode
    }
    finally {
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-CustomScript {
    param(
        [Parameter(Mandatory)][string] $ScriptsRoot,
        [Parameter(Mandatory)] $Entry,
        [System.Collections.ArrayList] $Failures,
        [System.Collections.ArrayList] $Results
    )

    $scriptId = [string] $Entry.id
    $phase = [string] $Entry.phase
    $started = Get-Date
    $logPath = New-CustomScriptLogPath -ScriptId $scriptId -Phase $phase
    $result = [ordered]@{
        id = $scriptId
        name = if ($Entry.name) { [string] $Entry.name } else { $null }
        phase = $phase
        status = 'running'
        startedAt = $started.ToString('o')
        endedAt = $null
        durationSeconds = $null
        script = $null
        logPath = $logPath
        exitCode = $null
        error = $null
    }

    Write-Host "Running custom script ($phase): $scriptId"
    Write-CustomScriptLog -Path $logPath -Message "StartedAt: $($result.startedAt)"
    Write-CustomScriptLog -Path $logPath -Message "Id: $scriptId"
    Write-CustomScriptLog -Path $logPath -Message "Name: $($result.name)"
    Write-CustomScriptLog -Path $logPath -Message "Phase: $phase"
    try {
        $script = Resolve-PackageScript -Root $ScriptsRoot -PackageId $scriptId -ScriptName 'run.ps1' -Label 'custom script'
        $result.script = $script
        Write-CustomScriptLog -Path $logPath -Message "Script: $script"

        $exitCode = Invoke-CustomScriptProcess -Script $script -LogPath $logPath
        $result.exitCode = $exitCode
        if ($exitCode -eq 0) {
            $result.status = 'succeeded'
            Write-Host "Completed custom script: $scriptId"
        }
        else {
            $result.status = 'failed'
            $result.error = "Custom script exited with code $exitCode"
            $message = "Failed custom script ${scriptId}: $($result.error)"
            Write-Host $message
            [void] $Failures.Add($message)
        }
    }
    catch {
        if ($_.Exception.Message -match 'not found') {
            $result.status = 'missing'
        }
        else {
            $result.status = 'failed'
        }
        $result.error = $_.Exception.Message
        $message = "Failed custom script ${scriptId}: $($_.Exception.Message)"
        Write-Host $message
        Write-CustomScriptLog -Path $logPath -Message "Exception: $($_.Exception.Message)"
        [void] $Failures.Add($message)
    }
    finally {
        $ended = Get-Date
        $result.endedAt = $ended.ToString('o')
        $result.durationSeconds = [Math]::Round(($ended - $started).TotalSeconds, 3)
        Write-CustomScriptLog -Path $logPath -Message "EndedAt: $($result.endedAt)"
        Write-CustomScriptLog -Path $logPath -Message "DurationSeconds: $($result.durationSeconds)"
        Write-CustomScriptLog -Path $logPath -Message "Status: $($result.status)"
        if ($null -ne $result.exitCode) {
            Write-CustomScriptLog -Path $logPath -Message "ExitCode: $($result.exitCode)"
        }
        if ($result.error) {
            Write-CustomScriptLog -Path $logPath -Message "Error: $($result.error)"
        }
        [void] $Results.Add([pscustomobject] $result)
    }
}

function Write-CustomScriptSummary {
    param([Parameter(Mandatory)][System.Collections.ArrayList] $Results)

    $summaryPath = Join-Path $LogDir 'custom-scripts-summary.json'
    $summary = [ordered]@{
        generatedAt = (Get-Date).ToString('o')
        total = $Results.Count
        succeeded = @($Results | Where-Object { $_.status -eq 'succeeded' }).Count
        failed = @($Results | Where-Object { $_.status -eq 'failed' }).Count
        missing = @($Results | Where-Object { $_.status -eq 'missing' }).Count
        scripts = @($Results)
    }
    $summaryJson = $summary | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($summaryPath, $summaryJson, [System.Text.UTF8Encoding]::new($false))
    return $summaryPath
}

try {
    $appsRoot = $PSScriptRoot
    $scriptsRoot = Join-Path (Split-Path -Parent $appsRoot) 'Scripts'
    $failures = New-Object System.Collections.ArrayList
    $customScriptResults = New-Object System.Collections.ArrayList
    Initialize-TargetUserEnvironment

    $profile = Get-SelectedProfile -AppsRoot $appsRoot
    $installSequence = @(Get-InstallSequence -AppsRoot $appsRoot -Profile $profile)
    $softwareCount = 0

    foreach ($entry in $installSequence) {
        $entryType = [string] $entry.type
        if ($entryType -eq 'script') {
            Invoke-CustomScript -ScriptsRoot $scriptsRoot -Entry $entry -Failures $failures -Results $customScriptResults
            continue
        }
        if ($entryType -ne 'software') {
            $message = "Unsupported install sequence entry type: $entryType"
            Write-Host $message
            [void] $failures.Add($message)
            continue
        }
        $softwareId = [string] $entry.id
        $softwareCount += 1
        Write-Host "Installing app: $softwareId"
        try {
            $script = Resolve-PackageScript -Root $appsRoot -PackageId $softwareId -ScriptName 'install.ps1' -Label 'app'
            & $script
            Write-Host "Completed app: $softwareId"
        }
        catch {
            $message = "Failed app ${softwareId}: $($_.Exception.Message)"
            Write-Host $message
            [void] $failures.Add($message)
        }
    }

    if ($softwareCount -eq 0) {
        Write-Host 'No client applications selected by deployment profile.'
    }

    if ($customScriptResults.Count -gt 0) {
        $summaryPath = Write-CustomScriptSummary -Results $customScriptResults
        Write-Host "Custom script summary: $summaryPath"
    }

    if ($failures.Count -gt 0) {
        throw ($failures -join '; ')
    }
}
finally {
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
