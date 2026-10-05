import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const stateFiles = [
  'config\\osdcloud-console.json',
  'state-schema.json',
  'config\\os-download-sources.json',
  'config\\os-image-catalog.json',
  'config\\software-catalog.json',
  'config\\scripts-catalog.json',
];

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

function invokePowerShellAsync(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(repoRoot, script),
      ...args,
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function completeTransaction(hostToolsRoot, apiOk = true) {
  const server = createServer((request, response) => {
    if (request.url === '/api/state') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: apiOk }));
      return;
    }
    response.end('ready');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await invokePowerShellAsync('tools/Complete-HostManagementUpgrade.ps1', [
      '-WebHost', '127.0.0.1',
      '-WebPort', String(server.address().port),
      '-HostToolsRoot', hostToolsRoot,
      '-TimeoutSeconds', '1',
    ]);
    return result;
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function installRelease(appRoot, stateRoot) {
  return invokePowerShell('tools/Install-HostManagementBundle.ps1', [
    '-SourceRoot', repoRoot,
    '-AppRoot', appRoot,
    '-StateRoot', stateRoot,
    '-Channel', 'Release',
  ]);
}

function upgradeDirectories(hostToolsRoot) {
  const backups = path.join(hostToolsRoot, 'Backups');
  return fs.readdirSync(backups).filter((name) => name.startsWith('HostTools-Upgrade-')).map((name) => path.join(backups, name));
}

test('HostTools install snapshots only declared State and rolls back an unready upgrade idempotently', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-install-test-'));
  const hostToolsRoot = path.join(root, 'HostTools');
  const appRoot = path.join(hostToolsRoot, 'App');
  const stateRoot = path.join(hostToolsRoot, 'State');
  try {
    let result = installRelease(appRoot, stateRoot);
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

    const firstManifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'installation-manifest.json'), 'utf8'));
    assert.equal(firstManifest.source.version, JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version);
    assert.equal(firstManifest.source.channel, 'Release');
    assert.match(firstManifest.source.sourceCommit, /^[0-9a-f]{40}$/i);
    assert.equal(typeof firstManifest.source.sourceTreeClean, 'boolean');
    assert.match(firstManifest.packageLockSha256, /^[0-9A-F]{64}$/);
    assert.equal(fs.existsSync(path.join(hostToolsRoot, 'Open-WebConsole.cmd')), true);
    const firstTransaction = upgradeDirectories(hostToolsRoot)[0];
    const firstTransactionManifest = JSON.parse(fs.readFileSync(path.join(firstTransaction, 'transaction.json'), 'utf8'));
    assert.deepEqual(firstTransactionManifest.stateFiles.map((record) => record.path), stateFiles);
    assert.equal(firstTransactionManifest.stateFiles.every((record) => record.existed === false), true);

    result = await completeTransaction(hostToolsRoot);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(firstTransaction, 'transaction.json'), 'utf8')).status, 'committed');
    assert.equal(fs.existsSync(path.join(hostToolsRoot, 'upgrade-current.json')), false);

    const profilePath = path.join(stateRoot, 'config', 'deployment-profiles', 'customer-profile.json');
    const softwarePath = path.join(stateRoot, 'config', 'software-catalog.json');
    const evidencePath = path.join(stateRoot, 'evidence', 'run-001.json');
    const secretPath = path.join(stateRoot, 'config', 'osdcloud-secrets.json');
    const labPath = path.join(stateRoot, 'lab', 'large-fixture.bin');
    const diagnosticsPath = path.join(stateRoot, 'diagnostics', 'prior-diagnostic.json');
    writeJson(profilePath, { id: 'customer-profile', name: 'Customer profile', osImageId: 'customer-image' });
    writeJson(softwarePath, { schemaVersion: 1, software: [{ id: 'customer-app', name: 'Customer app' }] });
    writeJson(evidencePath, { runId: 'run-001', status: 'completed' });
    writeJson(secretPath, { windowsUsername: 'customer-user', windowsPassword: 'test-only', pxeinstallPassword: 'test-only' });
    fs.mkdirSync(path.dirname(labPath), { recursive: true });
    fs.writeFileSync(labPath, Buffer.alloc(1024 * 1024, 0x5a));
    writeJson(diagnosticsPath, { runId: 'prior-diagnostic' });
    const outsideStateBefore = new Map([profilePath, softwarePath, evidencePath, secretPath, labPath].map((file) => [file, fs.readFileSync(file)]));
    const configBeforeUpgrade = fs.readFileSync(stateConfigPath);
    const schemaPath = path.join(stateRoot, 'state-schema.json');
    const schemaBeforeUpgrade = fs.readFileSync(schemaPath);
    const priorAppManifest = fs.readFileSync(path.join(appRoot, 'installation-manifest.json'));

    result = installRelease(appRoot, stateRoot);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const [file, content] of outsideStateBefore) assert.deepEqual(fs.readFileSync(file), content, `${path.relative(stateRoot, file)} must not change during upgrade`);

    const transactions = upgradeDirectories(hostToolsRoot);
    const pendingTransaction = transactions.find((directory) => JSON.parse(fs.readFileSync(path.join(directory, 'transaction.json'), 'utf8')).status !== 'committed');
    const pendingManifestPath = path.join(pendingTransaction, 'transaction.json');
    let pendingManifest = JSON.parse(fs.readFileSync(pendingManifestPath, 'utf8'));
    assert.deepEqual(pendingManifest.stateFiles.map((record) => record.path), stateFiles);
    assert.equal(pendingManifest.stateFiles.every((record) => record.existed), true);
    assert.equal(fs.existsSync(path.join(pendingTransaction, 'state-before', 'config', 'osdcloud-secrets.json')), false);
    assert.equal(fs.existsSync(path.join(pendingTransaction, 'state-before', 'lab')), false);
    assert.equal(fs.existsSync(path.join(pendingTransaction, 'state-before', 'evidence')), false);
    assert.equal(fs.existsSync(path.join(stateRoot, 'diagnostics')), false);
    assert.equal(fs.existsSync(path.join(pendingTransaction, 'state-before', 'diagnostics', 'prior-diagnostic.json')), true);
    assert.equal(fs.readFileSync(path.join(pendingTransaction, 'previous-app', 'installation-manifest.json')).equals(priorAppManifest), true);
    assert.equal(fs.existsSync(path.join(hostToolsRoot, 'upgrade-current.json')), true);

    const savedTransactionManifest = fs.readFileSync(pendingManifestPath);
    pendingManifest.stateFiles[0].path = 'lab\\large-fixture.bin';
    writeJson(pendingManifestPath, pendingManifest);
    result = invokePowerShell('tools/Restore-HostManagementUpgrade.ps1', [
      '-HostToolsRoot', hostToolsRoot,
      '-ConsoleAlreadyStopped',
    ]);
    assert.notEqual(result.status, 0, 'recovery must reject State paths outside the declared allowlist');
    assert.match(result.stderr, /undeclared State restore path/);
    fs.writeFileSync(pendingManifestPath, savedTransactionManifest);
    pendingManifest = JSON.parse(fs.readFileSync(pendingManifestPath, 'utf8'));

    result = await completeTransaction(hostToolsRoot, false);
    assert.notEqual(result.status, 0, 'an API readiness failure must leave recovery pending');
    assert.match(result.stderr, /readiness check failed/i);
    assert.equal(fs.existsSync(path.join(hostToolsRoot, 'upgrade-current.json')), true);
    writeJson(path.join(stateRoot, 'diagnostics', 'failed-upgrade.json'), { runId: 'failed-upgrade' });

    pendingManifest.stateRestoreStarted = true;
    writeJson(pendingManifestPath, pendingManifest);
    fs.writeFileSync(stateConfigPath, configBeforeUpgrade);

    result = invokePowerShell('tools/Restore-HostManagementUpgrade.ps1', [
      '-HostToolsRoot', hostToolsRoot,
      '-ConsoleAlreadyStopped',
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(fs.readFileSync(stateConfigPath), configBeforeUpgrade);
    assert.deepEqual(fs.readFileSync(schemaPath), schemaBeforeUpgrade);
    assert.deepEqual(fs.readFileSync(path.join(stateRoot, 'config', 'software-catalog.json')), outsideStateBefore.get(softwarePath));
    for (const [file, content] of outsideStateBefore) assert.deepEqual(fs.readFileSync(file), content, `${path.relative(stateRoot, file)} must survive rollback`);
    assert.deepEqual(fs.readFileSync(path.join(appRoot, 'installation-manifest.json')), priorAppManifest);
    assert.deepEqual(JSON.parse(fs.readFileSync(diagnosticsPath, 'utf8')), { runId: 'prior-diagnostic' });
    assert.equal(fs.existsSync(path.join(stateRoot, 'diagnostics', 'failed-upgrade.json')), false);
    assert.equal(fs.existsSync(path.join(hostToolsRoot, 'upgrade-current.json')), false);

    result = invokePowerShell('tools/Restore-HostManagementUpgrade.ps1', [
      '-HostToolsRoot', hostToolsRoot,
      '-TransactionPath', pendingTransaction,
      '-ConsoleAlreadyStopped',
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr, 'repeating recovery after rollback must be idempotent');

    const transactionCount = upgradeDirectories(hostToolsRoot).length;
    writeJson(schemaPath, { schemaVersion: 99, appVersion: 'future' });
    result = installRelease(appRoot, stateRoot);
    assert.notEqual(result.status, 0, 'unsupported State schema must stop installation');
    assert.match(result.stderr, /Unsupported HostTools State schema version 99/i);
    assert.equal(upgradeDirectories(hostToolsRoot).length, transactionCount, 'schema rejection must happen before a transaction or State snapshot is created');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manual State snapshot supports WhatIf, structural inventory, and legacy restore', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-state-backup-test-'));
  const hostToolsRoot = path.join(root, 'HostTools');
  const stateRoot = path.join(hostToolsRoot, 'State');
  const backupRoot = path.join(root, 'ExternalBackups');
  const backupPath = path.join(backupRoot, 'HostTools-State-test');
  try {
    writeJson(path.join(stateRoot, 'config', 'osdcloud-console.json'), { setup: true });
    writeJson(path.join(stateRoot, 'state-schema.json'), { schemaVersion: 1 });
    writeJson(path.join(stateRoot, 'config', 'os-download-sources.json'), { images: [] });
    writeJson(path.join(stateRoot, 'config', 'os-image-catalog.json'), { images: [] });
    writeJson(path.join(stateRoot, 'config', 'software-catalog.json'), { software: [] });
    writeJson(path.join(stateRoot, 'config', 'scripts-catalog.json'), { scripts: [] });
    writeJson(path.join(stateRoot, 'config', 'osdcloud-secrets.json'), { windowsPassword: 'test-only' });
    fs.mkdirSync(path.join(stateRoot, 'lab'), { recursive: true });
    fs.writeFileSync(path.join(stateRoot, 'lab', 'payload.bin'), Buffer.alloc(1024 * 1024, 0x33));

    let result = invokePowerShell('tools/Backup-HostManagementState.ps1', [
      '-StateRoot', stateRoot,
      '-Destination', backupPath,
      '-WhatIf',
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(backupPath), false, 'WhatIf must not create the snapshot');
    assert.equal(fs.existsSync(`${backupPath}.manifest.json`), false);

    result = invokePowerShell('tools/Backup-HostManagementState.ps1', [
      '-StateRoot', stateRoot,
      '-Destination', backupPath,
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(`${backupPath}.manifest.json`), true);
    fs.cpSync(backupPath, path.join(backupRoot, 'HostTools-State-duplicate'), { recursive: true });

    result = invokePowerShell('tools/Get-HostManagementStateBackupInventory.ps1', [
      '-BackupRoot', backupRoot,
      '-AsJson',
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const inventory = JSON.parse(result.stdout);
    assert.equal(inventory.length, 2);
    const verifiedSnapshot = inventory.find((entry) => entry.name === 'HostTools-State-test');
    assert.equal(verifiedSnapshot.fileCount, 8);
    assert.equal(verifiedSnapshot.integrity, 'inventory-manifest-matches');
    assert.equal(verifiedSnapshot.completeness, 'current-required-files-present');
    assert.equal(inventory.every((entry) => entry.duplicateCandidate), true);

    writeJson(path.join(stateRoot, 'config', 'osdcloud-console.json'), { changedAfterSnapshot: true });
    result = invokePowerShell('tools/Restore-HostManagementState.ps1', [
      '-BackupPath', backupPath,
      '-StateRoot', stateRoot,
      '-Force',
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stateRoot, 'config', 'osdcloud-console.json'), 'utf8')), { setup: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stateRoot, 'config', 'osdcloud-secrets.json'), 'utf8')), { windowsPassword: 'test-only' });
    assert.equal(fs.statSync(path.join(stateRoot, 'lab', 'payload.bin')).size, 1024 * 1024);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Development fixture loading is explicit and selects a fixture profile and image', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-development-seed-test-'));
  const appRoot = path.join(root, 'HostTools', 'App');
  const stateRoot = path.join(root, 'HostTools', 'State');
  try {
    const result = invokePowerShell('tools/Install-HostManagementBundle.ps1', [
      '-SourceRoot', repoRoot,
      '-AppRoot', appRoot,
      '-StateRoot', stateRoot,
      '-Channel', 'Development',
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path.join(appRoot, 'fixtures', 'development')), true);
    assert.equal(fs.existsSync(path.join(appRoot, 'tools', 'Seed-DevelopmentFixture.ps1')), true);

    const seed = invokePowerShell('tools/Seed-DevelopmentFixture.ps1', [
      '-SourceRoot', appRoot,
      '-StateRoot', stateRoot,
      '-ActiveProfileId', 'IZVZO7PU',
    ]);
    assert.equal(seed.status, 0, seed.stdout + seed.stderr);
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

test('upgrade source declares scoped State and App transaction guards', () => {
  const installer = fs.readFileSync(path.join(repoRoot, 'tools', 'Install-HostManagementBundle.ps1'), 'utf8');
  const transaction = fs.readFileSync(path.join(repoRoot, 'tools', 'lib', 'HostManagementUpgrade.ps1'), 'utf8');
  const reload = fs.readFileSync(path.join(repoRoot, 'tools', 'Reload-Console.ps1'), 'utf8');
  const recovery = fs.readFileSync(path.join(repoRoot, 'tools', 'Restore-HostManagementUpgrade.ps1'), 'utf8');
  assert.ok(installer.lastIndexOf('Start-HostToolsUpgradeCutover') < installer.lastIndexOf('Invoke-StateMigration -Path'), 'State migration must follow the staged App cutover');
  assert.match(installer, /Copy-FilteredDirectoryTree -Source \(Join-Path \$sourceRootFull \$relativeDirectory\) -Destination \(Join-Path \$stageRoot \$relativeDirectory\)/);
  assert.match(installer, /-PrepareDependencies/);
  assert.match(installer, /-RunSmoke/);
  assert.match(transaction, /HostToolsUpgradeStateFiles/);
  assert.match(transaction, /Assert-HostToolsUpgradeStateMutationAllowed/);
  assert.match(transaction, /state-before\\diagnostics/);
  assert.match(transaction, /Wait-HostToolsUpgradeReady/);
  assert.match(recovery, /Restore-HostToolsUpgradeFromPointer/);
  assert.match(reload, /Restore-HostManagementUpgrade\.ps1/);
  assert.match(reload, /Complete-HostManagementUpgrade\.ps1/);
  assert.doesNotMatch(installer, /Backup-StateRoot|Remove-Item -LiteralPath \$safeAppRoot/);
  assert.doesNotMatch(installer, /&\s+(?:powershell\.exe\s+)?[^\r\n]*Seed-DevelopmentFixture\.ps1(?:\s|$)/, 'Release installer must not call Development seed implicitly');
  assert.ok(installer.includes('tools\\osdcloud-console\\web'));
  assert.match(fs.readFileSync(path.join(repoRoot, 'tools', 'Verify-HostToolsBundle.ps1'), 'utf8'), /tools\\\\osdcloud-console\\\\web/);
  assert.match(fs.readFileSync(path.join(repoRoot, 'tools', 'Setup-DeploymentServer.ps1'), 'utf8'), /SeedDevelopmentFixture/);
});
