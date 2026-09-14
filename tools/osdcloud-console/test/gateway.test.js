import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateNetworkGateway, gatewayOptions, networkTopology, validateGatewayInput } from '../src/windows/gateway.js';
import { assertNatSubnetAvailable, subnetsOverlap } from '../src/windows/networkOptions.js';

test('NAT subnet rejects upstream/VPN overlap and ignores its own vNIC/default route', () => {
  assert.equal(subnetsOverlap('10.203.0.0/24', '10.0.0.0/8'), true);
  assert.equal(subnetsOverlap('192.168.100.0/24', '192.168.101.0/24'), false);
  assert.throws(() => assertNatSubnetAvailable('10.203.0.0/24', { routes: [{ interfaceAlias: 'VPN', destinationPrefix: '10.0.0.0/8' }] }), /重疊/);
  assert.doesNotThrow(() => assertNatSubnetAvailable('192.168.100.0/24', { routes: [
    { interfaceAlias: 'WAN', destinationPrefix: '0.0.0.0/0' },
    { interfaceAlias: 'vEthernet (Winception-PXE)', destinationPrefix: '192.168.100.0/24' },
  ] }));
});

test('Windows PowerShell gateway subnet calculation handles normalized CIDR without mutation', { skip: process.platform !== 'win32' }, () => {
  const script = `
$errors = $null; $tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'tools/Configure-WinceptionGateway.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Parser failed' }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-SubnetInfo' }, $true)
Invoke-Expression $definition.Extent.Text
@(Get-SubnetInfo '192.168.100.20/24'; Get-SubnetInfo '10.203.0.2/30'; Get-SubnetInfo '10.20.30.40/8') | ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const values = JSON.parse(result.stdout);
  assert.deepEqual(values.map((item) => item.Gateway), ['192.168.100.1', '10.203.0.1', '10.0.0.1']);
  assert.deepEqual(values.map((item) => item.Cidr), ['192.168.100.0/24', '10.203.0.0/30', '10.0.0.0/8']);
});

test('gateway defaults keep existing configurations on shared LAN', () => {
  assert.equal(networkTopology({}), 'shared-lan');
  assert.deepEqual(gatewayOptions({}), {
    topology: 'shared-lan',
    wanInterfaceAlias: '',
    pxeInterfaceAlias: '',
    switchName: null,
    natName: null,
    internalSubnet: null,
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
