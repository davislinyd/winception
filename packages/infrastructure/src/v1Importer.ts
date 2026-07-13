import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { SecretProtector } from '../../domain/src/ports.js';
import { ValidationError } from '../../domain/src/errors.js';
import type { WinceptionDatabase } from './database.js';
import { writeJsonAtomic } from './atomicFile.js';

const SECRET_KEYS = ['windowsUsername', 'windowsPassword', 'pxeinstallPassword'] as const;

export interface V1ImportOptions {
  appRoot: string;
  stateRoot: string;
  backupRoot: string;
  database: WinceptionDatabase;
  secretProtector: SecretProtector;
  dryRun?: boolean;
}

export interface V1ImportReport {
  status: 'dry-run' | 'imported' | 'already-imported';
  fingerprint: string;
  imported: {
    settings: number;
    profiles: number;
    softwarePackages: number;
    customScripts: number;
    protectedSecrets: number;
  };
  evidenceArchive: string | null;
  warnings: string[];
}

interface JsonObject { [key: string]: unknown }
interface V1SourcePaths {
  baseConfig: string;
  localConfig: string;
  secrets: string;
  profiles: string;
  software: string;
  scripts: string;
  evidence: string;
}

export async function importV1State(options: V1ImportOptions): Promise<V1ImportReport> {
  const appRoot = resolve(options.appRoot);
  const stateRoot = resolve(options.stateRoot);
  const backupRoot = resolve(options.backupRoot);
  assertDistinctRoots(appRoot, stateRoot, backupRoot);

  const paths = {
    baseConfig: join(appRoot, 'config', 'osdcloud-console.json'),
    localConfig: join(stateRoot, 'config', 'osdcloud-console.local.json'),
    secrets: join(stateRoot, 'config', 'osdcloud-secrets.json'),
    profiles: join(stateRoot, 'config', 'deployment-profiles'),
    software: join(stateRoot, 'config', 'software-catalog.json'),
    scripts: join(stateRoot, 'config', 'scripts-catalog.json'),
    evidence: join(stateRoot, 'status'),
  };
  if (!existsSync(paths.baseConfig)) throw new ValidationError('The v1 base configuration was not found.');

  const sourceFiles = collectSourceFiles(paths);
  const fingerprint = fingerprintFiles(sourceFiles);
  const previous = options.database.getSetting<{ fingerprint: string }>('migration.v1');
  if (previous?.fingerprint === fingerprint) {
    return emptyReport('already-imported', fingerprint, existsSync(paths.evidence) ? relative(stateRoot, paths.evidence) : null);
  }
  if (previous) throw new ValidationError('A different v1 state was already imported.', 'Restore the v2 database backup before importing another v1 state.');

  const baseConfig = readObject(paths.baseConfig, 'v1 base configuration');
  const localConfig = existsSync(paths.localConfig) ? readObject(paths.localConfig, 'v1 local configuration') : {};
  const mergedConfig = mergeObjects(baseConfig, localConfig);
  const profiles = readDocuments(paths.profiles);
  const software = readCatalog(paths.software);
  const scripts = readCatalog(paths.scripts);
  const secrets = existsSync(paths.secrets) ? readObject(paths.secrets, 'v1 deployment secrets') : {};
  const protectedSecrets = new Map<string, string>();
  for (const key of SECRET_KEYS) {
    const value = secrets[key];
    if (typeof value === 'string' && value.length > 0) protectedSecrets.set(key, await options.secretProtector.protect(key, value));
  }

  const report: V1ImportReport = {
    status: options.dryRun ? 'dry-run' : 'imported',
    fingerprint,
    imported: {
      settings: Object.keys(mergedConfig).length,
      profiles: profiles.length,
      softwarePackages: software.length,
      customScripts: scripts.length,
      protectedSecrets: protectedSecrets.size,
    },
    evidenceArchive: existsSync(paths.evidence) ? relative(stateRoot, paths.evidence) : null,
    warnings: protectedSecrets.size === SECRET_KEYS.length ? [] : ['One or more v1 deployment secrets were absent and must be entered after migration.'],
  };
  if (options.dryRun) return report;

  backupCoreFiles(sourceFiles, stateRoot, backupRoot, fingerprint);
  options.database.transaction(() => {
    options.database.setSetting('legacy.config', mergedConfig);
    options.database.setSetting('legacy.evidenceArchive', report.evidenceArchive);
    options.database.setSetting('runtime.rebuildRequired', true);
    for (const document of profiles) options.database.saveDocument('profiles', document.id, document.value);
    for (const document of software) options.database.saveDocument('software_packages', document.id, document.value);
    for (const document of scripts) options.database.saveDocument('custom_scripts', document.id, document.value);
    for (const [name, ciphertext] of protectedSecrets) options.database.setProtectedSecret(name, ciphertext);
    options.database.setSetting('migration.v1', { fingerprint, importedAt: new Date().toISOString() });
  });
  writeJsonAtomic(join(backupRoot, fingerprint, 'migration-report.json'), report);
  return report;
}

function collectSourceFiles(paths: V1SourcePaths): string[] {
  const files = [paths.baseConfig, paths.localConfig, paths.secrets, paths.software, paths.scripts].filter((path) => existsSync(path));
  if (existsSync(paths.profiles)) {
    files.push(...readdirSync(paths.profiles)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .map((name) => join(paths.profiles, name)));
  }
  return files.sort();
}

function fingerprintFiles(files: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(basename(file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function readObject(path: string, label: string): JsonObject {
  const value = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, '')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`The ${label} must contain a JSON object.`);
  return value as JsonObject;
}

function readDocuments(directory: string): Array<{ id: string; value: unknown }> {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.toLowerCase().endsWith('.json')).sort().map((name) => {
    const value = readObject(join(directory, name), `deployment profile ${name}`);
    const id = typeof value.id === 'string' && value.id ? value.id : basename(name, '.json');
    return { id, value };
  });
}

function readCatalog(path: string): Array<{ id: string; value: unknown }> {
  if (!existsSync(path)) return [];
  const value = readObject(path, basename(path));
  const candidate = Array.isArray(value.items) ? value.items
    : Array.isArray(value.software) ? value.software
      : Array.isArray(value.scripts) ? value.scripts
        : [];
  return candidate.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const document = item as JsonObject;
    const id = typeof document.id === 'string' && document.id ? document.id : `legacy-${index + 1}`;
    return [{ id, value: document }];
  });
}

function mergeObjects(base: JsonObject, overlay: JsonObject): JsonObject {
  const merged: JsonObject = structuredClone(base);
  for (const [key, value] of Object.entries(overlay)) {
    const existing = merged[key];
    merged[key] = isObject(existing) && isObject(value) ? mergeObjects(existing, value) : structuredClone(value);
  }
  return merged;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function backupCoreFiles(files: readonly string[], stateRoot: string, backupRoot: string, fingerprint: string): void {
  const destinationRoot = join(backupRoot, fingerprint, 'source');
  mkdirSync(destinationRoot, { recursive: true });
  for (const file of files) {
    const relativePath = isInside(stateRoot, file) ? relative(stateRoot, file) : join('app-config', basename(file));
    const destination = join(destinationRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(file, destination, { force: false, errorOnExist: true });
  }
}

function assertDistinctRoots(appRoot: string, stateRoot: string, backupRoot: string): void {
  if (appRoot === stateRoot) throw new ValidationError('The v1 App and State roots must be separate.');
  if (isInside(appRoot, stateRoot) || isInside(stateRoot, appRoot)) throw new ValidationError('The v1 App and State roots must not contain each other.');
  if (isInside(appRoot, backupRoot) || backupRoot === appRoot) throw new ValidationError('The migration backup must not be stored in the v1 App root.');
}

function isInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== '' && !value.startsWith(`..${sep}`) && value !== '..';
}

function emptyReport(status: V1ImportReport['status'], fingerprint: string, evidenceArchive: string | null): V1ImportReport {
  return {
    status,
    fingerprint,
    imported: { settings: 0, profiles: 0, softwarePackages: 0, customScripts: 0, protectedSecrets: 0 },
    evidenceArchive,
    warnings: [],
  };
}
