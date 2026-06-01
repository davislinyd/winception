import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  buildBootWimSyncInputs,
  checkBootWimSyncState,
  evaluateBootWimCustomization,
  evaluateDhcpSubnet,
  evaluateServiceIp,
  evaluateSmbImage,
  getServiceBindIps,
  normalizeIpv4ServiceInterfaces,
  parseUncPath,
  preparePowerShellArgs,
  removeStatusFiles,
  resolveEndpointSyncScript,
  resolveRepoRoot,
  hashBootWimSyncInputs,
  smbAccessAllowsRead,
  smbBackingImagePath,
} from '../src/windows.js';

const templateFixtureFiles = {
  'osdcloud-assets/OSDCloud/WinPE/Windows/System32/Startnet.cmd': 'startnet-template',
  'osdcloud-assets/OSDCloud/WinPE/OSDCloud/Start-OSDCloud-iPXE.ps1': 'start-osdcloud-template',
  'osdcloud-assets/OSDCloud/WinPE/OSDCloud/Report-OSDCloudProgress.ps1': 'report-progress-template',
  'osdcloud-assets/OSDCloud/Config/Scripts/Shutdown/Invoke-OobeCustomization.ps1': 'oobe-customization-template',
  'osdcloud-assets/OSDCloud/Config/Scripts/SetupComplete/SetupComplete.cmd': 'setupcomplete-cmd-template',
  'osdcloud-assets/OSDCloud/Config/Scripts/SetupComplete/SetupComplete.ps1': 'setupcomplete-ps1-template',
};

function sha256Text(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createBootWimSyncFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-sync-fixture-'));
  const stateRoot = path.join(root, 'state');
  const runtimeRoot = path.join(root, 'runtime');
  const publishedBootWim = path.join(runtimeRoot, 'PXE-HttpRoot', 'osdcloud', 'boot.wim');
  const secretsPath = path.join(stateRoot, 'config', 'osdcloud-secrets.json');
  for (const [relativePath, content] of Object.entries(templateFixtureFiles)) {
    writeText(path.join(root, ...relativePath.split('/')), content);
  }
  writeText(secretsPath, JSON.stringify({ windowsUsername: 'custom-user', windowsPassword: 'custom-pass', pxeinstallPassword: 'custom-pxe' }));
  writeText(publishedBootWim, 'wim');
  return {
    root,
    stateRoot,
    runtimeRoot,
    publishedBootWim,
    secretsPath,
    config: {
      adapter: {
        serverIp: '192.168.100.1',
      },
      paths: {
        appRoot: root,
        stateRoot,
        osdCloudRoot: runtimeRoot,
      },
    },
  };
}

function writeSyncMarker(publishedBootWim, syncInputs, extra = {}) {
  const marker = {
    publishedSha256: 'BOOT-WIM-SHA',
    syncedAtUtc: '2026-06-02T01:02:03Z',
    markerSchema: 2,
    syncInputsSha256: hashBootWimSyncInputs(syncInputs),
    syncInputs,
    ...extra,
  };
  writeText(`${publishedBootWim}.sync.json`, `${JSON.stringify(marker, null, 2)}\n`);
}

test('prepends UTF-8 output settings to PowerShell command calls', () => {
  const args = preparePowerShellArgs(['-NoProfile', '-Command', 'Get-NetAdapter | ConvertTo-Json']);
  assert.match(args[2], /\[Console\]::OutputEncoding/);
  assert.match(args[2], /\[Console\]::InputEncoding/);
  assert.match(args[2], /\$OutputEncoding/);
  assert.match(args[2], /Get-NetAdapter/);
  assert.deepEqual(preparePowerShellArgs(['-NoProfile', '-File', 'script.ps1']), ['-NoProfile', '-File', 'script.ps1']);
});

test('PowerShell output uses shared UTF-8 process decoder', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'tools', 'osdcloud-console', 'src', 'windows.js'), 'utf8');

  assert.match(source, /collectProcessOutput/);
  assert.doesNotMatch(source, /chunk\.toString\(\)/);
});

test('endpoint sync adds -SyncAssets only when explicitly requested', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'tools', 'osdcloud-console', 'src', 'windows.js'), 'utf8');

  assert.match(source, /if \(options\.syncAssets === true\) \{\s*args\.push\('-SyncAssets'\);/);
});

test('endpoint sync script writes marker schema v2 with sync input fingerprints', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'), 'utf8');

  assert.match(source, /markerSchema\s*=\s*2/);
  assert.match(source, /syncInputsSha256/);
  assert.match(source, /syncInputs\s*=/);
  assert.match(source, /Get-BootWimSyncInputs/);
  assert.match(source, /ConvertTo-CanonicalJson/);
});

test('resolves endpoint sync paths from derived repo root by default', () => {
  assert.equal(resolveRepoRoot({ paths: {} }), path.resolve('.'));
  assert.equal(
    resolveEndpointSyncScript({ paths: {} }),
    path.join(path.resolve('.'), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'),
  );
});

test('resolves endpoint sync paths with optional overrides', () => {
  const root = path.join(os.tmpdir(), 'portable-repo-root');
  assert.equal(resolveRepoRoot({ paths: { repoRoot: root } }), path.resolve(root));
  assert.equal(
    resolveEndpointSyncScript({ paths: { repoRoot: root, endpointSyncScript: 'scripts\\sync.ps1' } }),
    path.resolve(root, 'scripts\\sync.ps1'),
  );
  assert.equal(
    resolveEndpointSyncScript({ paths: { repoRoot: root, endpointSyncScript: 'C:\\custom\\sync.ps1' } }),
    path.resolve('C:\\custom\\sync.ps1'),
  );
});

test('resolves endpoint sync script from app root when provided', () => {
  const appRoot = path.join(os.tmpdir(), 'portable-app-root');
  assert.equal(resolveRepoRoot({ paths: { appRoot } }), path.resolve(appRoot));
  assert.equal(
    resolveEndpointSyncScript({ paths: { appRoot } }),
    path.join(path.resolve(appRoot), 'tools', 'Set-OsdCloudIpxeEndpoint.ps1'),
  );
});

test('builds boot.wim sync inputs from endpoint, secrets, and template sources', () => {
  const fixture = createBootWimSyncFixture();

  try {
    const syncInputs = buildBootWimSyncInputs(fixture.config);
    assert.deepEqual(syncInputs.endpoint, {
      serverIp: '192.168.100.1',
      statusUrl: 'http://192.168.100.1/osdcloud/status',
    });
    assert.deepEqual(syncInputs.secrets, {
      present: true,
      sha256: sha256Text(JSON.stringify({ windowsUsername: 'custom-user', windowsPassword: 'custom-pass', pxeinstallPassword: 'custom-pxe' })),
    });
    assert.equal(
      syncInputs.templates['Windows/System32/Startnet.cmd'],
      sha256Text(templateFixtureFiles['osdcloud-assets/OSDCloud/WinPE/Windows/System32/Startnet.cmd']),
    );
    assert.equal(
      syncInputs.templates['OSDCloud/Config/Scripts/SetupComplete/SetupComplete.ps1'],
      sha256Text(templateFixtureFiles['osdcloud-assets/OSDCloud/Config/Scripts/SetupComplete/SetupComplete.ps1']),
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('clears status metadata and screenshot directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-status-clear-'));
  const statusRoot = path.join(root, 'status');
  fs.mkdirSync(path.join(statusRoot, 'screenshots', 'run-1'), { recursive: true });
  fs.writeFileSync(path.join(statusRoot, 'latest.json'), '{}');
  fs.writeFileSync(path.join(statusRoot, 'runs-index.json'), '{}');
  fs.writeFileSync(path.join(statusRoot, 'run-1.summary.json'), '{}');
  fs.writeFileSync(path.join(statusRoot, 'run-1.latest.json'), '{}');
  fs.writeFileSync(path.join(statusRoot, 'latest-screenshot.json'), '{}');
  fs.writeFileSync(path.join(statusRoot, 'run-1.screenshots.jsonl'), '{}\n');
  fs.writeFileSync(path.join(statusRoot, 'screenshots', 'run-1', 'shot.png'), 'png');
  fs.writeFileSync(path.join(statusRoot, 'keep.txt'), 'keep');

  try {
    const removed = removeStatusFiles({ http: { statusRoot } });
    assert.equal(removed, 7);
    assert.equal(fs.existsSync(path.join(statusRoot, 'latest.json')), false);
    assert.equal(fs.existsSync(path.join(statusRoot, 'runs-index.json')), false);
    assert.equal(fs.existsSync(path.join(statusRoot, 'run-1.summary.json')), false);
    assert.equal(fs.existsSync(path.join(statusRoot, 'run-1.latest.json')), false);
    assert.equal(fs.existsSync(path.join(statusRoot, 'latest-screenshot.json')), false);
    assert.equal(fs.existsSync(path.join(statusRoot, 'run-1.screenshots.jsonl')), false);
    assert.equal(fs.existsSync(path.join(statusRoot, 'screenshots')), false);
    assert.equal(fs.readFileSync(path.join(statusRoot, 'keep.txt'), 'utf8'), 'keep');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('parses SMB UNC image paths and maps them to the share backing path', () => {
  assert.deepEqual(parseUncPath('\\\\10.10.10.1\\OSDCloudiPXE\\OSDCloud\\OS\\install.wim'), {
    server: '10.10.10.1',
    shareName: 'OSDCloudiPXE',
    relativePath: 'OSDCloud\\OS\\install.wim',
  });

  assert.equal(
    smbBackingImagePath(
      '\\\\10.10.10.1\\OSDCloudiPXE\\OSDCloud\\OS\\install.wim',
      { Path: 'C:\\OSDCloud\\Media' },
    ),
    'C:\\OSDCloud\\Media\\OSDCloud\\OS\\install.wim',
  );
});

test('SMB image preflight uses the share backing file and pxeinstall access', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-smb-preflight-'));
  const imagePath = path.join(root, 'OSDCloud', 'OS', 'install.wim');
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, 'image');

  try {
    const result = await evaluateSmbImage({
      smb: {
        share: '\\\\10.10.10.1\\OSDCloudiPXE',
        imagePath: '\\\\10.10.10.1\\OSDCloudiPXE\\OSDCloud\\OS\\install.wim',
      },
    }, {
      shareInfo: {
        Name: 'OSDCloudiPXE',
        Path: root,
        Access: [{ AccountName: 'DESKTOP-TEST\\pxeinstall', AccessControlType: 'Allow', AccessRight: 'Read' }],
      },
    });

    assert.equal(result.ok, true);
    assert.match(result.detail, /\\\\10\.10\.10\.1\\OSDCloudiPXE/);
    assert.match(result.detail, /pxeinstall read access/);
    assert.match(result.detail, /backing=/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SMB image preflight reports missing share, image, and pxeinstall access clearly', async () => {
  const config = {
    smb: {
      share: '\\\\10.10.10.1\\OSDCloudiPXE',
      imagePath: '\\\\10.10.10.1\\OSDCloudiPXE\\OSDCloud\\OS\\install.wim',
    },
  };

  let result = await evaluateSmbImage(config, { shareInfo: null });
  assert.equal(result.ok, false);
  assert.match(result.detail, /SMB share not found: OSDCloudiPXE/);

  result = await evaluateSmbImage(config, {
    shareInfo: {
      Name: 'OSDCloudiPXE',
      Path: 'C:\\OSDCloud\\Media',
      Access: [{ AccountName: 'DESKTOP-TEST\\pxeinstall', AccessControlType: 'Allow', AccessRight: 'Read' }],
    },
    fileExists: () => false,
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /image missing:/);
  assert.match(result.detail, /from \\\\10\.10\.10\.1\\OSDCloudiPXE/);

  result = await evaluateSmbImage(config, {
    shareInfo: {
      Name: 'OSDCloudiPXE',
      Path: 'C:\\OSDCloud\\Media',
      Access: [{ AccountName: 'DESKTOP-TEST\\otheruser', AccessControlType: 'Allow', AccessRight: 'Read' }],
    },
    fileExists: () => true,
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /does not grant read access to pxeinstall/);
});

test('SMB access check accepts numeric PowerShell enum values for read access', () => {
  assert.equal(smbAccessAllowsRead([
    { AccountName: 'DESKTOP-TEST\\pxeinstall', AccessControlType: 0, AccessRight: 2 },
  ]), true);
  assert.equal(smbAccessAllowsRead([
    { AccountName: 'DESKTOP-TEST\\pxeinstall', AccessControlType: 'Deny', AccessRight: 'Read' },
  ]), false);
});

test('service IP preflight accepts any up interface carrying the service address', () => {
  const config = {
    adapter: { serverIp: '192.168.100.100', prefixLength: 24 },
    dhcp: { listenIp: '192.168.100.100' },
    tftp: { listenIp: '192.168.100.100' },
    http: { host: '192.168.100.100' },
  };
  const states = [{
    TargetIp: '192.168.100.100',
    IPAddress: '192.168.100.100',
    PrefixLength: 24,
    AddressState: 'Preferred',
    InterfaceAlias: 'Wi-Fi',
    Status: 'Up',
  }];

  assert.deepEqual(getServiceBindIps(config), ['192.168.100.100']);
  assert.equal(evaluateServiceIp(config, states, '192.168.100.100').ok, true);
});

test('service IP preflight rejects disabled or wrong-prefix matches', () => {
  const config = {
    adapter: { serverIp: '192.168.100.100', prefixLength: 24 },
    dhcp: { listenIp: '192.168.100.100' },
    tftp: { listenIp: '192.168.100.100' },
    http: { host: '192.168.100.100' },
  };

  assert.equal(evaluateServiceIp(config, [{
    TargetIp: '192.168.100.100',
    IPAddress: '192.168.100.100',
    PrefixLength: 24,
    AddressState: 'Preferred',
    InterfaceAlias: 'Ethernet',
    Status: 'Disabled',
  }], '192.168.100.100').ok, false);

  assert.equal(evaluateServiceIp(config, [{
    TargetIp: '192.168.100.100',
    IPAddress: '192.168.100.100',
    PrefixLength: 16,
    AddressState: 'Preferred',
    InterfaceAlias: 'Wi-Fi',
    Status: 'Up',
  }], '192.168.100.100').ok, false);
});

test('normalizes enabled non-APIPA IPv4 service interfaces', () => {
  const rows = normalizeIpv4ServiceInterfaces([
    {
      InterfaceAlias: '乙太網路 3',
      InterfaceIndex: 6,
      InterfaceDescription: 'Realtek USB GbE',
      Status: 'Up',
      MacAddress: '48-65-EE-10-94-77',
      LinkSpeed: '1 Gbps',
      IPAddress: '192.168.100.100',
      PrefixLength: 24,
      Gateway: '192.168.100.1',
    },
    {
      InterfaceAlias: 'Ethernet 2',
      InterfaceIndex: 36,
      InterfaceDescription: 'VM Virtual Ethernet Adapter',
      Status: 'Up',
      IPAddress: '172.25.96.1',
      PrefixLength: 28,
      Gateway: '',
    },
    {
      InterfaceAlias: '藍牙網路連線',
      Status: 'Up',
      IPAddress: '169.254.147.62',
      PrefixLength: 16,
    },
    {
      InterfaceAlias: 'Wi-Fi',
      Status: 'Disabled',
      IPAddress: '192.168.100.1',
      PrefixLength: 24,
    },
  ]);

  assert.deepEqual(rows.map((row) => row.interfaceAlias), ['乙太網路 3', 'Ethernet 2']);
  assert.equal(rows.find((row) => row.interfaceAlias === '乙太網路 3').gateway, '192.168.100.1');
  assert.equal(rows.find((row) => row.interfaceAlias === 'Ethernet 2').gateway, '');
});

test('DHCP subnet preflight catches lease and router mismatch', () => {
  assert.equal(evaluateDhcpSubnet({
    adapter: { serverIp: '192.168.100.100', prefixLength: 24 },
    dhcp: {
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      router: '192.168.100.1',
    },
  }).ok, true);

  const result = evaluateDhcpSubnet({
    adapter: { serverIp: '10.10.10.5', prefixLength: 24 },
    dhcp: {
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      router: '192.168.100.1',
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /outside 10\.10\.10\.5\/24/);
});

test('desktop-ready reporter returns success only after status upload', () => {
  const setupCompletePath = path.resolve(
    'osdcloud-assets',
    'OSDCloud',
    'Config',
    'Scripts',
    'SetupComplete',
    'SetupComplete.ps1',
  );
  const setupComplete = fs.readFileSync(setupCompletePath, 'utf8');
  const sendStatusStart = setupComplete.indexOf('function Send-Status');
  const sendStatusEnd = setupComplete.indexOf('function Get-DesktopReadyFacts', sendStatusStart);

  assert.ok(sendStatusStart > 0);
  assert.ok(sendStatusEnd > sendStatusStart);

  const sendStatus = setupComplete.slice(sendStatusStart, sendStatusEnd);
  assert.match(sendStatus, /Invoke-WebRequest[\s\S]*return \$true/);
  assert.match(sendStatus, /UploadString[\s\S]*return \$true/);
  assert.match(sendStatus, /return \$false/);
});

test('desktop-ready reporter targets dynamic profile desktop instead of Public Desktop', () => {
  const setupCompletePath = path.resolve(
    'osdcloud-assets',
    'OSDCloud',
    'Config',
    'Scripts',
    'SetupComplete',
    'SetupComplete.ps1',
  );
  const setupComplete = fs.readFileSync(setupCompletePath, 'utf8');

  assert.doesNotMatch(setupComplete, /C:\\Users\\Public\\Desktop\\OSDCloud-Desktop-Ready\.txt/);
  assert.match(setupComplete, /\$targetUser = 'TARGET_USER_PLACEHOLDER'/);
  assert.match(setupComplete, /function Test-TargetUserIdentity/);
  assert.match(setupComplete, /function Get-ExplorerOwner/);
  assert.match(setupComplete, /function Get-TargetUserProfilePath/);
  assert.match(setupComplete, /Join-Path \$targetUserDesktopPath 'OSDCloud-Desktop-Ready\.txt'/);
  assert.match(setupComplete, /\$facts\.explorerRunning -and \$facts\.interactiveUserIsTarget -and \$facts\.desktopReadyFile/);
});

test('windows apps error payload uses joined tail text for Windows PowerShell compatibility', () => {
  const setupCompletePath = path.resolve(
    'osdcloud-assets',
    'OSDCloud',
    'Config',
    'Scripts',
    'SetupComplete',
    'SetupComplete.ps1',
  );
  const setupComplete = fs.readFileSync(setupCompletePath, 'utf8');

  assert.match(setupComplete, /function Get-TextFileTailText/);
  assert.match(setupComplete, /stdoutTailText = Get-TextFileTailText -Path \$stdoutPath -Count 80/);
  assert.match(setupComplete, /stderrTailText = Get-TextFileTailText -Path \$stderrPath -Count 80/);
  assert.match(setupComplete, /transcriptTailText = Get-TextFileTailText -Path \$transcriptPath -Count 80/);
  assert.doesNotMatch(setupComplete, /stdoutTail = @\(Get-TextFileTail/);
});

test('desktop-ready status includes resolved dynamic desktop evidence fields', () => {
  const setupCompletePath = path.resolve(
    'osdcloud-assets',
    'OSDCloud',
    'Config',
    'Scripts',
    'SetupComplete',
    'SetupComplete.ps1',
  );
  const setupComplete = fs.readFileSync(setupCompletePath, 'utf8');
  const factsStart = setupComplete.indexOf('function Get-DesktopReadyFacts');
  const factsEnd = setupComplete.indexOf('try {', factsStart);

  assert.ok(factsStart > 0);
  assert.ok(factsEnd > factsStart);

  const facts = setupComplete.slice(factsStart, factsEnd);
  assert.match(facts, /loggedOnUser = \$loggedOnUser/);
  assert.match(facts, /explorerOwner = \$explorerOwner/);
  assert.match(facts, /targetUserProfilePath = \$targetUserProfilePath/);
  assert.match(facts, /targetUserDesktopPath = \$targetUserDesktopPath/);
  assert.match(facts, /desktopReadyFilePath = \$desktopReadyFilePath/);
  assert.match(facts, /desktopReadyFile = \(-not \[string\]::IsNullOrWhiteSpace\(\$desktopReadyFilePath\)/);
});

test('WinPE boot.wim synchronization check uses sync input fingerprints instead of mtimes', () => {
  const fixture = createBootWimSyncFixture();

  try {
    const syncInputs = buildBootWimSyncInputs(fixture.config);
    writeSyncMarker(fixture.publishedBootWim, syncInputs);

    const now = Date.now();
    fs.utimesSync(fixture.publishedBootWim, new Date(now - 20000), new Date(now - 20000));
    fs.utimesSync(fixture.secretsPath, new Date(now - 5000), new Date(now - 5000));

    const result = checkBootWimSyncState(fixture.config, fixture.publishedBootWim);
    assert.equal(result.ok, true);
    assert.match(result.detail, /up to date with WinPE sync inputs/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('WinPE boot.wim synchronization check reports endpoint settings drift', () => {
  const fixture = createBootWimSyncFixture();

  try {
    const syncInputs = buildBootWimSyncInputs(fixture.config);
    writeSyncMarker(fixture.publishedBootWim, syncInputs);

    fixture.config.adapter.serverIp = '192.168.100.2';
    const result = checkBootWimSyncState(fixture.config, fixture.publishedBootWim);
    assert.equal(result.ok, false);
    assert.match(result.detail, /endpoint settings/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('WinPE boot.wim synchronization check reports deployment secrets drift', () => {
  const fixture = createBootWimSyncFixture();

  try {
    const syncInputs = buildBootWimSyncInputs(fixture.config);
    writeSyncMarker(fixture.publishedBootWim, syncInputs);

    writeText(fixture.secretsPath, JSON.stringify({ windowsUsername: 'custom-user', windowsPassword: 'changed-pass', pxeinstallPassword: 'custom-pxe' }));
    const result = checkBootWimSyncState(fixture.config, fixture.publishedBootWim);
    assert.equal(result.ok, false);
    assert.match(result.detail, /deployment secrets/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('WinPE boot.wim synchronization check reports WinPE template drift', () => {
  const fixture = createBootWimSyncFixture();

  try {
    const syncInputs = buildBootWimSyncInputs(fixture.config);
    writeSyncMarker(fixture.publishedBootWim, syncInputs);

    writeText(
      path.join(fixture.root, 'osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Report-OSDCloudProgress.ps1'),
      'report-progress-template-v2',
    );
    const result = checkBootWimSyncState(fixture.config, fixture.publishedBootWim);
    assert.equal(result.ok, false);
    assert.match(result.detail, /WinPE template files/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('WinPE boot.wim synchronization check uses legacy mtime fallback when marker lacks sync fingerprints', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-sync-test-'));
  const configDir = path.join(root, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  const secretsPath = path.join(configDir, 'osdcloud-secrets.json');
  const configPath = path.join(configDir, 'osdcloud-console.json');
  const publishedBootWim = path.join(root, 'boot.wim');

  fs.writeFileSync(publishedBootWim, 'wim');
  fs.writeFileSync(secretsPath, '{}');
  fs.writeFileSync(configPath, '{}');
  fs.writeFileSync(`${publishedBootWim}.sync.json`, JSON.stringify({ publishedSha256: 'BOOT', syncedAtUtc: '2026-06-01T00:00:00Z' }));

  const now = Date.now();
  fs.utimesSync(publishedBootWim, new Date(now - 10000), new Date(now - 10000));
  fs.utimesSync(secretsPath, new Date(now - 30000), new Date(now - 30000));
  fs.utimesSync(configPath, new Date(now - 20000), new Date(now - 20000));

  try {
    const config = {
      __configPath: configPath,
      paths: {
        stateRoot: root,
      },
    };

    let result = checkBootWimSyncState(config, publishedBootWim);
    assert.equal(result.ok, true);
    assert.match(result.detail, /legacy sync marker/);

    fs.utimesSync(configPath, new Date(now - 2000), new Date(now - 2000));
    result = checkBootWimSyncState(config, publishedBootWim);
    assert.equal(result.ok, false);
    assert.match(result.detail, /published boot\.wim is older than the current config/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('WinPE boot.wim customization check uses the sync marker', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-custom-test-'));
  const publishedBootWim = path.join(root, 'boot.wim');
  const markerPath = `${publishedBootWim}.sync.json`;
  const wimContent = 'customized-wim-bytes';
  const wimHash = crypto.createHash('sha256').update(wimContent).digest('hex').toUpperCase();

  try {
    // 0. Missing published boot.wim
    let result = await evaluateBootWimCustomization(publishedBootWim);
    assert.equal(result.ok, false);
    assert.match(result.detail, /Published boot\.wim is missing/);

    fs.writeFileSync(publishedBootWim, wimContent);

    // 1. No marker -> not customized
    result = await evaluateBootWimCustomization(publishedBootWim);
    assert.equal(result.ok, false);
    assert.match(result.detail, /has not been customized/);

    // 2. Marker hash does not match published image -> changed since sync
    fs.writeFileSync(markerPath, JSON.stringify({ publishedSha256: 'DEADBEEF', syncedAtUtc: '2026-06-01T00:00:00Z' }));
    result = await evaluateBootWimCustomization(publishedBootWim);
    assert.equal(result.ok, false);
    assert.match(result.detail, /has changed since the last Endpoint Sync/);

    // 3. Marker matches published image -> customized
    fs.writeFileSync(markerPath, JSON.stringify({ publishedSha256: wimHash, syncedAtUtc: '2026-06-01T12:34:56Z' }));
    result = await evaluateBootWimCustomization(publishedBootWim);
    assert.equal(result.ok, true);
    assert.match(result.detail, /has been customized/);
    assert.match(result.detail, /2026-06-01T12:34:56Z/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

