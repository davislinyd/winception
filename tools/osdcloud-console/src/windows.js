import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import dgram from 'node:dgram';
import path from 'node:path';
import crypto from 'node:crypto';
import { appRootForConfig, stateRootForConfig, resolveHttpFile } from './config.js';
import { ipv4ToUInt32 } from './dhcp.js';
import { evaluateDeploymentProfilePayload } from './deploymentProfiles.js';
import { evaluateOsImageCache } from './osImages.js';
import {
  collectProcessOutput,
  preparePowerShellArgs as prepareProcessPowerShellArgs,
} from './processOutput.js';

export { preparePowerShellArgs } from './processOutput.js';

function getFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
    stream.on('error', (err) => reject(err));
  });
}

function getFileSha256Sync(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function powershellExe() {
  return process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
}

export function runPowerShell(args, options = {}) {
  const { onStdout, onStderr, ...spawnOptions } = options;
  const child = spawn(powershellExe(), prepareProcessPowerShellArgs(args), {
    windowsHide: true,
    ...spawnOptions,
  });
  return collectProcessOutput(child, { onStdout, onStderr }).then((result) => {
    if (result.code === 0) {
      return result;
    }
    const error = new Error(result.stderr.trim() || result.stdout.trim() || `PowerShell exited with code ${result.code}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.code = result.code;
    throw error;
  });
}

export async function isElevated() {
  if (process.platform !== 'win32') {
    return process.getuid?.() === 0;
  }
  const script = "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)";
  const result = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  return result.stdout.trim().toLowerCase() === 'true';
}

export function isElevatedSync() {
  if (process.platform !== 'win32') {
    return process.getuid?.() === 0;
  }
  const script = "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)";
  const result = spawnSync(powershellExe(), prepareProcessPowerShellArgs([
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]), {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return String(result.stdout ?? '').trim().toLowerCase() === 'true';
  }
  const message = String(result.stderr ?? '').trim() || String(result.stdout ?? '').trim() || `PowerShell exited with code ${result.status}`;
  throw new Error(message);
}

export async function getAdapterState(config) {
  const alias = config.adapter.interfaceAlias.replaceAll("'", "''");
  const script = `
$adapter = Get-NetAdapter -Name '${alias}' -ErrorAction Stop
$ip = Get-NetIPAddress -InterfaceAlias '${alias}' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Select-Object -First 1 IPAddress,PrefixLength
$route = Get-NetRoute -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
  Select-Object -First 1 NextHop,RouteMetric
[pscustomobject]@{
  Name = $adapter.Name
  Status = $adapter.Status
  MacAddress = $adapter.MacAddress
  InterfaceIndex = $adapter.ifIndex
  IPv4 = $ip.IPAddress
  PrefixLength = $ip.PrefixLength
  Gateway = $route.NextHop
  RouteMetric = $route.RouteMetric
} | ConvertTo-Json -Compress
`;
  const result = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  return JSON.parse(result.stdout);
}

function toPowerShellArray(values) {
  return values.map((value) => `'${String(value).replaceAll("'", "''")}'`).join(', ');
}

function asArray(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function escapePowerShellString(value) {
  return String(value ?? '').replaceAll("'", "''");
}

export function parseUncPath(value) {
  const text = String(value ?? '');
  if (!text.startsWith('\\\\')) {
    return null;
  }

  const parts = text.split(/[\\/]+/u).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  return {
    server: parts[0],
    shareName: parts[1],
    relativePath: parts.slice(2).join(path.win32.sep),
  };
}

function shareNameFromConfig(config = {}) {
  return parseUncPath(config.smb?.share)?.shareName
    ?? config.smb?.shareName
    ?? parseUncPath(config.smb?.imagePath)?.shareName
    ?? '';
}

function isAllowAccess(value) {
  const text = String(value ?? '').toLowerCase();
  return text === 'allow' || text === '0';
}

function hasReadRight(value) {
  const text = String(value ?? '').toLowerCase();
  return ['read', 'change', 'full', 'fullcontrol', '0', '1', '2'].includes(text);
}

function accountMatches(accountName, expectedUser) {
  const account = String(accountName ?? '').toLowerCase();
  const user = String(expectedUser ?? '').toLowerCase();
  return account === user || account.endsWith(`\\${user}`);
}

export function smbAccessAllowsRead(accessEntries, expectedUser = 'pxeinstall') {
  return asArray(accessEntries).some((entry) => (
    accountMatches(entry.AccountName ?? entry.accountName, expectedUser)
    && isAllowAccess(entry.AccessControlType ?? entry.accessControlType)
    && hasReadRight(entry.AccessRight ?? entry.accessRight)
  ));
}

export function smbBackingImagePath(imagePath, shareInfo) {
  const unc = parseUncPath(imagePath);
  if (!unc) {
    return path.resolve(imagePath);
  }

  if (!shareInfo?.Path) {
    return null;
  }

  const root = path.win32.resolve(String(shareInfo.Path));
  const resolved = path.win32.resolve(root, unc.relativePath);
  const rootWithSeparator = root.endsWith(path.win32.sep) ? root : `${root}${path.win32.sep}`;
  if (resolved !== root && !resolved.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    return null;
  }

  return resolved;
}

export function normalizeIpv4ServiceInterfaces(records) {
  return asArray(records)
    .map((record) => ({
      interfaceAlias: record.InterfaceAlias ?? record.interfaceAlias,
      interfaceIndex: Number(record.InterfaceIndex ?? record.interfaceIndex),
      interfaceDescription: record.InterfaceDescription ?? record.interfaceDescription ?? '',
      status: record.Status ?? record.status ?? '',
      macAddress: record.MacAddress ?? record.macAddress ?? '',
      linkSpeed: record.LinkSpeed ?? record.linkSpeed ?? '',
      ipAddress: record.IPAddress ?? record.ipAddress,
      prefixLength: Number(record.PrefixLength ?? record.prefixLength),
      gateway: record.Gateway ?? record.gateway ?? '',
    }))
    .filter((record) => (
      record.status === 'Up'
      && record.interfaceAlias
      && record.ipAddress
      && !record.ipAddress.startsWith('169.254.')
      && record.ipAddress !== '0.0.0.0'
      && Number.isInteger(record.prefixLength)
    ))
    .sort((a, b) => (
      a.interfaceAlias.localeCompare(b.interfaceAlias, undefined, { numeric: true })
      || a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true })
    ));
}

export async function listIpv4ServiceInterfaces() {
  const script = `
$rows = foreach ($ip in Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue) {
  if ([string]::IsNullOrWhiteSpace($ip.IPAddress) -or $ip.IPAddress.StartsWith('169.254.') -or $ip.IPAddress -eq '0.0.0.0') {
    continue
  }
  $adapter = Get-NetAdapter -InterfaceIndex $ip.InterfaceIndex -ErrorAction SilentlyContinue
  if (-not $adapter -or $adapter.Status.ToString() -ne 'Up') {
    continue
  }
  $route = Get-NetRoute -InterfaceIndex $ip.InterfaceIndex -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric |
    Select-Object -First 1
  [pscustomobject]@{
    InterfaceAlias = $adapter.Name
    InterfaceIndex = $adapter.ifIndex
    InterfaceDescription = $adapter.InterfaceDescription
    Status = $adapter.Status.ToString()
    MacAddress = $adapter.MacAddress
    LinkSpeed = $adapter.LinkSpeed
    IPAddress = $ip.IPAddress
    PrefixLength = $ip.PrefixLength
    Gateway = if ($route) { $route.NextHop } else { '' }
  }
}
@($rows) | ConvertTo-Json -Compress
`;
  const result = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  return normalizeIpv4ServiceInterfaces(JSON.parse(result.stdout || '[]'));
}

export function getServiceBindIps(config) {
  return [...new Set([
    config.http?.host,
    config.dhcp?.listenIp,
    config.tftp?.listenIp,
  ].filter((ip) => ip && ip !== '0.0.0.0'))];
}

function prefixLengthToMask(prefixLength) {
  const prefix = Number(prefixLength);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid IPv4 prefix length: ${prefixLength}`);
  }
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

function isIpv4InPrefix(address, networkAddress, prefixLength) {
  const mask = prefixLengthToMask(prefixLength);
  return (ipv4ToUInt32(address) & mask) === (ipv4ToUInt32(networkAddress) & mask);
}

export function evaluateDhcpSubnet(config) {
  const serverIp = config.adapter?.serverIp;
  const prefixLength = config.adapter?.prefixLength;
  const values = [
    ['lease start', config.dhcp?.leaseStartIp],
    ['lease end', config.dhcp?.leaseEndIp],
    ['router', config.dhcp?.router],
  ].filter(([, value]) => value);

  try {
    const outside = values.filter(([, value]) => !isIpv4InPrefix(value, serverIp, prefixLength));
    if (outside.length > 0) {
      return fail(
        'DHCP subnet',
        `${outside.map(([name, value]) => `${name}=${value}`).join(', ')} outside ${serverIp}/${prefixLength}`,
      );
    }
    return pass(
      'DHCP subnet',
      `lease=${config.dhcp.leaseStartIp}-${config.dhcp.leaseEndIp} router=${config.dhcp.router} within ${serverIp}/${prefixLength}`,
    );
  } catch (error) {
    return fail('DHCP subnet', error.message);
  }
}

export function evaluateServiceIp(config, states, targetIp) {
  const expectedPrefix = config.adapter?.serverIp === targetIp && config.adapter?.prefixLength !== undefined
    ? Number(config.adapter.prefixLength)
    : undefined;
  const matches = states.filter((state) => state.TargetIp === targetIp);
  const expected = expectedPrefix === undefined ? targetIp : `${targetIp}/${expectedPrefix}`;

  // The address is not assigned to any IPv4 interface — a real misconfiguration.
  if (matches.length === 0) {
    return fail(`Service IP ${targetIp}`, `not assigned to any IPv4 interface; expected ${expected}`);
  }

  const prefixOk = (state) => expectedPrefix === undefined || Number(state.PrefixLength) === expectedPrefix;
  const prefixMatches = matches.filter(prefixOk);

  // The address exists but on the wrong prefix/interface — a real misconfiguration.
  if (prefixMatches.length === 0) {
    return fail(
      `Service IP ${targetIp}`,
      matches.map((state) => (
        `${state.InterfaceAlias} status=${state.Status} actual=${state.IPAddress}/${state.PrefixLength} state=${state.AddressState || 'unknown'} expected=${expected}`
      )).join('; '),
    );
  }

  // Fully ready: link up and the address is Preferred.
  const good = prefixMatches.find((state) => (
    state.Status === 'Up'
    && (!state.AddressState || state.AddressState === 'Preferred')
  ));
  if (good) {
    return pass(
      `Service IP ${targetIp}`,
      `${good.InterfaceAlias} ${good.IPAddress}/${good.PrefixLength}`,
    );
  }

  // Hard blockers even with the right prefix: a duplicate address means another
  // host already owns the IP, and a Disabled adapter means the IP is not usable.
  const duplicate = prefixMatches.find((state) => state.AddressState === 'Duplicate');
  if (duplicate) {
    return fail(
      `Service IP ${targetIp}`,
      `${duplicate.InterfaceAlias} reports a DUPLICATE address ${duplicate.IPAddress}/${duplicate.PrefixLength}; another host already owns ${expected}`,
    );
  }
  const disabled = prefixMatches.find((state) => state.Status === 'Disabled');
  if (disabled) {
    return fail(
      `Service IP ${targetIp}`,
      `${disabled.InterfaceAlias} is Disabled; enable the adapter so ${expected} becomes usable`,
    );
  }

  // Correct IP + prefix on the expected interface, but the link is not up yet
  // (Status=Disconnected) or the address is Deprecated/Tentative — e.g. the
  // client or switch is not connected. Services can still bind to this address
  // (the UDP/TCP port checks confirm bindability), so this is a non-blocking
  // warning: the operator may legitimately start services before the link is up.
  const degraded = prefixMatches[0];
  return warn(
    `Service IP ${targetIp}`,
    `${degraded.InterfaceAlias} link is not up (status=${degraded.Status} state=${degraded.AddressState || 'unknown'}); ${degraded.IPAddress}/${degraded.PrefixLength} is configured and bindable. Services can start but will not serve clients until the link is up.`,
  );
}

export async function getServiceIpStates(config) {
  const bindIps = getServiceBindIps(config);
  if (bindIps.length === 0) {
    return [];
  }
  const script = `
$targetIps = @(${toPowerShellArray(bindIps)})
$addresses = foreach ($targetIp in $targetIps) {
  Get-NetIPAddress -AddressFamily IPv4 -IPAddress $targetIp -ErrorAction SilentlyContinue | ForEach-Object {
    $adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
    [pscustomobject]@{
      TargetIp = $targetIp
      IPAddress = $_.IPAddress
      PrefixLength = $_.PrefixLength
      AddressState = $_.AddressState.ToString()
      InterfaceAlias = $_.InterfaceAlias
      InterfaceIndex = $_.InterfaceIndex
      Status = if ($adapter) { $adapter.Status.ToString() } else { $null }
      MacAddress = if ($adapter) { $adapter.MacAddress } else { $null }
      InterfaceDescription = if ($adapter) { $adapter.InterfaceDescription } else { $null }
    }
  }
}
@($addresses) | ConvertTo-Json -Compress
`;
  const result = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  return asArray(JSON.parse(result.stdout || '[]'));
}

export async function getSmbShareInfo(shareName) {
  const safeShareName = escapePowerShellString(shareName);
  const script = `
$share = Get-SmbShare -Name '${safeShareName}' -ErrorAction Stop
$access = @(Get-SmbShareAccess -Name '${safeShareName}' -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    AccountName = $_.AccountName
    AccessControlType = $_.AccessControlType.ToString()
    AccessRight = $_.AccessRight.ToString()
  }
})
[pscustomobject]@{
  Name = $share.Name
  Path = $share.Path
  Access = $access
} | ConvertTo-Json -Compress -Depth 4
`;
  const result = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  return JSON.parse(result.stdout);
}

export function resolveRepoRoot(config = {}) {
  return appRootForConfig(config);
}

function bootWimSyncMarkerPath(publishedBootWim) {
  return `${publishedBootWim}.sync.json`;
}

function readBootWimSyncMarker(publishedBootWim) {
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

const BOOT_WIM_TEMPLATE_SOURCES = [
  ['Windows/System32/Startnet.cmd', ['osdcloud-assets', 'OSDCloud', 'WinPE', 'Windows', 'System32', 'Startnet.cmd']],
  ['OSDCloud/Maximize-Console.ps1', ['osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Maximize-Console.ps1']],
  ['OSDCloud/Start-OSDCloud-iPXE.ps1', ['osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Start-OSDCloud-iPXE.ps1']],
  ['OSDCloud/Report-OSDCloudProgress.ps1', ['osdcloud-assets', 'OSDCloud', 'WinPE', 'OSDCloud', 'Report-OSDCloudProgress.ps1']],
  ['OSDCloud/Config/Scripts/Shutdown/Invoke-OobeCustomization.ps1', ['osdcloud-assets', 'OSDCloud', 'Config', 'Scripts', 'Shutdown', 'Invoke-OobeCustomization.ps1']],
  ['OSDCloud/Config/Scripts/SetupComplete/SetupComplete.cmd', ['osdcloud-assets', 'OSDCloud', 'Config', 'Scripts', 'SetupComplete', 'SetupComplete.cmd']],
  ['OSDCloud/Config/Scripts/SetupComplete/SetupComplete.ps1', ['osdcloud-assets', 'OSDCloud', 'Config', 'Scripts', 'SetupComplete', 'SetupComplete.ps1']],
];

function resolveBootWimSecretSource(config) {
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

function serializeBootWimSyncInputs(syncInputs) {
  return JSON.stringify(syncInputs);
}

export function hashBootWimSyncInputs(syncInputs) {
  return crypto.createHash('sha256').update(serializeBootWimSyncInputs(syncInputs), 'utf8').digest('hex').toUpperCase();
}

function diffBootWimSyncInputs(expected, actual) {
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

function resolveBaseConfigPath(config, repoRoot) {
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

export async function prepareRuntimeArtifacts(config, options = {}) {
  const repoRoot = resolveRepoRoot(config);
  const scriptPath = path.join(repoRoot, 'tools', 'Restore-DeploymentArtifacts.ps1');
  const baseConfigPath = resolveBaseConfigPath(config, repoRoot);
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-CatalogPath',
    config.runtimeArtifacts?.catalogPath ?? path.join(repoRoot, 'config', 'runtime-artifacts.json'),
    '-LiveRoot',
    config.runtimeArtifacts?.liveRoot ?? 'C:\\OSDCloud',
    '-ConfigPath',
    baseConfigPath,
  ];
  if (options.includeOptional === true) {
    args.push('-IncludeOptional');
  }
  if (options.noAdkAutoInstall === true) {
    args.push('-NoAdkAutoInstall');
  }
  if (options.skipOsImageDownload === true) {
    args.push('-SkipOsImageDownload');
  }
  if (options.skipWinPeBuild === true) {
    args.push('-SkipWinPeBuild');
  }

  const result = await runPowerShell(args, {
    cwd: repoRoot,
    onStdout: options.onOutput ? (text) => options.onOutput(text, 'stdout') : undefined,
    onStderr: options.onOutput ? (text) => options.onOutput(text, 'stderr') : undefined,
  });
  return result.stdout.trim();
}

export function checkTcpPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => resolve({ ok: false, message: error.message }));
    server.listen(port, host, () => {
      server.close(() => resolve({ ok: true, message: 'available' }));
    });
  });
}

export function checkUdpPortAvailable(host, port) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', (error) => resolve({ ok: false, message: error.message }));
    socket.bind(port, host, () => {
      socket.close(() => resolve({ ok: true, message: 'available' }));
    });
  });
}

function pass(name, detail = '') {
  return { name, ok: true, detail };
}

function fail(name, detail = '') {
  return { name, ok: false, detail };
}

// A non-blocking caveat: the check is satisfied enough to start services, but
// the operator should be aware of a degraded condition (e.g. the service link
// is not up yet). `ok: true` keeps it out of the blocking set; `warn: true`
// lets the UI surface it distinctly.
function warn(name, detail = '') {
  return { name, ok: true, warn: true, detail };
}

export async function evaluateSmbImage(config, options = {}) {
  const imagePath = String(config.smb?.imagePath ?? '');
  if (!imagePath) {
    return fail('SMB image', 'smb.imagePath is not configured');
  }

  const imageUnc = parseUncPath(imagePath);
  if (!imageUnc) {
    return fs.existsSync(imagePath)
      ? pass('SMB image', `${imagePath} (local image path)`)
      : fail('SMB image', `image missing: ${imagePath}`);
  }

  const expectedShareName = shareNameFromConfig(config);
  if (!expectedShareName) {
    return fail('SMB image', `SMB share is not configured for ${imagePath}`);
  }
  if (imageUnc.shareName.toLowerCase() !== expectedShareName.toLowerCase()) {
    return fail('SMB image', `image path share ${imageUnc.shareName} does not match configured share ${expectedShareName}`);
  }

  let shareInfo;
  try {
    shareInfo = Object.hasOwn(options, 'shareInfo')
      ? options.shareInfo
      : await getSmbShareInfo(expectedShareName);
  } catch (error) {
    return fail('SMB image', `SMB share ${expectedShareName} not available: ${error.message}`);
  }

  if (!shareInfo) {
    return fail('SMB image', `SMB share not found: ${expectedShareName}`);
  }
  if (shareInfo.Name && String(shareInfo.Name).toLowerCase() !== expectedShareName.toLowerCase()) {
    return fail('SMB image', `SMB share mismatch: expected ${expectedShareName}, found ${shareInfo.Name}`);
  }

  const backingPath = smbBackingImagePath(imagePath, shareInfo);
  if (!backingPath) {
    return fail('SMB image', `unable to map ${imagePath} to SMB backing path ${shareInfo.Path ?? '<missing>'}`);
  }

  const fileExists = options.fileExists ?? fs.existsSync;
  if (!fileExists(backingPath)) {
    return fail('SMB image', `image missing: ${backingPath} from ${imagePath}`);
  }

  const accessUser = options.accessUser ?? config.smb?.username ?? 'pxeinstall';
  if (!smbAccessAllowsRead(shareInfo.Access ?? shareInfo.access, accessUser)) {
    return fail('SMB image', `SMB share ${expectedShareName} does not grant read access to ${accessUser}`);
  }

  return pass('SMB image', `${imagePath} (backing=${backingPath}; ${accessUser} read access)`);
}

export async function evaluateBootWimCustomization(publishedBootWim) {
  if (!fs.existsSync(publishedBootWim)) {
    return fail('WinPE boot.wim customization', `Published boot.wim is missing at ${publishedBootWim}`);
  }

  const marker = readBootWimSyncMarker(publishedBootWim);

  if (!marker || typeof marker.publishedSha256 !== 'string') {
    return fail(
      'WinPE boot.wim customization',
      'The published boot.wim has not been customized. You must run Endpoint Sync to inject WinPE settings before PXE boot.',
    );
  }

  let publishedHash;
  try {
    publishedHash = await getFileSha256(publishedBootWim);
  } catch (error) {
    return fail('WinPE boot.wim customization', `Failed to calculate boot.wim hash: ${error.message}`);
  }

  if (publishedHash !== marker.publishedSha256.toUpperCase()) {
    return fail(
      'WinPE boot.wim customization',
      'The published boot.wim has changed since the last Endpoint Sync. You must run Endpoint Sync to re-customize WinPE before PXE boot.',
    );
  }

  const syncedAt = marker.syncedAtUtc ? ` (last synced ${marker.syncedAtUtc})` : '';
  return pass('WinPE boot.wim customization', `The published boot.wim has been customized${syncedAt}.`);
}

function checkBootWimSyncStateLegacy(config, publishedBootWim) {
  if (!fs.existsSync(publishedBootWim)) {
    return fail('WinPE boot.wim synchronization', 'Published boot.wim is missing. Cannot check synchronization status.');
  }

  try {
    const stateRoot = stateRootForConfig(config);
    const secretsPath = path.join(stateRoot, 'config', 'osdcloud-secrets.json');
    const configPath = config.__configPath;
    const localConfigPath = config.__localConfigPath;

    const publishedMtime = fs.statSync(publishedBootWim).mtimeMs;
    let outOfSync = false;
    const details = [];

    if (fs.existsSync(secretsPath)) {
      const secretsMtime = fs.statSync(secretsPath).mtimeMs;
      if (secretsMtime > publishedMtime) {
        outOfSync = true;
        details.push('secrets');
      }
    }
    if (configPath && fs.existsSync(configPath)) {
      const configMtime = fs.statSync(configPath).mtimeMs;
      if (configMtime > publishedMtime) {
        outOfSync = true;
        details.push('config');
      }
    }
    if (localConfigPath && fs.existsSync(localConfigPath)) {
      const localConfigMtime = fs.statSync(localConfigPath).mtimeMs;
      if (localConfigMtime > publishedMtime) {
        outOfSync = true;
        details.push('local config');
      }
    }

    if (outOfSync) {
      return fail(
        'WinPE boot.wim synchronization',
        `The published boot.wim is older than the current ${details.join(' and ')}. You must run Endpoint Sync to apply settings/secrets changes to the WinPE boot image.`,
      );
    }

    return pass(
      'WinPE boot.wim synchronization',
      'The published boot.wim is up to date with configuration and secrets.',
    );
  } catch (error) {
    return fail('WinPE boot.wim synchronization', `Failed to check configuration timestamps: ${error.message}`);
  }
}

export function checkBootWimSyncState(config, publishedBootWim) {
  if (!fs.existsSync(publishedBootWim)) {
    return fail('WinPE boot.wim synchronization', 'Published boot.wim is missing. Cannot check synchronization status.');
  }

  const marker = readBootWimSyncMarker(publishedBootWim);
  if (!marker || typeof marker.publishedSha256 !== 'string' || typeof marker.syncInputsSha256 !== 'string') {
    const legacy = checkBootWimSyncStateLegacy(config, publishedBootWim);
    if (!legacy.ok) {
      return legacy;
    }
    return pass(
      'WinPE boot.wim synchronization',
      'The published boot.wim is up to date with configuration and secrets (legacy sync marker; run Endpoint Sync to upgrade to input fingerprint checks).',
    );
  }

  if (!marker.syncInputs || typeof marker.syncInputs !== 'object') {
    return fail(
      'WinPE boot.wim synchronization',
      'The published boot.wim sync marker is invalid. Run Endpoint Sync to regenerate fingerprint metadata.',
    );
  }

  try {
    const currentInputs = buildBootWimSyncInputs(config);
    const currentSha256 = hashBootWimSyncInputs(currentInputs);
    if (currentSha256 === String(marker.syncInputsSha256).toUpperCase()) {
      return pass(
        'WinPE boot.wim synchronization',
        'The published boot.wim is up to date with WinPE sync inputs.',
      );
    }

    const mismatches = diffBootWimSyncInputs(marker.syncInputs, currentInputs);
    const detail = mismatches.length > 0 ? mismatches.join(', ') : 'WinPE sync inputs';
    return fail(
      'WinPE boot.wim synchronization',
      `The published boot.wim is out of date with current ${detail}. You must run Endpoint Sync to apply WinPE input changes before PXE boot.`,
    );
  } catch (error) {
    return fail('WinPE boot.wim synchronization', `Failed to check WinPE sync inputs: ${error.message}`);
  }
}

export async function runPreflight(config, services = {}) {
  const checks = [];

  try {
    checks.push((await isElevated()) ? pass('Administrator', 'running elevated') : fail('Administrator', 'run elevated before binding ports 67/69/80'));
  } catch (error) {
    checks.push(fail('Administrator', error.message));
  }

  try {
    const serviceIpStates = await getServiceIpStates(config);
    const bindIps = getServiceBindIps(config);
    if (bindIps.length === 0) {
      checks.push(pass('Service IP', 'services bind all IPv4 interfaces'));
    } else {
      checks.push(...bindIps.map((targetIp) => evaluateServiceIp(config, serviceIpStates, targetIp)));
    }
  } catch (error) {
    checks.push(fail('Service IP', error.message));
  }

  checks.push(evaluateDhcpSubnet(config));

  for (const relativePath of config.paths.expectedHttpFiles) {
    const filePath = resolveHttpFile(config.http.root, relativePath);
    checks.push(fs.existsSync(filePath) ? pass(`HTTP file ${relativePath}`, filePath) : fail(`HTTP file ${relativePath}`, filePath));
  }

  // Check whether the published boot.wim has been customized by Endpoint Sync.
  // Endpoint Sync deliberately makes Media\sources\boot.wim and the published copy
  // identical (it customizes the source in place then copies it over), so comparing
  // those two files cannot detect customization. Instead, Endpoint Sync writes a
  // boot.wim.sync.json marker recording the hash of the image it published; we
  // validate the published wim against that marker.
  const runtimeRoot = config.paths?.osdCloudRoot || 'C:\\OSDCloud';
  const publishedBootWim = path.join(runtimeRoot, 'PXE-HttpRoot', 'osdcloud', 'boot.wim');
  checks.push(await evaluateBootWimCustomization(publishedBootWim));

  // Check if published boot.wim is newer than config and secrets files (Option 1)
  checks.push(checkBootWimSyncState(config, publishedBootWim));

  checks.push(fs.existsSync(config.tftp.root) ? pass('TFTP root', config.tftp.root) : fail('TFTP root', config.tftp.root));
  checks.push(fs.existsSync(config.http.root) ? pass('HTTP root', config.http.root) : fail('HTTP root', config.http.root));

  try {
    checks.push(await evaluateSmbImage(config));
  } catch (error) {
    checks.push(fail('SMB image', error.message));
  }

  if (!services.dhcp?.running) {
    const udp67 = await checkUdpPortAvailable(config.dhcp.listenIp, config.dhcp.listenPort);
    checks.push(udp67.ok ? pass('UDP 67', udp67.message) : fail('UDP 67', udp67.message));
  } else {
    checks.push(pass('UDP 67', 'owned by console DHCP responder'));
  }

  if (!services.tftp?.running) {
    const udp69 = await checkUdpPortAvailable(config.tftp.listenIp, config.tftp.port);
    checks.push(udp69.ok ? pass('UDP 69', udp69.message) : fail('UDP 69', udp69.message));
  } else {
    checks.push(pass('UDP 69', 'owned by console TFTP responder'));
  }

  if (!services.http?.running) {
    const tcp80 = await checkTcpPortAvailable(config.http.host, config.http.port);
    checks.push(tcp80.ok ? pass('TCP 80', tcp80.message) : fail('TCP 80', tcp80.message));
  } else {
    checks.push(pass('TCP 80', 'owned by console HTTP server'));
  }

  fs.mkdirSync(config.http.statusRoot, { recursive: true });
  checks.push(pass('Status root', config.http.statusRoot));
  checks.push(await evaluateOsImageCache(config));
  checks.push(evaluateDeploymentProfilePayload(config));

  checks.sort((a, b) => Number(a.ok) - Number(b.ok));
  return checks;
}

export function removeStatusFiles(config) {
  const statusRoot = config.http.statusRoot;
  if (!fs.existsSync(statusRoot)) {
    return 0;
  }
  let removed = 0;
  for (const entry of fs.readdirSync(statusRoot)) {
    const entryPath = path.join(statusRoot, entry);
    if (entry.endsWith('.json') || entry.endsWith('.jsonl')) {
      fs.rmSync(entryPath, { force: true });
      removed += 1;
    } else if (entry === 'screenshots') {
      fs.rmSync(entryPath, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}
