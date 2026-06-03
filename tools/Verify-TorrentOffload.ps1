<#
.SYNOPSIS
  One-shot helper to apply and verify the torrent seeder-throttle offload fix.

  Run in an ELEVATED PowerShell on the deployment host. It restarts the Web
  console (so the new throttled-seeder code loads), starts all services, then
  tails the seeder log and reports the host upload ratio while you PXE-reboot
  the client VMs. A final ratio near ~1-1.5x (instead of ~Nx for N clients)
  means P2P is offloading the host.

.NOTES
  Does NOT reboot VMs for you (do that from Hyper-V once it prints the prompt).
#>
[CmdletBinding()]
param(
  [string] $WebBase = 'http://127.0.0.1:8080',
  [string] $SeederLog = 'C:\OSDCloud\logs\torrent-seeder.log',
  [string] $AppRoot = 'C:\OSDCloud\HostTools\App',
  [int] $WatchMinutes = 20
)

$ErrorActionPreference = 'Stop'
function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}
if (-not (Test-Admin)) { throw 'Run this script from an ELEVATED PowerShell (Administrator).' }

Write-Host '== Stopping the running Web console (frees the elevated seeder) ==' -ForegroundColor Cyan
$conns = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop; Write-Host "  stopped node PID $($c.OwningProcess)" } catch {}
}
Start-Sleep -Seconds 2

Write-Host '== Launching the installed Web console with the updated code ==' -ForegroundColor Cyan
$startScript = Join-Path $AppRoot 'tools\Start-InstalledWebConsole.ps1'
if (Test-Path $startScript) {
  Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$startScript -WindowStyle Normal
} else {
  Start-Process powershell -ArgumentList '-NoProfile','-NoExit','-Command',"Set-Location '$AppRoot'; npm run web" -WindowStyle Normal
}

Write-Host '== Waiting for the console API ==' -ForegroundColor Cyan
$up = $false
for ($i = 0; $i -lt 60; $i++) {
  try { $s = Invoke-RestMethod "$WebBase/api/state" -TimeoutSec 3; if ($s.ok) { $up = $true; break } } catch {}
  Start-Sleep -Seconds 2
}
if (-not $up) { throw "Console did not come up at $WebBase. Start it manually, then re-run with -SkipRestart logic." }
Write-Host '  console is up.' -ForegroundColor Green

Write-Host '== Starting all services (tracker + throttled seeder) ==' -ForegroundColor Cyan
$r = Invoke-RestMethod "$WebBase/api/services/start-all" -Method Post -TimeoutSec 120
$t = $r.state.services.torrent
Write-Host ("  torrent tracker running={0} seederRunning={1} seeding={2}" -f $t.running,$t.seederRunning,$t.seeding) -ForegroundColor Green

Write-Host ''
Write-Host '>>> NOW PXE-REBOOT YOUR CLIENT VMs (Hyper-V). Watching the seeder log... <<<' -ForegroundColor Yellow
Write-Host ''

$deadline = (Get-Date).AddMinutes($WatchMinutes)
$peakMiB = 0.0
$lastLine = ''
while ((Get-Date) -lt $deadline) {
  if (Test-Path $SeederLog) {
    $sum = Select-String -LiteralPath $SeederLog -Pattern 'SEED\(' | Select-Object -Last 1
    if ($sum) {
      $line = ($sum.Line -replace '\x1b\[[0-9;]*m','').Trim()
      if ($line -ne $lastLine) { Write-Host "  $line"; $lastLine = $line }
      if ($line -match 'UL:[0-9.]+[KMG]?iB\(([0-9.]+)(K|M|G)iB\)') {
        $v = [double]$Matches[1]; $u = $Matches[2]
        $miB = $v * ($(if ($u -eq 'G') {1024} elseif ($u -eq 'M') {1} else {1/1024}))
        if ($miB -gt $peakMiB) { $peakMiB = $miB }
      }
    }
  }
  Start-Sleep -Seconds 5
}

Write-Host ''
Write-Host ("== Peak host seeder upload this window: {0:N0} MiB ({1:N1} GiB) ==" -f $peakMiB, ($peakMiB/1024)) -ForegroundColor Cyan
Write-Host 'Compare against the WIM size: ~1-1.5x of the WIM = good offload; ~Nx (N=#VMs) = not offloading.' -ForegroundColor Cyan
