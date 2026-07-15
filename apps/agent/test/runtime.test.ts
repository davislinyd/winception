import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import type { LegacyController } from '../src/legacyController.js';
import type { OperationRecord } from '../../../packages/contracts/src/index.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DeploymentSecretStore } from '../../../packages/infrastructure/src/deploymentSecrets.js';
import { WinceptionDatabase } from '../../../packages/infrastructure/src/database.js';
import type { SecretProtector } from '../../../packages/domain/src/ports.js';

class MemoryOperations {
  records = new Map<string, OperationRecord>();
  save(record: OperationRecord): void { this.records.set(record.id, record); }
  list(): OperationRecord[] { return [...this.records.values()]; }
}

function controllerWithState(state: Record<string, unknown>): LegacyController {
  return {
    runExternallyCoordinated: <T>(action: () => T): T => action(),
    getState: () => state,
    shutdown: async () => undefined,
    startSoftwareTest: async () => ({ runId: 'run-1' }),
    abortSoftwareTest: async () => ({}),
    updateTorrentSettings: () => ({}),
    releaseTorrentClients: () => ({}),
    extendTorrentClient: () => ({}),
    startOsDownload: () => ({ promise: Promise.resolve() }),
    startReexportOsImage: () => ({ promise: Promise.resolve() }),
    softwareTestPromise: Promise.resolve(),
  } as unknown as LegacyController;
}

test('software test rechecks stopped ingress while holding its resources', async () => {
  const operations = new MemoryOperations();
  const runtime = createAgentRuntime({
    controller: controllerWithState({ services: { http: { running: true } }, fleet: { runs: [] } }),
    operationRepository: operations,
  });
  const result = runtime.registry.execute('software-test.start', { profileId: 'minimal' }) as Promise<{ operationId: string }>;
  const { operationId } = await result;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(operations.records.get(operationId)?.status, 'failed');
  assert.equal(operations.records.get(operationId)?.errorCode, 'VALIDATION_FAILED');
});

test('torrent runtime control and OS cache use independent resources', async () => {
  const operations = new MemoryOperations();
  let releaseDownload!: () => void;
  const controller = controllerWithState({ services: {}, fleet: { runs: [] } });
  controller.startOsDownload = () => ({ promise: new Promise<void>((resolve) => { releaseDownload = resolve; }) });
  const runtime = createAgentRuntime({ controller, operationRepository: operations });
  await runtime.registry.execute('os-image.download.start', { imageId: 'win11' });
  await runtime.registry.execute('torrent.client.extend', { runId: 'run-1', clientId: 'client-1', additionalMinutes: 15 });
  releaseDownload();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal([...operations.records.values()].some((record) => record.status === 'failed'), false);
});

test('OS cache mutation conflicts with profile publish while torrent settings conflict with service mutation', async () => {
  const operations = new MemoryOperations();
  let releaseDownload!: () => void;
  let releaseSettings!: () => void;
  const controller = controllerWithState({ services: {}, fleet: { runs: [] } });
  controller.startOsDownload = () => ({ promise: new Promise<void>((resolve) => { releaseDownload = resolve; }) });
  controller.changeDeploymentProfile = async () => ({});
  controller.updateTorrentSettings = () => new Promise<void>((resolve) => { releaseSettings = resolve; });
  controller.startService = async () => ({});
  const runtime = createAgentRuntime({ controller, operationRepository: operations });

  await runtime.registry.execute('os-image.download.start', { imageId: 'win11' });
  await assert.rejects(runtime.registry.execute('profile.publish', { id: 'profile-1' }), (error: unknown) => objectCode(error) === 'OPERATION_CONFLICT');
  releaseDownload();
  await new Promise((resolve) => setImmediate(resolve));

  await runtime.registry.execute('torrent.settings.update', { seedMinutes: 15 });
  await assert.rejects(runtime.registry.execute('service.start', { name: 'http' }), (error: unknown) => objectCode(error) === 'OPERATION_CONFLICT');
  releaseSettings();
  await new Promise((resolve) => setImmediate(resolve));
});

test('deployment root command rejects protected application paths inside the Agent boundary', async () => {
  const operations = new MemoryOperations();
  let updated = false;
  const controller = controllerWithState({ services: {}, fleet: { runs: [] } });
  controller.updateProjectRoot = async () => { updated = true; return {}; };
  const runtime = createAgentRuntime({
    controller,
    operationRepository: operations,
    appRoot: 'C:\\Program Files\\Winception\\app',
    stateRoot: 'C:\\ProgramData\\Winception\\State',
  });
  const result = await runtime.registry.execute('project-root.update', { projectRoot: 'C:\\Program Files\\Winception\\app\\runtime' }) as { operationId: string };
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(operations.records.get(result.operationId)?.status, 'failed');
  assert.equal(operations.records.get(result.operationId)?.errorCode, 'VALIDATION_FAILED');
  assert.equal(updated, false);
});

test('v2 secret command uses DPAPI SQLite state and materializes plaintext only inside secret-dependent operations', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-v2-'));
  try {
    const operations = new MemoryOperations();
    const database = new WinceptionDatabase(join(root, 'state.db'));
    const secretPath = join(root, 'legacy', 'config', 'osdcloud-secrets.json');
    const protector: SecretProtector = {
      protect: async (name, value) => `protected:${name}:${Buffer.from(value).toString('base64')}`,
      unprotect: async (_name, value) => Buffer.from(value.split(':').at(-1) ?? '', 'base64').toString(),
    };
    const deploymentSecrets = new DeploymentSecretStore({ database, protector, materializedPath: secretPath });
    const controller = controllerWithState({ services: {}, fleet: { runs: [] } });
    controller.saveDeploymentSecrets = async () => { throw new Error('plaintext legacy save must not run'); };
    controller.runPreflight = async () => {
      const value = JSON.parse(readFileSync(secretPath, 'utf8')) as Record<string, string>;
      assert.equal(value.windowsUsername, 'operator');
      return [];
    };
    const runtime = createAgentRuntime({ controller, operationRepository: operations, deploymentSecrets });
    const result = await runtime.registry.execute('secrets.save', {
      windowsUsername: 'operator', windowsPassword: 'password', pxeinstallPassword: 'pxe-password',
    }) as { operationId: string };
    await waitForFinished(operations, result.operationId);
    assert.equal(operations.records.get(result.operationId)?.status, 'succeeded');
    assert.match(database.getProtectedSecret('windowsPassword') ?? '', /^protected:windowsPassword:/u);
    assert.equal(existsSync(secretPath), false);
    database.close();
  }
  finally { rmSync(root, { recursive: true, force: true }); }
});

async function waitForFinished(repository: MemoryOperations, operationId: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (repository.records.get(operationId)?.status !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Operation did not finish.');
}

function objectCode(value: unknown): string {
  if (!value || typeof value !== 'object' || !('code' in value)) return '';
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}
