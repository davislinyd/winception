import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WinceptionDatabase } from '../src/database.js';
import { ProductStateStore, type ProductStateSnapshot } from '../src/productState.js';

test('SQLite product state materializes the legacy adapter projection and removes drift', () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-product-state-'));
  const appRoot = join(root, 'app');
  const stateRoot = join(root, 'state');
  try {
    seedBundle(appRoot);
    const database = new WinceptionDatabase(join(stateRoot, 'winception.db'));
    const store = new ProductStateStore({ database, appRoot, stateRoot });
    store.initialize();
    assert.equal(database.getSetting('product.initialized'), true);
    assert.equal(database.listDocuments('profiles').length, 1);
    assert.equal(existsSync(join(store.legacyRoot, 'Softwares', 'tool', 'install.ps1')), true);

    const snapshot: ProductStateSnapshot = {
      config: { schemaVersion: 1, paths: {}, deploymentProfiles: { activeProfile: 'field' } },
      profiles: {
        profiles: [{ id: 'field', name: 'Field', description: '', softwareIds: [], execution: { defaultTimeoutSeconds: 900 }, installSequence: [], osImageId: 'win11' }],
        softwareCatalog: [], customScriptCatalog: [],
      },
      osImages: { images: [{ id: 'win11', name: 'Windows 11' }] },
    };
    store.capture(snapshot);
    store.materialize();
    assert.equal(existsSync(join(store.legacyRoot, 'config', 'deployment-profiles', 'minimal.json')), false);
    assert.equal(existsSync(join(store.legacyRoot, 'config', 'deployment-profiles', 'field.json')), true);
    assert.equal(database.listDocuments('os_images').length, 1);
    const config = JSON.parse(readFileSync(store.configPath, 'utf8')) as { paths: { appRoot: string; stateRoot: string } };
    assert.equal(config.paths.appRoot, appRoot);
    assert.equal(config.paths.stateRoot, store.legacyRoot);
    database.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite product state resumes imported rows and rejects incomplete snapshots', () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-product-state-'));
  const appRoot = join(root, 'app');
  const stateRoot = join(root, 'state');
  try {
    mkdirSync(join(appRoot, 'Softwares'), { recursive: true });
    mkdirSync(join(stateRoot, 'legacy', 'Softwares'), { recursive: true });
    const database = new WinceptionDatabase(join(stateRoot, 'winception.db'));
    database.setSetting('legacy.config', { schemaVersion: 7, __source: 'v1', paths: 'invalid' });
    database.saveDocument('profiles', 'imported', { id: 'imported', name: 'Imported' });
    database.saveDocument('software_packages', 'software', { id: 'software', name: 'Software' });
    database.saveDocument('custom_scripts', 'script', { id: 'script', name: 'Script' });
    database.saveDocument('os_images', 'image', { id: 'image', name: 'Image' });
    const store = new ProductStateStore({ database, appRoot, stateRoot });
    store.initialize();
    store.initialize();
    const config = JSON.parse(readFileSync(store.configPath, 'utf8')) as Record<string, unknown>;
    assert.equal(config.__source, undefined);
    assert.equal(database.listDocuments('custom_scripts').length, 1);
    assert.equal(database.listDocuments('os_images').length, 1);
    assert.throws(() => store.capture({
      config: {},
      profiles: { profiles: [{}], softwareCatalog: [], customScriptCatalog: [] },
      osImages: { images: [] },
    }), /missing an ID/u);
    database.close();

    const emptyDatabase = new WinceptionDatabase(join(root, 'empty.db'));
    assert.throws(() => new ProductStateStore({ database: emptyDatabase, appRoot, stateRoot: join(root, 'empty') }).materialize(), /configuration is missing/u);
    emptyDatabase.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite product state tolerates optional bundle catalogs and validates JSON objects', () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-product-state-'));
  try {
    const appRoot = join(root, 'app');
    const configRoot = join(appRoot, 'config');
    mkdirSync(join(configRoot, 'deployment-profiles'), { recursive: true });
    json(join(configRoot, 'osdcloud-console.json'), { paths: {} });
    json(join(configRoot, 'deployment-profiles', 'filename-id.json'), { name: 'Filename ID' });
    writeFileSync(join(configRoot, 'deployment-profiles', 'ignored.txt'), 'ignored', 'utf8');
    json(join(configRoot, 'software-catalog.json'), { software: 'invalid' });
    json(join(configRoot, 'scripts-catalog.json'), { scripts: [null, { id: 'script', name: 'Script' }] });
    const database = new WinceptionDatabase(join(root, 'state', 'winception.db'));
    const store = new ProductStateStore({ database, appRoot, stateRoot: join(root, 'state') });
    store.initialize();
    assert.equal(database.listDocuments('profiles')[0]?.id, 'filename-id');
    assert.equal(database.listDocuments('software_packages').length, 0);
    assert.equal(database.listDocuments('custom_scripts').length, 1);
    assert.equal(database.listDocuments('os_images').length, 0);
    database.close();

    const invalidRoot = join(root, 'invalid-app');
    mkdirSync(join(invalidRoot, 'config'), { recursive: true });
    json(join(invalidRoot, 'config', 'osdcloud-console.json'), []);
    const invalidDatabase = new WinceptionDatabase(join(root, 'invalid-state', 'winception.db'));
    assert.throws(
      () => new ProductStateStore({ database: invalidDatabase, appRoot: invalidRoot, stateRoot: join(root, 'invalid-state') }).initialize(),
      /Expected a JSON object/u,
    );
    invalidDatabase.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite product state fills missing bundled software metadata without replacing user values', () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-product-state-'));
  const appRoot = join(root, 'app');
  const stateRoot = join(root, 'state');
  try {
    seedBundle(appRoot);
    json(join(appRoot, 'config', 'software-catalog.json'), {
      software: [{
        id: 'tool', name: 'Bundled Tool', source: 'tool', installerFileName: 'tool.msi', installerBytes: 42,
        installerSha256: 'bundled-sha256', downloadUrl: 'https://example.test/tool.msi',
      }],
    });
    const database = new WinceptionDatabase(join(stateRoot, 'winception.db'));
    database.setSetting('product.initialized', true);
    database.setSetting('product.config', { paths: {} });
    database.saveDocument('software_packages', 'tool', {
      id: 'tool', name: 'User Tool', source: 'tool', installerFileName: null, installerBytes: null,
      installerSha256: 'user-sha256', downloadUrl: null,
    });

    const store = new ProductStateStore({ database, appRoot, stateRoot });
    store.initialize();
    const tool = database.listDocuments<Record<string, unknown>>('software_packages')[0]?.document;
    assert.equal(tool?.name, 'User Tool');
    assert.equal(tool?.installerFileName, 'tool.msi');
    assert.equal(tool?.installerBytes, 42);
    assert.equal(tool?.installerSha256, 'user-sha256');
    assert.equal(tool?.downloadUrl, 'https://example.test/tool.msi');

    store.initialize();
    assert.equal(database.listDocuments('software_packages').length, 1);
    database.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function seedBundle(appRoot: string): void {
  const configRoot = join(appRoot, 'config');
  mkdirSync(join(configRoot, 'deployment-profiles'), { recursive: true });
  mkdirSync(join(appRoot, 'Softwares', 'tool'), { recursive: true });
  mkdirSync(join(appRoot, 'Scripts'), { recursive: true });
  json(join(configRoot, 'osdcloud-console.json'), { schemaVersion: 1, paths: {}, deploymentProfiles: { activeProfile: 'minimal' } });
  json(join(configRoot, 'deployment-profiles', 'minimal.json'), { id: 'minimal', name: 'Minimal' });
  json(join(configRoot, 'software-catalog.json'), { software: [{ id: 'tool', name: 'Tool', source: 'tool' }] });
  json(join(configRoot, 'scripts-catalog.json'), { scripts: [] });
  json(join(configRoot, 'os-image-catalog.json'), { images: [] });
  json(join(configRoot, 'os-download-sources.json'), { allowedHosts: [], images: [] });
  writeFileSync(join(appRoot, 'Softwares', 'tool', 'install.ps1'), 'exit 0\n', 'utf8');
}

function json(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}
