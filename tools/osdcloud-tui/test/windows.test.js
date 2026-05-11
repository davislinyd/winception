import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateDhcpSubnet,
  evaluateServiceIp,
  getServiceBindIps,
  normalizeIpv4ServiceInterfaces,
  preparePowerShellArgs,
  removeStatusFiles,
  resolveEndpointSyncScript,
  resolveRepoRoot,
} from '../src/windows.js';

test('prepends UTF-8 output settings to PowerShell command calls', () => {
  const args = preparePowerShellArgs(['-NoProfile', '-Command', 'Get-NetAdapter | ConvertTo-Json']);
  assert.match(args[2], /\[Console\]::OutputEncoding/);
  assert.match(args[2], /Get-NetAdapter/);
  assert.deepEqual(preparePowerShellArgs(['-NoProfile', '-File', 'script.ps1']), ['-NoProfile', '-File', 'script.ps1']);
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
    'Win11-iPXE-Lab',
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
