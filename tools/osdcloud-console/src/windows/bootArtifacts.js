import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appRootForConfig, stateRootForConfig } from '../config.js';
import { runPowerShell } from './powershell.js';
import { getFileSha256Sync } from './shared.js';

export function resolveRepoRoot(config = {}) {
  return appRootForConfig(config);
}

export function bootWimSyncMarkerPath(publishedBootWim) {
  return `${publishedBootWim}.sync.json`;
}

export function readBootWimSyncMarker(publishedBootWim) {
  const markerPath = bootWimSyncMarkerPath(publishedBootWim);
  if (!fs.existsSync(markerPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    return null;
  }
}

export const BOOT_WIM_TEMPLATE_SOURCES = [
  ['Windows/System32/Startnet.cmd', ['osdcloud-assets', 'OSDCloud', 'WinPE', 'Windows', 'System32', 'Startnet.cmd']],
  ['OSDCloud/Maximize-Console.ps1', ['osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Maximize-Console.ps1']],
  ['OSDCloud/Start-OSDCloud-iPXE.ps1', ['osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Start-OSDCloud-iPXE.ps1']],
  ['OSDCloud/Report-OSDCloudProgress.ps1', ['osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Report-OSDCloudProgress.ps1']],
  ['OSDCloud/Report-TorrentTelemetry.ps1', ['osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Report-TorrentTelemetry.ps1']],
  ['OSDCloud/Config/Scripts/Shutdown/Invoke-OobeCustomization.ps1', ['osdcloud-assets', 'OSDCloud', 'Config', 'Scripts', 'Shutdown', 'Invoke-OobeCustomization.ps1']],
  ['OSDCloud/Config/Scripts/SetupComplete/SetupComplete.cmd', ['osdcloud-assets', 'OSDCloud', 'Config', 'Scripts', 'SetupComplete', 'SetupComplete.cmd']],
  ['OSDCloud/Config/Scripts/SetupComplete/SetupComplete.ps1', ['osdcloud-assets', 'OSDCloud', 'Config', 'Scripts', 'SetupComplete', 'SetupComplete.ps1']],
];

export function resolveBootWimSecretSource(config) {
  const repoRoot = resolveRepoRoot(config);
  const stateRoot = stateRootForConfig(config);
  const runtimeRoot = config.paths?.osdCloudRoot || 'C:\\OSDCloud';
  const candidates = [
    path.join(stateRoot, 'config', 'osdcloud-secrets.json'),
    path.join(repoRoot, 'config', 'osdcloud-secrets.json'),
    path.join(runtimeRoot, 'secrets.json'),
    path.join(runtimeRoot, 'Config', 'secrets.json'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

export function buildBootWimSyncInputs(config) {
  const repoRoot = resolveRepoRoot(config);
  const serverIp = String(config.adapter?.serverIp ?? '').trim();
  const syncInputs = {
    endpoint: {
      serverIp,
      statusUrl: `http://${serverIp}/osdcloud/status`,
    },
    secrets: {
      present: false,
    },
    templates: {},
  };

  const secretSource = resolveBootWimSecretSource(config);
  if (secretSource) {
    syncInputs.secrets = {
      present: true,
      sha256: getFileSha256Sync(secretSource),
    };
  }

  for (const [relativePath, parts] of BOOT_WIM_TEMPLATE_SOURCES) {
    const sourcePath = path.join(repoRoot, ...parts);
    syncInputs.templates[relativePath] = getFileSha256Sync(sourcePath);
  }

  return syncInputs;
}

export function serializeBootWimSyncInputs(syncInputs) {
  return JSON.stringify(syncInputs);
}

export function hashBootWimSyncInputs(syncInputs) {
  return crypto.createHash('sha256').update(serializeBootWimSyncInputs(syncInputs), 'utf8').digest('hex').toUpperCase();
}

export function diffBootWimSyncInputs(expected, actual) {
  const mismatches = [];
  if (JSON.stringify(expected?.endpoint ?? null) !== JSON.stringify(actual?.endpoint ?? null)) {
    mismatches.push('endpoint settings');
  }
  if (JSON.stringify(expected?.secrets ?? null) !== JSON.stringify(actual?.secrets ?? null)) {
    mismatches.push('deployment secrets');
  }
  if (JSON.stringify(expected?.templates ?? null) !== JSON.stringify(actual?.templates ?? null)) {
    mismatches.push('WinPE template files');
  }
  return mismatches;
}

export function resolveEndpointSyncScript(config = {}) {
  const root = resolveRepoRoot(config);
  const configured = config.paths?.endpointSyncScript;
  if (configured) {
    return path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(root, configured);
  }
  return path.join(root, 'tools', 'Set-OsdCloudIpxeEndpoint.ps1');
}

export function resolveBaseConfigPath(config, repoRoot) {
  return config.__configPath ?? path.join(repoRoot, 'config', 'osdcloud-console.json');
}

export async function syncIpxeEndpoint(config, options = {}) {
  const repoRoot = resolveRepoRoot(config);
  const scriptPath = resolveEndpointSyncScript(config);
  const effectiveConfigPath = config.__savePath ?? config.__localConfigPath ?? config.__configPath ?? path.join(repoRoot, 'config', 'osdcloud-console.json');
  const shareName = String(config.smb.share).split('\\').filter(Boolean).at(-1) || 'OSDCloudiPXE';
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ConfigPath',
    effectiveConfigPath,
    '-InterfaceAlias',
    config.adapter.interfaceAlias,
    '-ServerIp',
    config.adapter.serverIp,
    '-PrefixLength',
    String(config.adapter.prefixLength),
    '-DefaultGateway',
    config.dhcp.router,
    '-SmbShareName',
    shareName,
  ];

  if (config.paths.imageNamePattern) {
    args.push('-ImageNamePattern', config.paths.imageNamePattern);
  }

  if (options.commitWinPe !== false) {
    args.push('-CommitWinPe');
  }
  if (options.syncAssets === true) {
    args.push('-SyncAssets');
  }
  if (options.hashLargeArtifacts !== false) {
    args.push('-HashLargeArtifacts');
  }

  const result = await runPowerShell(args, {
    cwd: repoRoot,
    onStdout: options.onOutput ? (text) => options.onOutput(text, 'stdout') : undefined,
    onStderr: options.onOutput ? (text) => options.onOutput(text, 'stderr') : undefined,
  });
  return result.stdout.trim();
}
