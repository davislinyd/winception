import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { SecretProtector } from '../../domain/src/ports.js';
import { WinceptionDatabase } from '../src/database.js';
import { DeploymentSecretStore } from '../src/deploymentSecrets.js';

const protector: SecretProtector = {
  protect: async (name, value) => `protected:${name}:${Buffer.from(value).toString('base64')}`,
  unprotect: async (_name, ciphertext) => Buffer.from(ciphertext.split(':').at(-1) ?? '', 'base64').toString(),
};

test('deployment secrets persist only as protected SQLite values and materialize for the action lifetime', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-v2-'));
  try {
    const database = new WinceptionDatabase(join(root, 'state.db'));
    const path = join(root, 'legacy', 'config', 'osdcloud-secrets.json');
    const store = new DeploymentSecretStore({ database, protector, materializedPath: path });
    await store.save({ windowsUsername: 'operator', windowsPassword: 'one', pxeinstallPassword: 'two' });
    assert.equal(store.status().ready, true);
    assert.match(database.getProtectedSecret('windowsPassword') ?? '', /^protected:windowsPassword:/u);
    assert.equal(existsSync(path), false);
    assert.deepEqual(await store.read(), {
      windowsUsername: 'operator', windowsPassword: 'one', pxeinstallPassword: 'two',
    });
    assert.equal(existsSync(path), false);
    await store.withMaterialized(async () => {
      const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
      assert.equal(value.windowsUsername, 'operator');
      assert.equal(value.windowsPassword, 'one');
    });
    assert.equal(existsSync(path), false);
    database.close();
  }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('deployment secret materialization fails closed and scrubs after action failure or stale startup state', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-v2-'));
  try {
    const database = new WinceptionDatabase(join(root, 'state.db'));
    const path = join(root, 'legacy', 'config', 'osdcloud-secrets.json');
    const store = new DeploymentSecretStore({ database, protector, materializedPath: path });
    await assert.rejects(store.withMaterialized(() => undefined), /not configured/u);
    await store.save({ windowsUsername: 'operator', windowsPassword: 'one', pxeinstallPassword: 'two' });
    await assert.rejects(store.withMaterialized(() => { throw new Error('action failed'); }), /action failed/u);
    assert.equal(existsSync(path), false);
    await store.withMaterialized(() => { store.clearMaterialized(); });
    assert.equal(existsSync(path), false);
    database.close();
  }
  finally { rmSync(root, { recursive: true, force: true }); }
});
