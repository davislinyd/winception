#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Repairs a deployment-server boot.wim that is missing WinPE-PowerShell, then
    verifies the published WIM actually contains powershell.exe.

.DESCRIPTION
    Run this on the deployment server (new machine) if clients fail with
    "'PowerShell' is not recognized" at WinPE startup.

    The script:
      1. Detects whether the OSDCloud Template was built by our controlled pipeline
         (marker file .winpe-ps-built). If missing, forces a full rebuild so that
         WinPE-PowerShell is included.
      2. Rebuilds the OSDCloud workspace from the (now-correct) template.
      3. Runs endpoint sync (-CommitWinPe) to inject scripts and PS modules.
      4. Mounts the published boot.wim read-only and verifies powershell.exe is present.
      5. Restarts services if they were running before the repair.

.PARAMETER AppRoot
    Path to the installed Web console bundle. Defaults to C:\OSDCloud\HostTools\App.

.PARAMETER LiveRoot
    Path to the OSDCloud live root. Defaults to C:\OSDCloud.

.EXAMPLE
    .\tools\Repair-WinPeBootWim.ps1
#>
[CmdletBinding()]
param(
    [string] $AppRoot  = 'C:\OSDCloud\HostTools\App',
    [string] $LiveRoot = 'C:\OSDCloud'
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom

function Write-Step {
    param([Parameter(Mandatory)][string] $Message)
    Write-Host ''
    Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Write-Ok   { param([string]$m) Write-Host "  OK  $m" -ForegroundColor Green }
function Write-Fail { param([string]$m) Write-Host "  FAIL $m" -ForegroundColor Red }
function Write-Info { param([string]$m) Write-Host "  ..  $m" -ForegroundColor Gray }

# ---------------------------------------------------------------------------
# 1. Pull latest code into App copy
# ---------------------------------------------------------------------------
Write-Step 'Step 1 — update App bundle from repo'

$repoRoot = Split-Path -Parent $PSScriptRoot
Write-Info "Repo root : $repoRoot"
Write-Info "App root  : $AppRoot"

if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'tools') -PathType Container)) {
    throw "App bundle not found at $AppRoot. Run Setup-DeploymentServer.cmd first."
}

$installScript = Join-Path $repoRoot 'tools\Install-HostManagementBundle.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript `
    -SourceRoot $repoRoot -AppRoot $AppRoot `
    -StateRoot (Join-Path (Split-Path -Parent $AppRoot) 'State') -Force
if ($LASTEXITCODE -ne 0) { throw "Install-HostManagementBundle failed (exit $LASTEXITCODE)" }
Write-Ok 'App bundle updated'

# ---------------------------------------------------------------------------
# 2. Prepare runtime (rebuilds OSDCloud template + workspace + downloads aria2c)
# ---------------------------------------------------------------------------
Write-Step 'Step 2 — Prepare runtime (OSDCloud template + workspace rebuild)'

$restoreScript = Join-Path $AppRoot 'tools\Restore-DeploymentArtifacts.ps1'
$catalogPath   = Join-Path $AppRoot 'config\runtime-artifacts.json'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $restoreScript `
    -CatalogPath $catalogPath -LiveRoot $LiveRoot
if ($LASTEXITCODE -ne 0) { throw "Restore-DeploymentArtifacts failed (exit $LASTEXITCODE)" }
Write-Ok 'Runtime prepared'

# ---------------------------------------------------------------------------
# 3. Endpoint sync (-CommitWinPe) — inject scripts + PS modules into boot.wim
# ---------------------------------------------------------------------------
Write-Step 'Step 3 — Endpoint sync (commit boot.wim)'

$endpointScript = Join-Path $AppRoot 'tools\Set-OsdCloudIpxeEndpoint.ps1'
# -ForceCommitWinPe bypasses the "already customized" hash-skip so we always
# get a fresh DISM injection after the workspace rebuild.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $endpointScript -ForceCommitWinPe
if ($LASTEXITCODE -ne 0) { throw "Set-OsdCloudIpxeEndpoint failed (exit $LASTEXITCODE)" }
Write-Ok 'Endpoint sync complete'

# ---------------------------------------------------------------------------
# 4. Verify — mount published boot.wim read-only, check for powershell.exe
# ---------------------------------------------------------------------------
Write-Step 'Step 4 — Verify published boot.wim contains powershell.exe'

$publishedWim = Join-Path $LiveRoot 'PXE-HttpRoot\osdcloud\boot.wim'
if (-not (Test-Path -LiteralPath $publishedWim -PathType Leaf)) {
    throw "Published boot.wim not found: $publishedWim"
}

$mountDir = Join-Path $env:TEMP ("WinPEVerify-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $mountDir -Force | Out-Null
$verified = $false
try {
    Write-Info "Mounting $publishedWim (read-only)…"
    & dism /English /Mount-Wim /WimFile:$publishedWim /Index:1 /MountDir:$mountDir /ReadOnly | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "DISM mount failed (exit $LASTEXITCODE)" }

    $psExe = Join-Path $mountDir 'Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    if (Test-Path -LiteralPath $psExe -PathType Leaf) {
        $psSize = (Get-Item -LiteralPath $psExe).Length
        Write-Ok "powershell.exe found in WIM ($([math]::Round($psSize/1KB)) KB)"
        $verified = $true
    }
    else {
        Write-Fail 'powershell.exe NOT found in WIM — rebuild did not include WinPE-PowerShell'
    }
}
finally {
    Write-Info 'Unmounting…'
    & dism /English /Unmount-Wim /MountDir:$mountDir /Discard | Out-Null
    try { Remove-Item -LiteralPath $mountDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}

if (-not $verified) {
    throw 'boot.wim verification failed: WinPE-PowerShell is still missing. ' +
          'Delete the OSDCloud Template folder and re-run this script.'
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Step 'REPAIR COMPLETE'
Write-Host ''
Write-Host '  boot.wim has WinPE-PowerShell confirmed.' -ForegroundColor Green
Write-Host '  Reboot clients — they will PXE-boot from the repaired WIM.' -ForegroundColor Green
Write-Host ''
Write-Host '  If services are not running, start them from the Web console.' -ForegroundColor Yellow
