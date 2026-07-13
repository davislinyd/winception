import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationCoordinator } from '../src/operationCoordinator.js';
import { OperationConflictError } from '../../domain/src/errors.js';
import type { OperationRecord } from '../../contracts/src/index.js';

test('rejects an overlapping resource and releases locks after completion', async () => {
  const records: OperationRecord[] = [];
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const coordinator = new OperationCoordinator({
    createId: () => `op-${records.length + 1}`,
    repository: { save: (record) => records.push(record), list: () => records },
  });

  const first = coordinator.run({ label: 'Prepare runtime', resources: ['runtime', 'config'] }, async () => waiting);
  await assert.rejects(
    coordinator.run({ label: 'Update torrent settings', resources: ['config'] }, async () => undefined),
    (error) => error instanceof OperationConflictError && error.conflicts[0]?.resources[0] === 'config',
  );
  release();
  await first;
  await coordinator.run({ label: 'Update torrent settings', resources: ['config'] }, async () => undefined);

  assert.equal(coordinator.listActive().length, 0);
  assert.deepEqual(records[0]?.resources, ['config', 'runtime']);
  assert.equal(records.at(-1)?.status, 'succeeded');
});

test('runs preconditions after resources are locked', async () => {
  const coordinator = new OperationCoordinator({ createId: () => 'software-test' });
  let observedActive = false;
  await coordinator.run({
    label: 'Software test',
    resources: ['deployment-ingress', 'profile-payload', 'software-test-vm'],
    precondition: () => { observedActive = coordinator.listActive().length === 1; },
  }, async () => undefined);
  assert.equal(observedActive, true);
});

test('abort marks the operation aborted and propagates the action error', async () => {
  const coordinator = new OperationCoordinator({ createId: () => 'abort-me' });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const running = coordinator.run({ label: 'Long task', resources: ['runtime-control'] }, async ({ signal }) => {
    markStarted();
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  });
  await started;
  assert.equal(coordinator.requestAbort('abort-me'), true);
  await assert.rejects(running, /cancelled/u);
  assert.equal(coordinator.listActive().length, 0);
});

test('persistence failure does not leak an operation resource lock', async () => {
  let fail = true;
  const records: OperationRecord[] = [];
  const coordinator = new OperationCoordinator({
    createId: () => 'persisted-operation',
    repository: {
      save: (record) => {
        if (fail) throw new Error('simulated persistence failure');
        records.push(record);
      },
      list: () => records,
    },
  });
  assert.throws(() => coordinator.start({ label: 'Persist first', resources: ['config'] }, async () => undefined), /persistence failure/u);
  assert.equal(coordinator.listActive().length, 0);
  fail = false;
  await coordinator.run({ label: 'Retry', resources: ['config'] }, async () => undefined);
  assert.equal(records.at(-1)?.status, 'succeeded');
});
