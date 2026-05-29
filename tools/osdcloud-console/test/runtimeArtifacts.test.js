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

function createSetupSourceFixture(root) {
  fs.mkdirSync(path.join(root, 'tools', 'osdcloud-console', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config', 'deployment-profiles'), { recursive: true });
  fs.mkdirSync(path.join(root, 'osdcloud-assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Softwares'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: { web: 'node tools/osdcloud-console/src/webServer.js' },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n', 'utf8');
  fs.copyFileSync(
    path.join(process.cwd(), 'tools', 'Setup-DeploymentServer.ps1'),
    path.join(root, 'tools', 'Setup-DeploymentServer.ps1'),
  );
  fs.copyFileSync(
    path.join(process.cwd(), 'tools', 'Install-HostManagementBundle.ps1'),
    path.join(root, 'tools', 'Install-HostManagementBundle.ps1'),
  );
  fs.copyFileSync(
    path.join(process.cwd(), 'tools', 'Start-InstalledWebConsole.ps1'),
    path.join(root, 'tools', 'Start-InstalledWebConsole.ps1'),
  );
  fs.writeFileSync(path.join(root, 'tools', 'osdcloud-console', 'src', 'webServer.js'), 'export {};\n', 'utf8');
  fs.writeFileSync(path.join(root, 'Softwares', 'Install-Apps.ps1'), "Write-Host 'fixture'\n", 'utf8');
  fs.writeFileSync(path.join(root, 'Setup-DeploymentServer.cmd'), '@echo off\r\n', 'utf8');
  fs.writeFileSync(path.join(root, 'Deploy-DeploymentServer.cmd'), '@echo off\r\n', 'utf8');
  writeJson(path.join(root, 'config', 'osdcloud-console.json'), {
    adapter: { interfaceAlias: 'LAN', serverIp: '10.10.10.1', prefixLength: 24 },
    dhcp: {
      listenIp: '10.10.10.1',
      leaseStartIp: '10.10.10.200',
      leaseEndIp: '10.10.10.250',
      subnetMask: '255.255.255.0',
      router: '10.10.10.1',
      bootFile: 'ipxeboot/x86_64-sb/snponly.efi',
      ipxeBootUrl: 'http://10.10.10.1/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\OSDCloud\\PXE-TFTP' },
    http: { root: 'C:\\OSDCloud\\PXE-HttpRoot', host: '10.10.10.1', statusRoot: 'C:\\OSDCloud\\PXE-HttpRoot\\status' },
    paths: { expectedHttpFiles: ['osdcloud\\boot.ipxe'] },
    smb: { share: '\\\\10.10.10.1\\OSDCloudiPXE' },
    deploymentProfiles: { activeProfile: 'default' },
    web: { host: '127.0.0.1', port: 8080 },
  });
  writeJson(path.join(root, 'config', 'os-image-catalog.json'), { images: [] });
  writeJson(path.join(root, 'config', 'os-download-sources.json'), { allowedHosts: [], images: [] });
  writeJson(path.join(root, 'config', 'software-catalog.json'), { software: [] });
  writeJson(path.join(root, 'config', 'scripts-catalog.json'), { scripts: [] });
  writeJson(path.join(root, 'config', 'deployment-profiles', 'default.json'), {
    id: 'default',
    name: 'Default',
    software: [],
  });
  spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
}

test('runtime artifact catalog validates download recipes and ignores software rows', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-artifacts-'));
  try {
    const catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [
        {
          id: 'boot-wim',
          kind: 'winpe',
          sourceType: 'generated-winpe',
          prepareGroup: 'winpe-workspace',
          prepareReason: 'Builds test WinPE image',
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
    assert.equal(catalog.artifacts.length, 2);
    assert.equal(catalog.artifacts[0].prepareGroup, 'winpe-workspace');
    assert.equal(catalog.artifacts[0].prepareReason, 'Builds test WinPE image');
    assert.deepEqual(catalog.artifacts[0].dependencyIds, []);
    assert.deepEqual(catalog.checkOrder, ['boot-wim', 'optional-en-us']);
    assert.deepEqual(planRuntimeArtifacts(catalog).map((artifact) => artifact.id), ['boot-wim']);
    assert.deepEqual(
      planRuntimeArtifacts(catalog, { includeOptional: true }).map((artifact) => artifact.id),
      ['boot-wim', 'optional-en-us'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime artifact catalog accepts repo-managed artifacts with sourcePath', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-repo-file-'));
  try {
    const catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [{
        id: 'ipxe-snponly-efi',
        sourceType: 'repo-file',
        sourcePath: 'osdcloud-assets\\OSDCloud\\PXE-TFTP\\ipxeboot\\x86_64-sb\\snponly.efi',
        target: 'PXE-TFTP\\ipxeboot\\x86_64-sb\\snponly.efi',
        length: 288256,
        sha256: 'A'.repeat(64),
      }],
    });

    const catalog = loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath });
    assert.equal(catalog.artifacts.length, 1);
    assert.equal(catalog.artifacts[0].sourceType, 'repo-file');
    assert.equal(catalog.artifacts[0].sourcePath, 'osdcloud-assets\\OSDCloud\\PXE-TFTP\\ipxeboot\\x86_64-sb\\snponly.efi');
    assert.deepEqual(planRuntimeArtifacts(catalog).map((artifact) => artifact.action), ['repo-file']);
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

    catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [{
        id: 'missing-source-path',
        sourceType: 'repo-file',
        target: 'PXE-TFTP\\ipxeboot\\x86_64-sb\\snponly.efi',
        length: 1,
        sha256: 'A'.repeat(64),
      }],
    });
    assert.throws(
      () => loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath }),
      /sourcePath is required/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime artifact catalog allows generated WinPE without fixed size or hash', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-generated-winpe-'));
  try {
    const catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [{
        id: 'winpe-boot-wim',
        sourceType: 'generated-winpe',
        targets: [
          'Media\\sources\\boot.wim',
          'PXE-HttpRoot\\osdcloud\\boot.wim',
        ],
      }],
    });
    const catalog = loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath });
    assert.equal(catalog.artifacts[0].length, null);
    assert.equal(catalog.artifacts[0].sha256, '');

    const liveRoot = path.join(root, 'OSDCloud');
    fs.mkdirSync(path.join(liveRoot, 'Media', 'sources'), { recursive: true });
    fs.mkdirSync(path.join(liveRoot, 'PXE-HttpRoot', 'osdcloud'), { recursive: true });
    fs.writeFileSync(path.join(liveRoot, 'Media', 'sources', 'boot.wim'), 'host-generated boot image');
    fs.writeFileSync(path.join(liveRoot, 'PXE-HttpRoot', 'osdcloud', 'boot.wim'), 'endpoint-specific boot image');
    const readiness = getRuntimeReadiness(
      { paths: { repoRoot: root }, runtimeArtifacts: { liveRoot } },
      { catalogPath },
    );
    assert.equal(readiness.ready, true);
    assert.equal(readiness.missingCount, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime artifact catalog validates dependency references and cycles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-artifacts-deps-invalid-'));
  try {
    let catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [{
        id: 'child',
        sourceType: 'generated',
        dependsOn: ['missing-parent'],
        target: 'child.bin',
        length: 1,
        sha256: 'A'.repeat(64),
      }],
    });
    assert.throws(
      () => loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath }),
      /depends on unknown artifact: missing-parent/,
    );

    catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [
        {
          id: 'artifact-a',
          sourceType: 'generated',
          dependsOn: ['artifact-b'],
          target: 'a.bin',
          length: 1,
          sha256: 'A'.repeat(64),
        },
        {
          id: 'artifact-b',
          sourceType: 'generated',
          dependsOn: ['artifact-a'],
          target: 'b.bin',
          length: 1,
          sha256: 'B'.repeat(64),
        },
      ],
    });
    assert.throws(
      () => loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath }),
      /Circular runtime artifact dependency: artifact-a -> artifact-b -> artifact-a/,
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

test('runtime readiness reports dependency order and blocked downstream artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-runtime-readiness-deps-'));
  try {
    const liveRoot = path.join(root, 'OSDCloud');
    fs.mkdirSync(liveRoot, { recursive: true });
    fs.writeFileSync(path.join(liveRoot, 'published.bin'), 'abc', 'utf8');
    const catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [
        {
          id: 'winpe-boot-wim',
          name: 'WinPE boot image',
          kind: 'winpe',
          sourceType: 'generated-winpe',
          prepareGroup: 'winpe-workspace',
          prepareReason: 'Builds test WinPE image',
          target: 'boot.wim',
          length: 10,
          sha256: 'A'.repeat(64),
        },
        {
          id: 'published-boot-file',
          name: 'Published boot file',
          kind: 'bootBinary',
          sourceType: 'generated',
          dependsOn: ['winpe-boot-wim'],
          prepareGroup: 'winpe-workspace',
          prepareReason: 'Published from generated workspace',
          target: 'published.bin',
          length: 3,
          sha256: 'B'.repeat(64),
        },
      ],
    });

    const readiness = getRuntimeReadiness(
      { paths: { repoRoot: root }, runtimeArtifacts: { liveRoot } },
      { catalogPath },
    );
    assert.deepEqual(readiness.checkOrder, ['winpe-boot-wim', 'published-boot-file']);
    assert.equal(readiness.ready, false);
    assert.equal(readiness.missingCount, 2);
    const winpe = readiness.artifacts.find((artifact) => artifact.id === 'winpe-boot-wim');
    const published = readiness.artifacts.find((artifact) => artifact.id === 'published-boot-file');
    assert.equal(winpe.status, 'blocked');
    assert.deepEqual(winpe.dependents, ['published-boot-file']);
    assert.equal(published.status, 'blocked-by-dependency');
    assert.deepEqual(published.dependencyIds, ['winpe-boot-wim']);
    assert.deepEqual(published.blockedBy, [{ id: 'winpe-boot-wim', name: 'WinPE boot image', status: 'blocked' }]);
    assert.equal(published.targets[0].ok, true);
    assert.equal(published.targets[0].reason, 'present');
    assert.deepEqual(
      readiness.missing.find((artifact) => artifact.id === 'published-boot-file').blockedBy,
      [{ id: 'winpe-boot-wim', name: 'WinPE boot image', status: 'blocked' }],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setup wizard stays lightweight and leaves runtime preparation to Web', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Setup-DeploymentServer.ps1'), 'utf8');
  assert.match(script, /npm' -ArgumentList @\('install'\)/);
  assert.match(script, /npm' -ArgumentList @\('run', 'smoke'\)/);
  assert.match(script, /Install-HostManagementBundle\.ps1/);
  assert.match(script, /\[string\] \$AppRoot = 'C:\\OSDCloud\\HostTools\\App'/);
  assert.match(script, /\[string\] \$StateRoot = 'C:\\OSDCloud\\HostTools\\State'/);
  assert.match(script, /function Ensure-NodeAndNpm/);
  assert.match(script, /function Add-NodeInstallPaths/);
  assert.match(script, /function Test-NodeAndNpmAvailable/);
  assert.match(script, /OpenJS\.NodeJS\.LTS/);
  assert.match(script, /wingetExitCode/);
  assert.match(script, /node\/npm are available now\. Continuing setup/);
  assert.match(script, /function Test-IsAdministrator/);
  assert.match(script, /Start-Process -FilePath 'powershell\.exe'/);
  assert.match(script, /'RunAs'/);
  assert.match(script, /administrator rights\./i);
  assert.match(script, /\[string\] \$WebHost/);
  assert.match(script, /function Select-WebServiceHost/);
  assert.match(script, /OSDCLOUD_CONSOLE_CONFIG/);
  assert.match(script, /`\$env:OSDCLOUD_CONSOLE_CONFIG/);
  assert.match(script, /HostTools\\State/);
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

test('setup seeds installed host bundle state and writes the Web local overlay', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-setup-install-'));
  try {
    createSetupSourceFixture(root);
    const appRoot = path.join(root, 'HostTools', 'App');
    const stateRoot = path.join(root, 'HostTools', 'State');
    const localConfig = path.join(stateRoot, 'config', 'osdcloud-console.local.json');
    const stateConfig = path.join(stateRoot, 'config', 'osdcloud-console.json');
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'tools', 'Setup-DeploymentServer.ps1'),
      '-NoLaunch',
      '-SkipNpmInstall',
      '-SkipSmoke',
      '-WebHost',
      '127.0.0.1',
      '-AppRoot',
      appRoot,
      '-StateRoot',
      stateRoot,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Installed host management bundle/);
    assert.match(result.stdout, /Setup installed the host management bundle under/);
    assert.match(result.stdout, /Saved Web console settings:/);
    assert.deepEqual(JSON.parse(fs.readFileSync(localConfig, 'utf8')), { web: { host: '127.0.0.1', port: 8080 } });
    const seededConfig = JSON.parse(fs.readFileSync(stateConfig, 'utf8'));
    assert.equal(seededConfig.paths.appRoot, appRoot);
    assert.equal(seededConfig.paths.stateRoot, stateRoot);
    assert.equal(fs.existsSync(path.join(appRoot, 'tools', 'Start-InstalledWebConsole.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'HostTools', 'Open-WebConsole.cmd')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setup WebHost writes only web host and port to local overlay', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-setup-webhost-'));
  try {
    createSetupSourceFixture(root);
    const appRoot = path.join(root, 'HostTools', 'App');
    const stateRoot = path.join(root, 'HostTools', 'State');
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
      '-AppRoot',
      appRoot,
      '-StateRoot',
      stateRoot,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const localConfig = JSON.parse(fs.readFileSync(path.join(stateRoot, 'config', 'osdcloud-console.local.json'), 'utf8'));
    assert.deepEqual(localConfig, { web: { host: '127.0.0.1', port: 8080 } });
    assert.equal(fs.existsSync(path.join(stateRoot, 'config', 'osdcloud-secrets.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setup rejects a WebHost that is not a local enabled IPv4 address', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-setup-webhost-invalid-'));
  try {
    createSetupSourceFixture(root);
    const appRoot = path.join(root, 'HostTools', 'App');
    const stateRoot = path.join(root, 'HostTools', 'State');
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'tools', 'Setup-DeploymentServer.ps1'),
      '-NoLaunch',
      '-SkipNpmInstall',
      '-SkipSmoke',
      '-AppRoot',
      appRoot,
      '-StateRoot',
      stateRoot,
      '-WebHost',
      '203.0.113.10',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /not assigned to an enabled local IPv4 adapter/);
    assert.equal(fs.existsSync(path.join(stateRoot, 'config', 'osdcloud-console.local.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime restore uses the base Web config path while preserving local overlay merge', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Restore-DeploymentArtifacts.ps1'), 'utf8');
  const windows = fs.readFileSync(path.join(process.cwd(), 'tools', 'osdcloud-console', 'src', 'windows.js'), 'utf8');

  assert.match(script, /\[string\] \$ConfigPath/);
  assert.match(script, /--config[\s\S]*\$ConfigPath/);
  assert.doesNotMatch(script, /\$catalog\.software/);
  assert.match(windows, /function resolveBaseConfigPath/);
  assert.match(windows, /const baseConfigPath = resolveBaseConfigPath\(config, repoRoot\)/);
  assert.match(windows, /'-ConfigPath'[\s\S]*baseConfigPath/);
  assert.doesNotMatch(windows, /prepareRuntimeArtifacts[\s\S]*const effectiveConfigPath = config\.__savePath/);
});

test('runtime restore initializes UTF-8 console output before execution', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Restore-DeploymentArtifacts.ps1'), 'utf8');
  const utf8Index = script.indexOf('$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)');
  const errorPreferenceIndex = script.indexOf("$ErrorActionPreference = 'Stop'");

  assert.ok(utf8Index > 0);
  assert.ok(errorPreferenceIndex > utf8Index);
  assert.match(script, /\[Console\]::OutputEncoding = \$Utf8NoBom/);
  assert.match(script, /\[Console\]::InputEncoding = \$Utf8NoBom/);
  assert.match(script, /\$OutputEncoding = \$Utf8NoBom/);
});

test('host PowerShell entrypoints initialize UTF-8 console output', () => {
  for (const relativePath of [
    'tools/Setup-DeploymentServer.ps1',
    'tools/Initialize-DeploymentServer.ps1',
    'tools/Set-OsdCloudIpxeEndpoint.ps1',
    'tools/Set-IpxePhysicalNic.ps1',
    'tools/Sync-OsdCloudAssets.ps1',
    'tools/Export-DeploymentServerBundle.ps1',
    'tools/Install-HostManagementBundle.ps1',
    'tools/Invoke-IpxeTimingRun.ps1',
    'tools/Restore-DeploymentArtifacts.ps1',
    'tools/Start-InstalledWebConsole.ps1',
  ]) {
    const script = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    assert.match(script, /\$Utf8NoBom = \[System\.Text\.UTF8Encoding\]::new\(\$false\)/, relativePath);
    assert.match(script, /\[Console\]::OutputEncoding = \$Utf8NoBom/, relativePath);
    assert.match(script, /\[Console\]::InputEncoding = \$Utf8NoBom/, relativePath);
    assert.match(script, /\$OutputEncoding = \$Utf8NoBom/, relativePath);
  }
});

test('installed Web console launcher escapes environment assignment and reads local overlay host settings', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Start-InstalledWebConsole.ps1'), 'utf8');
  assert.match(script, /`\$env:OSDCLOUD_CONSOLE_CONFIG/);
  assert.match(script, /State\\config\\osdcloud-console\.local\.json/);
  assert.match(script, /\$overlay\.web/);
});

test('checked-in runtime artifact catalog is valid', () => {
  const catalog = loadRuntimeArtifactCatalog();
  assert.ok(catalog.artifacts.length >= 1);
  assert.equal(catalog.artifacts.some((artifact) => artifact.kind === 'osImage'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(catalog.raw, 'software'), false);
  const winpe = catalog.artifacts.find((artifact) => artifact.id === 'winpe-boot-wim');
  assert.equal(winpe.prepareGroup, 'winpe-workspace');
  assert.ok(catalog.artifacts.some((artifact) => artifact.dependencyIds.includes('winpe-boot-wim')));
  assert.equal(catalog.artifacts.some((artifact) => artifact.kind === 'software'), false);
  assert.equal(catalog.artifacts.some((artifact) => artifact.prepareGroup === 'software-payloads'), false);
});

test('runtime restore creates SMB account password without Security module cmdlets', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Restore-DeploymentArtifacts.ps1'), 'utf8');
  assert.match(script, /function New-PlainTextSecureString/);
  assert.match(script, /\[System\.Security\.SecureString\]::new\(\)/);
  assert.match(script, /New-PlainTextSecureString -PlainText \$password/);
  assert.doesNotMatch(script, /ConvertTo-SecureString \$password/);
});

test('runtime restore sets SMB folder ACLs without Security module cmdlets', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Restore-DeploymentArtifacts.ps1'), 'utf8');
  assert.doesNotMatch(script, /\bGet-Acl\b/);
  assert.doesNotMatch(script, /\bSet-Acl\b/);
  assert.match(script, /\[System\.IO\.DirectoryInfo\]::new\(\$Path\)/);
  assert.match(script, /\$directory\.GetAccessControl\(\)/);
  assert.match(script, /\$directory\.SetAccessControl\(\$acl\)/);
});

test('restore bootstrap auto-installs ADK prerequisites with signed Microsoft installers', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Restore-DeploymentArtifacts.ps1'), 'utf8');
  assert.match(script, /linkid=2289980/);
  assert.match(script, /linkid=2289981/);
  assert.match(script, /--silent --show-error --location --fail --retry 3/);
  assert.match(script, /curl\.exe failed with exit code/);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /WinVerifyTrust/);
  assert.match(script, /validated with WinVerifyTrust fallback after Get-AuthenticodeSignature could not complete/);
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
  assert.match(script, /Optional WinPE PowerShell Gallery module injection skipped/);
  assert.match(script, /Media\\sources\\boot\.wim/);
  assert.match(script, /workspace build did not produce required boot\.wim/);
});

test('endpoint sync restores missing live endpoint templates from repo mirror', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  assert.match(script, /Sync-RequiredEndpointFilesFromRepo/);
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

test('endpoint sync injects Startnet boot chain into rebuilt WinPE', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  const startnet = fs.readFileSync(
    path.join(process.cwd(), 'osdcloud-assets', 'OSDCloud', 'WinPE', 'Windows', 'System32', 'Startnet.cmd'),
    'utf8',
  );

  assert.match(script, /WinPE\\Windows\\System32\\Startnet\.cmd/);
  assert.match(script, /Windows\\System32\\Startnet\.cmd/);
  assert.match(startnet, /PowerShell -NoL -NoP -ExecutionPolicy Bypass -File X:\\OSDCloud\\Start-OSDCloud-iPXE\.ps1/);
});

test('WinPE deployment script uses a lab-scoped selected OS manifest helper', () => {
  const script = fs.readFileSync(
    path.join(process.cwd(), 'osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Start-OSDCloud-iPXE.ps1'),
    'utf8',
  );

  assert.match(script, /function Get-LabSelectedOsManifest/);
  assert.match(script, /\$SelectedOs = Get-LabSelectedOsManifest -OsRoot \$osRoot/);
  assert.match(script, /selected-os\.json did not produce a usable OS selection/);
  assert.doesNotMatch(script, /function Get-SelectedOsManifest/);
});

test('endpoint sync injects OSD modules into rebuilt WinPE', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');

  assert.match(script, /function Copy-WinPePowerShellModule/);
  assert.match(script, /Program Files\\WindowsPowerShell\\Modules\\\$Name/);
  assert.match(script, /Copy-WinPePowerShellModule -Name 'OSD' -MountDir \$mountDir/);
  assert.match(script, /Copy-WinPePowerShellModule -Name 'OSDCloud' -MountDir \$mountDir/);
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
