import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.js';

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
    paths: { expectedHttpFiles: ['osdcloud\\boot.ipxe'] },
  };

  assert.equal(validateConfig(config), config);
});
