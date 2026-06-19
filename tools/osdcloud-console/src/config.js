import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..');

export const defaultAppRoot = repoRoot;
export const defaultRepoRoot = defaultAppRoot;
export const defaultConfigPath = path.join(defaultAppRoot, 'config', 'osdcloud-console.json');
export const defaultLocalConfigPath = path.join(defaultAppRoot, 'config', 'osdcloud-console.local.json');

function splitLocalConfigPath(configPath) {
  const parsed = path.parse(configPath);
  if (!parsed.name.endsWith('.local')) {
    return null;
  }
  return {
    basePath: path.join(parsed.dir, `${parsed.name.slice(0, -'.local'.length)}${parsed.ext}`),
    localPath: configPath,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseJsonFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '');
  return JSON.parse(content);
}

function mergeConfig(base, overlay) {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    return cloneJson(base);
  }
  const merged = cloneJson(base);
  for (const [key, value] of Object.entries(overlay)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key])) {
      merged[key] = mergeConfig(merged[key], value);
    } else {
      merged[key] = cloneJson(value);
    }
  }
  return merged;
}

export function localConfigPathFor(configPath) {
  const resolved = path.resolve(configPath);
  const parsed = path.parse(resolved);
  return path.join(parsed.dir, `${parsed.name}.local${parsed.ext || '.json'}`);
}

export function appRootForConfig(config = {}) {
  return path.resolve(config.paths?.appRoot ?? config.paths?.repoRoot ?? defaultAppRoot);
}

export function stateRootForConfig(config = {}) {
  if (config.paths?.stateRoot) {
    return path.resolve(config.paths.stateRoot);
  }
  if (config.__configPath) {
    return path.resolve(path.dirname(config.__configPath), '..');
  }
  return appRootForConfig(config);
}

export function loadConfig(configPath = process.env.OSDCLOUD_CONSOLE_CONFIG || defaultConfigPath, options = {}) {
  const passedPath = path.resolve(configPath);
  const inferredLocal = options.localConfigPath === false ? null : splitLocalConfigPath(passedPath);
  const resolved = inferredLocal?.basePath ?? passedPath;
  const baseConfig = parseJsonFile(resolved);
  const localConfigPath = options.localConfigPath === false
    ? null
    : path.resolve(options.localConfigPath ?? process.env.OSDCLOUD_CONSOLE_LOCAL_CONFIG ?? inferredLocal?.localPath ?? localConfigPathFor(resolved));
  const localConfig = localConfigPath && fs.existsSync(localConfigPath)
    ? parseJsonFile(localConfigPath)
    : null;
  const config = localConfig ? mergeConfig(baseConfig, localConfig) : baseConfig;
  config.__configPath = resolved;
  if (localConfigPath) {
    config.__localConfigPath = localConfigPath;
    config.__savePath = localConfigPath;
  }
  validateConfig(config);
  return config;
}

function publicConfig(config) {
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !key.startsWith('__')),
  );
}

export function saveConfig(config, configPath = config.__savePath || config.__configPath || defaultConfigPath) {
  const resolved = path.resolve(configPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(publicConfig(config), null, 2)}\n`, 'utf8');
  if (config.__savePath || config.__localConfigPath) {
    config.__savePath = resolved;
    config.__localConfigPath = resolved;
  } else {
    config.__configPath = resolved;
  }
  validateConfig(config);
  return resolved;
}

export function mediaHttpServerConfig(config) {
  return {
    ...config.http,
    driverPackCache: config.driverPackCache,
    smb: config.smb,
    torrent: torrentServerConfig(config),
    osCacheRoot: config.osImage?.cacheRoot ?? null,
    // Forward the resolved state root so the media server's loadSecrets() reads
    // the live deployment secrets (e.g. the auto-generated pxeinstallPassword)
    // instead of falling back to defaultAppRoot and serving stale committed
    // secrets via /osdcloud/boot-config.
    paths: { stateRoot: stateRootForConfig(config) },
  };
}

// Sidecar manifest written next to the OS WIM so cheap consumers (the boot-config
// endpoint) can advertise torrent details without re-hashing the multi-GB image.
export const osTorrentManifestName = 'os-torrent.json';

// HTTP tracker announce endpoint. bittorrent-tracker serves announce/scrape on
// its own HTTP listener bound to the service IP and tracker port.
export function trackerAnnounceUrl(serverIp, trackerPort) {
  return `http://${serverIp}:${trackerPort}/announce`;
}

// BEP19 (GetRight) webseed URL for a single-file torrent: the direct HTTP URL to
// the WIM, served by MediaHttpServer's /osdcloud/os/<file> route.
export function osWebSeedUrl(serverIp, httpPort, fileName) {
  const port = Number(httpPort);
  const portPart = !Number.isFinite(port) || port === 80 ? '' : `:${port}`;
  return `http://${serverIp}${portPart}/osdcloud/os/${encodeURIComponent(fileName)}`;
}

// URL clients use to fetch the .torrent metainfo (served next to the WIM).
export function osTorrentUrl(serverIp, httpPort, fileName) {
  return `${osWebSeedUrl(serverIp, httpPort, fileName)}.torrent`;
}

export const defaultTorrentConfig = Object.freeze({
  enabled: true,
  trackerPort: 6969,
  seederListenPort: 6881,
  pieceLengthBytes: 4194304,
  seedMinutes: 30,
});

// Resolve the host-side torrent/tracker settings, mirroring mediaHttpServerConfig.
// The tracker binds to the same service IP as the HTTP server, and the webseed/
// announce URLs are derived from the HTTP host + port so a single endpoint sync
// keeps everything aligned.
export function torrentServerConfig(config = {}) {
  const torrent = config.torrent ?? {};
  const serverIp = config.http?.host ?? config.adapter?.serverIp ?? '127.0.0.1';
  const httpPort = Number(config.http?.port ?? 80);
  const liveRoot = config.runtimeArtifacts?.liveRoot ?? config.paths?.osdCloudRoot ?? 'C:\\OSDCloud';
  const aria2cPath = torrent.aria2cPath ?? path.join(liveRoot, 'Tools', 'aria2c.exe');
  return {
    enabled: torrent.enabled !== false,
    serverIp,
    httpPort,
    trackerPort: Number(torrent.trackerPort ?? defaultTorrentConfig.trackerPort),
    seederListenPort: Number(torrent.seederListenPort ?? defaultTorrentConfig.seederListenPort),
    pieceLengthBytes: Number(torrent.pieceLengthBytes ?? defaultTorrentConfig.pieceLengthBytes),
    seedMinutes: Number(torrent.seedMinutes ?? defaultTorrentConfig.seedMinutes),
    stateRoot: stateRootForConfig(config),
    osCacheRoot: config.osImage?.cacheRoot ?? null,
    aria2cPath,
    logPath: config.http?.logPath ?? null,
    seederLogPath: torrent.seederLogPath ?? path.join(liveRoot, 'logs', 'torrent-seeder.log'),
    trackerLogPath: torrent.trackerLogPath ?? path.join(liveRoot, 'logs', 'torrent-tracker.log'),
  };
}

function isPathInside(parent, candidate) {
  const parentPath = path.resolve(parent);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function runtimeRootForConfig(config = {}) {
  return path.resolve(config.runtimeArtifacts?.liveRoot ?? config.paths?.osdCloudRoot ?? 'C:\\OSDCloud');
}

export function workspaceInfo(config = {}) {
  const appRoot = appRootForConfig(config);
  const stateRoot = stateRootForConfig(config);
  const runtimeRoot = runtimeRootForConfig(config);
  return {
    appRoot,
    repoRoot: appRoot,
    stateRoot,
    runtimeRoot,
    configPath: config.__configPath,
    localConfigPath: config.__localConfigPath,
    runtimeInsideRepo: isPathInside(appRoot, runtimeRoot),
  };
}

function assertRuntimeRootAllowed(config, runtimeRoot) {
  const appRoot = appRootForConfig(config);
  const resolved = path.resolve(String(runtimeRoot ?? '').trim());
  if (!path.isAbsolute(resolved)) {
    throw new Error(`Project root must be an absolute path: ${runtimeRoot}`);
  }
  if (isPathInside(appRoot, resolved)) {
    throw new Error(`Project root must not be inside the host management bundle: ${resolved}`);
  }
  return resolved;
}

export function applyProjectRoot(config, runtimeRoot) {
  const root = assertRuntimeRootAllowed(config, runtimeRoot);
  config.paths ??= {};
  config.paths.osdCloudRoot = root;
  config.paths.logsDir = path.join(root, 'logs');
  config.paths.statusLatest = path.join(root, 'PXE-HttpRoot', 'status', 'latest.json');
  config.paths.statusEvents = path.join(root, 'PXE-HttpRoot', 'status', 'progress.jsonl');
  config.tftp ??= {};
  config.tftp.root = path.join(root, 'PXE-TFTP');
  config.tftp.logPath = path.join(root, 'logs', 'host-services.log');
  config.http ??= {};
  config.http.root = path.join(root, 'PXE-HttpRoot');
  config.http.logPath = path.join(root, 'logs', 'host-services.log');
  config.http.statusRoot = path.join(root, 'PXE-HttpRoot', 'status');
  config.dhcp ??= {};
  config.dhcp.logPath = path.join(root, 'logs', 'host-services.log');
  config.driverPackCache ??= {};
  config.driverPackCache.root = path.join(root, 'Media', 'OSDCloud', 'DriverPacks');
  config.osImage ??= {};
  config.osImage.cacheRoot = path.join(root, 'Media', 'OSDCloud', 'OS');
  config.osImage.downloadStagingRoot = path.join(root, 'Media', 'OSDCloud', 'OS', '.downloads');
  config.deploymentProfiles ??= {};
  config.deploymentProfiles.appsRoot = path.join(root, 'Media', 'OSDCloud', 'Apps');
  config.deploymentProfiles.customScriptsAppsRoot = path.join(root, 'Media', 'OSDCloud', 'Scripts');
  config.runtimeArtifacts ??= {};
  config.runtimeArtifacts.liveRoot = root;
  return config;
}

export function webServerConfig(config) {
  const section = config.web ?? {};
  const host = section.host ?? '127.0.0.1';
  const port = section.port ?? 8080;
  return {
    host,
    port: Number(port),
  };
}

function smbShareName(config) {
  const share = String(config.smb?.share ?? '');
  const match = /^\\\\[^\\]+\\([^\\]+)$/u.exec(share);
  return match?.[1] || config.smb?.shareName || 'OSDCloudiPXE';
}

function ipv4ToUInt32(address) {
  return String(address).split('.').reduce((value, part) => {
    const byte = Number.parseInt(part, 10);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`Invalid IPv4 address: ${address}`);
    }
    return ((value << 8) | byte) >>> 0;
  }, 0);
}

function uint32ToIPv4(value) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}

function prefixLengthToMask(prefixLength) {
  const prefix = Number(prefixLength);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid IPv4 prefix length: ${prefixLength}`);
  }
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

function subnetInfo(address, prefixLength) {
  const addressValue = ipv4ToUInt32(address);
  const mask = prefixLengthToMask(prefixLength);
  const network = (addressValue & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const firstUsable = prefixLength >= 31 ? network : network + 1;
  const lastUsable = prefixLength >= 31 ? broadcast : broadcast - 1;
  return { addressValue, network, broadcast, firstUsable, lastUsable, mask };
}

function isInSubnet(address, serverIp, prefixLength) {
  const { network, mask } = subnetInfo(serverIp, prefixLength);
  return ((ipv4ToUInt32(address) & mask) >>> 0) === network;
}

function reservationIp(reservation) {
  return String(
    reservation?.ip
    ?? reservation?.IP
    ?? reservation?.ipAddress
    ?? reservation?.IPAddress
    ?? '',
  );
}

function filterReservationsForSubnet(reservations, serverIp, prefixLength) {
  if (!Array.isArray(reservations)) {
    return reservations;
  }
  return reservations.filter((reservation) => {
    const ip = reservationIp(reservation);
    try {
      return ip && isInSubnet(ip, serverIp, prefixLength);
    } catch {
      return false;
    }
  });
}

function subnetMask(prefixLength) {
  return uint32ToIPv4(prefixLengthToMask(prefixLength));
}

function subnetCidr(serverIp, prefixLength) {
  return `${uint32ToIPv4(subnetInfo(serverIp, prefixLength).network)}/${prefixLength}`;
}

function dhcpLeaseRange(serverIp, prefixLength) {
  const info = subnetInfo(serverIp, prefixLength);
  const preferredStart = info.network + 200;
  const preferredEnd = info.network + 250;
  if (
    preferredStart >= info.firstUsable
    && preferredEnd <= info.lastUsable
    && (info.addressValue < preferredStart || info.addressValue > preferredEnd)
  ) {
    return {
      leaseStartIp: uint32ToIPv4(preferredStart),
      leaseEndIp: uint32ToIPv4(preferredEnd),
    };
  }

  let end = info.lastUsable === info.addressValue ? info.addressValue - 1 : info.lastUsable;
  let start = Math.max(info.firstUsable, end - 50);
  if (info.addressValue >= start && info.addressValue <= end) {
    if (info.addressValue === start) {
      start += 1;
    } else {
      end = info.addressValue - 1;
    }
  }

  if (start > end) {
    throw new Error(`No DHCP lease range available outside server IP ${serverIp}/${prefixLength}`);
  }

  return {
    leaseStartIp: uint32ToIPv4(start),
    leaseEndIp: uint32ToIPv4(end),
  };
}

export function applyServiceEndpoint(config, choice, options = {}) {
  const interfaceAlias = choice.interfaceAlias ?? choice.InterfaceAlias;
  const serverIp = choice.ipAddress ?? choice.IPAddress;
  const prefixLength = Number(choice.prefixLength ?? choice.PrefixLength);
  const gateway = choice.gateway ?? choice.Gateway ?? '';
  const shareName = options.smbShareName || smbShareName(config);
  const imageName = config.paths?.imageNamePattern;

  if (!interfaceAlias || !serverIp || !Number.isInteger(prefixLength)) {
    throw new Error('Selected interface must include interfaceAlias, ipAddress, and prefixLength');
  }

  config.adapter.interfaceAlias = interfaceAlias;
  config.adapter.serverIp = serverIp;
  config.adapter.prefixLength = prefixLength;
  config.adapter.defaultGateway = gateway || serverIp;
  config.adapter.remoteSubnet = subnetCidr(serverIp, prefixLength);
  config.dhcp.listenIp = serverIp;
  config.dhcp.ipxeBootUrl = `http://${serverIp}/osdcloud/boot.ipxe`;
  if ((config.dhcp.dhcpMode ?? 'server') !== 'proxy') {
    config.dhcp.subnetMask = subnetMask(prefixLength);
    config.dhcp.router = gateway && isInSubnet(gateway, serverIp, prefixLength) ? gateway : serverIp;
    Object.assign(config.dhcp, dhcpLeaseRange(serverIp, prefixLength));
    if (config.dhcp.reservations !== undefined) {
      config.dhcp.reservations = filterReservationsForSubnet(config.dhcp.reservations, serverIp, prefixLength);
    }
  }
  config.tftp.listenIp = serverIp;
  config.http.host = serverIp;

  config.smb ??= {};
  config.smb.share = `\\\\${serverIp}\\${shareName}`;
  if (imageName) {
    config.smb.imagePath = `${config.smb.share}\\OSDCloud\\OS\\${imageName}`;
  } else {
    config.smb.imagePath = '';
  }

  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  const isProxyMode = (config.dhcp?.dhcpMode ?? 'server') === 'proxy';
  const required = [
    ['adapter', 'interfaceAlias'],
    ['adapter', 'serverIp'],
    ['dhcp', 'listenIp'],
    ...(!isProxyMode ? [
      ['dhcp', 'leaseStartIp'],
      ['dhcp', 'leaseEndIp'],
      ['dhcp', 'subnetMask'],
      ['dhcp', 'router'],
    ] : []),
    ['dhcp', 'bootFile'],
    ['dhcp', 'ipxeBootUrl'],
    ['tftp', 'root'],
    ['http', 'root'],
    ['http', 'host'],
    ['http', 'statusRoot'],
    ['paths', 'expectedHttpFiles'],
    ['smb', 'share'],
  ];

  const missing = [];
  for (const [section, key] of required) {
    if (config?.[section]?.[key] === undefined || config?.[section]?.[key] === '') {
      missing.push(`${section}.${key}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required config values: ${missing.join(', ')}`);
  }

  if (!Array.isArray(config.paths.expectedHttpFiles) || config.paths.expectedHttpFiles.length === 0) {
    throw new Error('paths.expectedHttpFiles must be a non-empty array');
  }

  // Optional for back-compat: configs written before the secureboot mode existed
  // omit both keys and default to secureboot/bootmgfw.efi in code.
  if (config.dhcp.bootMode !== undefined && !['secureboot', 'ipxe'].includes(config.dhcp.bootMode)) {
    throw new Error(`Invalid dhcp.bootMode: ${config.dhcp.bootMode}. Expected secureboot or ipxe.`);
  }

  if (config.dhcp.dhcpMode !== undefined && !['server', 'proxy'].includes(config.dhcp.dhcpMode)) {
    throw new Error(`Invalid dhcp.dhcpMode: ${config.dhcp.dhcpMode}. Expected server or proxy.`);
  }

  config.web ??= {};
  config.web.host ??= '127.0.0.1';
  config.web.port ??= 8080;
  if (typeof config.web.host !== 'string' || config.web.host.trim() === '') {
    throw new Error('web.host must be a non-empty string');
  }
  const webPort = Number(config.web.port);
  if (!Number.isInteger(webPort) || webPort < 0 || webPort > 65535) {
    throw new Error(`Invalid web.port: ${config.web.port}`);
  }
  config.web.port = webPort;

  config.torrent ??= {};
  config.torrent.enabled = config.torrent.enabled !== false;
  config.torrent.trackerPort ??= defaultTorrentConfig.trackerPort;
  config.torrent.seederListenPort ??= defaultTorrentConfig.seederListenPort;
  config.torrent.pieceLengthBytes ??= defaultTorrentConfig.pieceLengthBytes;
  config.torrent.seedMinutes ??= defaultTorrentConfig.seedMinutes;
  const trackerPort = Number(config.torrent.trackerPort);
  if (!Number.isInteger(trackerPort) || trackerPort < 1 || trackerPort > 65535) {
    throw new Error(`Invalid torrent.trackerPort: ${config.torrent.trackerPort}`);
  }
  config.torrent.trackerPort = trackerPort;
  const seederListenPort = Number(config.torrent.seederListenPort);
  if (!Number.isInteger(seederListenPort) || seederListenPort < 1 || seederListenPort > 65535) {
    throw new Error(`Invalid torrent.seederListenPort: ${config.torrent.seederListenPort}`);
  }
  config.torrent.seederListenPort = seederListenPort;
  const pieceLengthBytes = Number(config.torrent.pieceLengthBytes);
  if (!Number.isInteger(pieceLengthBytes) || pieceLengthBytes < 16384) {
    throw new Error(`torrent.pieceLengthBytes must be an integer >= 16384: ${config.torrent.pieceLengthBytes}`);
  }
  config.torrent.pieceLengthBytes = pieceLengthBytes;
  const seedMinutes = Number(config.torrent.seedMinutes);
  if (!Number.isFinite(seedMinutes) || seedMinutes < 0) {
    throw new Error(`torrent.seedMinutes must be a non-negative number: ${config.torrent.seedMinutes}`);
  }
  config.torrent.seedMinutes = seedMinutes;

  if (config.dhcp.reservations !== undefined) {
    if (!Array.isArray(config.dhcp.reservations)) {
      throw new Error('dhcp.reservations must be an array when provided');
    }

    const reservedIps = new Set();
    for (const reservation of config.dhcp.reservations) {
      const mac = String(reservation.mac ?? reservation.Mac ?? reservation.macAddress ?? reservation.MacAddress ?? '');
      const ip = reservationIp(reservation);
      const normalizedMac = mac.replace(/[^0-9A-Fa-f]/gu, '');
      if (!/^[0-9A-Fa-f]{12}$/u.test(normalizedMac)) {
        throw new Error(`Invalid DHCP reservation MAC address: ${mac}`);
      }
      ipv4ToUInt32(ip);
      if (!isInSubnet(ip, config.dhcp.listenIp, config.adapter.prefixLength)) {
        throw new Error(`DHCP reservation ${ip} is outside ${config.dhcp.listenIp}/${config.adapter.prefixLength}`);
      }
      if (reservedIps.has(ip)) {
        throw new Error(`Duplicate DHCP reservation IP address: ${ip}`);
      }
      reservedIps.add(ip);
    }
  }

  if (config.driverPackCache?.enabled === true) {
    if (!config.driverPackCache.root) {
      throw new Error('driverPackCache.root is required when driver pack cache is enabled');
    }

    if (
      config.driverPackCache.allowedHosts !== undefined
      && (
        !Array.isArray(config.driverPackCache.allowedHosts)
        || config.driverPackCache.allowedHosts.length === 0
      )
    ) {
      throw new Error('driverPackCache.allowedHosts must be a non-empty array when provided');
    }
  }

  return config;
}

export function resolveHttpFile(root, relativePath) {
  return path.join(root, relativePath);
}
