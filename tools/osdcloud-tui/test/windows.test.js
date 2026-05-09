import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateServiceIp, getServiceBindIps, removeStatusFiles } from '../src/windows.js';

test('clears status metadata and screenshot directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-status-clear-'));
  const statusRoot = path.join(root, 'status');
  fs.mkdirSync(path.join(statusRoot, 'screenshots', 'run-1'), { recursive: true });
  fs.writeFileSync(path.join(statusRoot, 'latest.json'), '{}');
  fs.writeFileSync(path.join(statusRoot, 'latest-screenshot.json'), '{}');
  fs.writeFileSync(path.join(statusRoot, 'run-1.screenshots.jsonl'), '{}\n');
  fs.writeFileSync(path.join(statusRoot, 'screenshots', 'run-1', 'shot.png'), 'png');
  fs.writeFileSync(path.join(statusRoot, 'keep.txt'), 'keep');

  try {
    const removed = removeStatusFiles({ http: { statusRoot } });
    assert.equal(removed, 4);
    assert.equal(fs.existsSync(path.join(statusRoot, 'latest.json')), false);
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
