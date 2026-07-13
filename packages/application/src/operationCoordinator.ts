import { randomUUID } from 'node:crypto';
import type { OperationRecord, OperationResource } from '../../contracts/src/index.js';
import { OperationConflictError } from '../../domain/src/errors.js';
import { systemClock, type Clock, type OperationRepository } from '../../domain/src/ports.js';

const RESOURCE_ORDER: readonly OperationResource[] = Object.freeze([
  'config',
  'deployment-ingress',
  'runtime',
  'os-cache',
  'profile-payload',
  'software-test-vm',
  'evidence',
  'runtime-control',
]);

const RESOURCE_INDEX = new Map(RESOURCE_ORDER.map((resource, index) => [resource, index]));

export interface OperationContext {
  id: string;
  signal: AbortSignal;
}

export interface OperationSpec {
  label: string;
  resources: readonly OperationResource[];
  precondition?: () => void | Promise<void>;
}

export interface OperationCoordinatorOptions {
  repository?: OperationRepository;
  clock?: Clock;
  createId?: () => string;
  onChanged?: (record: OperationRecord) => void;
}

export interface StartedOperation<T> {
  operationId: string;
  promise: Promise<T>;
}

export type OperationAction<T> = (context: OperationContext) => T | Promise<T>;

interface ActiveOperation {
  record: OperationRecord;
  controller: AbortController;
}

export class OperationCoordinator {
  readonly #active = new Map<string, ActiveOperation>();
  readonly #resourceOwners = new Map<OperationResource, string>();
  readonly #repository: OperationRepository | undefined;
  readonly #clock: Clock;
  readonly #createId: () => string;
  readonly #onChanged: ((record: OperationRecord) => void) | undefined;

  constructor(options: OperationCoordinatorOptions = {}) {
    this.#repository = options.repository;
    this.#clock = options.clock ?? systemClock;
    this.#createId = options.createId ?? randomUUID;
    this.#onChanged = options.onChanged;
  }

  listActive(): OperationRecord[] {
    return [...this.#active.values()].map(({ record }) => structuredClone(record));
  }

  async run<T>(spec: OperationSpec, action: OperationAction<T>): Promise<T> {
    return this.start(spec, action).promise;
  }

  start<T>(spec: OperationSpec, action: OperationAction<T>): StartedOperation<T> {
    const resources = normalizeResources(spec.resources);
    const conflicts = this.#findConflicts(resources);
    if (conflicts.length > 0) {
      throw new OperationConflictError(conflicts);
    }

    const id = this.#createId();
    const controller = new AbortController();
    const record: OperationRecord = {
      id,
      label: spec.label,
      resources,
      status: 'running',
      startedAt: this.#clock.now().toISOString(),
    };
    const active = { record, controller };
    this.#save(record);
    this.#active.set(id, active);
    for (const resource of resources) this.#resourceOwners.set(resource, id);

    const promise = this.#execute(spec, active, action);
    return { operationId: id, promise };
  }

  async #execute<T>(spec: OperationSpec, active: ActiveOperation, action: OperationAction<T>): Promise<T> {
    const { record, controller } = active;
    const resources = record.resources;
    try {
      await spec.precondition?.();
      const result = await action({ id: record.id, signal: controller.signal });
      record.status = controller.signal.aborted ? 'aborted' : 'succeeded';
      return result;
    }
    catch (error) {
      record.status = controller.signal.aborted ? 'aborted' : 'failed';
      record.errorCode = errorCode(error);
      throw error;
    }
    finally {
      record.finishedAt = this.#clock.now().toISOString();
      for (const resource of resources) {
        if (this.#resourceOwners.get(resource) === record.id) this.#resourceOwners.delete(resource);
      }
      this.#active.delete(record.id);
      this.#save(record);
    }
  }

  requestAbort(operationId: string): boolean {
    const active = this.#active.get(operationId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  #findConflicts(resources: readonly OperationResource[]): Array<{ operationId: string; label: string; resources: OperationResource[] }> {
    const byOperation = new Map<string, { operationId: string; label: string; resources: OperationResource[] }>();
    for (const resource of resources) {
      const ownerId = this.#resourceOwners.get(resource);
      if (!ownerId) continue;
      const owner = this.#active.get(ownerId);
      if (!owner) continue;
      const existing = byOperation.get(ownerId) ?? {
        operationId: ownerId,
        label: owner.record.label,
        resources: [],
      };
      existing.resources.push(resource);
      byOperation.set(ownerId, existing);
    }
    return [...byOperation.values()];
  }

  #save(record: OperationRecord): void {
    const snapshot = structuredClone(record);
    this.#repository?.save(snapshot);
    this.#onChanged?.(snapshot);
  }
}

function normalizeResources(resources: readonly OperationResource[]): OperationResource[] {
  return [...new Set(resources)].sort((left, right) => {
    const leftIndex = RESOURCE_INDEX.get(left);
    const rightIndex = RESOURCE_INDEX.get(right);
    if (leftIndex === undefined || rightIndex === undefined) throw new Error('Unknown operation resource.');
    return leftIndex - rightIndex;
  });
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return 'OPERATION_FAILED';
}
