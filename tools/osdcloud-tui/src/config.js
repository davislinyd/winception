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
