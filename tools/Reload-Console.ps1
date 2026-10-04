[CmdletBinding()]
param(
    [string] $AppRoot = 'C:\OSDCloud\HostTools\App'
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom

. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$SourceRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\\')
$NormalizedAppRoot = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd('\\')
$ReloadFromInstalledApp = $SourceRoot -ieq $NormalizedAppRoot
$HostToolsRoot = Split-Path -Parent $AppRoot
$StateRoot = Join-Path $HostToolsRoot 'State'
$RunRoot = Join-Path $HostToolsRoot 'State\run'
$TrayStatePath = Join-Path $RunRoot 'web-console-tray.json'
$TrayStopRequestPath = Join-Path $RunRoot 'web-console-tray.stop.json'

function Get-WebPort {
    $webPort = 8080
    try {
        $stateConfigPath = Join-Path $HostToolsRoot 'State\config\osdcloud-console.json'
        if (Test-Path -LiteralPath $stateConfigPath -PathType Leaf) {
            $cfg = Get-Content -LiteralPath $stateConfigPath -Raw | ConvertFrom-Json
            if ($cfg.web.port) {
                $webPort = [int] $cfg.web.port
            }
        }
    }
    catch {}
    return $webPort
}

function Get-InstallChannel {
    $stateConfigPath = Join-Path $StateRoot 'config\osdcloud-console.json'
    if (-not (Test-Path -LiteralPath $stateConfigPath -PathType Leaf)) {
        return 'Release'
    }
    try {
        $cfg = Get-Content -LiteralPath $stateConfigPath -Raw | ConvertFrom-Json
        if ([string]$cfg.product.channel -ieq 'development' -or [string]$cfg.product.dataPolicy -ieq 'development-fixture') {
            return 'Development'
        }
    }
    catch {
    }
    return 'Release'
}

function Read-TrayState {
    if (-not (Test-Path -LiteralPath $TrayStatePath -PathType Leaf)) {
        return $null
    }
    try {
        return Get-Content -LiteralPath $TrayStatePath -Raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Request-TrayStop {
    if (-not (Test-Path -LiteralPath $TrayStatePath -PathType Leaf)) {
        return $false
    }
    New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null
    $request = [ordered]@{
        appRoot = [System.IO.Path]::GetFullPath($AppRoot)
        requestedAt = [DateTimeOffset]::Now.ToString('o')
        requesterPid = $PID
        reason = 'reload'
    }
    [System.IO.File]::WriteAllText(
        $TrayStopRequestPath,
        (($request | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
        $Utf8NoBom
    )
    return $true
}

function Wait-TrayStop {
    param([int] $TimeoutSeconds = 8)

    $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::Now -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $webPort = Get-WebPort
        $conn = Get-NetTCPConnection -LocalPort $webPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not (Test-Path -LiteralPath $TrayStatePath -PathType Leaf) -and -not $conn) {
            return $true
        }
    }
    return $false
}

function Wait-WebPortClosed {
    param([int] $TimeoutSeconds = 8)

    $webPort = Get-WebPort
    $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::Now -lt $deadline) {
        $conn = Get-NetTCPConnection -LocalPort $webPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $conn) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Stop-ProcessById {
    param($ProcessId)

    if (-not $ProcessId) {
        return
    }
    $process = Get-Process -Id ([int] $ProcessId) -ErrorAction SilentlyContinue
    if ($process) {
        Write-Host "Terminating Web Console process: $($process.Id)"
        $process | Stop-Process -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $process.Id -Timeout 5 -ErrorAction SilentlyContinue
    }
}

function Stop-WebPortOwner {
    $webPort = Get-WebPort
    $conn = Get-NetTCPConnection -LocalPort $webPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        $processes = Get-CimInstance Win32_Process
        $nodeProcess = $processes | Where-Object { $_.ProcessId -eq $conn.OwningProcess -and $_.Name -eq 'node.exe' } | Select-Object -First 1
        if ($nodeProcess) {
            $parentProcess = $processes | Where-Object { $_.ProcessId -eq $nodeProcess.ParentProcessId -and $_.Name -in @('powershell.exe', 'pwsh.exe') } | Select-Object -First 1
            Stop-ProcessById -ProcessId $nodeProcess.ProcessId
            if ($parentProcess) {
                Stop-ProcessById -ProcessId $parentProcess.ProcessId
            }
        }
    }
}

function Stop-WebConsoleFallback {
    $trayState = Read-TrayState
    if ($trayState) {
        Stop-ProcessById -ProcessId $trayState.nodePid
        Stop-ProcessById -ProcessId $trayState.trayPid
    }

    Stop-WebPortOwner
    for ($attempt = 0; $attempt -lt 3 -and -not (Wait-WebPortClosed -TimeoutSeconds 2); $attempt++) {
        Stop-WebPortOwner
    }

    Remove-Item -LiteralPath $TrayStatePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $TrayStopRequestPath -Force -ErrorAction SilentlyContinue
    if (-not (Wait-WebPortClosed)) {
        throw "Timed out waiting for Web Console port $(Get-WebPort) to close."
    }
}

if (-not (Test-IsAdministrator)) {
    throw 'Reload-Console.ps1 must run from an elevated PowerShell session to update the installed HostTools App and its scoped State files.'
}

$rootRecoveryScript = Join-Path $HostToolsRoot 'Restore-HostManagementUpgrade.ps1'
$upgradePointerPath = Join-Path $HostToolsRoot 'upgrade-current.json'
$completeScript = Join-Path $AppRoot 'tools\Complete-HostManagementUpgrade.ps1'
$stagedAppPath = $null

try {
    $consoleStopped = $false
    if (Test-Path -LiteralPath $upgradePointerPath -PathType Leaf) {
        Write-Host 'Stopping Web Console to recover the interrupted HostTools upgrade...'
        if ((Request-TrayStop) -and (Wait-TrayStop)) {
            Write-Host 'Web Console tray stopped gracefully.'
        } else {
            Stop-WebConsoleFallback
        }
        if (-not (Test-Path -LiteralPath $rootRecoveryScript -PathType Leaf)) {
            throw "HostTools recovery script was not found: $rootRecoveryScript"
        }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $rootRecoveryScript -HostToolsRoot $HostToolsRoot -ConsoleAlreadyStopped
        if ($LASTEXITCODE -ne 0) { throw "Previous pending transaction recovery failed with exit code $LASTEXITCODE." }
        $consoleStopped = $true
    }

    if (-not $ReloadFromInstalledApp) {
        $stageId = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
        $stagedAppPath = Join-Path (Join-Path $HostToolsRoot 'Staging') "HostTools-App-$stageId"
        Write-Host "Building and validating a staged $((Get-InstallChannel)) HostTools App from $SourceRoot..."
        $installScript = Join-Path $SourceRoot 'tools\Install-HostManagementBundle.ps1'
        if (-not (Test-Path -LiteralPath $installScript -PathType Leaf)) {
            throw "Missing HostTools installer: $installScript"
        }
        $stageArguments = @(
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            $installScript,
            '-SourceRoot',
            $SourceRoot,
            '-AppRoot',
            $AppRoot,
            '-StateRoot',
            $StateRoot,
            '-Channel',
            (Get-InstallChannel),
            '-Force',
            '-StageOnly',
            '-StagePath',
            $stagedAppPath,
            '-PrepareDependencies',
            '-RunSmoke'
        )
        & powershell.exe @stageArguments
        if ($LASTEXITCODE -ne 0) { throw "HostTools App staging or validation failed with exit code $LASTEXITCODE" }
    } else {
        Write-Host 'Reloading installed HostTools App without reinstalling it from itself.'
    }

    if (-not $consoleStopped) {
        Write-Host 'Stopping active Web Console...'
        if ((Request-TrayStop) -and (Wait-TrayStop)) {
            Write-Host 'Web Console tray stopped gracefully.'
        } else {
            Stop-WebConsoleFallback
        }
    }

    if ($stagedAppPath) {
        Write-Host 'Switching the validated HostTools App and applying scoped State changes...'
        $installArguments = @(
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            $installScript,
            '-SourceRoot',
            $SourceRoot,
            '-AppRoot',
            $AppRoot,
            '-StateRoot',
            $StateRoot,
            '-Channel',
            (Get-InstallChannel),
            '-Force',
            '-StagedAppPath',
            $stagedAppPath
        )
        & powershell.exe @installArguments
        if ($LASTEXITCODE -ne 0) { throw "HostTools App cutover failed with exit code $LASTEXITCODE" }
    }

    $startArguments = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        (Join-Path $AppRoot 'tools\Start-InstalledWebConsole.ps1'),
        '-NoBrowser'
    )
    if (Test-Path -LiteralPath $upgradePointerPath -PathType Leaf) {
        $startArguments += '-DuringUpgrade'
    }
    Write-Host 'Starting Web Console...'
    Start-Process -FilePath 'powershell.exe' -ArgumentList $startArguments

    if (Test-Path -LiteralPath $upgradePointerPath -PathType Leaf) {
        $configPath = Join-Path $StateRoot 'config\osdcloud-console.json'
        $localConfigPath = Join-Path $StateRoot 'config\osdcloud-console.local.json'
        $webHost = '127.0.0.1'
        $webPort = Get-WebPort
        if (Test-Path -LiteralPath $configPath -PathType Leaf) {
            $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
            if ($config.web.host) { $webHost = [string]$config.web.host }
        }
        if (Test-Path -LiteralPath $localConfigPath -PathType Leaf) {
            try {
                $localConfig = Get-Content -LiteralPath $localConfigPath -Raw | ConvertFrom-Json
                if ($localConfig.web.host) { $webHost = [string]$localConfig.web.host }
                if ($localConfig.web.port) { $webPort = [int]$localConfig.web.port }
            } catch {}
        }
        if (-not (Test-Path -LiteralPath $completeScript -PathType Leaf)) {
            throw "HostTools completion script was not found: $completeScript"
        }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $completeScript -WebHost $webHost -WebPort $webPort -HostToolsRoot $HostToolsRoot
        if ($LASTEXITCODE -ne 0) { throw "HostTools HTTP/API readiness validation failed with exit code $LASTEXITCODE." }
    }
    Write-Host 'Reload complete.'
} catch {
    $failure = $_.Exception.Message
    if (Test-Path -LiteralPath $upgradePointerPath -PathType Leaf) {
        try {
            Stop-WebConsoleFallback
            if (-not (Test-Path -LiteralPath $rootRecoveryScript -PathType Leaf)) {
                throw "HostTools recovery script was not found: $rootRecoveryScript"
            }
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $rootRecoveryScript -HostToolsRoot $HostToolsRoot -ConsoleAlreadyStopped
            if ($LASTEXITCODE -ne 0) { throw "HostTools transaction recovery failed with exit code $LASTEXITCODE." }
        } catch {
            Write-Error "HostTools transaction recovery did not finish. Run $rootRecoveryScript after stopping the Web Console. $($_.Exception.Message)"
        }
    }
    if ($stagedAppPath -and (Test-Path -LiteralPath $stagedAppPath -PathType Container) -and
        [System.IO.Path]::GetFullPath($stagedAppPath).StartsWith(([System.IO.Path]::GetFullPath((Join-Path $HostToolsRoot 'Staging')).TrimEnd('\') + '\'), [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $stagedAppPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw "Reload-Console failed: $failure"
}
