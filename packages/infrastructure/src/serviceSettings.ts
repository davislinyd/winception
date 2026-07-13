import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DpapiSecretProtector } from './dpapi.js';

export interface ServiceSettings {
  schemaVersion: 1;
  appRoot: string;
  stateRoot: string;
  legacyConfigPath: string;
  agentPipe: string;
  managementHost: string;
  managementPort: number;
  managementToken: string;
  agentToken: string;
  tls?: { pfxPath: string; pfxPassword: string; thumbprint: string; notAfter: string };
}

interface StoredServiceSettings {
  schemaVersion: 1;
  appRoot: string;
  stateRoot: string;
  legacyConfigPath: string;
  agentPipe: string;
  managementHost: string;
  managementPort: number;
  managementTokenProtected: string;
  agentTokenProtected: string;
  tls?: { pfxPath: string; pfxPasswordProtected: string; thumbprint: string; notAfter: string };
}

export async function loadServiceSettings(settingsPath?: string): Promise<ServiceSettings> {
  const path = resolve(settingsPath ?? process.env.WINCEPTION_SERVICE_SETTINGS ?? join(
    process.env.ProgramData ?? 'C:\\ProgramData', 'Winception', 'State', 'service-settings.json',
  ));
  if (!existsSync(path)) throw new Error('Installer-provisioned service settings were not found.');
  const stored = parseStoredSettings(readFileSync(path, 'utf8'));
  const protector = new DpapiSecretProtector(join(stored.appRoot, 'tools', 'v2', 'Protect-WinceptionSecret.ps1'));
  const managementToken = await protector.unprotect('management-token', stored.managementTokenProtected);
  const agentToken = await protector.unprotect('agent-token', stored.agentTokenProtected);
  const settings: ServiceSettings = {
    schemaVersion: 1,
    appRoot: stored.appRoot,
    stateRoot: stored.stateRoot,
    legacyConfigPath: stored.legacyConfigPath,
    agentPipe: stored.agentPipe,
    managementHost: stored.managementHost,
    managementPort: stored.managementPort,
    managementToken,
    agentToken,
  };
  if (stored.tls) {
    settings.tls = {
      pfxPath: resolve(stored.tls.pfxPath), thumbprint: stored.tls.thumbprint, notAfter: stored.tls.notAfter,
      pfxPassword: await protector.unprotect('tls-pfx-password', stored.tls.pfxPasswordProtected),
    };
  }
  return settings;
}

function parseStoredSettings(raw: string): StoredServiceSettings {
  const value = JSON.parse(raw) as Partial<StoredServiceSettings>;
  if (value.schemaVersion !== 1 || !isPath(value.appRoot) || !isPath(value.stateRoot) || !isPath(value.legacyConfigPath)
    || typeof value.agentPipe !== 'string' || value.agentPipe.length < 8
    || typeof value.managementHost !== 'string' || !value.managementHost
    || !Number.isInteger(value.managementPort) || Number(value.managementPort) < 1 || Number(value.managementPort) > 65535
    || typeof value.managementTokenProtected !== 'string' || !value.managementTokenProtected
    || typeof value.agentTokenProtected !== 'string' || !value.agentTokenProtected) {
    throw new Error('Installer-provisioned service settings are invalid.');
  }
  return value as StoredServiceSettings;
}

function isPath(value: unknown): value is string {
  return typeof value === 'string' && resolve(value) === value;
}
