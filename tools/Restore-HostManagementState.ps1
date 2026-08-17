[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string] $BackupPath,
    [string] $StateRoot = 'C:\OSDCloud\HostTools\State',
    [switch] $Force
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$ErrorActionPreference = 'Stop'
$stateFull = Get-FullPath $StateRoot
$backupFull = Get-FullPath $BackupPath
$hostToolsRoot = Split-Path -Parent $stateFull
$backupParent = Split-Path -Parent $backupFull

if (-not (Test-Path -LiteralPath $backupFull -PathType Container)) {
    throw "State backup directory not found: $backupFull"
}
if (-not ($backupFull.StartsWith("$hostToolsRoot\", [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Refusing to restore a backup outside HostTools Backups: $backupFull"
}
if ($stateFull -eq [System.IO.Path]::GetPathRoot($stateFull) -or $stateFull.Length -lt 8) {
    throw "Refusing unsafe State root: $stateFull"
}
if ((Test-Path -LiteralPath $stateFull) -and -not $Force) {
    throw "State root already exists. Pass -Force after stopping the Web console: $stateFull"
}

if ($PSCmdlet.ShouldProcess($stateFull, "restore State from $backupFull")) {
    if (Test-Path -LiteralPath $stateFull) {
        $failedPath = "$stateFull.failed-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff'))"
        Move-Item -LiteralPath $stateFull -Destination $failedPath -Force
        Write-Host "Preserved current State at $failedPath"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $stateFull) -Force | Out-Null
    Copy-Item -LiteralPath $backupFull -Destination $stateFull -Recurse -Force
    Write-Host "Restored State from $backupFull"
}
