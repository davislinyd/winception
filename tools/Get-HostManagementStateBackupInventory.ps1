[CmdletBinding()]
param(
    [string] $BackupRoot = 'C:\OSDCloud\HostTools\Backups',
    [switch] $AsJson
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
    throw "HostTools backup directory not found: $BackupRoot"
}
$requiredFiles = @(
    'config\osdcloud-console.json',
    'state-schema.json',
    'config\os-download-sources.json',
    'config\os-image-catalog.json',
    'config\software-catalog.json',
    'config\scripts-catalog.json'
)

$snapshots = New-Object System.Collections.Generic.List[object]
foreach ($directory in Get-ChildItem -LiteralPath $BackupRoot -Directory -Filter 'HostTools-State-*' | Sort-Object Name) {
    $files = @(Get-ChildItem -LiteralPath $directory.FullName -Recurse -Force | Where-Object { -not $_.PSIsContainer })
    $records = New-Object System.Collections.Generic.List[object]
    $totalBytes = [int64]0
    $readable = $true
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($directory.FullName.Length).TrimStart('\')
        $stream = $null
        try {
            $stream = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            $length = [int64]$stream.Length
        } catch {
            $readable = $false
            $length = [int64]$file.Length
        } finally {
            if ($stream) { $stream.Dispose() }
        }
        $totalBytes += $length
        $records.Add([pscustomobject]@{ path = $relative; length = $length })
    }
    $shapeText = (@($records | Sort-Object path | ForEach-Object { '{0}{1}{2}' -f $_.path, [char]9, $_.length }) -join [Environment]::NewLine)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $shapeHash = ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($shapeText)) | ForEach-Object { $_.ToString('x2') }) -join '' } finally { $sha.Dispose() }

    $manifestPath = "$($directory.FullName).manifest.json"
    $manifestIntegrity = 'legacy-unverifiable'
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        try {
            $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
            $manifestMatches = [int]$manifest.fileCount -eq $files.Count -and
                [int64]$manifest.totalBytes -eq $totalBytes -and
                [string]$manifest.shapeSha256 -eq $shapeHash
            $manifestIntegrity = if ($manifestMatches) { 'inventory-manifest-matches' } else { 'inventory-manifest-mismatch' }
        } catch {
            $manifestIntegrity = 'inventory-manifest-unreadable'
        }
    }
    if (-not $readable) { $manifestIntegrity = 'files-not-all-readable' }

    $relativeSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($record in $records) { [void]$relativeSet.Add([string]$record.path) }
    $missing = @($requiredFiles | Where-Object { -not $relativeSet.Contains($_) })
    $completeness = if ($missing.Count -eq 0) { 'current-required-files-present' } else { 'current-required-files-missing' }
    $snapshots.Add([pscustomobject][ordered]@{
        name = $directory.Name
        path = $directory.FullName
        fileCount = $files.Count
        sizeBytes = $totalBytes
        sizeGiB = [math]::Round($totalBytes / 1GB, 2)
        readable = $readable
        integrity = $manifestIntegrity
        completeness = $completeness
        missingRequiredCount = $missing.Count
        structureFingerprint = $shapeHash
        duplicateCandidate = $false
        duplicateCandidateGroup = $null
    })
}

$groups = @($snapshots | Group-Object structureFingerprint | Where-Object { $_.Count -gt 1 })
$groupNumber = 0
foreach ($group in $groups) {
    $groupNumber++
    foreach ($snapshot in $group.Group) {
        $snapshot.duplicateCandidate = $true
        $snapshot.duplicateCandidateGroup = "shape-$groupNumber"
    }
}

if ($AsJson) {
    @($snapshots | ForEach-Object {
        [pscustomobject]@{
            name = $_.name
            path = $_.path
            fileCount = $_.fileCount
            sizeBytes = $_.sizeBytes
            sizeGiB = $_.sizeGiB
            readable = $_.readable
            integrity = $_.integrity
            completeness = $_.completeness
            missingRequiredCount = $_.missingRequiredCount
            duplicateCandidate = $_.duplicateCandidate
            duplicateCandidateGroup = $_.duplicateCandidateGroup
        }
    } | ConvertTo-Json -Depth 5)
} else {
    $snapshots | Select-Object name, fileCount, sizeGiB, readable, integrity, completeness, missingRequiredCount, duplicateCandidateGroup, path | Format-Table -AutoSize
    Write-Host 'Duplicate groups compare relative paths and file lengths only; matching groups are candidates and need not be content-identical.'
    Write-Host 'Legacy backups without a sidecar inventory manifest are structurally inspected but not cryptographically verified.'
}
