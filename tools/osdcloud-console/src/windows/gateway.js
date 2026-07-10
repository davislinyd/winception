import path from 'node:path';
import { appRootForConfig, stateRootForConfig } from '../config.js';
import { ipv4ToUInt32 } from '../dhcp.js';
import { runPowerShell } from './powershell.js';
import { fail, pass } from './shared.js';

export const sharedLanTopology = 'shared-lan';
export const dualNicNatTopology = 'dual-nic-nat';

export function networkTopology(config = {}) {
  return config.network?.topology === dualNicNatTopology ? dualNicNatTopology : sharedLanTopology;
}

export function gatewayOptions(config = {}) {
  const nat = config.network?.nat ?? {};
  return {
    topology: networkTopology(config),
    wanInterfaceAlias: String(nat.wanInterfaceAlias ?? ''),
    pxeInterfaceAlias: String(nat.pxeInterfaceAlias ?? ''),
    switchName: String(nat.switchName ?? 'Winception-PXE'),
    natName: String(nat.natName ?? 'WinceptionNAT'),
    internalSubnet: String(nat.internalSubnet ?? '192.168.100.0/24'),
  };
}

export function gatewayScriptPath(config = {}) {
  return path.join(appRootForConfig(config), 'tools', 'Configure-WinceptionGateway.ps1');
}

function parseGatewayResult(output) {
  const text = String(output ?? '').trim();
  if (!text) {
    throw new Error('Gateway script returned no JSON state.');
  }
  return JSON.parse(text);
}

function commandArgs(config, action, options = {}) {
  const gateway = gatewayOptions(config);
  return [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', gatewayScriptPath(config),
    '-Action', action,
    '-WanInterfaceAlias', options.wanInterfaceAlias ?? gateway.wanInterfaceAlias,
    '-PxeInterfaceAlias', options.pxeInterfaceAlias ?? gateway.pxeInterfaceAlias,
    '-InternalSubnet', options.internalSubnet ?? gateway.internalSubnet,
    '-SwitchName', gateway.switchName,
    '-NatName', gateway.natName,
    '-ConfigPath', config.__savePath ?? config.__localConfigPath ?? config.__configPath ?? '',
    '-StateRoot', stateRootForConfig(config),
  ];
}

export async function inspectNetworkGateway(config) {
  if (networkTopology(config) !== dualNicNatTopology) {
    return {
      topology: sharedLanTopology,
      ready: true,
      detail: 'Shared LAN: client Internet is provided by the selected LAN/router.',
    };
  }
  const result = await runPowerShell(commandArgs(config, 'Inspect'));
  return parseGatewayResult(result.stdout);
}

export async function prepareNetworkGateway(config, input = {}) {
  const result = await runPowerShell(commandArgs(config, 'Prepare', input), {
    onStdout: input.onOutput,
    onStderr: input.onOutput,
  });
  return parseGatewayResult(result.stdout);
}

export async function removeNetworkGateway(config, input = {}) {
  const result = await runPowerShell(commandArgs(config, 'Remove', input), {
    onStdout: input.onOutput,
    onStderr: input.onOutput,
  });
  return parseGatewayResult(result.stdout);
}

function subnetStart(internalSubnet) {
  const [address, rawPrefix] = String(internalSubnet).split('/');
  const prefix = Number(rawPrefix);
  if (!address || !Number.isInteger(prefix) || prefix < 8 || prefix > 30) {
    throw new Error(`Invalid internal subnet: ${internalSubnet}`);
  }
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return { address, prefix, value: ipv4ToUInt32(address) & mask };
}

export function validateGatewayInput(input = {}) {
  const wanInterfaceAlias = String(input.wanInterfaceAlias ?? '').trim();
  const pxeInterfaceAlias = String(input.pxeInterfaceAlias ?? '').trim();
  const internalSubnet = String(input.internalSubnet ?? '192.168.100.0/24').trim();
  if (!wanInterfaceAlias || !pxeInterfaceAlias) {
    throw new Error('Select both WAN and PXE interfaces.');
  }
  if (wanInterfaceAlias === pxeInterfaceAlias) {
    throw new Error('WAN and PXE interfaces must be different.');
  }
  subnetStart(internalSubnet);
  return { wanInterfaceAlias, pxeInterfaceAlias, internalSubnet };
}

export function evaluateNetworkGateway(config, state) {
  if (networkTopology(config) !== dualNicNatTopology) {
    return pass('Network topology', 'shared-lan: client Internet is owned by the existing LAN/router');
  }
  if (!state?.ready) {
    return fail('Winception NAT gateway', state?.detail ?? state?.error ?? 'dual-nic-nat is not ready');
  }
  return pass('Winception NAT gateway', `${state.virtualAdapter?.name ?? 'PXE vNIC'} -> ${state.wan?.name ?? 'WAN'} (${state.nat?.name ?? 'WinNAT'})`);
}
