import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function parsePowerShell(relativePath) {
  const fullPath = path.join(root, relativePath);
  const command = [
    "$path = '" + fullPath.replaceAll("'", "''") + "'",
    '$tokens = $null',
    '$errors = $null',
    '[System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null',
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Output $_.Message }; exit 1 }',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.error, undefined, 'PowerShell parser could not start for ' + relativePath);
  assert.equal(result.status, 0, relativePath + ': ' + result.stdout + '\n' + result.stderr);
}

test('Lab example config is isolated, complete, and secret-free', () => {
  const config = JSON.parse(read('config/lab-regression.example.json'));
  assert.equal(config.switchName, 'Winception-AutoLab');
  assert.equal(config.serviceInterfaceAlias, 'vEthernet (Winception-AutoLab)');
  assert.equal(config.serviceIp, '192.168.177.1');
  assert.equal(config.prefixLength, 24);
  assert.deepEqual(config.dhcp, {
    leaseStartIp: '192.168.177.200',
    leaseEndIp: '192.168.177.250',
    router: '192.168.177.1',
  });
  assert.deepEqual(config.secureBootVms, [
    'winception-autolab-01',
    'winception-autolab-02',
    'winception-autolab-03',
    'winception-autolab-04',
  ]);
  assert.equal(config.ipxeVm, 'winception-autolab-ipxe-01');
  assert.deepEqual(config.firmware.secureBootTpmOn, config.secureBootVms);
  assert.equal(config.firmware.secureBootTpmOff, 'winception-autolab-01');
  assert.equal(config.firmware.ipxeTpmOff, 'winception-autolab-ipxe-01');
  assert.equal(config.firmware.ipxeTpmOn, 'winception-autolab-ipxe-01');
  assert.equal(new Set([...config.secureBootVms, config.ipxeVm]).size, 5);
  for (const name of [...config.secureBootVms, config.ipxeVm]) {
    assert.equal(name.startsWith('winception-client-'), false, 'AutoLab VMs must not reuse historical vSwitch client names');
  }
  assert.equal(config.checkpointName, 'Winception-Clean');
  assert.equal(config.cache.requiredPaths.length, 3);
  assert.equal(config.cache.requiredPaths.some((entry) => String(entry.path).includes('boot.wim')), false);
  assert.equal(config.cache.requiredPaths.some((entry) => String(entry.path).includes('boot.ipxe')), false);
  assert.doesNotMatch(JSON.stringify(config), /windowsPassword|pxeinstallPassword|OSDCLOUD_WINDOWS_PASSWORD/);
});

test('HostTools exporter has allowlist, tracked-file, path, hash, manifest, and secret guards', () => {
  const script = read('tools/Export-HostToolsBundle.ps1');
  assert.match(script, /Get-TrackedRelativePaths/);
  assert.match(script, /git ls-files --cached/);
  assert.match(script, /Join-ChildPath/);
  assert.match(script, /Get-Sha256Hash/);
  assert.match(script, /bundle-manifest\.json/);
  assert.match(script, /sha256/);
  assert.match(script, /hosttools-production-v1/);
  assert.match(script, /no-plaintext-secrets/);
  assert.match(script, /secret/);
  assert.match(script, /osdcloud-secrets/);
  assert.match(script, /iso\|wim\|esd/);
});

test('shared path guard rejects bundle traversal', () => {
  const commonPath = path.join(root, 'tools', 'lib', 'Common.ps1').replaceAll("'", "''");
  const command = "$common = '" + commonPath + "'; . $common; try { Join-ChildPath -Root 'C:\\winception' -RelativePath '..\\escape' -Label 'test'; exit 1 } catch { exit 0 }";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('HostTools exporter emits verifiable hashes and excludes untracked secrets', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-bundle-fixture-'));
  const output = path.join(os.tmpdir(), 'winception-bundle-output-' + path.basename(fixture));
  const write = (relativePath, value) => {
    const fullPath = path.join(fixture, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, value, 'utf8');
  };
  try {
    fs.mkdirSync(path.join(fixture, 'tools', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'config'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'osdcloud-assets'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'docs', 'manual-assets'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'Softwares'), { recursive: true });
    fs.copyFileSync(
      path.join(root, 'tools', 'lib', 'Common.ps1'),
      path.join(fixture, 'tools', 'lib', 'Common.ps1'),
    );
    fs.copyFileSync(
      path.join(root, 'tools', 'Export-HostToolsBundle.ps1'),
      path.join(fixture, 'tools', 'Export-HostToolsBundle.ps1'),
    );
    write('package.json', '{"version":"0.0.0"}\n');
    write('package-lock.json', '{}\n');
    write('Setup-DeploymentServer.cmd', '@echo off\n');
    write('Deploy-DeploymentServer.cmd', '@echo off\n');
    write('New-WinceptionUsbInstaller.cmd', '@echo off\n');
    write('docs/winception-operations-manual.html', '<html></html>\n');
    write('Softwares/Install-Apps.ps1', 'Write-Output test\n');
    write('Softwares/Show-DeploymentProgress.ps1', 'Write-Output test\n');
    for (const relativePath of [
      'tools/Install-HostManagementBundle.ps1',
      'tools/Setup-DeploymentServer.ps1',
      'tools/Reload-Console.ps1',
      'tools/Start-InstalledWebConsole.ps1',
      'tools/Start-WebConsoleTray.ps1',
      'tools/Restore-HostManagementState.ps1',
      'tools/Invoke-SoftwareTestVm.ps1',
      'osdcloud-assets/README.md',
      'config/osdcloud-console.json',
      'config/os-download-sources.json',
      'config/os-image-catalog.json',
      'config/runtime-artifacts.json',
      'config/software-catalog.json',
      'config/scripts-catalog.json',
      'config/deployment-profiles/.gitkeep',
      'tools/osdcloud-console/src/tracked.js',
      'tools/osdcloud-console/web/tracked.js',
      'osdcloud-assets/OSDCloud/Config/tracked.ps1',
      'osdcloud-assets/OSDCloud/WinPE/tracked.ps1',
    ]) {
      write(relativePath, 'tracked\n');
    }
    write('config/osdcloud-console.json', JSON.stringify({
      product: { channel: 'release', dataPolicy: 'zero-preload' },
      initialization: { status: 'unconfigured' },
      adapter: { serverIp: null },
      dhcp: { listenIp: null, leaseStartIp: null, leaseEndIp: null, router: null, ipxeBootUrl: null },
      tftp: { listenIp: null },
      http: { host: null },
      smb: { share: null, imagePath: null },
      osImage: { activeImage: null },
      deploymentProfiles: { activeProfile: null },
    }) + '\n');
    write('config/software-catalog.json', JSON.stringify({ software: [] }) + '\n');
    write('config/scripts-catalog.json', JSON.stringify({ scripts: [] }) + '\n');
    write('config/os-image-catalog.json', JSON.stringify({ images: [] }) + '\n');
    write('config/os-download-sources.json', JSON.stringify({ images: [] }) + '\n');
    write('config/osdcloud-secrets.example.json', '{}\n');
    write('docs/manual-assets/readme.txt', 'asset\n');
    assert.equal(spawnSync('git', ['-C', fixture, 'init', '-q']).status, 0);
    assert.equal(spawnSync('git', ['-C', fixture, 'add', '.']).status, 0);
    write('config/osdcloud-secrets.json', '{"windowsPassword":"do-not-copy"}\n');
    write('tools/untracked.ps1', 'Write-Output untracked\n');

    const exporter = path.join(fixture, 'tools', 'Export-HostToolsBundle.ps1');
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-File',
      exporter,
      '-SourceRoot',
      fixture,
      '-OutputRoot',
      output,
      '-Commit',
      'fixture-commit',
      '-Force',
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'HostTools', 'bundle-manifest.json'), 'utf8'));
    const paths = manifest.files.map((entry) => entry.path);
    assert.ok(paths.includes('tools/osdcloud-console/src/tracked.js'));
    assert.ok(paths.includes('config/osdcloud-secrets.example.json'));
    assert.ok(!paths.includes('config/osdcloud-secrets.json'));
    assert.ok(!paths.includes('tools/untracked.ps1'));
    for (const record of manifest.files) {
      const fullPath = path.join(output, 'HostTools', record.path);
      const bytes = fs.readFileSync(fullPath);
      assert.equal(record.length, bytes.length);
      assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex').toUpperCase());
    }
    const verifier = path.join(root, 'tools', 'Verify-HostToolsBundle.ps1');
    const verification = spawnSync('powershell.exe', [
      '-NoProfile',
      '-File',
      verifier,
      '-BundleRoot',
      output,
      '-Channel',
      'Release',
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(verification.status, 0, verification.stdout + verification.stderr);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('Lab bootstrap is ValidateOnly-capable and fails closed on network and VM drift', () => {
  const script = read('tools/Initialize-WinceptionLab.ps1');
  assert.match(script, /ValidateOnly/);
  assert.match(script, /New-VMSwitch -Name \$Name -SwitchType Internal/);
  assert.doesNotMatch(script, /SwitchType Internal -AllowManagementOS/);
  assert.match(script, /SwitchType.*Internal/);
  assert.match(script, /default gateway/);
  assert.match(script, /Generation 2/);
  assert.match(script, /4GB/);
  assert.match(script, /Checkpoint-VM/);
  assert.match(script, /failed to create checkpoint/);
  assert.match(script, /EnableSecureBoot On/);
  assert.match(script, /EnableSecureBoot Off/);
  assert.match(script, /function Set-LabVmTpmEnabled/);
  assert.match(script, /Set-VMKeyProtector -VMName \$VmName -NewLocalKeyProtector/);
  assert.match(script, /Get-VMKeyProtector -VMName \$VmName/);
  assert.match(script, /protectorLength -lt 32/);
  assert.match(script, /Enable-VMTPM -VMName \$VmName/);
  assert.doesNotMatch(script, /\$security\.KpsAvailable/);
  assert.match(script, /Disable-VMTPM -VMName \$VmName/);
  assert.match(script, /Set-LabVmTpmEnabled -VmName \$VmName -Enabled \$Tpm/);
  assert.match(script, /SecureBoot \$true -Tpm \$true/);
  assert.match(script, /SecureBoot \$false -Tpm \$false/);
  const tpmFn = script.indexOf('function Set-LabVmTpmEnabled');
  const enableTpm = script.indexOf('Enable-VMTPM -VMName $VmName', tpmFn);
  const disableTpm = script.indexOf('Disable-VMTPM -VMName $VmName', tpmFn);
  assert.ok(tpmFn >= 0 && enableTpm > tpmFn && disableTpm > enableTpm, 'TPM disable must be the Enabled=false path');
});

test('Lab regression gates DHCP behind preflight and always cleans known resources', () => {
  const script = read('tools/Invoke-WinceptionLabRegression.ps1');
  assert.match(script, /try \{/);
  assert.match(script, /finally \{/);
  assert.match(script, /\/api\/preflight/);
  assert.match(script, /function Get-ConsoleTimeoutSec/);
  assert.match(script, /TimeoutSec \(Get-ConsoleTimeoutSec\)/);
  assert.match(script, /\/api\/services\/start-all/);
  assert.match(script, /server:preflight failed; DHCP will not be started/);
  assert.match(script, /IsManagementOS/);
  assert.match(script, /function Get-SecretStorePath/);
  assert.match(script, /\$webHost = \[string\] \$script:Config\.web\.host/);
  assert.doesNotMatch(script, /\$host = \[string\] \$script:Config\.web\.host/);
  assert.doesNotMatch(script, /secret store path'\)[\s\S]*RuntimeRoot/s);
  assert.match(script, /Assert-ChildPath -Root \$script:StateRoot -Path \$full -Label 'secret store path'/);
  assert.match(script, /Unexpected VM is connected to isolated Lab switch/);
  assert.ok(
    script.indexOf('Invoke-ServerPreflight') < script.indexOf('Start-LabServices'),
    'server preflight must appear before the service start gate',
  );
  const afterStart = script.indexOf("Save-ConsoleStateEvidence -Name 'state-after-start.json'");
  const setEndpoint = script.indexOf('$state = Set-ConsoleEndpoint', afterStart);
  assert.ok(afterStart >= 0 && setEndpoint > afterStart, 'Lab must start the console then set the AutoLab endpoint');
  assert.equal(
    script.slice(afterStart, setEndpoint).includes('Assert-ConsoleEndpoint'),
    false,
    'Lab must not require the console to already be on AutoLab before Set-ConsoleEndpoint',
  );
  assert.match(script, /New-PSSession -VMName/);
  assert.match(script, /windows-desktop-ready/);
  assert.match(script, /function Test-ClientTerminalFailureText/);
  assert.match(script, /PXE-HttpRoot\\status\\latest.json/);
  assert.match(script, /selected-os\\.json did not produce/);
  assert.match(script, /SMB map to Z: failed/);
  assert.match(script, /System error 86/);
  assert.match(script, /-ConfigPath', \$stateConfigPath/);
  assert.match(script, /Restore-VMSnapshot/);
  assert.match(script, /function Set-LabVmTpmEnabled/);
  assert.match(script, /Set-LabVmTpmEnabled -VmName \$VmName -Enabled \$Tpm/);
  assert.match(script, /Enable-VMTPM -VMName \$VmName/);
  assert.match(script, /Disable-VMTPM -VMName \$VmName/);
  assert.match(script, /Set-VMKeyProtector -VMName \$VmName -NewLocalKeyProtector/);
  assert.match(script, /Get-VMKeyProtector -VMName \$VmName/);
  assert.match(script, /protectorLength -lt 32/);
  assert.doesNotMatch(script, /\$security\.KpsAvailable/);
  assert.match(script, /Confirm-SecureBootUEFI/);
  assert.match(script, /Get-Tpm/);
  assert.match(script, /ExpectedSecureBoot \$SecureBoot/);
  assert.match(script, /ExpectedTpm \$Tpm/);
  assert.match(script, /FirmwareCorners/);
  assert.match(script, /secureboot-tpm-off/);
  assert.match(script, /ipxe-tpm-on/);
  assert.match(script, /function Get-LabFirmwareConfig/);
  const restoreAt = script.indexOf('function Restore-LabCheckpoint');
  const firmwareAfterRestore = script.indexOf('Set-VmFirmwareMode -VmName $vmName -SecureBoot $secureBoot -Tpm $tpm', restoreAt);
  assert.ok(restoreAt >= 0 && firmwareAfterRestore > restoreAt, 'checkpoint restore must re-apply firmware and TPM independently');
  const firmwareFn = script.indexOf('function Set-VmFirmwareMode');
  const tpmAfterFirmware = script.indexOf('Set-LabVmTpmEnabled -VmName $VmName -Enabled $Tpm', firmwareFn);
  assert.ok(firmwareFn >= 0 && tpmAfterFirmware > firmwareFn && tpmAfterFirmware < restoreAt, 'firmware apply must set TPM from -Tpm, not from Secure Boot');
  assert.match(script, /\[Parameter\(Mandatory\)\]\[bool\] \$Tpm/);
  assert.match(script, /PowerShell\.Exiting/);
  assert.match(script, /Stop-KnownLabProcesses/);
  assert.match(script, /Stop-Process -Id/);
  assert.match(script, /Global\\Winception-AutoLab/);
  assert.match(script, /cache.*allowNetworkRefresh/s);
  assert.doesNotMatch(script, /reason -eq 'manifest_missing'/);
  assert.match(script, /function Test-LabPortBindingConflicts/);
  assert.match(script, /0\.0\.0\.0/);
  assert.match(script, /::ffff:/);
  assert.match(script, /A Lab service port is already occupied/);
});

test('Lab port occupancy ignores ICS on another adapter and treats wildcard binds as conflicts', () => {
  const commonPath = path.join(root, 'tools', 'lib', 'Common.ps1').replaceAll("'", "''");
  const scriptPath = path.join(root, 'tools', 'Invoke-WinceptionLabRegression.ps1').replaceAll("'", "''");
  const command = [
    "$common = '" + commonPath + "'",
    '. $common',
    "$script = '" + scriptPath + "'",
    '$tokens = $null',
    '$errors = $null',
    '$ast = [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors)',
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Output $_.Message }; exit 1 }',
    '$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq \'Test-LabPortBindingConflicts\' }, $true)',
    'if (-not $fn) { Write-Output \'missing Test-LabPortBindingConflicts\'; exit 1 }',
    'Invoke-Expression $fn.Extent.Text',
    'if (-not (Test-LabPortBindingConflicts -LocalAddress \'192.168.177.1\' -ServiceIp \'192.168.177.1\')) { Write-Output \'service-ip should conflict\'; exit 1 }',
    'if (-not (Test-LabPortBindingConflicts -LocalAddress \'0.0.0.0\' -ServiceIp \'192.168.177.1\')) { Write-Output \'wildcard should conflict\'; exit 1 }',
    'if (-not (Test-LabPortBindingConflicts -LocalAddress \'::ffff:192.168.177.1\' -ServiceIp \'192.168.177.1\')) { Write-Output \'mapped ipv6 should conflict\'; exit 1 }',
    'if (Test-LabPortBindingConflicts -LocalAddress \'172.25.144.1\' -ServiceIp \'192.168.177.1\') { Write-Output \'ICS address must not conflict\'; exit 1 }',
    'exit 0',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('Workflows use the dedicated runner and keep PRs non-mutating', () => {
  const pr = read('.github/workflows/pr.yml');
  const lab = read('.github/workflows/lab-deploy.yml');
  assert.match(pr, /pull_request:/);
  assert.match(pr, /runs-on: \[self-hosted, windows, winception-lab\]/);
  assert.match(pr, /node-version: 24\.x/);
  assert.match(pr, /npm ci/);
  assert.match(pr, /npm run check/);
  assert.match(pr, /npm test/);
  assert.match(pr, /npm run smoke/);
  assert.doesNotMatch(pr, /services\/start-all|server:preflight|dhcp-mode|Initialize-DeploymentServer/);

  assert.match(lab, /branches:\s+- master/);
  assert.match(lab, /runs-on: \[self-hosted, windows, hyperv, winception-lab\]/);
  assert.match(lab, /concurrency:\s+group: winception-lab/s);
  assert.match(lab, /cancel-in-progress: false/);
  assert.match(lab, /timeout-minutes: 180/);
  assert.match(lab, /contents: read/);
  assert.match(lab, /Export-HostToolsBundle\.ps1/);
  assert.match(lab, /Seed-DevelopmentFixture\.ps1/);
  assert.match(lab, /-ActiveProfileId IZVZO7PU/);
  assert.match(lab, /Invoke-WinceptionLabRegression\.ps1/);
  assert.match(lab, /GITHUB_WORKSPACE.*Invoke-WinceptionLabRegression/s);
  assert.match(lab, /actions\/upload-artifact@v4/);
  assert.match(lab, /if: always\(\)/);

  const release = read('.github/workflows/release-candidate.yml');
  assert.match(release, /workflow_dispatch:/);
  assert.match(release, /-Channel Release/);
  assert.match(release, /Verify-HostToolsBundle\.ps1/);
  assert.match(release, /Expand-Archive/);
  assert.match(release, /unsigned-rc/);
  assert.doesNotMatch(release, /git push|git tag|gh release create/);
});

test('new PowerShell automation modules parse without executing live operations', () => {
  for (const relativePath of [
    'tools/Export-HostToolsBundle.ps1',
    'tools/Verify-HostToolsBundle.ps1',
    'tools/Seed-DevelopmentFixture.ps1',
    'tools/Initialize-WinceptionLab.ps1',
    'tools/Invoke-WinceptionLabRegression.ps1',
  ]) {
    parsePowerShell(relativePath);
  }
});
