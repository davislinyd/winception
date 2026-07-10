import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateNetworkGateway, gatewayOptions, networkTopology, validateGatewayInput } from '../src/windows/gateway.js';

test('gateway defaults keep existing configurations on shared LAN', () => {
  assert.equal(networkTopology({}), 'shared-lan');
  assert.deepEqual(gatewayOptions({}), {
    topology: 'shared-lan',
    wanInterfaceAlias: '',
    pxeInterfaceAlias: '',
    switchName: 'Winception-PXE',
    natName: 'WinceptionNAT',
    internalSubnet: '192.168.100.0/24',
  });
  assert.equal(evaluateNetworkGateway({}, null).ok, true);
});

test('gateway input requires distinct adapters and a supported IPv4 subnet', () => {
  assert.throws(() => validateGatewayInput({ wanInterfaceAlias: 'Wi-Fi', pxeInterfaceAlias: 'Wi-Fi' }), /must be different/);
  assert.throws(() => validateGatewayInput({ wanInterfaceAlias: 'Wi-Fi', pxeInterfaceAlias: 'Ethernet', internalSubnet: '192.168.100.0/31' }), /Invalid internal subnet/);
  assert.deepEqual(validateGatewayInput({ wanInterfaceAlias: 'Wi-Fi', pxeInterfaceAlias: 'Ethernet', internalSubnet: '10.20.0.0/24' }), {
    wanInterfaceAlias: 'Wi-Fi', pxeInterfaceAlias: 'Ethernet', internalSubnet: '10.20.0.0/24',
  });
});

test('gateway readiness is blocking for dual NIC NAT only', () => {
  const config = { network: { topology: 'dual-nic-nat', nat: {} } };
  assert.equal(evaluateNetworkGateway(config, { ready: false, detail: 'WAN has no route' }).ok, false);
  assert.equal(evaluateNetworkGateway(config, { ready: true, virtualAdapter: { name: 'vEthernet (Winception-PXE)' }, wan: { name: 'Wi-Fi' }, nat: { name: 'WinceptionNAT' } }).ok, true);
});

test('gateway PowerShell only owns named resources and never disables the firewall', () => {
  const script = fs.readFileSync(path.resolve('tools/Configure-WinceptionGateway.ps1'), 'utf8');
  assert.match(script, /New-VMSwitch -Name \$SwitchName -NetAdapterName \$PxeInterfaceAlias -AllowManagementOS \$true/);
  assert.match(script, /New-NetNat -Name \$NatName -InternalIPInterfaceAddressPrefix \$subnet\.Cidr/);
  assert.match(script, /Set-NetIPInterface -InterfaceAlias \$virtualAlias -AddressFamily IPv4 -Forwarding Enabled/);
  assert.match(script, /Assert-PhysicalGatewayAdapter -InterfaceAlias \$WanInterfaceAlias -Role 'WAN interface'/);
  assert.match(script, /PXE interface must be a physical NIC/);
  assert.doesNotMatch(script, /Set-NetFirewallProfile/);
  assert.doesNotMatch(script, /Get-NetNat \| Remove-NetNat/);
});
