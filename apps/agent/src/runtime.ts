import { EventEmitter } from 'node:events';
import {
  WINCEPTION_V2_VERSION,
  CONTRACT_VERSION,
  type OperationRecord,
  type OsImagePayload,
  type SoftwareTestAbortPayload,
  type SoftwareTestStartPayload,
  type SystemState,
  type TorrentExtendPayload,
  type TorrentReleasePayload,
  type TorrentSettingsPayload,
} from '../../../packages/contracts/src/index.js';
import { OperationCoordinator } from '../../../packages/application/src/operationCoordinator.js';
import { ValidationError } from '../../../packages/domain/src/errors.js';
import type { OperationRepository } from '../../../packages/domain/src/ports.js';
import { AgentCommandRegistry } from '../../../packages/infrastructure/src/ipc.js';
import type { UploadStore } from '../../../packages/infrastructure/src/uploadStore.js';
import type { DeploymentSecretStore } from '../../../packages/infrastructure/src/deploymentSecrets.js';
import type { LegacyController } from './legacyController.js';
import { registerLegacyParityCommands } from './legacyParity.js';

export interface AgentRuntimeOptions {
  controller: LegacyController;
  operationRepository: OperationRepository;
  uploadStore?: UploadStore;
  deploymentSecrets?: DeploymentSecretStore;
  appRoot?: string;
  stateRoot?: string;
  onProductStateChanged?: () => void | Promise<void>;
  onEvidenceChanged?: () => void | Promise<void>;
}

export interface AgentRuntime {
  registry: AgentCommandRegistry;
  coordinator: OperationCoordinator;
  events: EventEmitter;
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const events = new EventEmitter();
  const softwareTestOperations = new Map<string, string>();
  const coordinator = new OperationCoordinator({
    repository: options.operationRepository,
    onChanged: (record) => events.emit('operation', record),
  });
  const registry = new AgentCommandRegistry();

  registry.register('system.health', () => ({
    ok: true,
    service: 'agent',
    version: WINCEPTION_V2_VERSION,
    contractVersion: CONTRACT_VERSION,
    at: new Date().toISOString(),
  }));

  registry.register('operations.list', () => options.operationRepository.list(100));
  registry.register('system.state', () => projectState(options.controller.getState(), coordinator.listActive()));

  registry.register('software-test.start', (payload) => {
    const { profileId } = payload as SoftwareTestStartPayload;
    const started = coordinator.start({
      label: 'Testing deployment profile software',
      resources: ['config', 'deployment-ingress', 'profile-payload', 'software-test-vm'],
      precondition: () => assertSoftwareTestIsolation(options.controller.getState()),
    }, async ({ id }) => {
      const execute = async (): Promise<Record<string, unknown>> => {
        const result = await options.controller.runExternallyCoordinated(() => options.controller.startSoftwareTest(profileId));
        const runId = typeof result.runId === 'string' ? result.runId : null;
        if (runId) softwareTestOperations.set(runId, id);
        try {
          await options.controller.softwareTestPromise;
          return result;
        }
        finally {
          if (runId) softwareTestOperations.delete(runId);
        }
      };
      return options.deploymentSecrets ? options.deploymentSecrets.withMaterialized(execute) : execute();
    });
    void started.promise.catch(() => undefined);
    return { operationId: started.operationId };
  });

  registry.register('software-test.abort', async (payload) => {
    const { runId } = payload as SoftwareTestAbortPayload;
    const result = await options.controller.abortSoftwareTest(runId);
    const operationId = softwareTestOperations.get(runId);
    if (operationId) coordinator.requestAbort(operationId);
    return result;
  });

  registry.register('torrent.settings.update', (payload) => {
    const { seedMinutes } = payload as TorrentSettingsPayload;
    const started = coordinator.start({
      label: 'Updating torrent settings',
      resources: ['config', 'deployment-ingress'],
    }, async () => {
      const result = await options.controller.runExternallyCoordinated(() => options.controller.updateTorrentSettings(seedMinutes));
      await options.onProductStateChanged?.();
      return result;
    });
    void started.promise.catch(() => undefined);
    return { operationId: started.operationId };
  });

  registry.register('torrent.client.release', (payload) => {
    const input = payload as TorrentReleasePayload;
    const started = coordinator.start({ label: 'Releasing torrent client', resources: ['runtime-control'] }, () => {
      return options.controller.runExternallyCoordinated(() => options.controller.releaseTorrentClients(input));
    });
    void started.promise.catch(() => undefined);
    return { operationId: started.operationId };
  });

  registry.register('torrent.client.extend', (payload) => {
    const input = payload as TorrentExtendPayload;
    const started = coordinator.start({ label: 'Extending torrent client', resources: ['runtime-control'] }, () => {
      return options.controller.runExternallyCoordinated(() => options.controller.extendTorrentClient(input));
    });
    void started.promise.catch(() => undefined);
    return { operationId: started.operationId };
  });

  registry.register('os-image.download.start', (payload) => {
    const { imageId } = payload as OsImagePayload;
    const started = coordinator.start({ label: 'Downloading OS image', resources: ['os-cache'] }, async () => {
      const result = options.controller.runExternallyCoordinated(() => options.controller.startOsDownload(imageId));
      await result.promise;
      await options.onProductStateChanged?.();
      return withoutPromise(result);
    });
    void started.promise.catch(() => undefined);
    return { operationId: started.operationId };
  });

  registry.register('os-image.reexport.start', (payload) => {
    const { imageId } = payload as OsImagePayload;
    const started = coordinator.start({ label: 'Re-exporting OS image', resources: ['os-cache', 'profile-payload'] }, async () => {
      const result = options.controller.runExternallyCoordinated(() => options.controller.startReexportOsImage(imageId));
      await result.promise;
      await options.onProductStateChanged?.();
      return withoutPromise(result);
    });
    void started.promise.catch(() => undefined);
    return { operationId: started.operationId };
  });

  registerLegacyParityCommands({
    registry,
    coordinator,
    controller: options.controller,
    appRoot: options.appRoot ?? process.cwd(),
    stateRoot: options.stateRoot ?? process.cwd(),
    ...(options.uploadStore ? { uploadStore: options.uploadStore } : {}),
    ...(options.deploymentSecrets ? { deploymentSecrets: options.deploymentSecrets } : {}),
    ...(options.onProductStateChanged ? { onProductStateChanged: options.onProductStateChanged } : {}),
    ...(options.onEvidenceChanged ? { onEvidenceChanged: options.onEvidenceChanged } : {}),
  });

  return { registry, coordinator, events };
}

function assertSoftwareTestIsolation(rawState: Record<string, unknown>): void {
  const services = objectValue(rawState.services);
  const activeServices = ['http', 'tftp', 'dhcp'].filter((name) => objectValue(services[name]).running === true);
  if (activeServices.length > 0) {
    throw new ValidationError(
      'Deployment services must be stopped before starting a Software Test VM run.',
      'Stop HTTP, TFTP, and DHCP, then retry the software test.',
    );
  }
  const fleet = objectValue(rawState.fleet);
  const runs = Array.isArray(fleet.runs) ? fleet.runs : [];
  if (runs.some((run) => objectValue(run).status === 'running')) {
    throw new ValidationError('Active deployments must finish before starting a Software Test VM run.');
  }
}

function projectState(rawState: Record<string, unknown>, operations: OperationRecord[]): SystemState {
  const services = objectValue(rawState.services);
  const ingressRunning = ['http', 'tftp', 'dhcp'].some((name) => objectValue(services[name]).running === true);
  const fleet = objectValue(rawState.fleet);
  const runs = Array.isArray(fleet.runs) ? fleet.runs : [];
  return {
    app: { version: WINCEPTION_V2_VERSION, contractVersion: CONTRACT_VERSION },
    services: { agent: 'connected', deploymentIngress: ingressRunning ? 'running' : 'stopped' },
    fleet: { activeRuns: runs.filter((run) => objectValue(run).status === 'running').length },
    operations,
    updatedAt: new Date().toISOString(),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function withoutPromise(result: { promise?: Promise<unknown>; [key: string]: unknown }): Record<string, unknown> {
  const safe = { ...result };
  delete safe.promise;
  return safe;
}
