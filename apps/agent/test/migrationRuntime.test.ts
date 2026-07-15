import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductStateSnapshot } from '../../../packages/infrastructure/src/productState.js';
import type { LegacyController } from '../src/legacyController.js';
import { rebuildImportedRuntime } from '../src/migrationRuntime.js';

const snapshot = {
  config: {},
  profiles: { profiles: [], softwareCatalog: [], customScriptCatalog: [] },
  osImages: { images: [] },
} satisfies ProductStateSnapshot;

test('imported runtime rebuild materializes secrets before publishing product state', async () => {
  const settings = new Map<string, unknown>([['runtime.rebuildRequired', true]]);
  const calls: string[] = [];
  const rebuilt = await rebuildImportedRuntime({
    database: {
      getSetting: <T>(key: string): T | undefined => settings.get(key) as T | undefined,
      setSetting: (key, value) => { calls.push(`setting:${key}`); settings.set(key, value); },
    },
    controller: {
      prepareRuntime: async () => { calls.push('prepare'); },
      exportProductState: () => { calls.push('export'); return snapshot; },
    } as unknown as LegacyController,
    productState: { capture: () => { calls.push('capture'); } },
    deploymentSecrets: {
      withMaterialized: async <T>(action: () => T | Promise<T>): Promise<T> => {
        calls.push('secrets:start');
        const result = await action();
        calls.push('secrets:end');
        return result;
      },
    },
  });

  assert.equal(rebuilt, true);
  assert.deepEqual(calls, ['secrets:start', 'prepare', 'secrets:end', 'export', 'capture', 'setting:runtime.rebuildRequired']);
  assert.equal(settings.get('runtime.rebuildRequired'), false);
});

test('failed imported runtime rebuild remains pending and does not publish product state', async () => {
  const settings = new Map<string, unknown>([['runtime.rebuildRequired', true]]);
  let captured = false;
  await assert.rejects(rebuildImportedRuntime({
    database: {
      getSetting: <T>(key: string): T | undefined => settings.get(key) as T | undefined,
      setSetting: (key, value) => settings.set(key, value),
    },
    controller: {
      prepareRuntime: async () => { throw new Error('rebuild failed'); },
      exportProductState: () => snapshot,
    } as unknown as LegacyController,
    productState: { capture: () => { captured = true; } },
    deploymentSecrets: { withMaterialized: async (action) => action() },
  }), /rebuild failed/u);
  assert.equal(settings.get('runtime.rebuildRequired'), true);
  assert.equal(captured, false);
});

test('runtime rebuild is skipped when no migration is pending', async () => {
  const rebuilt = await rebuildImportedRuntime({
    database: { getSetting: <T>(): T | undefined => false as T, setSetting: () => { throw new Error('unexpected write'); } },
    controller: {} as LegacyController,
    productState: { capture: () => { throw new Error('unexpected capture'); } },
    deploymentSecrets: { withMaterialized: () => { throw new Error('unexpected materialization'); } },
  });
  assert.equal(rebuilt, false);
});
