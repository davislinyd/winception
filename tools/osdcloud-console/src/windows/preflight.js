import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { resolveHttpFile } from '../config.js';
import { evaluateOsImageCache } from '../osimages/catalog.js';
import { evaluateDeploymentProfilePayload } from '../profiles/profiles.js';
import { resolveBaseConfigPath, resolveRepoRoot } from './bootArtifacts.js';
import { checkBootWimSyncState, evaluateBootModeConfig, evaluateBootWimCustomization, evaluateSecureBootSignature, evaluateSecureBootTftpTree, evaluateSecureBootWimIdentity } from './bootValidation.js';
import { evaluateDhcpSubnet, evaluateServiceIp, getServiceBindIps, getServiceIpStates, getSmbShareInfo, parseUncPath, shareNameFromConfig, smbAccessAllowsRead, smbBackingImagePath } from './network.js';
import { evaluateNetworkGateway, inspectNetworkGateway, networkTopology } from './gateway.js';
import { isElevated, runPowerShell } from './powershell.js';
import { fail, pass } from './shared.js';

export async function prepareRuntimeArtifacts(config, options = {}) {
  const repoRoot = resolveRepoRoot(config);
  const scriptPath = path.join(repoRoot, 'tools', 'Restore-DeploymentArtifacts.ps1');
  const baseConfigPath = resolveBaseConfigPath(config, repoRoot);
  const productRoot = path.resolve(repoRoot, '..');
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
    '-NodePath',
    path.join(productRoot, 'node', 'node.exe'),
    '-PowerShellModulesRoot',
    path.join(repoRoot, 'powershell-modules'),
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

export async function runPreflight(config, services = {}, options = {}) {
  const checks = [];

  const report = (result) => {
    if (Array.isArray(result)) {
      result.forEach(report);
    } else {
      checks.push(result);
      options.onCheck?.(result);
    }
    return result;
  };

  try {
    report((await isElevated()) ? pass('Administrator', 'running elevated') : fail('Administrator', 'run elevated before binding ports 67/69/80'));
  } catch (error) {
    report(fail('Administrator', error.message));
  }

  try {
    const serviceIpStates = await getServiceIpStates(config);
    const bindIps = getServiceBindIps(config);
    if (bindIps.length === 0) {
      report(pass('Service IP', 'services bind all IPv4 interfaces'));
    } else {
      bindIps.forEach((targetIp) => report(evaluateServiceIp(config, serviceIpStates, targetIp)));
    }
  } catch (error) {
    report(fail('Service IP', error.message));
  }

  if ((config.dhcp?.dhcpMode ?? 'server') !== 'proxy') {
    report(evaluateDhcpSubnet(config));
  }

  if (networkTopology(config) === 'dual-nic-nat') {
    try {
      report(evaluateNetworkGateway(config, await inspectNetworkGateway(config)));
    } catch (error) {
      report(fail('Winception NAT gateway', error.message));
    }
  }

  for (const relativePath of config.paths.expectedHttpFiles) {
    const filePath = resolveHttpFile(config.http.root, relativePath);
    report(fs.existsSync(filePath) ? pass(`HTTP file ${relativePath}`, filePath) : fail(`HTTP file ${relativePath}`, filePath));
  }

  // Check whether the published boot.wim has been customized by Endpoint Sync.
  // Endpoint Sync deliberately makes Media\sources\boot.wim and the published copy
  // identical (it customizes the source in place then copies it over), so comparing
  // those two files cannot detect customization. Instead, Endpoint Sync writes a
  // boot.wim.sync.json marker recording the hash of the image it published; we
  // validate the published wim against that marker.
  const runtimeRoot = config.paths?.osdCloudRoot || 'C:\\OSDCloud';
  const publishedBootWim = path.join(runtimeRoot, 'PXE-HttpRoot', 'osdcloud', 'boot.wim');
  report(await evaluateBootWimCustomization(publishedBootWim));

  // Check if published boot.wim is newer than config and secrets files (Option 1)
  report(checkBootWimSyncState(config, publishedBootWim));

  report(evaluateBootModeConfig(config));
  if ((config.dhcp?.bootMode ?? 'secureboot') === 'secureboot') {
    report(evaluateSecureBootTftpTree(config));
    report(evaluateSecureBootWimIdentity(config, publishedBootWim));
    report(await evaluateSecureBootSignature(config));
  }

  report(fs.existsSync(config.tftp.root) ? pass('TFTP root', config.tftp.root) : fail('TFTP root', config.tftp.root));
  report(fs.existsSync(config.http.root) ? pass('HTTP root', config.http.root) : fail('HTTP root', config.http.root));

  try {
    report(await evaluateSmbImage(config));
  } catch (error) {
    report(fail('SMB image', error.message));
  }

  if (!services.dhcp?.running) {
    const udp67 = await checkUdpPortAvailable(config.dhcp.listenIp, config.dhcp.listenPort);
    report(udp67.ok ? pass('UDP 67', udp67.message) : fail('UDP 67', udp67.message));
  } else {
    report(pass('UDP 67', 'owned by console DHCP responder'));
  }

  if (!services.tftp?.running) {
    const udp69 = await checkUdpPortAvailable(config.tftp.listenIp, config.tftp.port);
    report(udp69.ok ? pass('UDP 69', udp69.message) : fail('UDP 69', udp69.message));
  } else {
    report(pass('UDP 69', 'owned by console TFTP responder'));
  }

  if (!services.http?.running) {
    const tcp80 = await checkTcpPortAvailable(config.http.host, config.http.port);
    report(tcp80.ok ? pass('TCP 80', tcp80.message) : fail('TCP 80', tcp80.message));
  } else {
    report(pass('TCP 80', 'owned by console HTTP server'));
  }

  fs.mkdirSync(config.http.statusRoot, { recursive: true });
  report(pass('Status root', config.http.statusRoot));
  report(await evaluateOsImageCache(config));
  report(evaluateDeploymentProfilePayload(config));

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
