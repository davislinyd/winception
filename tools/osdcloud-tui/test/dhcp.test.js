import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LeasePool,
  broadcastAddress,
  getDhcpMessageType,
  getRequestedIp,
  isIpxeClient,
  ipv4ToUInt32,
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
  assert.equal(ipv4ToUInt32('192.168.100.100'), 2887085156);
  assert.equal(uint32ToIPv4(2887085156), '192.168.100.100');
  assert.equal(broadcastAddress('192.168.100.100', '255.255.255.0'), '192.168.100.255');
});

test('parses DHCP message type, requested IP, and iPXE markers', () => {
  const packet = packetWithOptions([
    [53, [1]],
    [50, [172, 21, 108, 222]],
    [60, [...Buffer.from('iPXE', 'ascii')]],
  ]);

  assert.equal(getDhcpMessageType(packet), 1);
  assert.equal(getRequestedIp(packet), '192.168.100.222');
  assert.equal(isIpxeClient(packet), true);
});

test('allocates requested IPs only inside the lease pool', () => {
  const pool = new LeasePool('192.168.100.200', '192.168.100.0');
  assert.equal(pool.getLease('AA-BB-CC-00-00-01', '192.168.100.201'), '192.168.100.201');
  assert.equal(pool.getLease('AA-BB-CC-00-00-01', '192.168.100.0'), '192.168.100.201');
  assert.equal(pool.getLease('AA-BB-CC-00-00-02', '192.168.100.201'), '192.168.100.200');
  assert.equal(pool.getLease('AA-BB-CC-00-00-03', '10.0.0.10'), '192.168.100.0');
});
