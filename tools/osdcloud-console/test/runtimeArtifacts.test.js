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

// Helpers shared by the tools/*.ps1 scripts now live in tools/lib/Common.ps1
// (dot-sourced by each script); assert their bodies there.
const commonPs1 = fs.readFileSync(path.join(process.cwd(), 'tools', 'lib', 'Common.ps1'), 'utf8');
const manualAssetNames = [
  'operator-flow.en.svg',
  'operator-flow.svg',
  'system-architecture.en.svg',
  'system-architecture.svg',
  'web-activity.png',
  'web-dashboard.png',
  'web-validation-evidence.png',
];

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
  fs.mkdirSync(path.join(root, 'docs', 'manual-assets'), { recursive: true });
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
  // Scripts dot-source tools/lib/Common.ps1; stage it alongside them.
  fs.mkdirSync(path.join(root, 'tools', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), 'tools', 'lib', 'Common.ps1'),
    path.join(root, 'tools', 'lib', 'Common.ps1'),
  );
  fs.writeFileSync(path.join(root, 'tools', 'osdcloud-console', 'src', 'webServer.js'), 'export {};\n', 'utf8');
  fs.writeFileSync(path.join(root, 'Softwares', 'Install-Apps.ps1'), "Write-Host 'fixture'\n", 'utf8');
  fs.writeFileSync(path.join(root, 'Softwares', 'Show-DeploymentProgress.ps1'), "Write-Host 'fixture viewer'\n", 'utf8');
  fs.writeFileSync(path.join(root, 'Setup-DeploymentServer.cmd'), '@echo off\r\n', 'utf8');
  fs.writeFileSync(path.join(root, 'Deploy-DeploymentServer.cmd'), '@echo off\r\n', 'utf8');
  fs.writeFileSync(path.join(root, 'docs', 'winception-operations-manual.html'), '<!doctype html><title>Manual</title>\n', 'utf8');
  for (const fileName of manualAssetNames) {
    fs.writeFileSync(path.join(root, 'docs', 'manual-assets', fileName), 'fixture\n', 'utf8');
  }
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

function createPowerShellModuleFixture(root) {
  const moduleRoot = path.join(root, 'powershell-modules');
  for (const moduleName of ['OSD', 'OSDCloud']) {
    const modulePath = path.join(moduleRoot, moduleName);
    fs.mkdirSync(modulePath, { recursive: true });
    fs.writeFileSync(path.join(modulePath, `${moduleName}.psm1`), "Write-Output 'fixture module'\n", 'utf8');
  }
  return moduleRoot;
}

function setupFixtureEnv(root) {
  const moduleRoot = createPowerShellModuleFixture(root);
  return {
    ...process.env,
    PSModulePath: [moduleRoot, process.env.PSModulePath].filter(Boolean).join(path.delimiter),
  };
}

function makeBloatedPath() {
  const basePath = process.env.Path ?? '';
  const fillerRoot = 'C:\\osdcloud-path-padding';
  const entries = [];
  for (let index = 0; index < 330; index += 1) {
    entries.push(path.win32.join(fillerRoot, `entry-${String(index).padStart(3, '0')}`));
  }
  return [...entries, basePath].filter(Boolean).join(path.delimiter);
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
  const reloadScript = fs.readFileSync(path.join(process.cwd(), 'tools', 'Reload-Console.ps1'), 'utf8');
  assert.match(script, /npm' -ArgumentList @\('install'\)/);
  assert.match(script, /npm' -ArgumentList @\('run', 'smoke'\)/);
  assert.match(script, /Install-HostManagementBundle\.ps1/);
  assert.match(script, /\[string\] \$AppRoot = 'C:\\OSDCloud\\HostTools\\App'/);
  assert.match(script, /\[string\] \$StateRoot = 'C:\\OSDCloud\\HostTools\\State'/);
  assert.match(script, /function Ensure-NodeAndNpm/);
  assert.match(script, /function Get-UniquePathEntries/);
  assert.match(script, /function Add-NodeInstallPaths/);
  assert.match(script, /function Test-NodeAndNpmAvailable/);
  assert.match(script, /OpenJS\.NodeJS\.LTS/);
  assert.match(script, /wingetExitCode/);
  assert.match(script, /node\/npm are available now\. Continuing setup/);
  assert.match(script, /\[switch\] \$NoPowerShellModuleAutoInstall/);
  assert.match(script, /function Ensure-HostPowerShellModules/);
  assert.match(script, /Install-PackageProvider -Name NuGet/);
  assert.match(script, /Set-PSRepository -Name PSGallery -InstallationPolicy Trusted/);
  assert.match(script, /Install-Module \$moduleName -Scope AllUsers -Force -AllowClobber/);
  assert.match(commonPs1, /function Test-IsAdministrator/);
  assert.match(script, /lib\\Common\.ps1/);
  assert.match(script, /Start-Process -FilePath 'powershell\.exe'/);
  assert.match(script, /'RunAs'/);
  assert.match(script, /administrator rights\./i);
  assert.match(script, /\[string\] \$WebHost/);
  assert.match(script, /function Select-WebServiceHost/);
  assert.match(script, /Using default Web service IP 127\.0\.0\.1/);
  assert.match(script, /OSDCLOUD_CONSOLE_CONFIG/);
  assert.match(script, /`\$env:OSDCLOUD_CONSOLE_CONFIG/);
  assert.match(script, /HostTools\\State/);
  assert.match(script, /host = \$HostIp/);
  assert.match(script, /writing only the Web console local overlay/);
  assert.doesNotMatch(script, /Read-Host/);
  assert.doesNotMatch(script, /OSDCLOUD_DAVIS_PASSWORD/);
  assert.doesNotMatch(script, /OSDCLOUD_PXEINSTALL_PASSWORD/);
  assert.doesNotMatch(script, /New-SmbShare/);
  assert.doesNotMatch(script, /New-LocalUser/);
  assert.doesNotMatch(script, /New-Item\s+-ItemType\s+Directory/);
  assert.doesNotMatch(script, /Restore-DeploymentArtifacts\.ps1/);
  assert.doesNotMatch(script, /Set-OsdCloudIpxeEndpoint\.ps1/);
  assert.doesNotMatch(script, /server:preflight/);
  assert.doesNotMatch(script, /Start-Pxe|Start-Dhcp|Start-Tftp|Start-Http/);
  assert.match(reloadScript, /docs\\winception-operations-manual\.html/);
  assert.match(reloadScript, /docs\\manual-assets/);
});

test('setup prerequisite refresh keeps a long inherited PATH within Windows limits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-setup-path-refresh-'));
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
      '-WebHost',
      '127.0.0.1',
      '-AppRoot',
      appRoot,
      '-StateRoot',
      stateRoot,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...setupFixtureEnv(root),
        Path: makeBloatedPath(),
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout + result.stderr, /Environment variable name or value is too long/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setup cmd passes arguments through to PowerShell script', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'Setup-DeploymentServer.cmd'), 'utf8');
  assert.match(script, /-File "%SCRIPT%" %\*/);
});

test('setup seeds installed host bundle state and writes the Web local overlay', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-setup-install-'));
  try {
    createSetupSourceFixture(root);
    writeJson(path.join(root, 'config', 'osdcloud-secrets.json'), { pxeinstallPassword: 'seeded-secret' });
    const appRoot = path.join(root, 'HostTools', 'App');
    const stateRoot = path.join(root, 'HostTools', 'State');
    const localConfig = path.join(stateRoot, 'config', 'osdcloud-console.local.json');
    const stateConfig = path.join(stateRoot, 'config', 'osdcloud-console.json');
    const stateSecrets = path.join(stateRoot, 'config', 'osdcloud-secrets.json');
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
      env: setupFixtureEnv(root),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Installed host management bundle/);
    assert.match(result.stdout, /Setup installed the host management bundle under/);
    assert.match(result.stdout, /Saved Web console settings:/);
    assert.deepEqual(JSON.parse(fs.readFileSync(localConfig, 'utf8')), { web: { host: '127.0.0.1', port: 8080 } });
    const seededConfig = JSON.parse(fs.readFileSync(stateConfig, 'utf8'));
    assert.equal(seededConfig.paths.appRoot, appRoot);
    assert.equal(seededConfig.paths.stateRoot, stateRoot);
    assert.equal(fs.existsSync(stateSecrets), false);
    assert.equal(fs.existsSync(path.join(appRoot, 'tools', 'Start-InstalledWebConsole.ps1')), true);
    assert.equal(fs.existsSync(path.join(appRoot, 'docs', 'winception-operations-manual.html')), true);
    assert.deepEqual(fs.readdirSync(path.join(appRoot, 'docs', 'manual-assets')).sort(), manualAssetNames.slice().sort());
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
      env: setupFixtureEnv(root),
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
      env: setupFixtureEnv(root),
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
  const windowsDir = path.join(process.cwd(), 'tools', 'osdcloud-console', 'src', 'windows');
  const windows = fs.readdirSync(windowsDir).filter((f) => f.endsWith('.js')).sort()
    .map((f) => fs.readFileSync(path.join(windowsDir, f), 'utf8')).join('\n');

  assert.match(script, /\[string\] \$ConfigPath/);
  assert.match(script, /InstalledStateConfigPath/);
  assert.match(script, /State\\config\\osdcloud-console\.json/);
  assert.match(script, /State\\config\\osdcloud-secrets\.json/);
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
  assert.match(commonPs1, /Get-Command -Name Get-FileHash/);
  assert.match(commonPs1, /System\.Security\.Cryptography\.SHA256/);
  assert.match(script, /lib\\Common\.ps1/);
  assert.match(script, /OptionId\.DeploymentTools/);
  assert.match(script, /OptionId\.WindowsPreinstallationEnvironment/);
  assert.match(script, /NoAdkAutoInstall/);
});

test('secure boot publish imports Security module by child PSHOME path before Authenticode check', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Publish-SecureBootTftp.ps1'), 'utf8');
  assert.match(script, /Import-Module \(Join-Path \$PSHOME 'Modules\\Microsoft\.PowerShell\.Security'\) -ErrorAction Stop/);
  assert.match(script, /Get-AuthenticodeSignature -LiteralPath \$env:OSDCLOUD_SIGCHECK_PATH/);
});

test('runtime restore requires both OSD modules before WinPE preparation', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Restore-DeploymentArtifacts.ps1'), 'utf8');

  assert.match(script, /foreach \(\$moduleName in @\('OSD', 'OSDCloud'\)\)/);
  assert.match(script, /Get-Module -ListAvailable -Name \$moduleName/);
  assert.match(script, /Install-Module \$moduleName -Scope AllUsers -Force -AllowClobber/);
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
  assert.match(script, /State\\config\\osdcloud-console\.json/);
  assert.match(script, /State\\config\\osdcloud-secrets\.json/);
});

test('endpoint sync restores missing source boot.wim from published HTTP copy', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  assert.match(script, /Restore-BootWimSourceIfMissing/);
  assert.match(script, /Restored missing source boot\.wim from published HTTP copy/);
  assert.match(script, /Published copy is also missing/);
});

test('endpoint sync writes a boot.wim sync marker after publishing', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  assert.match(script, /Write-BootWimSyncMarker/);
  assert.match(script, /publishedSha256/);
  assert.match(script, /syncedAtUtc/);
});

test('endpoint sync injects progress reporter into rebuilt WinPE', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  assert.match(script, /WinPE\\OSDCloud\\Report-OSDCloudProgress\.ps1/);
  assert.match(script, /OSDCloud\\Report-OSDCloudProgress\.ps1/);
  assert.match(script, /Set-ProgressReporterEndpoint/);
});

test('endpoint sync injects deployment Config scripts from the bundle, not the mutable live tree', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  const mountInjection = script.slice(script.indexOf('& dism /English /Mount-Wim'));

  // boot.wim injection sources the deployment scripts from the self-contained bundle copy.
  assert.match(mountInjection, /osdcloud-assets\\OSDCloud\\Config\\Scripts\\SetupComplete\\SetupComplete\.ps1/);
  assert.match(mountInjection, /osdcloud-assets\\OSDCloud\\Config\\Scripts\\SetupComplete\\SetupComplete\.cmd/);
  assert.match(mountInjection, /osdcloud-assets\\OSDCloud\\Config\\Scripts\\Shutdown\\Invoke-OobeCustomization\.ps1/);

  // The injection must not read these scripts from the mutable live ($ipxeLab) tree.
  assert.doesNotMatch(mountInjection, /\$ipxeLab 'Config\\Scripts\\SetupComplete\\SetupComplete\.ps1'/);
  assert.doesNotMatch(mountInjection, /\$ipxeLab 'Config\\Scripts\\Shutdown\\Invoke-OobeCustomization\.ps1'/);
});

test('SetupComplete defers client sequence to a SYSTEM logon task and gates desktop-ready', () => {
  const setupPath = path.join(
    process.cwd(),
    'osdcloud-assets',
    'OSDCloud',
    'Config',
    'Scripts',
    'SetupComplete',
    'SetupComplete.ps1',
  );
  const setup = fs.readFileSync(setupPath, 'utf8');
  const preLogonBody = setup.slice(setup.indexOf("[void] (Send-DeploymentStatus -Stage 'windows-setupcomplete-start'"));
  const reporterHereStringStart = setup.indexOf("$reporter = @'");
  const isOuterFunction = (name) => {
    const functionIndex = setup.indexOf(`function ${name}`);
    return functionIndex >= 0 && functionIndex < reporterHereStringStart;
  };

  assert.match(setup, /\[switch\] \$PostLogonFinalize/);
  assert.match(setup, /\[long\] \$RegisteredBootTimeUtcTicks = 0/);
  assert.match(setup, /OSDCloudPostLogonFinalize/);
  assert.match(setup, /LastBootUpTime\.ToUniversalTime\(\)\.Ticks/);
  assert.match(setup, /-PostLogonFinalize -RegisteredBootTimeUtcTicks \$registeredBootTimeUtcTicks/);
  assert.match(setup, /\$currentBootTimeUtcTicks -eq \$RegisteredBootTimeUtcTicks/);
  assert.match(setup, /Client finalization is waiting for the required post-SetupComplete reboot/);
  assert.match(setup, /New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest/);
  assert.match(setup, /New-ItemProperty -Path \$runOnce -Name '!OSDCloudDeploymentProgress'/);
  assert.match(setup, /Show-DeploymentProgress\.ps1/);
  assert.match(setup, /if \(\$progressStatus -ne 'succeeded'\)/);
  assert.match(setup, /\$timeoutTimer = \[System\.Diagnostics\.Stopwatch\]::StartNew\(\)/);
  assert.match(setup, /\$timeoutTimer\.Elapsed\.TotalSeconds -lt \$timeoutSeconds/);
  assert.match(setup, /\$pollTimer = \[System\.Diagnostics\.Stopwatch\]::StartNew\(\)/);
  assert.match(setup, /-MultipleInstances IgnoreNew/);
  assert.doesNotMatch(setup, /\$deadline = \(Get-Date\)\.AddMinutes\(30\)/);
  assert.match(setup, /Set-DeploymentProgressFailure -Category 'interrupted'/);
  assert.equal(isOuterFunction('Write-JsonFileAtomic'), true);
  assert.equal(isOuterFunction('Initialize-DeploymentProgress'), true);
  assert.equal(isOuterFunction('Set-DeploymentProgressFailure'), true);
  assert.doesNotMatch(preLogonBody, /\$clientAppsResult = Invoke-ClientAppInstallers/);
  assert.match(preLogonBody, /\$finalizer = Install-PostLogonFinalizer/);

  const winPeMirror = fs.readFileSync(path.join(
    process.cwd(),
    'osdcloud-assets',
    'OSDCloud',
    'WinPE',
    'OSDCloud',
    'Config',
    'Scripts',
    'SetupComplete',
    'SetupComplete.ps1',
  ), 'utf8');
  assert.equal(winPeMirror.replace(/\r\n/gu, '\n'), setup.replace(/\r\n/gu, '\n'));
});

test('client progress viewer is full-screen, topmost, and has no running close path', () => {
  const viewer = fs.readFileSync(path.join(process.cwd(), 'Softwares', 'Show-DeploymentProgress.ps1'), 'utf8');
  assert.match(viewer, /WindowStyle="None" ResizeMode="NoResize" WindowState="Maximized" Topmost="True"/);
  assert.match(viewer, /if \(-not \$script:allowClose\)/);
  assert.match(viewer, /Acknowledge and return to desktop/);
  assert.match(viewer, /Elapsed: \{0:D2\}:\{1:D2\}:\{2:D2\}/);
  assert.match(viewer, /\$State\.elapsedSeconds/);
  assert.match(viewer, /\$view\.status -eq 'succeeded'/);
  assert.doesNotMatch(viewer, /rawException|stdoutTailText|stderrTailText/);
});

test('client installer records elapsed time from monotonic timers', () => {
  const installer = fs.readFileSync(path.join(process.cwd(), 'Softwares', 'Install-Apps.ps1'), 'utf8');
  assert.match(installer, /\$script:SequenceTimer = \[System\.Diagnostics\.Stopwatch\]::StartNew\(\)/);
  assert.match(installer, /\$durationTimer = \[System\.Diagnostics\.Stopwatch\]::StartNew\(\)/);
  assert.match(installer, /durationSeconds = \[Math\]::Round\(\$durationTimer\.Elapsed\.TotalSeconds, 3\)/);
  assert.doesNotMatch(installer, /durationSeconds = \[Math\]::Round\(\(\$ended - \$started\)\.TotalSeconds, 3\)/);
});

test('endpoint sync injects Startnet boot chain into rebuilt WinPE', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  const startnet = fs.readFileSync(
    path.join(process.cwd(), 'osdcloud-assets', 'OSDCloud', 'WinPE', 'Windows', 'System32', 'Startnet.cmd'),
    'utf8',
  );

  assert.match(script, /WinPE\\Windows\\System32\\Startnet\.cmd/);
  assert.match(script, /Windows\\System32\\Startnet\.cmd/);
  assert.match(startnet, /PowerShell -NoL -NoP -ExecutionPolicy Bypass -File X:\\OSDCloud\\Maximize-Console\.ps1/);
  assert.match(startnet, /PowerShell -NoL -NoP -ExecutionPolicy Bypass -File X:\\OSDCloud\\Start-OSDCloud-iPXE\.ps1/);
});

test('endpoint sync injects WinPE console maximize helper into rebuilt WinPE', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  const maximizeHelper = fs.readFileSync(
    path.join(process.cwd(), 'osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Maximize-Console.ps1'),
    'utf8',
  );

  assert.match(script, /WinPE\\OSDCloud\\Maximize-Console\.ps1/);
  assert.match(script, /OSDCloud\\Maximize-Console\.ps1/);
  assert.match(maximizeHelper, /kernel32\.dll/);
  assert.match(maximizeHelper, /GetConsoleWindow/);
  assert.match(maximizeHelper, /user32\.dll/);
  assert.match(maximizeHelper, /ShowWindow/);
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

test('WinPE deployment script maximizes the visible console for deployment readability', () => {
  const script = fs.readFileSync(
    path.join(process.cwd(), 'osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Start-OSDCloud-iPXE.ps1'),
    'utf8',
  );

  assert.match(script, /function Ensure-ConsoleMaximized/);
  assert.match(script, /kernel32\.dll/);
  assert.match(script, /GetConsoleWindow/);
  assert.match(script, /user32\.dll/);
  assert.match(script, /ShowWindow\(System\.IntPtr hWnd, int nCmdShow\)/);
  assert.doesNotMatch(script, /Get-Process -Id \$PID/);
  assert.match(script, /Ensure-ConsoleMaximized/);
});

test('WinPE torrent download shows local progress and active peers through loopback-only aria2 RPC', () => {
  const script = fs.readFileSync(
    path.join(process.cwd(), 'osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Start-OSDCloud-iPXE.ps1'),
    'utf8',
  );

  assert.match(script, /function Invoke-Aria2Rpc/);
  assert.match(script, /http:\/\/127\.0\.0\.1:6800\/jsonrpc/);
  assert.match(script, /--enable-rpc=true/);
  assert.match(script, /--rpc-listen-all=false/);
  assert.match(script, /--rpc-listen-port=6800/);
  assert.match(script, /--rpc-secret=\$aria2RpcSecret/);
  assert.match(script, /--gid=\$aria2Gid/);
  assert.match(script, /aria2\.tellStatus/);
  assert.match(script, /aria2\.getPeers/);
  assert.match(script, /wpeutil DisableFirewall/);
  assert.match(script, /--bt-enable-lpd=true/);
  assert.match(script, /--enable-peer-exchange=true/);
  assert.match(script, /--bt-tracker-interval=5/);
  assert.match(script, /--bt-external-ip=\$clientIPv4/);
  assert.match(script, /--bt-lpd-interface=\$clientIPv4/);
  assert.match(script, /--listen-port=\$listenPort/);
  assert.match(script, /uploadedBytes=/);
  assert.match(script, /Write-Progress -Id 22/);
  assert.match(script, /Downloading from:/);
  assert.match(script, /Uploading to:/);
  assert.match(script, /Torrent progress telemetry unavailable; download continues/);
  assert.match(script, /Start-Process -FilePath \$aria2 -ArgumentList \$aria2Args -WindowStyle Hidden -PassThru/);
  assert.match(script, /Torrent path failed; falling back to SMB-direct apply/);
  assert.match(script, /http:\/\/\$server\/osdcloud\/torrent-telemetry/);
  assert.match(script, /http:\/\/\$server\/osdcloud\/torrent-control/);
  assert.match(script, /function Wait-TorrentSeedWindow/);
  assert.match(script, /Press Enter to continue to reboot now/);
  assert.match(script, /aria2\.shutdown/);
  assert.match(script, /seedDeadline = \$completedAt\.AddMinutes\(\$seedMinutes\)/);
  assert.match(script, /Wait-TorrentSeedWindow -Context \$torrentTransfer/);
  assert.match(script, /Report-TorrentTelemetry\.ps1/);
  assert.match(script, /torrent-seed-wait/);
  assert.match(script, /torrent-emergency-fallback/);
  for (const reason of ['deadline', 'aria2-exit', 'client-enter', 'host-release']) {
    assert.match(script, new RegExp(reason));
  }
  assert.match(script, /catch \{\s*Stop-Process -Id \$Context\.process\.Id -Force/s);
});

test('endpoint sync injects the torrent telemetry reporter into rebuilt WinPE', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  assert.match(script, /OSDCloud\/Report-TorrentTelemetry\.ps1/);
  assert.match(script, /WinPE\\OSDCloud\\Report-TorrentTelemetry\.ps1/);
});

test('asset sync exports and restores the torrent telemetry reporter', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Sync-OsdCloudAssets.ps1'), 'utf8');
  assert.match(script, /OSDCloud\\Report-TorrentTelemetry\.ps1/);
  assert.match(script, /WinPE\\OSDCloud\\Report-TorrentTelemetry\.ps1/);
});

test('endpoint sync injects OSD modules into rebuilt WinPE', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');
  const moduleCheckIndex = script.indexOf("Assert-WinPePowerShellModuleAvailable -Name 'OSDCloud'");
  const mountIndex = script.indexOf('& dism /English /Mount-Wim');

  assert.match(script, /function Get-WinPePowerShellModule/);
  assert.match(script, /function Assert-WinPePowerShellModuleAvailable/);
  assert.match(script, /function Copy-WinPePowerShellModule/);
  assert.match(script, /Program Files\\WindowsPowerShell\\Modules\\\$Name/);
  assert.match(script, /Assert-WinPePowerShellModuleAvailable -Name 'OSD'/);
  assert.match(script, /Assert-WinPePowerShellModuleAvailable -Name 'OSDCloud'/);
  assert.ok(moduleCheckIndex > -1 && moduleCheckIndex < mountIndex);
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

test('parses a download artifact with an archive (zip member) spec', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-archive-'));
  try {
    const catalogPath = makeCatalog(root, {
      schemaVersion: 1,
      artifacts: [{
        id: 'aria2c',
        kind: 'torrent',
        name: 'aria2 client',
        sourceType: 'download',
        required: true,
        url: 'https://example.com/aria2.zip',
        target: 'Tools\aria2c.exe',
        length: 5649408,
        sha256: 'B'.repeat(64),
        archive: {
          format: 'zip',
          member: 'aria2-1.37.0-win-64bit-build1/aria2c.exe',
          length: 2475379,
          sha256: '6'.repeat(64),
        },
      }],
    });
    const catalog = loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath });
    const artifact = catalog.artifacts.find((a) => a.id === 'aria2c');
    assert.equal(artifact.archive.format, 'zip');
    assert.equal(artifact.archive.member, 'aria2-1.37.0-win-64bit-build1/aria2c.exe');
    assert.equal(artifact.archive.length, 2475379);
    assert.equal(artifact.archive.sha256, '6'.repeat(64));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects archive members that escape the archive or have bad metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-archive-bad-'));
  try {
    const base = (archive) => ({
      schemaVersion: 1,
      artifacts: [{
        id: 'aria2c',
        sourceType: 'download',
        url: 'https://example.com/aria2.zip',
        target: 'Tools\aria2c.exe',
        length: 10,
        sha256: 'B'.repeat(64),
        archive,
      }],
    });

    let catalogPath = makeCatalog(root, base({ member: '../evil.exe', length: 1, sha256: '6'.repeat(64) }));
    assert.throws(() => loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath }), /escapes archive/);

    catalogPath = makeCatalog(root, base({ member: 'aria2c.exe', length: 1, sha256: 'nothex' }));
    assert.throws(() => loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath }), /sha256/);

    catalogPath = makeCatalog(root, base({ format: 'tar', member: 'aria2c.exe', length: 1, sha256: '6'.repeat(64) }));
    assert.throws(() => loadRuntimeArtifactCatalog({ paths: { repoRoot: root } }, { catalogPath }), /format is not supported/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
