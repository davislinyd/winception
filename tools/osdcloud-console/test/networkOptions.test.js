import test from 'node:test';
import assert from 'node:assert/strict';
import { readNetworkOptions, assertNatSubnetAvailable } from '../src/windows/networkOptions.js';

test('read-only inventory includes disconnected NIC without IPv4 and chooses a non-overlapping subnet', async () => {
  const options = await readNetworkOptions({ execute: async (args) => {
    assert.match(args.at(-1), /Get-NetAdapter -Physical/);
    assert.doesNotMatch(args.at(-1), /(?:New|Set|Remove|Stop|Start)-(?:Net|VM|Service)/);
    return { stdout: JSON.stringify({
      adapters: [{ interfaceAlias: 'Wi-Fi', ipv4: [{ ipAddress: '192.168.100.20', prefixLength: 24 }] },
        { interfaceAlias: 'USB Ethernet', status: 'Disconnected', ipv4: [] }],
      routes: [{ interfaceAlias: 'Wi-Fi', destinationPrefix: '192.168.100.0/24' },
        { interfaceAlias: 'VPN', destinationPrefix: '10.0.0.0/8' }],
      serviceAddresses: [], natNetworks: [], icsRunning: true,
    }) };
  } });
  assert.equal(options.adapters[1].interfaceAlias, 'USB Ethernet');
  assert.deepEqual(options.adapters[1].ipv4, []);
  assert.equal(options.suggestedSubnet, '172.30.100.0/24');
  assert.equal(options.icsRunning, true);
  assert.throws(() => assertNatSubnetAvailable('172.30.100.0/24', { routes: [
    { interfaceAlias: 'VPN', destinationPrefix: '172.30.100.21/32' },
  ] }), /VPN/);
});
