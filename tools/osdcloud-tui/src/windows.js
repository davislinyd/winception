import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import dgram from 'node:dgram';
import path from 'node:path';
import { resolveHttpFile } from './config.js';

function powershellExe() {
  return process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
}

export function runPowerShell(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(powershellExe(), args, {
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
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

export async function configurePhysicalNic(config) {
  const scriptPath = config.paths.physicalNicScript;
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-InterfaceAlias',
    config.adapter.interfaceAlias,
    '-ServerIp',
    config.adapter.serverIp,
    '-PrefixLength',
    String(config.adapter.prefixLength),
    '-DefaultGateway',
    config.adapter.defaultGateway,
    '-InterfaceMetric',
    String(config.adapter.interfaceMetric),
    '-RemoteSubnet',
    config.adapter.remoteSubnet,
  ];
  const result = await runPowerShell(args);
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
    const adapter = await getAdapterState(config);
    const expected = `${config.adapter.serverIp}/${config.adapter.prefixLength}`;
    const actual = adapter.IPv4 ? `${adapter.IPv4}/${adapter.PrefixLength}` : 'no IPv4';
    const ok = adapter.Status === 'Up' && adapter.IPv4 === config.adapter.serverIp && Number(adapter.PrefixLength) === Number(config.adapter.prefixLength);
    checks.push(ok ? pass('Adapter', `${adapter.Name} ${actual}`) : fail('Adapter', `${adapter.Name} status=${adapter.Status} actual=${actual} expected=${expected}`));
  } catch (error) {
    checks.push(fail('Adapter', error.message));
  }

  for (const relativePath of config.paths.expectedHttpFiles) {
    const filePath = resolveHttpFile(config.http.root, relativePath);
    checks.push(fs.existsSync(filePath) ? pass(`HTTP file ${relativePath}`, filePath) : fail(`HTTP file ${relativePath}`, filePath));
  }

  checks.push(fs.existsSync(config.tftp.root) ? pass('TFTP root', config.tftp.root) : fail('TFTP root', config.tftp.root));
  checks.push(fs.existsSync(config.http.root) ? pass('HTTP root', config.http.root) : fail('HTTP root', config.http.root));
  checks.push(fs.existsSync(config.paths.physicalNicScript) ? pass('NIC script', config.paths.physicalNicScript) : fail('NIC script', config.paths.physicalNicScript));

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
