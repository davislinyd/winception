import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();

function invokePowerShell(script, args) {
  return spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(repoRoot, script),
    ...args,
  ], { encoding: 'utf8', windowsHide: true });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('Release install is fresh, upgrades preserve State, and migration failure is recoverable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-install-test-'));
  const appRoot = path.join(root, 'HostTools', 'App');
  const stateRoot = path.join(root, 'HostTools', 'State');
  try {
    let result = invokePowerShell('tools/Install-HostManagementBundle.ps1', [
      '-SourceRoot', repoRoot,
      '-AppRoot', appRoot,
      '-StateRoot', stateRoot,
      '-Channel', 'Release',
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    const stateConfigPath = path.join(stateRoot, 'config', 'osdcloud-console.json');
    const stateConfig = JSON.parse(fs.readFileSync(stateConfigPath, 'utf8'));
    assert.equal(stateConfig.product.channel, 'release');
    assert.equal(stateConfig.product.dataPolicy, 'zero-preload');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stateRoot, 'config', 'software-catalog.json'), 'utf8')).software, []);
    assert.equal(fs.readdirSync(path.join(stateRoot, 'config', 'deployment-profiles')).filter((name) => name.endsWith('.json')).length, 0);
    assert.equal(fs.existsSync(path.join(stateRoot, 'fixtures')), false);
    assert.equal(fs.existsSync(path.join(appRoot, 'fixtures', 'development')), false);
    assert.equal(fs.existsSync(path.join(appRoot, 'tools', 'Seed-DevelopmentFixture.ps1')), false);
    assert.equal(fs.existsSync(path.join(appRoot, 'tools', 'osdcloud-console', 'web', 'logo.png')), true);
    assert.equal(fs.existsSync(path.join(appRoot, 'tools', 'osdcloud-console', 'web', 'logo.ico')), true);

    const profilePath = path.join(stateRoot, 'config', 'deployment-profiles', 'customer-profile.json');
    const softwarePath = path.join(stateRoot, 'config', 'software-catalog.json');
    const evidencePath = path.join(stateRoot, 'history', 'run-001.json');
    const secretPath = path.join(stateRoot, 'config', 'osdcloud-secrets.json');
    writeJson(profilePath, { id: 'customer-profile', name: 'Customer profile', osImageId: 'customer-image' });
    writeJson(softwarePath, { schemaVersion: 1, software: [{ id: 'customer-app', name: 'Customer app' }] });
    writeJson(evidencePath, { runId: 'run-001', status: 'completed' });
    writeJson(secretPath, { windowsUsername: 'customer-user', windowsPassword: 'test-only', pxeinstallPassword: 'test-only' });

    result = invokePowerShell('tools/Install-HostManagementBundle.ps1', [
      '-SourceRoot', repoRoot,
      '-AppRoot', appRoot,
      '-StateRoot', stateRoot,
      '-Channel', 'Release',
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(profilePath, 'utf8')), { id: 'customer-profile', name: 'Customer profile', osImageId: 'customer-image' });
    assert.deepEqual(JSON.parse(fs.readFileSync(softwarePath, 'utf8')).software, [{ id: 'customer-app', name: 'Customer app' }]);
    assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, 'utf8')), { runId: 'run-001', status: 'completed' });
    assert.deepEqual(JSON.parse(fs.readFileSync(secretPath, 'utf8')), { windowsUsername: 'customer-user', windowsPassword: 'test-only', pxeinstallPassword: 'test-only' });
    const backups = fs.readdirSync(path.join(root, 'HostTools', 'Backups')).filter((name) => name.startsWith('HostTools-State-'));
    assert.ok(backups.length >= 1, 'upgrade must create a timestamped State backup');

    writeJson(path.join(stateRoot, 'state-schema.json'), { schemaVersion: 99, appVersion: 'future' });
    result = invokePowerShell('tools/Install-HostManagementBundle.ps1', [
      '-SourceRoot', repoRoot,
      '-AppRoot', appRoot,
      '-StateRoot', stateRoot,
      '-Channel', 'Release',
    ]);
    assert.notEqual(result.status, 0, 'unsupported State schema must stop the upgrade');
    const failedBackups = fs.readdirSync(path.join(root, 'HostTools', 'Backups')).filter((name) => name.startsWith('HostTools-State-'));
    assert.ok(failedBackups.length >= 2, 'failed upgrade must retain a second recovery backup');

    const newestBackup = failedBackups
      .map((name) => path.join(root, 'HostTools', 'Backups', name))
      .sort()
      .at(-1);
    result = invokePowerShell('tools/Restore-HostManagementState.ps1', [
      '-BackupPath', newestBackup,
      '-StateRoot', stateRoot,
      '-Force',
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(profilePath, 'utf8')), { id: 'customer-profile', name: 'Customer profile', osImageId: 'customer-image' });
    assert.deepEqual(JSON.parse(fs.readFileSync(secretPath, 'utf8')), { windowsUsername: 'customer-user', windowsPassword: 'test-only', pxeinstallPassword: 'test-only' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Development fixture loading is explicit and selects a fixture profile and image', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-development-seed-test-'));
  const appRoot = path.join(root, 'HostTools', 'App');
  const stateRoot = path.join(root, 'HostTools', 'State');
  try {
    let result = invokePowerShell('tools/Install-HostManagementBundle.ps1', [
      '-SourceRoot', repoRoot,
      '-AppRoot', appRoot,
      '-StateRoot', stateRoot,
      '-Channel', 'Development',
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path.join(appRoot, 'fixtures', 'development')), true);
    assert.equal(fs.existsSync(path.join(appRoot, 'tools', 'Seed-DevelopmentFixture.ps1')), true);

    result = invokePowerShell('tools/Seed-DevelopmentFixture.ps1', [
      '-SourceRoot', appRoot,
      '-StateRoot', stateRoot,
      '-ActiveProfileId', 'IZVZO7PU',
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const stateConfig = JSON.parse(fs.readFileSync(path.join(stateRoot, 'config', 'osdcloud-console.json'), 'utf8'));
    assert.equal(stateConfig.product.channel, 'development');
    assert.equal(stateConfig.product.dataPolicy, 'development-fixture');
    assert.equal(stateConfig.deploymentProfiles.activeProfile, 'IZVZO7PU');
    assert.equal(stateConfig.osImage.activeImage, 'WINDOWS-11-25H2-X64-EN-US-RETAIL-26200-6584-EN-US-PRO-RETAIL-6-2');
    assert.equal(fs.existsSync(path.join(stateRoot, 'config', 'deployment-profiles', 'IZVZO7PU.json')), true);
    assert.equal(fs.existsSync(path.join(stateRoot, 'development-fixture.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer ordering backs up State before app replacement and never seeds Development fixtures implicitly', () => {
  const script = fs.readFileSync(path.join(repoRoot, 'tools', 'Install-HostManagementBundle.ps1'), 'utf8');
  assert.ok(script.indexOf('$stateBackupPath = Backup-StateRoot') < script.indexOf('Remove-Item -LiteralPath $safeAppRoot'), 'State backup must precede forced App replacement');
  assert.match(script, /Unable to backup HostTools State/);
  assert.match(script, /Run the installer from an elevated PowerShell session/);
  assert.ok(script.indexOf('Invoke-StateMigration') < script.indexOf('Clear-DiagnosticsState'), 'migration must complete before diagnostics cleanup');
  assert.doesNotMatch(script, /Seed-DevelopmentFixture\.ps1.*&/s, 'Release installer must not call Development seed implicitly');
  assert.match(script, /tools\\\\osdcloud-console\\\\web\\\\/);
  assert.match(fs.readFileSync(path.join(repoRoot, 'tools', 'Verify-HostToolsBundle.ps1'), 'utf8'), /tools\\\\osdcloud-console\\\\web\\\\/);
  assert.match(fs.readFileSync(path.join(repoRoot, 'tools', 'Setup-DeploymentServer.ps1'), 'utf8'), /SeedDevelopmentFixture/);
});
