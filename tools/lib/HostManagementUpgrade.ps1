# Transactional App and small-scope State rollback for HostTools upgrades.

$script:HostToolsUpgradeStateFiles = @(
    'config\osdcloud-console.json',
    'state-schema.json',
    'config\os-download-sources.json',
    'config\os-image-catalog.json',
    'config\software-catalog.json',
    'config\scripts-catalog.json'
)
$script:HostToolsUpgradeStateDirectories = @(
    'config',
    'config\deployment-profiles',
    'Softwares',
    'Scripts'
)

function Get-HostToolsUpgradeHash {
    param([Parameter(Mandatory)][string] $LiteralPath)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = $null
    try {
        $stream = [System.IO.File]::Open($LiteralPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '')
    } finally {
        if ($stream) { $stream.Dispose() }
        $sha.Dispose()
    }
}

function Assert-HostToolsUpgradePathHasNoReparsePoints {
    param([Parameter(Mandatory)][string] $Path)
    $full = [System.IO.Path]::GetFullPath($Path)
    $current = [System.IO.Path]::GetPathRoot($full)
    $relative = $full.Substring($current.Length).TrimStart('\')
    foreach ($segment in @($relative -split '\\' | Where-Object { $_ })) {
        $current = Join-Path $current $segment
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "HostTools transaction path contains a reparse point: $current"
            }
        }
    }
}

function Write-HostToolsUpgradeJson {
    param([Parameter(Mandatory)][string] $Path, [Parameter(Mandatory)] $Value)
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
    $temporaryPath = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
    $json = ($Value | ConvertTo-Json -Depth 32) + [Environment]::NewLine
    try {
        [System.IO.File]::WriteAllText($temporaryPath, $json, [System.Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    finally {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
}

function Get-HostToolsSourceMetadata {
    param(
        [Parameter(Mandatory)][string] $SourceRoot,
        [Parameter(Mandatory)][string] $Channel,
        [Parameter(Mandatory)][string] $Version
    )
    $commit = $null
    $branch = $null
    $sourceClean = $null
    $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
    if (-not $gitCommand) { $gitCommand = Get-Command git -ErrorAction SilentlyContinue }
    if ($gitCommand) {
        try {
            $commitValue = & $gitCommand.Source -C $SourceRoot rev-parse HEAD 2>$null
            if ($LASTEXITCODE -eq 0) {
                $commit = ([string]($commitValue | Select-Object -First 1)).Trim()
                try {
                    $branchValue = & $gitCommand.Source -C $SourceRoot branch --show-current 2>$null
                    if ($LASTEXITCODE -eq 0) { $branch = ([string]($branchValue | Select-Object -First 1)).Trim() }
                    $statusValue = & $gitCommand.Source -C $SourceRoot status --porcelain --untracked-files=all 2>$null
                    if ($LASTEXITCODE -eq 0) { $sourceClean = @($statusValue).Count -eq 0 }
                } catch {}
            }
        } catch {}
    }

    $bundlePath = Join-Path $SourceRoot 'bundle-manifest.json'
    $bundleHash = $null
    $bundleCommit = $null
    $bundleBranch = $null
    $bundleTreeClean = $null
    $bundleVersion = $null
    $bundleChannel = $null
    if (Test-Path -LiteralPath $bundlePath -PathType Leaf) {
        $bundleHash = Get-HostToolsUpgradeHash -LiteralPath $bundlePath
        try {
            $bundle = Get-Content -LiteralPath $bundlePath -Raw | ConvertFrom-Json
            $bundleCommit = [string]$bundle.repoCommit
            $bundleBranch = [string]$bundle.repoBranch
            if ($null -ne $bundle.sourceTreeClean) { $bundleTreeClean = [bool]$bundle.sourceTreeClean }
            $bundleVersion = [string]$bundle.version
            $bundleChannel = [string]$bundle.channel
        } catch {
            throw "Unable to read HostTools bundle manifest: $bundlePath"
        }
    }
    if (-not $commit) { $commit = $bundleCommit }
    if (-not $branch) { $branch = $bundleBranch }
    if ($null -eq $sourceClean) { $sourceClean = $bundleTreeClean }

    [pscustomobject][ordered]@{
        sourceCommit = $commit
        sourceBranch = $branch
        sourceTreeClean = $sourceClean
        version = $Version
        channel = $Channel
        bundleCommit = $bundleCommit
        bundleVersion = $bundleVersion
        bundleChannel = $bundleChannel
        bundleManifestSha256 = $bundleHash
    }
}

function Assert-HostToolsUpgradeStateMutationAllowed {
    param(
        [Parameter(Mandatory)][string] $StateRoot,
        [Parameter(Mandatory)][string] $Path,
        [switch] $Directory
    )
    $root = [System.IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
    $candidate = [System.IO.Path]::GetFullPath($Path)
    if (-not $candidate.StartsWith("$root\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "State mutation escaped StateRoot: $candidate"
    }
    Assert-HostToolsUpgradePathHasNoReparsePoints -Path $root
    Assert-HostToolsUpgradePathHasNoReparsePoints -Path $candidate
    $relative = $candidate.Substring($root.Length).TrimStart('\')
    $allowed = if ($Directory) { $script:HostToolsUpgradeStateDirectories } else { $script:HostToolsUpgradeStateFiles }
    if ($allowed -notcontains $relative) { throw "State mutation is not declared in the upgrade transaction: $relative" }
    $current = $root
    foreach ($segment in @($relative -split '\\')) {
        $current = Join-Path $current $segment
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "State mutation path contains a reparse point: $relative"
            }
        }
    }
}

function Get-HostToolsUpgradePointerPath {
    param([Parameter(Mandatory)][string] $HostToolsRoot)
    Join-Path $HostToolsRoot 'upgrade-current.json'
}

function Get-ActiveHostToolsUpgradeTransaction {
    param([Parameter(Mandatory)][string] $HostToolsRoot)
    Assert-HostToolsUpgradePathHasNoReparsePoints -Path $HostToolsRoot
    $pointerPath = Get-HostToolsUpgradePointerPath -HostToolsRoot $HostToolsRoot
    if (-not (Test-Path -LiteralPath $pointerPath -PathType Leaf)) { return $null }
    $pointer = Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json
    $id = [string]$pointer.transactionId
    if ($id -notmatch '^\d{8}-\d{6}-\d{3}$') { throw "Invalid HostTools upgrade pointer: $pointerPath" }
    Join-Path (Join-Path $HostToolsRoot 'Backups') "HostTools-Upgrade-$id"
}

function Read-HostToolsUpgradeTransaction {
    param([Parameter(Mandatory)][string] $TransactionPath)
    $full = [System.IO.Path]::GetFullPath($TransactionPath)
    Assert-HostToolsUpgradePathHasNoReparsePoints -Path $full
    $manifestPath = if (Test-Path -LiteralPath $full -PathType Leaf) { $full } else { Join-Path $full 'transaction.json' }
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Upgrade transaction manifest not found: $manifestPath" }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([int]$manifest.schemaVersion -ne 1 -or [string]$manifest.transactionId -notmatch '^\d{8}-\d{6}-\d{3}$') {
        throw "Unsupported or invalid HostTools upgrade transaction: $manifestPath"
    }
    if ((Split-Path -Leaf (Split-Path -Parent $manifestPath)) -ine "HostTools-Upgrade-$($manifest.transactionId)") {
        throw "HostTools upgrade transaction folder does not match its ID: $manifestPath"
    }
    [pscustomobject]@{ manifestPath = $manifestPath; root = Split-Path -Parent $manifestPath; manifest = $manifest }
}

function New-HostToolsUpgradeTransaction {
    param(
        [Parameter(Mandatory)][string] $HostToolsRoot,
        [Parameter(Mandatory)][string] $AppRoot,
        [Parameter(Mandatory)][string] $StateRoot,
        [Parameter(Mandatory)][string] $StageRoot,
        [Parameter(Mandatory)] $SourceMetadata,
        [Parameter(Mandatory)][string] $TransactionId
    )
    if ($TransactionId -notmatch '^\d{8}-\d{6}-\d{3}$') { throw "Invalid transaction ID: $TransactionId" }
    if (Get-ActiveHostToolsUpgradeTransaction -HostToolsRoot $HostToolsRoot) {
        throw 'A HostTools upgrade is already pending. Run Restore-HostManagementUpgrade.ps1 before starting another upgrade.'
    }
    $hostToolsFull = [System.IO.Path]::GetFullPath($HostToolsRoot).TrimEnd('\')
    foreach ($path in @($hostToolsFull, $AppRoot, $StateRoot, $StageRoot)) {
        Assert-HostToolsUpgradePathHasNoReparsePoints -Path $path
    }
    if ([System.IO.Path]::GetFullPath($AppRoot) -ine [System.IO.Path]::GetFullPath((Join-Path $hostToolsFull 'App')) -or
        [System.IO.Path]::GetFullPath($StateRoot) -ine [System.IO.Path]::GetFullPath((Join-Path $hostToolsFull 'State'))) {
        throw 'HostTools upgrade AppRoot and StateRoot must be the App and State folders under HostToolsRoot.'
    }
    $stageFull = [System.IO.Path]::GetFullPath($StageRoot)
    $stageBase = [System.IO.Path]::GetFullPath((Join-Path $hostToolsFull 'Staging')).TrimEnd('\') + '\'
    if (-not $stageFull.StartsWith($stageBase, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Staged App must remain under HostTools Staging: $stageFull"
    }

    $backupRoot = Join-Path $HostToolsRoot 'Backups'
    [System.IO.Directory]::CreateDirectory($backupRoot) | Out-Null
    $transactionRoot = Join-Path $backupRoot "HostTools-Upgrade-$TransactionId"
    if (Test-Path -LiteralPath $transactionRoot) { throw "Upgrade transaction already exists: $transactionRoot" }
    [System.IO.Directory]::CreateDirectory($transactionRoot) | Out-Null
    $pointerPath = Get-HostToolsUpgradePointerPath -HostToolsRoot $HostToolsRoot
    $pointerCreated = $false
    try {
        $stateBeforeRoot = Join-Path $transactionRoot 'state-before'
        [System.IO.Directory]::CreateDirectory($stateBeforeRoot) | Out-Null
        $stateExisted = Test-Path -LiteralPath $StateRoot -PathType Container
        $fileRecords = @()
        foreach ($relative in $script:HostToolsUpgradeStateFiles) {
            $source = Join-Path $StateRoot $relative
            $exists = Test-Path -LiteralPath $source -PathType Leaf
            $record = [ordered]@{
                path = $relative
                existed = $exists
                backupRelativePath = $null
                beforeSha256 = $null
                afterExists = $null
                afterSha256 = $null
            }
            if ($exists) {
                $item = Get-Item -LiteralPath $source -Force
                if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw "Refusing to snapshot a State mutation path that is a reparse point: $relative"
                }
                $beforeHash = Get-HostToolsUpgradeHash -LiteralPath $source
                $backup = Join-Path $stateBeforeRoot $relative
                [System.IO.Directory]::CreateDirectory((Split-Path -Parent $backup)) | Out-Null
                Copy-Item -LiteralPath $source -Destination $backup -Force
                if ((Get-HostToolsUpgradeHash -LiteralPath $backup) -ne $beforeHash) {
                    throw "State file changed while its transaction snapshot was being created: $relative"
                }
                $record.backupRelativePath = "state-before\$relative"
                $record.beforeSha256 = $beforeHash
            }
            $fileRecords += [pscustomobject]$record
        }

        $directoryRecords = @()
        foreach ($relative in $script:HostToolsUpgradeStateDirectories) {
            $path = Join-Path $StateRoot $relative
            $exists = Test-Path -LiteralPath $path -PathType Container
            if ($exists) {
                $item = Get-Item -LiteralPath $path -Force
                if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw "Refusing a State mutation directory that is a reparse point: $relative"
                }
            }
            $directoryRecords += [pscustomobject][ordered]@{ path = $relative; existed = $exists }
        }
        $diagnosticsPath = Join-Path $StateRoot 'diagnostics'
        $diagnosticsExisted = Test-Path -LiteralPath $diagnosticsPath -PathType Container
        if ($diagnosticsExisted) {
            $item = Get-Item -LiteralPath $diagnosticsPath -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Refusing to move State diagnostics because it is a reparse point.'
            }
        }

        $appExisted = Test-Path -LiteralPath $AppRoot -PathType Container
        $previousAppMetadata = $null
        if ($appExisted) {
            $oldManifest = Join-Path $AppRoot 'installation-manifest.json'
            if (Test-Path -LiteralPath $oldManifest -PathType Leaf) {
                try { $previousAppMetadata = Get-Content -LiteralPath $oldManifest -Raw | ConvertFrom-Json } catch {}
            }
        }
        $manifest = [pscustomobject][ordered]@{
            schemaVersion = 1
            transactionId = $TransactionId
            status = 'prepared'
            createdAt = [DateTimeOffset]::UtcNow.ToString('o')
            installedAt = $null
            stateMutationCompletedAt = $null
            rolledBackAt = $null
            completedAt = $null
            appRoot = [System.IO.Path]::GetFullPath($AppRoot)
            stateRoot = [System.IO.Path]::GetFullPath($StateRoot)
            stageRoot = $stageFull
            stateRootExisted = $stateExisted
            previousAppExisted = $appExisted
            previousAppMetadata = $previousAppMetadata
            diagnosticsExisted = $diagnosticsExisted
            diagnosticsMoved = $false
            appMoved = $false
            newAppMoved = $false
            stateMutationComplete = $false
            stateRestoreStarted = $false
            stateRestored = $false
            source = $SourceMetadata
            stateFiles = @($fileRecords)
            stateDirectories = @($directoryRecords)
        }
        $manifestPath = Join-Path $transactionRoot 'transaction.json'
        Write-HostToolsUpgradeJson -Path $manifestPath -Value $manifest
        Write-HostToolsUpgradeJson -Path $pointerPath -Value ([pscustomobject]@{ transactionId = $TransactionId })
        $pointerCreated = $true
        $manifestPath
    }
    catch {
        if (-not $pointerCreated) { Remove-Item -LiteralPath $transactionRoot -Recurse -Force -ErrorAction SilentlyContinue }
        throw
    }
}

function Start-HostToolsUpgradeCutover {
    param(
        [Parameter(Mandatory)][string] $TransactionPath,
        [Parameter(Mandatory)][string] $StageRoot,
        [Parameter(Mandatory)][string] $AppRoot,
        [Parameter(Mandatory)][string] $StateRoot
    )
    $transaction = Read-HostToolsUpgradeTransaction -TransactionPath $TransactionPath
    $manifest = $transaction.manifest
    if ($manifest.status -ne 'prepared') { throw "Cannot cut over transaction in status '$($manifest.status)'." }
    if ([System.IO.Path]::GetFullPath($manifest.appRoot) -ine [System.IO.Path]::GetFullPath($AppRoot) -or
        [System.IO.Path]::GetFullPath($manifest.stateRoot) -ine [System.IO.Path]::GetFullPath($StateRoot) -or
        [System.IO.Path]::GetFullPath($manifest.stageRoot) -ine [System.IO.Path]::GetFullPath($StageRoot)) {
        throw 'Upgrade transaction roots do not match the requested cutover paths.'
    }
    if (-not (Test-Path -LiteralPath $StageRoot -PathType Container)) { throw "Staged App is missing: $StageRoot" }
    $manifest.status = 'cutting-over'
    Write-HostToolsUpgradeJson -Path $transaction.manifestPath -Value $manifest

    $diagnosticsPath = Join-Path $StateRoot 'diagnostics'
    if ($manifest.diagnosticsExisted -and (Test-Path -LiteralPath $diagnosticsPath -PathType Container)) {
        $diagnosticsBackup = Join-Path $transaction.root 'state-before\diagnostics'
        [System.IO.Directory]::CreateDirectory((Split-Path -Parent $diagnosticsBackup)) | Out-Null
        Move-Item -LiteralPath $diagnosticsPath -Destination $diagnosticsBackup
        $manifest.diagnosticsMoved = $true
        Write-HostToolsUpgradeJson -Path $transaction.manifestPath -Value $manifest
    }
    if ($manifest.previousAppExisted -and (Test-Path -LiteralPath $AppRoot -PathType Container)) {
        Move-Item -LiteralPath $AppRoot -Destination (Join-Path $transaction.root 'previous-app')
        $manifest.appMoved = $true
        Write-HostToolsUpgradeJson -Path $transaction.manifestPath -Value $manifest
    }
    Move-Item -LiteralPath $StageRoot -Destination $AppRoot
    $manifest.newAppMoved = $true
    $manifest.status = 'installed'
    $manifest.installedAt = [DateTimeOffset]::UtcNow.ToString('o')
    Write-HostToolsUpgradeJson -Path $transaction.manifestPath -Value $manifest
}

function Complete-HostToolsUpgradeStateMutation {
    param([Parameter(Mandatory)][string] $TransactionPath,[Parameter(Mandatory)][string] $StateRoot)
    $transaction = Read-HostToolsUpgradeTransaction -TransactionPath $TransactionPath
    if ($transaction.manifest.status -notin @('installed','pending-validation')) {
        throw "Cannot seal State changes for transaction in status '$($transaction.manifest.status)'."
    }
    foreach ($record in @($transaction.manifest.stateFiles)) {
        $target = Join-Path $StateRoot ([string]$record.path)
        $record.afterExists = Test-Path -LiteralPath $target -PathType Leaf
        $record.afterSha256 = if ($record.afterExists) { Get-HostToolsUpgradeHash -LiteralPath $target } else { $null }
    }
    $transaction.manifest.stateMutationComplete = $true
    $transaction.manifest.stateMutationCompletedAt = [DateTimeOffset]::UtcNow.ToString('o')
    Write-HostToolsUpgradeJson -Path $transaction.manifestPath -Value $transaction.manifest
}

function Wait-HostToolsUpgradeReady {
    param(
        [Parameter(Mandatory)][string] $WebHost,
        [Parameter(Mandatory)][ValidateRange(1,65535)][int] $WebPort,
        [ValidateRange(1,300)][int] $TimeoutSeconds = 45
    )
    $baseUri = 'http://' + $WebHost + ':' + $WebPort
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastFailure = 'Web Console did not respond.'
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        try {
            $homeResponse = Invoke-WebRequest -Uri $baseUri -Method Get -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
            if ([int]$homeResponse.StatusCode -ne 200) { throw "Home page returned HTTP $($homeResponse.StatusCode)." }
            $state = Invoke-RestMethod -Uri "$baseUri/api/state" -Method Get -TimeoutSec 3 -ErrorAction Stop
            if ($state.ok -eq $true) { return }
            $lastFailure = '/api/state did not return {ok:true}.'
        } catch {
            $lastFailure = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 500
    }
    throw "HostTools readiness check failed at $baseUri after $TimeoutSeconds seconds: $lastFailure"
}

function Restore-HostToolsUpgradeTransaction {
    param(
        [Parameter(Mandatory)][string] $TransactionPath,
        [Parameter(Mandatory)][string] $HostToolsRoot,
        [Parameter(Mandatory)][string] $AppRoot,
        [Parameter(Mandatory)][string] $StateRoot
    )
    $transaction = Read-HostToolsUpgradeTransaction -TransactionPath $TransactionPath
    $root = [System.IO.Path]::GetFullPath($transaction.root)
    foreach ($path in @($HostToolsRoot, $root, $AppRoot, $StateRoot)) {
        Assert-HostToolsUpgradePathHasNoReparsePoints -Path $path
    }
    $backupBase = [System.IO.Path]::GetFullPath((Join-Path $HostToolsRoot 'Backups')).TrimEnd('\') + '\'
    if (-not $root.StartsWith($backupBase, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to restore a transaction outside HostTools Backups: $root"
    }
    $manifest = $transaction.manifest
    if ($manifest.status -in @('committed','rolled-back')) { return }
    if ([System.IO.Path]::GetFullPath($manifest.appRoot) -ine [System.IO.Path]::GetFullPath($AppRoot) -or
        [System.IO.Path]::GetFullPath($manifest.stateRoot) -ine [System.IO.Path]::GetFullPath($StateRoot)) {
        throw 'Upgrade transaction AppRoot or StateRoot does not match the requested restore roots.'
    }
    if ([System.IO.Path]::GetFullPath($AppRoot) -ine [System.IO.Path]::GetFullPath((Join-Path $HostToolsRoot 'App')) -or
        [System.IO.Path]::GetFullPath($StateRoot) -ine [System.IO.Path]::GetFullPath((Join-Path $HostToolsRoot 'State'))) {
        throw 'Upgrade restore AppRoot and StateRoot must be the App and State folders under HostToolsRoot.'
    }

    $records = @()
    foreach ($record in @($manifest.stateFiles)) {
        $relative = [string]$record.path
        if ($script:HostToolsUpgradeStateFiles -notcontains $relative) { throw "Transaction contains an undeclared State restore path: $relative" }
        if ($record.existed) {
            $expected = "state-before\$relative"
            if ([string]$record.backupRelativePath -ine $expected) { throw "Transaction contains an invalid State backup path for $relative." }
            $backup = Join-Path $root $expected
            if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) { throw "State transaction backup is missing: $backup" }
            if ((Get-HostToolsUpgradeHash -LiteralPath $backup) -ne [string]$record.beforeSha256) {
                throw "State transaction backup failed its SHA-256 check: $relative"
            }
        }
        $records += $record
    }

    if ($manifest.stateMutationComplete -and -not $manifest.stateRestoreStarted) {
        foreach ($record in $records) {
            $target = Join-Path $StateRoot ([string]$record.path)
            $exists = Test-Path -LiteralPath $target -PathType Leaf
            if ([bool]$record.afterExists -ne $exists) { throw "State changed after the upgrade transaction was sealed; refusing to overwrite: $($record.path)" }
            if ($exists -and (Get-HostToolsUpgradeHash -LiteralPath $target) -ne [string]$record.afterSha256) {
                throw "State changed after the upgrade transaction was sealed; refusing to overwrite: $($record.path)"
            }
        }
        $manifest.stateRestoreStarted = $true
        Write-HostToolsUpgradeJson -Path $transaction.manifestPath -Value $manifest
    }

    if (-not $manifest.stateRestored) {
        foreach ($record in $records) {
            $target = Join-Path $StateRoot ([string]$record.path)
            Assert-HostToolsUpgradeStateMutationAllowed -StateRoot $StateRoot -Path $target
            if ($record.existed) {
                [System.IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
                $temporary = "$target.rollback-$($manifest.transactionId)"
                Copy-Item -LiteralPath (Join-Path $root ([string]$record.backupRelativePath)) -Destination $temporary -Force
                Move-Item -LiteralPath $temporary -Destination $target -Force
            } elseif (Test-Path -LiteralPath $target -PathType Leaf) {
                Remove-Item -LiteralPath $target -Force
            }
        }

        $diagnosticsPath = Join-Path $StateRoot 'diagnostics'
        $diagnosticsBackup = Join-Path $root 'state-before\diagnostics'
        if ($manifest.diagnosticsExisted -and (Test-Path -LiteralPath $diagnosticsBackup -PathType Container)) {
            if (Test-Path -LiteralPath $diagnosticsPath -PathType Container) {
                $failedRoot = Join-Path $root 'state-after-failure'
                [System.IO.Directory]::CreateDirectory($failedRoot) | Out-Null
                $failedDiagnostics = Join-Path $failedRoot ("diagnostics-" + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff'))
                while (Test-Path -LiteralPath $failedDiagnostics) { $failedDiagnostics += '-1' }
                Move-Item -LiteralPath $diagnosticsPath -Destination $failedDiagnostics
            }
            [System.IO.Directory]::CreateDirectory((Split-Path -Parent $diagnosticsPath)) | Out-Null
            Move-Item -LiteralPath $diagnosticsBackup -Destination $diagnosticsPath
        }
        foreach ($record in @($manifest.stateDirectories | Sort-Object { $_.path.Length } -Descending)) {
            if ($script:HostToolsUpgradeStateDirectories -notcontains [string]$record.path) {
                throw "Transaction contains an undeclared State directory: $($record.path)"
            }
            if (-not $record.existed) {
                $path = Join-Path $StateRoot ([string]$record.path)
                if (Test-Path -LiteralPath $path -PathType Container) {
                    $children = @(Get-ChildItem -LiteralPath $path -Force -ErrorAction SilentlyContinue)
                    if ($children.Count -eq 0) { Remove-Item -LiteralPath $path -Force }
                }
            }
        }
        if (-not $manifest.stateRootExisted -and (Test-Path -LiteralPath $StateRoot -PathType Container)) {
            $children = @(Get-ChildItem -LiteralPath $StateRoot -Force -ErrorAction SilentlyContinue)
            if ($children.Count -eq 0) { Remove-Item -LiteralPath $StateRoot -Force }
        }
        $manifest.stateRestored = $true
        Write-HostToolsUpgradeJson -Path $transaction.manifestPath -Value $manifest
    }

    $previousApp = Join-Path $root 'previous-app'
    if ($manifest.previousAppExisted) {
        if (Test-Path -LiteralPath $previousApp -PathType Container) {
            if (Test-Path -LiteralPath $AppRoot -PathType Container) { Remove-Item -LiteralPath $AppRoot -Recurse -Force }
            Move-Item -LiteralPath $previousApp -Destination $AppRoot
        } elseif (-not (Test-Path -LiteralPath $AppRoot -PathType Container)) {
            throw 'Previous App snapshot is unavailable; refusing to mark the transaction restored.'
        }
    } elseif (Test-Path -LiteralPath $AppRoot -PathType Container) {
        Remove-Item -LiteralPath $AppRoot -Recurse -Force
    }

    $stageRoot = [string]$manifest.stageRoot
    if (-not [string]::IsNullOrWhiteSpace($stageRoot)) {
        $stageBase = [System.IO.Path]::GetFullPath((Join-Path $HostToolsRoot 'Staging')).TrimEnd('\') + '\'
        $stageFull = [System.IO.Path]::GetFullPath($stageRoot)
        if ($stageFull.StartsWith($stageBase, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $stageFull -PathType Container)) {
            Remove-Item -LiteralPath $stageFull -Recurse -Force
        }
    }
    $manifest.status = 'rolled-back'
    $manifest.rolledBackAt = [DateTimeOffset]::UtcNow.ToString('o')
    Write-HostToolsUpgradeJson -Path $transaction.manifestPath -Value $manifest
    $pointerPath = Get-HostToolsUpgradePointerPath -HostToolsRoot $HostToolsRoot
    if (Test-Path -LiteralPath $pointerPath -PathType Leaf) {
        try {
            $pointer = Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json
            if ([string]$pointer.transactionId -eq [string]$manifest.transactionId) { Remove-Item -LiteralPath $pointerPath -Force }
        } catch {}
    }
}

function Complete-HostToolsUpgradeTransaction {
    param([Parameter(Mandatory)][string] $TransactionPath,[Parameter(Mandatory)][string] $HostToolsRoot)
    $transaction = Read-HostToolsUpgradeTransaction -TransactionPath $TransactionPath
    if ($transaction.manifest.status -notin @('installed','pending-validation') -or -not $transaction.manifest.stateMutationComplete) {
        throw "Cannot complete HostTools upgrade in status '$($transaction.manifest.status)' before State changes are sealed."
    }
    $manifest = $transaction.manifest
    $manifest.status = 'committed'
    $manifest.completedAt = [DateTimeOffset]::UtcNow.ToString('o')
    Write-HostToolsUpgradeJson -Path $transaction.manifestPath -Value $manifest
    $pointerPath = Get-HostToolsUpgradePointerPath -HostToolsRoot $HostToolsRoot
    if (Test-Path -LiteralPath $pointerPath -PathType Leaf) {
        try {
            $pointer = Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json
            if ([string]$pointer.transactionId -eq [string]$manifest.transactionId) { Remove-Item -LiteralPath $pointerPath -Force }
        } catch {}
    }
    $backupRoot = Join-Path $HostToolsRoot 'Backups'
    foreach ($directory in Get-ChildItem -LiteralPath $backupRoot -Directory -Filter 'HostTools-Upgrade-*' -ErrorAction SilentlyContinue) {
        if ($directory.FullName -ieq $transaction.root) { continue }
        $oldManifestPath = Join-Path $directory.FullName 'transaction.json'
        if (-not (Test-Path -LiteralPath $oldManifestPath -PathType Leaf)) { continue }
        try {
            $oldManifest = Get-Content -LiteralPath $oldManifestPath -Raw | ConvertFrom-Json
            if ($oldManifest.status -eq 'committed') {
                $oldRoot = [System.IO.Path]::GetFullPath($directory.FullName)
                $safeBase = [System.IO.Path]::GetFullPath($backupRoot).TrimEnd('\') + '\'
                if ($oldRoot.StartsWith($safeBase, [System.StringComparison]::OrdinalIgnoreCase)) {
                    Assert-HostToolsUpgradePathHasNoReparsePoints -Path $oldRoot
                    Remove-Item -LiteralPath $oldRoot -Recurse -Force
                }
            }
        } catch {}
    }
}

function Restore-HostToolsUpgradeFromPointer {
    param([Parameter(Mandatory)][string] $HostToolsRoot)
    $transactionPath = Get-ActiveHostToolsUpgradeTransaction -HostToolsRoot $HostToolsRoot
    if (-not $transactionPath) { return $false }
    if (-not (Test-Path -LiteralPath (Join-Path $transactionPath 'transaction.json') -PathType Leaf)) {
        throw "Active HostTools upgrade transaction is missing: $transactionPath"
    }
    $transaction = Read-HostToolsUpgradeTransaction -TransactionPath $transactionPath
    if ($transaction.manifest.status -in @('committed','rolled-back')) {
        Remove-Item -LiteralPath (Get-HostToolsUpgradePointerPath -HostToolsRoot $HostToolsRoot) -Force -ErrorAction SilentlyContinue
        return $false
    }
    Restore-HostToolsUpgradeTransaction -TransactionPath $transactionPath -HostToolsRoot $HostToolsRoot -AppRoot ([string]$transaction.manifest.appRoot) -StateRoot ([string]$transaction.manifest.stateRoot)
    $true
}
