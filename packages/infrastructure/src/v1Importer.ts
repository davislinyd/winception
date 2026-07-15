import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
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
  targetAssetRoot?: string;
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
    softwareFiles: number;
    customScriptFiles: number;
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
    profiles: preferPath(join(stateRoot, 'config', 'deployment-profiles'), join(appRoot, 'config', 'deployment-profiles')),
    software: preferPath(join(stateRoot, 'config', 'software-catalog.json'), join(appRoot, 'config', 'software-catalog.json')),
    scripts: preferPath(join(stateRoot, 'config', 'scripts-catalog.json'), join(appRoot, 'config', 'scripts-catalog.json')),
    evidence: join(stateRoot, 'status'),
  };
  if (!existsSync(paths.baseConfig)) throw new ValidationError('The v1 base configuration was not found.');

  const sourceFiles = collectSourceFiles(paths);
  const backupFiles = sourceFiles.filter((file) => file !== paths.secrets);
  const softwareFiles = collectTreeFiles(join(appRoot, 'Softwares'));
  const customScriptFiles = collectTreeFiles(join(appRoot, 'Scripts'));
  const fingerprint = fingerprintFiles([...sourceFiles, ...softwareFiles, ...customScriptFiles]);
  const previous = options.database.getSetting<{ fingerprint: string }>('migration.v1');
  if (previous?.fingerprint === fingerprint) {
    const report = emptyReport('already-imported', fingerprint, existsSync(paths.evidence) ? relative(stateRoot, paths.evidence) : null);
    backupCoreFiles(backupFiles, stateRoot, backupRoot, fingerprint);
    const reportPath = join(backupRoot, fingerprint, 'migration-report.json');
    if (!existsSync(reportPath)) writeJsonAtomic(reportPath, report);
    return report;
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
      softwareFiles: softwareFiles.length,
      customScriptFiles: customScriptFiles.length,
    },
    evidenceArchive: existsSync(paths.evidence) ? relative(stateRoot, paths.evidence) : null,
    warnings: protectedSecrets.size === SECRET_KEYS.length ? [] : ['One or more v1 deployment secrets were absent and must be entered after migration.'],
  };
  if (options.dryRun) return report;

  backupCoreFiles(backupFiles, stateRoot, backupRoot, fingerprint);
  const movedAssets = stageAssets(options.targetAssetRoot, appRoot, fingerprint);
  try {
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
  }
  catch (error) {
    for (const path of movedAssets) rmSync(path, { recursive: true, force: true });
    throw error;
  }
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

function collectTreeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
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
  const destinationRoot = join(backupRoot, fingerprint);
  if (existsSync(destinationRoot)) {
    assertBackupMatches(files, stateRoot, join(destinationRoot, 'source'));
    return;
  }
  mkdirSync(backupRoot, { recursive: true });
  const stageRoot = join(backupRoot, `.v1-import-${fingerprint}`);
  rmSync(stageRoot, { recursive: true, force: true });
  try {
    const sourceRoot = join(stageRoot, 'source');
    for (const file of files) {
      const destination = backupDestination(sourceRoot, stateRoot, file);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(file, destination, { force: false, errorOnExist: true });
    }
    renameSync(stageRoot, destinationRoot);
  }
  catch (error) {
    rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

function assertBackupMatches(files: readonly string[], stateRoot: string, destinationRoot: string): void {
  for (const file of files) {
    const destination = backupDestination(destinationRoot, stateRoot, file);
    if (!existsSync(destination) || !readFileSync(file).equals(readFileSync(destination))) {
      throw new ValidationError('The existing v1 migration backup does not match the source state.', 'Preserve both copies and choose a new migration backup root.');
    }
  }
}

function backupDestination(destinationRoot: string, stateRoot: string, file: string): string {
  const relativePath = isInside(stateRoot, file) ? relative(stateRoot, file) : join('app-config', basename(file));
  return join(destinationRoot, relativePath);
}

function assertDistinctRoots(appRoot: string, stateRoot: string, backupRoot: string): void {
  if (appRoot === stateRoot) throw new ValidationError('The v1 App and State roots must be separate.');
  if (isInside(appRoot, stateRoot) || isInside(stateRoot, appRoot)) throw new ValidationError('The v1 App and State roots must not contain each other.');
  if (isInside(appRoot, backupRoot) || backupRoot === appRoot) throw new ValidationError('The migration backup must not be stored in the v1 App root.');
}

function stageAssets(targetAssetRoot: string | undefined, appRoot: string, fingerprint: string): string[] {
  if (!targetAssetRoot) return [];
  const target = resolve(targetAssetRoot);
  const stage = join(target, `.v1-import-${fingerprint}`);
  if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  const names = ['Softwares', 'Scripts'] as const;
  mkdirSync(stage, { recursive: true });
  for (const name of names) {
    const source = join(appRoot, name);
    if (existsSync(source)) cpSync(source, join(stage, name), { recursive: true, errorOnExist: true, force: false });
  }
  const moved: string[] = [];
  try {
    for (const name of names) {
      const source = join(stage, name);
      if (!existsSync(source)) continue;
      const destination = join(target, name);
      if (existsSync(destination)) throw new ValidationError(`The v2 ${name} payload directory already exists.`, 'Use a fresh v2 State root or restore its pre-migration backup.');
      mkdirSync(target, { recursive: true });
      renameSync(source, destination);
      moved.push(destination);
    }
    return moved;
  }
  catch (error) {
    for (const path of moved) rmSync(path, { recursive: true, force: true });
    throw error;
  }
  finally { rmSync(stage, { recursive: true, force: true }); }
}

function preferPath(primary: string, fallback: string): string {
  return existsSync(primary) ? primary : fallback;
}

function isInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== '' && !value.startsWith(`..${sep}`) && value !== '..';
}

function emptyReport(status: V1ImportReport['status'], fingerprint: string, evidenceArchive: string | null): V1ImportReport {
  return {
    status,
    fingerprint,
    imported: { settings: 0, profiles: 0, softwarePackages: 0, customScripts: 0, protectedSecrets: 0, softwareFiles: 0, customScriptFiles: 0 },
    evidenceArchive,
    warnings: [],
  };
}
