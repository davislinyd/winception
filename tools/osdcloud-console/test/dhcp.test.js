import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  DhcpResponder,
  LeasePool,
  broadcastAddress,
  getDhcpMessageType,
  getRequestedIp,
  isIpxeClient,
  ipv4ToUInt32,
  normalizeMacAddress,
  uint32ToIPv4,
} from '../src/dhcp.js';

function packetWithOptions(options) {
  const packet = Buffer.alloc(240);
  packet[0] = 1;
  packet[2] = 6;
  packet[28] = 0xaa;
  packet[29] = 0xbb;
  packet[30] = 0xcc;
  packet[31] = 0xdd;
  packet[32] = 0xee;
  packet[33] = 0xff;
  packet[236] = 99;
  packet[237] = 130;
  packet[238] = 83;
  packet[239] = 99;
  const bytes = [];
  for (const [code, value] of options) {
    bytes.push(code, value.length, ...value);
  }
  bytes.push(255);
  return Buffer.concat([packet, Buffer.from(bytes)]);
}

test('converts IPv4 values', () => {
  assert.equal(ipv4ToUInt32('192.168.100.100'), 3232261220);
  assert.equal(uint32ToIPv4(3232261220), '192.168.100.100');
  assert.equal(broadcastAddress('192.168.100.100', '255.255.255.0'), '192.168.100.255');
});

test('parses DHCP message type, requested IP, and iPXE markers', () => {
  const packet = packetWithOptions([
    [53, [1]],
    [50, [192, 168, 100, 222]],
    [60, [...Buffer.from('iPXE', 'ascii')]],
  ]);

  assert.equal(getDhcpMessageType(packet), 1);
  assert.equal(getRequestedIp(packet), '192.168.100.222');
  assert.equal(isIpxeClient(packet), true);
});

test('allocates requested IPs only inside the lease pool', () => {
  const pool = new LeasePool('192.168.100.200', '192.168.100.202');
  assert.equal(pool.getLease('AA-BB-CC-00-00-01', '192.168.100.201'), '192.168.100.201');
  assert.equal(pool.getLease('AA-BB-CC-00-00-01', '192.168.100.202'), '192.168.100.201');
  assert.equal(pool.getLease('AA-BB-CC-00-00-02', '192.168.100.201'), '192.168.100.200');
  assert.equal(pool.getLease('AA-BB-CC-00-00-03', '10.0.0.10'), '192.168.100.202');
});

test('normalizes MAC address formats', () => {
  assert.equal(normalizeMacAddress('aa:bb:cc:dd:ee:ff'), 'AA-BB-CC-DD-EE-FF');
  assert.equal(normalizeMacAddress('AABB.CCDD.EEFF'), 'AA-BB-CC-DD-EE-FF');
  assert.throws(() => normalizeMacAddress('bad-mac'), /Invalid MAC/);
});

test('honors DHCP reservations outside the dynamic lease pool', () => {
  const pool = new LeasePool('192.168.100.200', '192.168.100.202', [
    { mac: 'AA-BB-CC-DD-EE-FF', ip: '192.168.100.115' },
  ]);

  assert.equal(pool.getLease('AA-BB-CC-DD-EE-FF', null), '192.168.100.115');
  assert.equal(pool.getLease('AA-BB-CC-00-00-01', '192.168.100.115'), '192.168.100.200');
  assert.equal(pool.getLease('AA-BB-CC-00-00-02', null), '192.168.100.201');
});

test('refreshes DHCP lease pool after endpoint lease range changes', () => {
  const config = {
    listenIp: '192.168.100.1',
    leaseStartIp: '192.168.100.200',
    leaseEndIp: '192.168.100.250',
    subnetMask: '255.255.255.0',
    router: '192.168.100.1',
    dnsServers: ['1.1.1.1'],
    bootFile: 'ipxeboot/x86_64-sb/snponly.efi',
    ipxeBootUrl: 'http://192.168.100.1/osdcloud/boot.ipxe',
    logPath: path.join(os.tmpdir(), 'osdcloud-dhcp-refresh-test.log'),
  };
  const responder = new DhcpResponder(config);
  assert.equal(responder.leasePool.getLease('AA-BB-CC-00-00-01', null), '192.168.100.200');

  config.listenIp = '192.168.100.2';
  config.leaseStartIp = '192.168.100.200';
  config.leaseEndIp = '192.168.100.250';
  config.router = '192.168.100.2';
  config.ipxeBootUrl = 'http://192.168.100.2/osdcloud/boot.ipxe';
  config.reservations = [{ mac: 'AA-BB-CC-DD-EE-FF', ip: '192.168.100.115' }];
  responder.refreshLeasePool();

  assert.equal(responder.leasePool.getLease('AA-BB-CC-00-00-01', null), '192.168.100.200');
  assert.equal(responder.leasePool.getLease('AA-BB-CC-DD-EE-FF', null), '192.168.100.115');
});
