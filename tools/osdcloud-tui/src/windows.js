import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import dgram from 'node:dgram';
import path from 'node:path';
import { resolveHttpFile } from './config.js';
import { ipv4ToUInt32 } from './dhcp.js';
import { evaluateDeploymentProfilePayload } from './deploymentProfiles.js';

function powershellExe() {
  return process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
}

const utf8OutputPrelude = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false);";

export function preparePowerShellArgs(args) {
  const prepared = [...args];
  const commandIndex = prepared.findIndex((arg) => ['-command', '-c'].includes(String(arg).toLowerCase()));
  if (commandIndex >= 0 && commandIndex + 1 < prepared.length) {
    const command = String(prepared[commandIndex + 1]);
    if (!command.includes('[Console]::OutputEncoding')) {
      prepared[commandIndex + 1] = `${utf8OutputPrelude}\n${command}`;
    }
  }
  return prepared;
}

export function runPowerShell(args, options = {}) {
  return new Promise((resolve, reject) => {
    const { onStdout, onStderr, ...spawnOptions } = options;
    const child = spawn(powershellExe(), preparePowerShellArgs(args), {
      windowsHide: true,
      ...spawnOptions,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onStdout?.(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onStderr?.(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const error = new Error(stderr.trim() || stdout.trim() || `PowerShell exited with code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });
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
  const good = matches.find((state) => (
    state.Status === 'Up'
    && (!state.AddressState || state.AddressState === 'Preferred')
    && (expectedPrefix === undefined || Number(state.PrefixLength) === expectedPrefix)
  ));

  if (good) {
    return pass(
      `Service IP ${targetIp}`,
      `${good.InterfaceAlias} ${good.IPAddress}/${good.PrefixLength}`,
    );
  }

  const expected = expectedPrefix === undefined ? targetIp : `${targetIp}/${expectedPrefix}`;
  if (matches.length === 0) {
    return fail(`Service IP ${targetIp}`, `not assigned to any IPv4 interface; expected ${expected}`);
  }

  return fail(
    `Service IP ${targetIp}`,
    matches.map((state) => (
      `${state.InterfaceAlias} status=${state.Status} actual=${state.IPAddress}/${state.PrefixLength} state=${state.AddressState || 'unknown'} expected=${expected}`
    )).join('; '),
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

function defaultEndpointSyncScript(config) {
  return path.join(config.paths.repoRoot, 'tools', 'Set-OsdCloudIpxeEndpoint.ps1');
}

export async function syncIpxeEndpoint(config, options = {}) {
  const scriptPath = config.paths.endpointSyncScript || defaultEndpointSyncScript(config);
  const shareName = String(config.smb.share).split('\\').filter(Boolean).at(-1) || 'OSDCloudiPXE';
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ConfigPath',
    config.__configPath,
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
  if (options.syncAssets !== false) {
    args.push('-SyncAssets');
  }
  if (options.hashLargeArtifacts !== false) {
    args.push('-HashLargeArtifacts');
  }

  const result = await runPowerShell(args, {
    cwd: config.paths.repoRoot,
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

  checks.push(fs.existsSync(config.tftp.root) ? pass('TFTP root', config.tftp.root) : fail('TFTP root', config.tftp.root));
  checks.push(fs.existsSync(config.http.root) ? pass('HTTP root', config.http.root) : fail('HTTP root', config.http.root));

  try {
    checks.push(fs.existsSync(config.smb.imagePath) ? pass('SMB image', config.smb.imagePath) : fail('SMB image', config.smb.imagePath));
  } catch (error) {
    checks.push(fail('SMB image', error.message));
  }

  if (!services.dhcp?.running) {
    const udp67 = await checkUdpPortAvailable(config.dhcp.listenIp, config.dhcp.listenPort);
    checks.push(udp67.ok ? pass('UDP 67', udp67.message) : fail('UDP 67', udp67.message));
  } else {
    checks.push(pass('UDP 67', 'owned by TUI DHCP responder'));
  }

  if (!services.tftp?.running) {
    const udp69 = await checkUdpPortAvailable(config.tftp.listenIp, config.tftp.port);
    checks.push(udp69.ok ? pass('UDP 69', udp69.message) : fail('UDP 69', udp69.message));
  } else {
    checks.push(pass('UDP 69', 'owned by TUI TFTP responder'));
  }

  if (!services.http?.running) {
    const tcp80 = await checkTcpPortAvailable(config.http.host, config.http.port);
    checks.push(tcp80.ok ? pass('TCP 80', tcp80.message) : fail('TCP 80', tcp80.message));
  } else {
    checks.push(pass('TCP 80', 'owned by TUI HTTP server'));
  }

  fs.mkdirSync(config.http.statusRoot, { recursive: true });
  checks.push(pass('Status root', config.http.statusRoot));
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
