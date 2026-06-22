import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const mainPath = path.join(root, 'tools', 'New-WinceptionUsbInstaller.ps1');
const startupPath = path.join(root, 'osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Start-OSDCloud-USB.ps1');
const oobePath = path.join(root, 'osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Invoke-OobeCustomization-USB.ps1');
const setupPath = path.join(root, 'osdcloud-assets', 'OSDCloud', 'Config', 'Scripts', 'SetupComplete', 'SetupComplete.ps1');
const stagedSetupPath = path.join(root, 'osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Config', 'Scripts', 'SetupComplete', 'SetupComplete.ps1');

const main = fs.readFileSync(mainPath, 'utf8');
const startup = fs.readFileSync(startupPath, 'utf8');
const oobe = fs.readFileSync(oobePath, 'utf8');
const setup = fs.readFileSync(setupPath, 'utf8');

test('USB installer PowerShell sources parse in Windows PowerShell', () => {
  for (const file of [mainPath, startupPath, oobePath, setupPath, stagedSetupPath]) {
    const escaped = file.replaceAll("'", "''");
    const command = `$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$tokens,[ref]$errors)|Out-Null;if($errors){$errors|ForEach-Object{Write-Error $_};exit 1}`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}\n${result.stderr || result.stdout}`);
  }
});

test('CLI exposes isolated USB and ISO parameter sets', () => {
  assert.match(main, /DefaultParameterSetName = 'Usb'/);
  assert.match(main, /ParameterSetName = 'Usb'[\s\S]*\[switch\] \$Usb/);
  assert.match(main, /ParameterSetName = 'Usb'[\s\S]*\[int\] \$DiskNumber/);
  assert.match(main, /ParameterSetName = 'Iso'[\s\S]*\[switch\] \$Iso/);
  assert.match(main, /\[switch\] \$CheckOnly/);
  assert.match(main, /\[switch\] \$OpenInRufus/);
});

test('snapshot is active-only, excludes runtime OSDCloud content, and cleans staging', () => {
  assert.match(main, /ExtraArguments @\('\/XD', \(Join-Path \$Context\.MediaRoot 'OSDCloud'\)\)/);
  assert.match(main, /Copy-Item -LiteralPath \$Context\.SelectedWim\.FullName/);
  assert.match(main, /selectedSoftware/);
  assert.match(main, /SelectedProfile\.scripts/);
  assert.match(main, /Copy-DirectoryContents -Source \$Context\.DriverRoot/);
  assert.match(main, /Program Files\\WindowsPowerShell\\Modules\\\$moduleName/);
  assert.match(main, /Remove-Item -LiteralPath \$safeStage -Recurse -Force/);
});

test('manifest records offline mode without secret values or host paths', () => {
  const manifestBody = main.slice(main.indexOf('function New-UsbManifest'), main.indexOf('function New-StagedMedia'));
  assert.match(manifestBody, /deploymentMode = 'usb-offline'/);
  assert.match(manifestBody, /path = \$relative/);
  assert.match(manifestBody, /sensitive = \$true/);
  assert.doesNotMatch(manifestBody, /windowsPassword|pxeinstallPassword|SecretsPath/);
  assert.doesNotMatch(manifestBody, /FullName\s*=/);
});

test('capacity and FAT32 guards include explicit headroom', () => {
  const bootBytes = 1500;
  const dataBytes = 8500;
  const bootMinimum = 2000;
  const bootHeadroom = 500;
  const dataHeadroom = 1000;
  const bootPartition = Math.max(bootMinimum, bootBytes + bootHeadroom);
  assert.equal(bootPartition, 2000);
  assert.equal(bootPartition + dataBytes + dataHeadroom, 11500);
  assert.match(main, /\[math\]::Max\(\$BootPartitionMinimumBytes, \$bootBytes \+ \$BootPartitionHeadroomBytes\)/);
  assert.match(main, /\$bootPartitionBytes \+ \$dataBytes \+ \$DataHeadroomBytes/);
  const capacityBody = main.slice(main.indexOf('$dataFiles = @('), main.indexOf('$dataBytes ='));
  assert.match(capacityBody, /selectedSoftware/);
  assert.match(capacityBody, /selectedProfile\.scripts/);
  assert.doesNotMatch(capacityBody, /Get-ChildItem -LiteralPath \$appsRoot -File -Recurse/);
  assert.match(main, /FAT32 boot file exceeds 4 GiB/);
  assert.match(main, /Assert-AvailableSpace/);
});

test('destructive USB path is identity-bound and rejects unsafe disks', () => {
  assert.match(main, /Refusing system\/boot disk/);
  assert.match(main, /Refusing non-USB disk/);
  assert.match(main, /ERASE DISK \$\(\$Disk\.Number\)/);
  assert.match(main, /Assert-SameUsbDisk -Expected \$ConfirmedDisk -Actual \$actualDisk/);
  assert.match(main, /PartitionStyle GPT/);
  assert.match(main, /FileSystem FAT32 -NewFileSystemLabel \$UsbBootLabel/);
  assert.match(main, /FileSystem NTFS -NewFileSystemLabel \$UsbDataLabel/);
});

test('offline startup verifies media, selects one internal disk, and prevents reapply', () => {
  assert.match(startup, /Test-UsbMediaManifest/);
  assert.match(startup, /Expected exactly one eligible internal install disk/);
  assert.match(startup, /BusType -notin @\('USB', 'SD', 'MMC', 'File Backed Virtual'\)/);
  assert.match(startup, /Test-MediaAlreadyApplied/);
  assert.match(startup, /metadata\.appliedAt/);
  assert.match(startup, /ImageFileDestination = \$imageFile/);
  assert.match(startup, /DriverPackName = 'None'/);
  assert.match(startup, /Install-MatchingOfflineDriverPack/);
  assert.doesNotMatch(startup, /net use|torrent|Invoke-WebRequest|statusUrl/i);
});

test('USB local status gate leaves the two PXE SetupComplete copies identical', () => {
  assert.match(oobe, /deploymentMode = 'usb-offline'/);
  assert.match(oobe, /statusTransport = 'local'/);
  assert.match(setup, /statusTransport -eq 'local'/);
  assert.match(setup, /NotePropertyName localStatus/);
  assert.match(setup, /Write-LocalStatus -Metadata \$metadata -Path \$metadataPath/);
  assert.match(setup, /\[System\.IO\.File\]::Replace\(\$temporaryPath, \$Path, \$backupPath\)/);
  assert.equal(setup, fs.readFileSync(stagedSetupPath, 'utf8'));
});

test('Rufus integration only preloads ISO and filesystem preference', () => {
  const launch = main.match(/Start-Process -FilePath \$resolvedRufus[^\n]+/u)?.[0] ?? '';
  assert.match(launch, /--gui/);
  assert.match(launch, /--iso=/);
  assert.match(launch, /--filesystem=NTFS/);
  assert.doesNotMatch(launch, /DiskNumber|--start|--write|--device/);
  assert.match(main, /Winception does not download Rufus/);
});
