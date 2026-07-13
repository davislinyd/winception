import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { writeJsonAtomic } from './atomicFile.js';
import type { WinceptionDatabase } from './database.js';

interface JsonObject { [key: string]: unknown }

export interface ProductStateSnapshot {
  config: JsonObject;
  profiles: {
    profiles: JsonObject[];
    softwareCatalog: JsonObject[];
    customScriptCatalog: JsonObject[];
  };
  osImages: { images: JsonObject[] };
}

export class ProductStateStore {
  readonly #database: WinceptionDatabase;
  readonly appRoot: string;
  readonly stateRoot: string;
  readonly legacyRoot: string;
  readonly configPath: string;

  constructor(options: { database: WinceptionDatabase; appRoot: string; stateRoot: string }) {
    this.#database = options.database;
    this.appRoot = resolve(options.appRoot);
    this.stateRoot = resolve(options.stateRoot);
    this.legacyRoot = join(this.stateRoot, 'legacy');
    this.configPath = join(this.legacyRoot, 'config', 'osdcloud-console.json');
  }

  initialize(): void {
    if (this.#database.getSetting<boolean>('product.initialized') !== true) {
      this.#bootstrapFromBundle();
    }
    this.materialize();
  }

  capture(snapshot: ProductStateSnapshot): void {
    this.#database.replaceProductState({
      config: cleanConfig(snapshot.config, this.appRoot, this.legacyRoot),
      profiles: documents(snapshot.profiles.profiles),
      softwarePackages: documents(snapshot.profiles.softwareCatalog),
      customScripts: documents(snapshot.profiles.customScriptCatalog),
      osImages: documents(snapshot.osImages.images),
    });
  }

  materialize(): void {
    const config = this.#database.getSetting<JsonObject>('product.config');
    if (!config) throw new Error('SQLite product configuration is missing.');
    const configRoot = join(this.legacyRoot, 'config');
    const profilesRoot = join(configRoot, 'deployment-profiles');
    mkdirSync(profilesRoot, { recursive: true });
    writeJsonAtomic(this.configPath, cleanConfig(config, this.appRoot, this.legacyRoot));
    materializeDocuments(profilesRoot, this.#database.listDocuments<JsonObject>('profiles'));
    writeJsonAtomic(join(configRoot, 'software-catalog.json'), {
      schemaVersion: 1,
      software: this.#database.listDocuments<JsonObject>('software_packages').map((item) => item.document),
    });
    writeJsonAtomic(join(configRoot, 'scripts-catalog.json'), {
      schemaVersion: 1,
      scripts: this.#database.listDocuments<JsonObject>('custom_scripts').map((item) => item.document),
    });
    writeJsonAtomic(join(configRoot, 'os-image-catalog.json'), {
      schemaVersion: 1,
      images: this.#database.listDocuments<JsonObject>('os_images').map((item) => item.document),
    });
    const sources = this.#database.getSetting<JsonObject>('product.osDownloadSources') ?? { allowedHosts: [], images: [] };
    writeJsonAtomic(join(configRoot, 'os-download-sources.json'), sources);
  }

  #bootstrapFromBundle(): void {
    const importedConfig = this.#database.getSetting<JsonObject>('legacy.config');
    const config = cleanConfig(importedConfig ?? readObject(join(this.appRoot, 'config', 'osdcloud-console.json')), this.appRoot, this.legacyRoot);
    const profiles = existingOrBundle(this.#database, 'profiles', () => readDocuments(join(this.appRoot, 'config', 'deployment-profiles')));
    const software = existingOrBundle(this.#database, 'software_packages', () => readCatalog(join(this.appRoot, 'config', 'software-catalog.json'), 'software'));
    const scripts = existingOrBundle(this.#database, 'custom_scripts', () => readCatalog(join(this.appRoot, 'config', 'scripts-catalog.json'), 'scripts'));
    const osImages = existingOrBundle(this.#database, 'os_images', () => readCatalog(join(this.appRoot, 'config', 'os-image-catalog.json'), 'images'));
    const osDownloadSourcesPath = join(this.appRoot, 'config', 'os-download-sources.json');
    const osDownloadSources = existsSync(osDownloadSourcesPath) ? readObject(osDownloadSourcesPath) : { allowedHosts: [], images: [] };
    this.#database.transaction(() => {
      this.#database.setSetting('product.config', config);
      for (const item of profiles) this.#database.saveDocument('profiles', item.id, item.document);
      for (const item of software) this.#database.saveDocument('software_packages', item.id, item.document);
      for (const item of scripts) this.#database.saveDocument('custom_scripts', item.id, item.document);
      for (const item of osImages) this.#database.saveDocument('os_images', item.id, item.document);
      this.#database.setSetting('product.osDownloadSources', osDownloadSources);
      this.#database.setSetting('product.initialized', true);
    });
    seedPayloadDirectory(join(this.appRoot, 'Softwares'), join(this.legacyRoot, 'Softwares'));
    seedPayloadDirectory(join(this.appRoot, 'Scripts'), join(this.legacyRoot, 'Scripts'));
  }
}

function cleanConfig(value: JsonObject, appRoot: string, legacyRoot: string): JsonObject {
  const config = structuredClone(value);
  for (const key of Object.keys(config)) if (key.startsWith('__')) delete config[key];
  const paths = isObject(config.paths) ? config.paths : {};
  config.paths = { ...paths, appRoot, stateRoot: legacyRoot };
  config.schemaVersion = 1;
  return config;
}

function documents(rows: JsonObject[]): Array<{ id: string; document: JsonObject }> {
  return rows.map((document) => ({ id: documentId(document), document }));
}

function materializeDocuments(root: string, documents: Array<{ id: string; document: JsonObject }>): void {
  const expected = new Set(documents.map((item) => `${item.id}.json`.toLowerCase()));
  for (const name of readdirSync(root)) {
    if (name.toLowerCase().endsWith('.json') && !expected.has(name.toLowerCase())) rmSync(join(root, name), { force: true });
  }
  for (const item of documents) writeJsonAtomic(join(root, `${item.id}.json`), item.document);
}

function existingOrBundle(
  database: WinceptionDatabase,
  table: 'profiles' | 'software_packages' | 'custom_scripts' | 'os_images',
  fallback: () => Array<{ id: string; document: JsonObject }>,
): Array<{ id: string; document: JsonObject }> {
  const existing = database.listDocuments<JsonObject>(table);
  return existing.length > 0 ? existing : fallback();
}

function readDocuments(root: string): Array<{ id: string; document: JsonObject }> {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => name.toLowerCase().endsWith('.json')).sort().map((name) => {
    const document = readObject(join(root, name));
    return { id: typeof document.id === 'string' ? document.id : basename(name, '.json'), document };
  });
}

function readCatalog(path: string, property: string): Array<{ id: string; document: JsonObject }> {
  if (!existsSync(path)) return [];
  const value = readObject(path);
  const rows = Array.isArray(value[property]) ? value[property] : [];
  return rows.flatMap((row) => isObject(row) && typeof row.id === 'string' ? [{ id: row.id, document: row }] : []);
}

function readObject(path: string): JsonObject {
  const value = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, '')) as unknown;
  if (!isObject(value)) throw new Error(`Expected a JSON object: ${path}`);
  return value;
}

function documentId(document: JsonObject): string {
  if (typeof document.id !== 'string' || !document.id) throw new Error('SQLite product document is missing an ID.');
  return document.id;
}

function seedPayloadDirectory(source: string, destination: string): void {
  if (!existsSync(source) || existsSync(destination)) return;
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
