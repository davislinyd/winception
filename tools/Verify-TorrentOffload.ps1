<#
.SYNOPSIS
  Helper to verify BitTorrent P2P offload on the deployment host.

  REAL-VM MODE (default): Restart the Web console, start all services, then
  tail the seeder log live while you PXE-reboot client VMs. A final host
  upload ratio near ~1-1.5x (vs ~Nx for N VMs) confirms P2P offloading.

  LOCAL-TEST MODE (-LocalTest): Spawn N aria2c leecher processes on this host
  with the same flags as WinPE to verify piece-trading works when there is no
  firewall barrier. Confirms the BT infrastructure (tracker + seeder + peers)
  is functional end-to-end without needing to boot real VMs.

  LIMITATION: -LocalTest cannot simulate WinPE Windows Firewall. It will show
  good offload even when real VMs cannot peer due to firewall issues. Always
  validate with a real 4-VM PXE boot after any WinPE networking change.

.NOTES
  Must run in an ELEVATED PowerShell (Administrator) on the deployment host.
  In real-VM mode, PXE-reboot client VMs from Hyper-V once prompted.
#>
[CmdletBinding()]
param(
  [string] $WebBase        = 'http://127.0.0.1:8080',
  [string] $SeederLog      = 'C:\OSDCloud\logs\torrent-seeder.log',
  [string] $AppRoot        = 'C:\OSDCloud\HostTools\App',
  [int]    $WatchMinutes   = 20,

  # -LocalTest: spawn leechers locally instead of waiting for real VM boots.
  [switch] $LocalTest,
  [string] $Aria2Exe       = 'C:\OSDCloud\Tools\aria2c.exe',
  [string] $OsDir          = 'C:\OSDCloud\OS',
  [int]    $LeechtestCount = 4,
  [string] $LeechtestDir   = "$env:TEMP\btltest"
)

$ErrorActionPreference = 'Stop'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}
if (-not (Test-Admin)) { throw 'Run this script from an ELEVATED PowerShell (Administrator).' }

function Get-SeederPeakMiB ([string]$LogPath) {
  $peak = 0.0
  if (Test-Path $LogPath) {
    Select-String -LiteralPath $LogPath -Pattern 'SEED\(' | ForEach-Object {
      $line = ($_.Line -replace '\x1b\[[0-9;]*m', '').Trim()
      if ($line -match 'UL:[0-9.]+[KMG]?iB\(([0-9.]+)(K|M|G)iB\)') {
        $v = [double]$Matches[1]; $u = $Matches[2]
        $miB = $v * $(if ($u -eq 'G') { 1024 } elseif ($u -eq 'M') { 1 } else { 1 / 1024 })
        if ($miB -gt $peak) { $peak = $miB }
      }
    }
  }
  return $peak
}

Write-Host '== Stopping the running Web console (frees the elevated seeder) ==' -ForegroundColor Cyan
$conns = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop; Write-Host "  stopped node PID $($c.OwningProcess)" } catch {}
}
Start-Sleep -Seconds 2

Write-Host '== Launching the installed Web console with the updated code ==' -ForegroundColor Cyan
$startScript = Join-Path $AppRoot 'tools\Start-InstalledWebConsole.ps1'
if (Test-Path $startScript) {
  Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startScript -WindowStyle Normal
} else {
  Start-Process powershell -ArgumentList '-NoProfile', '-NoExit', '-Command', "Set-Location '$AppRoot'; npm run web" -WindowStyle Normal
}

Write-Host '== Waiting for the console API ==' -ForegroundColor Cyan
$up = $false
for ($i = 0; $i -lt 60; $i++) {
  try { $s = Invoke-RestMethod "$WebBase/api/state" -TimeoutSec 3; if ($s.ok) { $up = $true; break } } catch {}
  Start-Sleep -Seconds 2
}
if (-not $up) { throw "Console did not come up at $WebBase. Start it manually and re-run." }
Write-Host '  console is up.' -ForegroundColor Green

Write-Host '== Starting all services (tracker + seeder) ==' -ForegroundColor Cyan
$r = Invoke-RestMethod "$WebBase/api/services/start-all" -Method Post -TimeoutSec 120
$t = $r.state.services.torrent
Write-Host ("  tracker running={0}  seederRunning={1}  seeding={2}" -f $t.running, $t.seederRunning, $t.seeding) -ForegroundColor Green
Write-Host ''

if ($LocalTest) {
  # ── LOCAL PEER TEST ──────────────────────────────────────────────────────────
  Write-Host '=== LOCAL PEER TEST ===' -ForegroundColor Cyan
  Write-Host '[!] Cannot simulate WinPE Windows Firewall — real VM boot required to validate that.' -ForegroundColor Yellow
  Write-Host '[i] This test confirms BT infrastructure (tracker + seeder + piece trading) is working.' -ForegroundColor Yellow
  Write-Host ''

  if (-not (Test-Path $Aria2Exe)) { throw "aria2c.exe not found at $Aria2Exe — use -Aria2Exe to specify path." }
  $manifestPath = Join-Path $OsDir 'os-torrent.json'
  if (-not (Test-Path $manifestPath)) {
    throw "No os-torrent.json in $OsDir — run endpoint sync and Start all services first."
  }
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $torrentFile = Join-Path $OsDir "$($manifest.fileName).torrent"
  if (-not (Test-Path $torrentFile)) { throw "Torrent file not found: $torrentFile" }
  $wimPath = Join-Path $OsDir $manifest.fileName
  if (-not (Test-Path $wimPath)) { throw "WIM not found: $wimPath" }
  $wimGiB = [math]::Round((Get-Item $wimPath).Length / 1GB, 2)

  Write-Host ("  WIM:      {0}  ({1} GiB)" -f $manifest.fileName, $wimGiB)
  Write-Host ("  Leechers: {0}   Torrent: {1}" -f $LeechtestCount, $torrentFile)
  Write-Host ''

  Remove-Item -LiteralPath $LeechtestDir -Recurse -Force -ErrorAction SilentlyContinue
  $seederPort = 6881
  $leechers = @()

  for ($i = 1; $i -le $LeechtestCount; $i++) {
    $dir = Join-Path $LeechtestDir "leech$i"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $logFile = Join-Path $dir 'aria2.log'
    $port = 6890 + $i  # 6891-6894; seeder is on 6881

    # Match WinPE flags exactly (minus falloc which requires pre-partitioned disk).
    # seed-time=5 mirrors the 30-min seeding VMs do during Invoke-OSDCloud; 5 min
    # is enough to observe piece trading in a local test.
    # log-level=info captures peer IP:port connections for the peer analysis below.
    $leechArgs = @(
      "--dir=$dir",
      '--check-integrity=false',
      '--seed-time=5',
      '--seed-ratio=0.0',
      '--file-allocation=none',
      '--bt-save-metadata=false',
      '--enable-dht=false',
      '--enable-dht6=false',
      '--bt-enable-lpd=false',
      "--listen-port=$port",
      '--console-log-level=warn',
      '--summary-interval=0',
      "--log=$logFile",
      '--log-level=info',
      $torrentFile
    )
    $proc = Start-Process -FilePath $Aria2Exe -ArgumentList $leechArgs -WindowStyle Hidden -PassThru
    $leechers += [pscustomobject]@{ Index = $i; Proc = $proc; Dir = $dir; Log = $logFile; Port = $port }
    Write-Host ("  [+] Leecher {0}  PID={1}  port={2}" -f $i, $proc.Id, $port)
  }

  Write-Host ''
  Write-Host 'Waiting for all leechers to finish downloading (up to 90 min)...' -ForegroundColor Cyan
  $dlTimeout = (Get-Date).AddMinutes(90)
  while ((Get-Date) -lt $dlTimeout) {
    $pending = @($leechers | Where-Object {
      $wim = Join-Path $_.Dir $manifest.fileName
      -not (Test-Path $wim) -or (Test-Path "$wim.aria2")
    })
    if ($pending.Count -eq 0) { break }
    Write-Host ("  {0}/{1} still downloading..." -f $pending.Count, $LeechtestCount)
    Start-Sleep -Seconds 15
  }
  Write-Host '  Downloads complete. Waiting 5-min seed window for peer piece exchange...' -ForegroundColor Green
  Start-Sleep -Seconds 300

  foreach ($l in $leechers) {
    try { Stop-Process -Id $l.Proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 2

  # Parse each leecher's info-level log for non-seeder peer ports on 127.0.0.1.
  # Seeder is 127.0.0.1:6881; other leechers are 127.0.0.1:6891-6894.
  Write-Host ''
  Write-Host '== Peer Connectivity (from leecher logs) ==' -ForegroundColor Cyan
  foreach ($l in $leechers) {
    $peers = [System.Collections.Generic.SortedSet[int]]::new()
    if (Test-Path $l.Log) {
      Get-Content $l.Log -ErrorAction SilentlyContinue |
        Select-String -Pattern '127\.0\.0\.1:(\d{4,5})' |
        ForEach-Object {
          foreach ($m in $_.Matches) {
            $p = [int]$m.Groups[1].Value
            if ($p -ne $seederPort) { [void]$peers.Add($p) }
          }
        }
    }
    $color = if ($peers.Count -gt 0) { 'Green' } else { 'Red' }
    $detail = if ($peers.Count -gt 0) { "(ports: $($peers -join ','))" } else { '-- no peer connections found in log' }
    Write-Host ("  Leecher {0} port={1}: {2} peer(s)  {3}" -f $l.Index, $l.Port, $peers.Count, $detail) -ForegroundColor $color
  }

  Write-Host ''
  $peakMiB = Get-SeederPeakMiB $SeederLog
  $ratio = if ($wimGiB -gt 0) { [math]::Round($peakMiB / 1024 / $wimGiB, 2) } else { '?' }
  Write-Host ("== Host seeder upload: {0:N0} MiB ({1:N1} GiB) ==" -f $peakMiB, ($peakMiB / 1024)) -ForegroundColor Cyan
  Write-Host ("   WIM: {0} GiB  |  Upload ratio: {1}x  (target <= 1.5x)" -f $wimGiB, $ratio) -ForegroundColor Cyan

} else {
  # ── REAL-VM MODE ─────────────────────────────────────────────────────────────
  Write-Host '>>> NOW PXE-REBOOT YOUR CLIENT VMs (Hyper-V). Watching the seeder log... <<<' -ForegroundColor Yellow
  Write-Host ''

  $deadline = (Get-Date).AddMinutes($WatchMinutes)
  $peakMiB = 0.0
  $lastLine = ''
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $SeederLog) {
      $sum = Select-String -LiteralPath $SeederLog -Pattern 'SEED\(' | Select-Object -Last 1
      if ($sum) {
        $line = ($sum.Line -replace '\x1b\[[0-9;]*m', '').Trim()
        if ($line -ne $lastLine) { Write-Host "  $line"; $lastLine = $line }
        if ($line -match 'UL:[0-9.]+[KMG]?iB\(([0-9.]+)(K|M|G)iB\)') {
          $v = [double]$Matches[1]; $u = $Matches[2]
          $miB = $v * $(if ($u -eq 'G') { 1024 } elseif ($u -eq 'M') { 1 } else { 1 / 1024 })
          if ($miB -gt $peakMiB) { $peakMiB = $miB }
        }
      }
    }
    Start-Sleep -Seconds 5
  }

  Write-Host ''
  Write-Host ("== Peak host seeder upload: {0:N0} MiB ({1:N1} GiB) ==" -f $peakMiB, ($peakMiB / 1024)) -ForegroundColor Cyan
  Write-Host 'Compare against WIM size: ~1-1.5x = good P2P offload; ~Nx (N=#VMs) = not offloading.' -ForegroundColor Cyan
}
