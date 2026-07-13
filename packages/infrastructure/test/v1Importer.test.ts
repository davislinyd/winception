import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { importV1State } from '../src/v1Importer.js';
import { WinceptionDatabase } from '../src/database.js';
import type { SecretProtector } from '../../domain/src/ports.js';

const protector: SecretProtector = {
  protect: async (name, value) => `protected:${name}:${Buffer.from(value).toString('base64')}`,
  unprotect: async (_name, value) => Buffer.from(value.split(':').at(-1) ?? '', 'base64').toString(),
};

test('v1 importer supports dry-run, protected secrets, backup and idempotent rerun', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-v2-'));
  try {
    const appRoot = join(root, 'App');
    const stateRoot = join(root, 'State');
    const backupRoot = join(root, 'Backup');
    mkdirSync(join(appRoot, 'config'), { recursive: true });
    mkdirSync(join(stateRoot, 'config', 'deployment-profiles'), { recursive: true });
    mkdirSync(join(stateRoot, 'status'), { recursive: true });
    writeJson(join(appRoot, 'config', 'osdcloud-console.json'), { network: { mode: 'shared-lan' }, paths: { projectRoot: 'C:\\OSDCloud' } });
    writeJson(join(stateRoot, 'config', 'osdcloud-console.local.json'), { network: { serviceIp: '10.0.0.2' } });
    writeJson(join(stateRoot, 'config', 'osdcloud-secrets.json'), {
      windowsUsername: 'operator', windowsPassword: 'secret-one', pxeinstallPassword: 'secret-two',
    });
    writeJson(join(stateRoot, 'config', 'deployment-profiles', 'minimal.json'), { id: 'minimal', name: 'Minimal' });
    writeJson(join(stateRoot, 'config', 'software-catalog.json'), { software: [{ id: 'sevenzip', name: '7-Zip' }] });
    writeJson(join(stateRoot, 'config', 'scripts-catalog.json'), { scripts: [{ id: 'baseline', name: 'Baseline' }] });
    const database = new WinceptionDatabase(join(root, 'v2', 'winception.db'));

    const dryRun = await importV1State({ appRoot, stateRoot, backupRoot, database, secretProtector: protector, dryRun: true });
    assert.equal(dryRun.status, 'dry-run');
    assert.equal(database.getSetting('migration.v1'), undefined);
    const imported = await importV1State({ appRoot, stateRoot, backupRoot, database, secretProtector: protector });
    assert.equal(imported.imported.profiles, 1);
    assert.equal(imported.imported.protectedSecrets, 3);
    assert.match(database.getProtectedSecret('windowsPassword') ?? '', /^protected:windowsPassword:/u);
    assert.deepEqual(database.getSetting<{ network: { mode: string; serviceIp: string } }>('legacy.config')?.network, {
      mode: 'shared-lan', serviceIp: '10.0.0.2',
    });
    const rerun = await importV1State({ appRoot, stateRoot, backupRoot, database, secretProtector: protector });
    assert.equal(rerun.status, 'already-imported');
    database.close();
  }
  finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('v1 importer handles missing optional catalogs and reports missing secrets', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-v2-'));
  try {
    const appRoot = join(root, 'App');
    const stateRoot = join(root, 'State');
    mkdirSync(join(appRoot, 'config'), { recursive: true });
    mkdirSync(join(stateRoot, 'config', 'deployment-profiles'), { recursive: true });
    writeJson(join(appRoot, 'config', 'osdcloud-console.json'), { network: { mode: 'shared-lan' } });
    writeJson(join(stateRoot, 'config', 'deployment-profiles', 'fallback.json'), { name: 'Fallback ID' });
    const database = new WinceptionDatabase(join(root, 'v2.db'));
    const report = await importV1State({ appRoot, stateRoot, backupRoot: join(root, 'Backup'), database, secretProtector: protector });
    assert.equal(report.imported.profiles, 1);
    assert.equal(report.imported.softwarePackages, 0);
    assert.equal(report.evidenceArchive, null);
    assert.equal(report.warnings.length, 1);
    assert.equal(database.listDocuments('profiles')[0]?.id, 'fallback');
    assert.equal(database.getSetting('runtime.rebuildRequired'), true);
    database.close();
  }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('v1 importer rejects invalid roots, malformed data and a changed rerun', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-v2-'));
  try {
    const appRoot = join(root, 'App');
    const stateRoot = join(root, 'State');
    mkdirSync(join(appRoot, 'config'), { recursive: true });
    mkdirSync(stateRoot, { recursive: true });
    const database = new WinceptionDatabase(join(root, 'v2.db'));
    await assert.rejects(importV1State({ appRoot, stateRoot: appRoot, backupRoot: join(root, 'Backup'), database, secretProtector: protector }), /must be separate/u);
    writeFileSync(join(appRoot, 'config', 'osdcloud-console.json'), '[]\n', 'utf8');
    await assert.rejects(importV1State({ appRoot, stateRoot, backupRoot: join(root, 'Backup'), database, secretProtector: protector }), /must contain a JSON object/u);
    writeJson(join(appRoot, 'config', 'osdcloud-console.json'), { version: 1 });
    await importV1State({ appRoot, stateRoot, backupRoot: join(root, 'Backup'), database, secretProtector: protector });
    writeJson(join(appRoot, 'config', 'osdcloud-console.json'), { version: 2 });
    await assert.rejects(importV1State({ appRoot, stateRoot, backupRoot: join(root, 'OtherBackup'), database, secretProtector: protector }), /different v1 state/u);
    database.close();
  }
  finally { rmSync(root, { recursive: true, force: true }); }
});

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
