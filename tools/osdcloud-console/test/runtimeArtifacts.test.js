import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getRuntimeReadiness,
  loadRuntimeArtifactCatalog,
  planRuntimeArtifacts,
  sha256File,
  verifyArtifactFile,
} from '../src/runtimeArtifacts.js';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeCatalog(root, body) {
  const catalogPath = path.join(root, 'runtime-artifacts.json');
  writeJson(catalogPath, body);
  return catalogPath;
}

test('runtime artifact catalog validates download recipes and plans required artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-artifacts-'));
  try {
    const catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [
        {
          id: 'boot-wim',
          kind: 'winpe',
          sourceType: 'generated-winpe',
          target: 'Media\\sources\\boot.wim',
          length: 12,
          sha256: 'A'.repeat(64),
        },
        {
          id: 'optional-en-us',
          kind: 'osImage',
          sourceType: 'download',
          required: false,
          url: 'https://dl.delivery.mp.microsoft.com/install.esd',
          target: 'Media\\OSDCloud\\OS\\en-us.esd',
          length: 10,
          sha256: 'B'.repeat(64),
        },
      ],
      software: [
        {
          id: '7zip',
          sourceType: 'download',
          url: 'https://www.7-zip.org/a/7z2601-x64.msi',
          targets: [
            'Softwares\\7zip\\7z2601-x64.msi',
            'Media\\OSDCloud\\Apps\\7zip\\7z2601-x64.msi',
          ],
          length: 9,
          sha256: 'C'.repeat(64),
        },
      ],
    });

    const catalog = loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath });
    assert.equal(catalog.artifacts.length, 3);
    assert.deepEqual(planRuntimeArtifacts(catalog).map((artifact) => artifact.id), ['boot-wim', '7zip']);
    assert.deepEqual(
      planRuntimeArtifacts(catalog, { includeOptional: true }).map((artifact) => artifact.id),
      ['boot-wim', 'optional-en-us', '7zip'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime artifact catalog rejects missing URLs and unsafe targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-artifacts-invalid-'));
  try {
    let catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [{
        id: 'bad-download',
        sourceType: 'download',
        target: 'file.bin',
        length: 1,
        sha256: 'A'.repeat(64),
      }],
    });
    assert.throws(
      () => loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath }),
      /url is required/,
    );

    catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [{
        id: 'bad-target',
        sourceType: 'generated',
        target: '..\\secrets.json',
        length: 1,
        sha256: 'A'.repeat(64),
      }],
    });
    assert.throws(
      () => loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath }),
      /escapes root/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime artifact verification catches size and hash mismatch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-artifacts-verify-'));
  try {
    const filePath = path.join(root, 'artifact.bin');
    fs.writeFileSync(filePath, 'expected bytes', 'utf8');
    const valid = {
      length: fs.statSync(filePath).size,
      sha256: sha256File(filePath),
    };
    assert.equal(verifyArtifactFile(filePath, valid).ok, true);
    assert.equal(verifyArtifactFile(filePath, { ...valid, length: valid.length + 1 }).reason, 'size-mismatch');
    assert.equal(verifyArtifactFile(filePath, { ...valid, sha256: 'D'.repeat(64) }).reason, 'hash-mismatch');
    assert.equal(verifyArtifactFile(path.join(root, 'missing.bin'), valid).reason, 'missing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime readiness reports missing required artifacts without hashing large files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-readiness-'));
  try {
    const catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [{
        id: 'required-boot',
        sourceType: 'download',
        url: 'https://example.test/boot.wim',
        target: 'PXE-HttpRoot\\osdcloud\\boot.wim',
        length: 1024,
        sha256: 'A'.repeat(64),
      }],
    });
    const readiness = getRuntimeReadiness(
      { paths: { repoRoot: root }, runtimeArtifacts: { liveRoot: path.join(root, 'OSDCloud') } },
      { catalogPath },
    );
    assert.equal(readiness.ready, false);
    assert.equal(readiness.missingCount, 1);
    assert.equal(readiness.missing[0].id, 'required-boot');
    assert.equal(readiness.missing[0].targets[0].reason, 'missing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setup wizard stays lightweight and leaves runtime preparation to Web', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Setup-DeploymentServer.ps1'), 'utf8');
  assert.match(script, /npm' -ArgumentList @\('install'\)/);
  assert.match(script, /npm' -ArgumentList @\('run', 'smoke'\)/);
  assert.match(script, /function Ensure-NodeAndNpm/);
  assert.match(script, /function Add-NodeInstallPaths/);
  assert.match(script, /function Test-NodeAndNpmAvailable/);
  assert.match(script, /OpenJS\.NodeJS\.LTS/);
  assert.match(script, /wingetExitCode/);
  assert.match(script, /node\/npm are available now\. Continuing setup/);
  assert.match(script, /\[string\] \$WebHost/);
  assert.match(script, /function Select-WebServiceHost/);
  assert.match(script, /config\\osdcloud-console\.local\.json/);
  assert.match(script, /host = \$HostIp/);
  assert.match(script, /writing only the Web console local overlay/);
  assert.doesNotMatch(script, /OSDCLOUD_DAVIS_PASSWORD/);
  assert.doesNotMatch(script, /OSDCLOUD_PXEINSTALL_PASSWORD/);
  assert.doesNotMatch(script, /New-SmbShare/);
  assert.doesNotMatch(script, /New-LocalUser/);
  assert.doesNotMatch(script, /New-Item\s+-ItemType\s+Directory/);
  assert.doesNotMatch(script, /Restore-DeploymentArtifacts\.ps1/);
  assert.doesNotMatch(script, /Set-OsdCloudIpxeEndpoint\.ps1/);
  assert.doesNotMatch(script, /server:preflight/);
  assert.doesNotMatch(script, /Start-Pxe|Start-Dhcp|Start-Tftp|Start-Http/);
});

test('setup dry-run saves only the Web local overlay', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-setup-dryrun-'));
  try {
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), 'tools', 'Setup-DeploymentServer.ps1'),
      path.join(root, 'tools', 'Setup-DeploymentServer.ps1'),
    );
    fs.copyFileSync(
      path.join(process.cwd(), 'config', 'osdcloud-console.json'),
      path.join(root, 'config', 'osdcloud-console.json'),
    );
    const localConfig = path.join(root, 'config', 'osdcloud-console.local.json');
    const setupState = path.join(root, 'config', 'deployment-server-setup.local.json');
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'tools', 'Setup-DeploymentServer.ps1'),
      '-DryRun',
      '-NoLaunch',
      '-SkipNpmInstall',
      '-SkipSmoke',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Setup only prepares the Web console/);
    assert.match(result.stdout, /writing only the Web console local overlay/);
    assert.deepEqual(JSON.parse(fs.readFileSync(localConfig, 'utf8')), { web: { host: '127.0.0.1', port: 8080 } });
    assert.equal(fs.existsSync(setupState), false);
    assert.equal(fs.existsSync(path.join(root, 'config', 'osdcloud-secrets.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'C:\\OSDCloud')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setup WebHost writes only web host and port to local overlay', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-setup-webhost-'));
  try {
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), 'tools', 'Setup-DeploymentServer.ps1'),
      path.join(root, 'tools', 'Setup-DeploymentServer.ps1'),
    );
    fs.copyFileSync(
      path.join(process.cwd(), 'config', 'osdcloud-console.json'),
      path.join(root, 'config', 'osdcloud-console.json'),
    );
    spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'tools', 'Setup-DeploymentServer.ps1'),
      '-WebHost',
      '127.0.0.1',
      '-NoLaunch',
      '-SkipNpmInstall',
      '-SkipSmoke',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const localConfig = JSON.parse(fs.readFileSync(path.join(root, 'config', 'osdcloud-console.local.json'), 'utf8'));
    assert.deepEqual(localConfig, { web: { host: '127.0.0.1', port: 8080 } });
    assert.equal(fs.existsSync(path.join(root, 'config', 'osdcloud-secrets.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'C:\\OSDCloud')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setup rejects a WebHost that is not a local enabled IPv4 address', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-setup-webhost-invalid-'));
  try {
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), 'tools', 'Setup-DeploymentServer.ps1'),
      path.join(root, 'tools', 'Setup-DeploymentServer.ps1'),
    );
    fs.copyFileSync(
      path.join(process.cwd(), 'config', 'osdcloud-console.json'),
      path.join(root, 'config', 'osdcloud-console.json'),
    );
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'tools', 'Setup-DeploymentServer.ps1'),
      '-DryRun',
      '-NoLaunch',
      '-SkipNpmInstall',
      '-SkipSmoke',
      '-WebHost',
      '203.0.113.10',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /not assigned to an enabled local IPv4 adapter/);
    assert.equal(fs.existsSync(path.join(root, 'config', 'osdcloud-console.local.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime restore uses the base Web config path while preserving local overlay merge', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Restore-DeploymentArtifacts.ps1'), 'utf8');
  const windows = fs.readFileSync(path.join(process.cwd(), 'tools', 'osdcloud-console', 'src', 'windows.js'), 'utf8');

  assert.match(script, /\[string\] \$ConfigPath/);
  assert.match(script, /--config[\s\S]*\$ConfigPath/);
  assert.match(windows, /function resolveBaseConfigPath/);
  assert.match(windows, /const baseConfigPath = resolveBaseConfigPath\(config, repoRoot\)/);
  assert.match(windows, /'-ConfigPath'[\s\S]*baseConfigPath/);
  assert.doesNotMatch(windows, /prepareRuntimeArtifacts[\s\S]*const effectiveConfigPath = config\.__savePath/);
});

test('checked-in runtime artifact catalog is valid', () => {
  const catalog = loadRuntimeArtifactCatalog();
  assert.ok(catalog.artifacts.length >= 1);
  assert.equal(catalog.artifacts.some((artifact) => artifact.kind === 'osImage'), false);
  assert.ok(catalog.artifacts.some((artifact) => artifact.id === '7zip'));
});

test('restore bootstrap auto-installs ADK prerequisites with signed Microsoft installers', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Restore-DeploymentArtifacts.ps1'), 'utf8');
  assert.match(script, /linkid=2289980/);
  assert.match(script, /linkid=2289981/);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /WinVerifyTrust/);
  assert.match(script, /CreateFromSignedFile/);
  assert.match(script, /Get-Command -Name Get-FileHash/);
  assert.match(script, /System\.Security\.Cryptography\.SHA256/);
  assert.match(script, /OptionId\.DeploymentTools/);
  assert.match(script, /OptionId\.WindowsPreinstallationEnvironment/);
  assert.match(script, /NoAdkAutoInstall/);
});

test('restore bootstrap creates missing OSDCloud template before workspace build', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Restore-DeploymentArtifacts.ps1'), 'utf8');
  assert.match(script, /Ensure-OsdCloudTemplate/);
  assert.match(script, /Test-OsdCloudTemplateReady/);
  assert.match(script, /Set-OsdCloudTemplateGalleryFallback/);
  assert.match(script, /New-OSDCloudTemplate -Name 'default'/);
  assert.match(script, /Skipping WinPE PowerShell Gallery module injection/);
  assert.match(script, /Media\\sources\\boot\.wim/);
  assert.match(script, /workspace build did not produce required boot\.wim/);
});

test('endpoint sync restores missing live endpoint templates from repo mirror', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  assert.match(script, /Restore-RequiredEndpointFiles/);
  assert.match(script, /PXE-HttpRoot\\osdcloud\\boot\.ipxe/);
  assert.match(script, /Config\\Scripts\\SetupComplete\\SetupComplete\.ps1/);
  assert.match(script, /osdcloud-assets\\OSDCloud/);
});

test('endpoint sync restores missing source boot.wim from published HTTP copy', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  assert.match(script, /Restore-BootWimSourceIfMissing/);
  assert.match(script, /Restored missing source boot\.wim from published HTTP copy/);
  assert.match(script, /Published copy is also missing/);
});

test('endpoint sync injects progress reporter into rebuilt WinPE', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  assert.match(script, /WinPE\\OSDCloud\\Report-OSDCloudProgress\.ps1/);
  assert.match(script, /OSDCloud\\Report-OSDCloudProgress\.ps1/);
  assert.match(script, /Set-ProgressReporterEndpoint/);
});

test('deployment bootstrap refreshes endpoint runtime files after validation', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Initialize-DeploymentServer.ps1'), 'utf8');
  assert.match(script, /Repair-EndpointRuntimeIfMissing/);
  assert.match(script, /Media\\sources\\boot\.wim/);
  assert.match(script, /PXE-HttpRoot\\osdcloud\\boot\.wim/);
  assert.match(script, /Refreshing runtime files required for endpoint sync/);
});

test('deployment bootstrap prepares host SMB share from local secrets', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Initialize-DeploymentServer.ps1'), 'utf8');
  assert.match(script, /Ensure-DeploymentSmbShare/);
  assert.match(script, /OSDCLOUD_PXEINSTALL_PASSWORD/);
  assert.match(script, /New-LocalUser/);
  assert.match(script, /New-SmbShare/);
  assert.match(script, /Get-SmbShareAccess/);
  assert.match(script, /Grant-SmbShareAccess/);
  assert.match(script, /SkipHostShareSetup/);
});
