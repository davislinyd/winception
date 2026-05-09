import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyServiceEndpoint, saveConfig, validateConfig } from '../src/config.js';

test('rejects incomplete config', () => {
  assert.throws(() => validateConfig({}), /Missing required config values/);
});

test('accepts minimum config shape', () => {
  const config = {
    adapter: { interfaceAlias: 'Ethernet', serverIp: '192.168.100.100' },
    dhcp: {
      listenIp: '192.168.100.100',
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://192.168.100.100/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\PXE-TFTP' },
    http: { root: 'C:\\PXE-HttpRoot', host: '192.168.100.100', statusRoot: 'C:\\status' },
    paths: {
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\192.168.100.100\\OSDCloudiPXE',
      imagePath: '\\\\192.168.100.100\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
  };

  assert.equal(validateConfig(config), config);
});

test('applies service endpoint to every network-facing config value', () => {
  const config = {
    adapter: { interfaceAlias: 'Ethernet', serverIp: '192.168.100.100', prefixLength: 24 },
    dhcp: {
      listenIp: '192.168.100.100',
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://192.168.100.100/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\PXE-TFTP', listenIp: '192.168.100.100' },
    http: { root: 'C:\\PXE-HttpRoot', host: '192.168.100.100', statusRoot: 'C:\\status' },
    paths: {
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\192.168.100.100\\OSDCloudiPXE',
      imagePath: '\\\\192.168.100.100\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
  };

  applyServiceEndpoint(config, {
    interfaceAlias: 'Wi-Fi',
    ipAddress: '10.10.10.5',
    prefixLength: 24,
  });

  assert.equal(config.adapter.interfaceAlias, 'Wi-Fi');
  assert.equal(config.adapter.serverIp, '10.10.10.5');
  assert.equal(config.adapter.prefixLength, 24);
  assert.equal(config.dhcp.listenIp, '10.10.10.5');
  assert.equal(config.tftp.listenIp, '10.10.10.5');
  assert.equal(config.http.host, '10.10.10.5');
  assert.equal(config.dhcp.ipxeBootUrl, 'http://10.10.10.5/osdcloud/boot.ipxe');
  assert.equal(config.smb.share, '\\\\10.10.10.5\\OSDCloudiPXE');
  assert.equal(config.smb.imagePath, '\\\\10.10.10.5\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd');
});

test('saves public config without losing existing fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-config-save-'));
  const configPath = path.join(root, 'osdcloud-tui.json');
  const config = {
    adapter: { interfaceAlias: '乙太網路 3', serverIp: '192.168.100.100', prefixLength: 24 },
    dhcp: {
      listenIp: '192.168.100.100',
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://192.168.100.100/osdcloud/boot.ipxe',
      leaseSeconds: 3600,
    },
    tftp: { root: 'C:\\PXE-TFTP', listenIp: '192.168.100.100' },
    http: { root: 'C:\\PXE-HttpRoot', host: '192.168.100.100', statusRoot: 'C:\\status' },
    paths: {
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      endpointSyncScript: 'C:\\repo\\tools\\Set-OsdCloudIpxeEndpoint.ps1',
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\192.168.100.100\\OSDCloudiPXE',
      imagePath: '\\\\192.168.100.100\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
    __configPath: configPath,
  };

  try {
    saveConfig(config);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(saved.__configPath, undefined);
    assert.equal(saved.dhcp.leaseSeconds, 3600);
    assert.equal(saved.paths.endpointSyncScript, 'C:\\repo\\tools\\Set-OsdCloudIpxeEndpoint.ps1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
