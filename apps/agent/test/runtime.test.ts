import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import type { LegacyController } from '../src/legacyController.js';
import type { OperationRecord } from '../../../packages/contracts/src/index.js';

class MemoryOperations {
  records = new Map<string, OperationRecord>();
  save(record: OperationRecord): void { this.records.set(record.id, record); }
  list(): OperationRecord[] { return [...this.records.values()]; }
}

function controllerWithState(state: Record<string, unknown>): LegacyController {
  return {
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
  await runtime.registry.execute('torrent.client.extend', { runId: 'run-1', clientId: 'client-1' });
  releaseDownload();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal([...operations.records.values()].some((record) => record.status === 'failed'), false);
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
