[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory)][string] $Destination,
    [string] $StateRoot = 'C:\OSDCloud\HostTools\State'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\HostManagementUpgrade.ps1')
$stateFull = [System.IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
$hostToolsRoot = Split-Path -Parent $stateFull
$destinationFull = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\')
if ($stateFull -eq [System.IO.Path]::GetPathRoot($stateFull) -or $stateFull.Length -lt 8) {
    throw "Refusing unsafe State root: $stateFull"
}
if (-not (Test-Path -LiteralPath $stateFull -PathType Container)) {
    throw "HostTools State directory not found: $stateFull"
}
Assert-HostToolsUpgradePathHasNoReparsePoints -Path $stateFull
Assert-HostToolsUpgradePathHasNoReparsePoints -Path $destinationFull
if ((Split-Path -Leaf $destinationFull) -notlike 'HostTools-State-*') {
    throw 'Destination must be a new directory named HostTools-State-*.'
}
if ($destinationFull -eq [System.IO.Path]::GetPathRoot($destinationFull) -or
    $destinationFull.StartsWith("$stateFull\", [System.StringComparison]::OrdinalIgnoreCase) -or
    $stateFull.StartsWith("$destinationFull\", [System.StringComparison]::OrdinalIgnoreCase) -or
    $destinationFull.StartsWith("$hostToolsRoot\App\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Destination must be outside HostTools App and State.'
}
Assert-HostToolsUpgradePathHasNoReparsePoints -Path $destinationFull
if (Test-Path -LiteralPath $destinationFull) { throw "Destination already exists: $destinationFull" }
$sidecarPath = "$destinationFull.manifest.json"
if (Test-Path -LiteralPath $sidecarPath) { throw "Backup manifest already exists: $sidecarPath" }

$entries = @(Get-ChildItem -LiteralPath $stateFull -Recurse -Force)
foreach ($entry in $entries) {
    if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Full State snapshot does not follow reparse points; remove or resolve this path first: $($entry.FullName)"
    }
}
$files = @($entries | Where-Object { -not $_.PSIsContainer })
$records = New-Object System.Collections.Generic.List[object]
$totalBytes = [int64]0
foreach ($file in $files) {
    $relative = $file.FullName.Substring($stateFull.Length).TrimStart('\')
    $stream = $null
    try {
        $stream = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $length = [int64]$stream.Length
    } catch {
        throw "Full State snapshot preflight cannot read $relative. Run this command from an account with access to HostTools State. $($_.Exception.Message)"
    } finally {
        if ($stream) { $stream.Dispose() }
    }
    $totalBytes += $length
    $records.Add([pscustomobject][ordered]@{ path = $relative; length = $length })
}

$shapeText = (@($records | Sort-Object path | ForEach-Object { '{0}{1}{2}' -f $_.path, [char]9, $_.length }) -join [Environment]::NewLine)
$shapeBytes = [System.Text.Encoding]::UTF8.GetBytes($shapeText)
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $shapeHash = ($sha.ComputeHash($shapeBytes) | ForEach-Object { $_.ToString('x2') }) -join '' } finally { $sha.Dispose() }
$drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($destinationFull))
$reserveBytes = 256MB
$requiredBytes = $totalBytes + $reserveBytes
if ($drive.AvailableFreeSpace -lt $requiredBytes) {
    throw ("Insufficient free space on {0}: snapshot requires {1:N2} GB plus 0.25 GB reserve; {2:N2} GB is available." -f $drive.Name, ($totalBytes / 1GB), ($drive.AvailableFreeSpace / 1GB))
}
if ($records.Count -eq 0) { Write-Warning 'HostTools State is empty; creating an empty legacy-format snapshot.' }

$summary = "snapshot $stateFull to $destinationFull ($($records.Count) files, $([math]::Round($totalBytes / 1GB, 2)) GB)"
if ($PSCmdlet.ShouldProcess($destinationFull, $summary)) {
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $destinationFull)) | Out-Null
    [System.IO.Directory]::CreateDirectory($destinationFull) | Out-Null
    foreach ($directory in @($entries | Where-Object { $_.PSIsContainer } | Sort-Object { $_.FullName.Length })) {
        $relativeDirectory = $directory.FullName.Substring($stateFull.Length).TrimStart('\')
        [System.IO.Directory]::CreateDirectory((Join-Path $destinationFull $relativeDirectory)) | Out-Null
    }
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($stateFull.Length).TrimStart('\')
        $target = Join-Path $destinationFull $relative
        [System.IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    }

    $copiedFiles = @(Get-ChildItem -LiteralPath $destinationFull -Recurse -Force | Where-Object { -not $_.PSIsContainer })
    $copiedRecords = @($copiedFiles | ForEach-Object {
        [pscustomobject]@{ path = $_.FullName.Substring($destinationFull.Length).TrimStart('\'); length = [int64]$_.Length }
    })
    $copiedShape = (@($copiedRecords | Sort-Object path | ForEach-Object { '{0}{1}{2}' -f $_.path, [char]9, $_.length }) -join [Environment]::NewLine)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $copiedHash = ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($copiedShape)) | ForEach-Object { $_.ToString('x2') }) -join '' } finally { $sha.Dispose() }
    if ($copiedFiles.Count -ne $files.Count -or $copiedHash -ne $shapeHash) {
        throw "Snapshot verification failed. Partial snapshot retained for inspection: $destinationFull"
    }

    $manifest = [pscustomobject][ordered]@{
        schemaVersion = 1
        format = 'HostTools-State-full'
        createdAt = [DateTimeOffset]::UtcNow.ToString('o')
        stateRoot = $stateFull
        fileCount = $files.Count
        totalBytes = $totalBytes
        integrity = 'relative-path-and-length'
        shapeSha256 = $shapeHash
        files = @($records.ToArray())
    }
    [System.IO.File]::WriteAllText($sidecarPath, (($manifest | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
    Write-Host "HostTools State snapshot verified: $destinationFull"
    Write-Host "Files: $($files.Count); size: $([math]::Round($totalBytes / 1GB, 2)) GB; manifest: $sidecarPath"
}
