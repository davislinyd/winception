import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..');

export const defaultConfigPath = path.join(repoRoot, 'config', 'osdcloud-tui.json');

export function loadConfig(configPath = process.env.OSDCLOUD_TUI_CONFIG || defaultConfigPath) {
  const resolved = path.resolve(configPath);
  const config = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  config.__configPath = resolved;
  validateConfig(config);
  return config;
}

function publicConfig(config) {
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !key.startsWith('__')),
  );
}

export function saveConfig(config, configPath = config.__configPath || defaultConfigPath) {
  const resolved = path.resolve(configPath);
  fs.writeFileSync(resolved, `${JSON.stringify(publicConfig(config), null, 2)}\n`, 'utf8');
  config.__configPath = resolved;
  validateConfig(config);
  return resolved;
}

function smbShareName(config) {
  const share = String(config.smb?.share ?? '');
  const match = /^\\\\[^\\]+\\([^\\]+)$/u.exec(share);
  return match?.[1] || config.smb?.shareName || 'OSDCloudiPXE';
}

export function applyServiceEndpoint(config, choice, options = {}) {
  const interfaceAlias = choice.interfaceAlias ?? choice.InterfaceAlias;
  const serverIp = choice.ipAddress ?? choice.IPAddress;
  const prefixLength = Number(choice.prefixLength ?? choice.PrefixLength);
  const shareName = options.smbShareName || smbShareName(config);
  const imageName = config.paths?.imageNamePattern;

  if (!interfaceAlias || !serverIp || !Number.isInteger(prefixLength)) {
    throw new Error('Selected interface must include interfaceAlias, ipAddress, and prefixLength');
  }

  config.adapter.interfaceAlias = interfaceAlias;
  config.adapter.serverIp = serverIp;
  config.adapter.prefixLength = prefixLength;
  config.dhcp.listenIp = serverIp;
  config.dhcp.ipxeBootUrl = `http://${serverIp}/osdcloud/boot.ipxe`;
  config.tftp.listenIp = serverIp;
  config.http.host = serverIp;

  config.smb ??= {};
  config.smb.share = `\\\\${serverIp}\\${shareName}`;
  if (imageName) {
    config.smb.imagePath = `${config.smb.share}\\OSDCloud\\OS\\${imageName}`;
  }

  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  const required = [
    ['adapter', 'interfaceAlias'],
    ['adapter', 'serverIp'],
    ['dhcp', 'listenIp'],
    ['dhcp', 'leaseStartIp'],
    ['dhcp', 'leaseEndIp'],
    ['dhcp', 'bootFile'],
    ['dhcp', 'ipxeBootUrl'],
    ['tftp', 'root'],
    ['http', 'root'],
    ['http', 'host'],
    ['http', 'statusRoot'],
    ['paths', 'expectedHttpFiles'],
    ['smb', 'share'],
    ['smb', 'imagePath'],
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

  return config;
}

export function resolveHttpFile(root, relativePath) {
  return path.join(root, relativePath);
}
