import type {
  AgentCommandName,
  BootModePayload,
  DiagnosticsBundlePayload,
  DeploymentSecretsPayload,
  DhcpModePayload,
  IdPayload,
  IdsPayload,
  OperationResource,
  CustomScriptCreatePayload,
  SafeObjectPayload,
  ServicePayload,
  SoftwareCreatePayload,
  UploadTokenPayload,
} from '../../../packages/contracts/src/index.js';
import type { OperationCoordinator } from '../../../packages/application/src/operationCoordinator.js';
import type { AgentCommandRegistry } from '../../../packages/infrastructure/src/ipc.js';
import type { UploadStore, StagedFileKind } from '../../../packages/infrastructure/src/uploadStore.js';
import type { DeploymentSecretStore } from '../../../packages/infrastructure/src/deploymentSecrets.js';
import { createReadStream } from 'node:fs';
import { win32 } from 'node:path';
import { ValidationError } from '../../../packages/domain/src/errors.js';
import type { LegacyController } from './legacyController.js';

export function registerLegacyParityCommands(options: {
  registry: AgentCommandRegistry;
  coordinator: OperationCoordinator;
  controller: LegacyController;
  appRoot: string;
  stateRoot: string;
  uploadStore?: UploadStore;
  deploymentSecrets?: DeploymentSecretStore;
  onProductStateChanged?: () => void | Promise<void>;
  onEvidenceChanged?: () => void | Promise<void>;
}): void {
  const { registry, coordinator, controller, uploadStore, deploymentSecrets, onProductStateChanged, onEvidenceChanged } = options;
  const mutation = (
    targetRegistry: AgentCommandRegistry,
    targetCoordinator: OperationCoordinator,
    command: AgentCommandName,
    label: string,
    resources: OperationResource[],
    action: (payload: unknown) => unknown,
    usesSecrets = false,
  ): void => registerMutation(
    targetRegistry,
    targetCoordinator,
    command,
    label,
    resources,
    async (payload) => {
      const execute = (): unknown => controller.runExternallyCoordinated(() => action(payload));
      const result = usesSecrets && deploymentSecrets ? await deploymentSecrets.withMaterialized(execute) : await execute();
      if (resources.some(isProductStateResource)) await onProductStateChanged?.();
      if (resources.includes('evidence')) await onEvidenceChanged?.();
      return result;
    },
  );

  registry.register('deployment.snapshot', (payload) => controller.getState(asObject(payload)));
  registry.register('interfaces.list', () => controller.listInterfaces());
  registry.register('network.inspect', () => controller.inspectNetworkGateway());
  registry.register('profiles.list', () => controller.getProfiles());
  registry.register('os-images.list', () => controller.getOsImages());
  registry.register('os-images.catalog', (payload) => controller.getOsDownloadCatalog(asObject(payload)));
  registry.register('diagnostics.latest', () => controller.diagnosticsSummary());
  if (uploadStore) {
    registry.register('diagnostics.bundle.stage', async (payload) => {
      const { bundleName } = payload as DiagnosticsBundlePayload;
      const staged = await uploadStore.stageFile('diagnostics', controller.diagnosticsDownloadPath(bundleName), bundleName);
      return publicStagedFile(staged);
    });
  }
  registry.register('software.script.read', (payload) => controller.readSoftwareInstallScript((payload as IdPayload).id));
  registry.register('custom-script.read', (payload) => controller.readCustomScriptContent((payload as IdPayload).id));
  registry.register('software-test.status', () => controller.getSoftwareTestStatus());

  mutation(registry, coordinator, 'service.start', 'Starting deployment service', ['deployment-ingress'], (payload) => controller.startService((payload as ServicePayload).name));
  mutation(registry, coordinator, 'service.stop', 'Stopping deployment service', ['deployment-ingress'], (payload) => controller.stopService((payload as ServicePayload).name));
  mutation(registry, coordinator, 'services.start-all', 'Starting deployment services', ['deployment-ingress'], () => controller.startAll());
  mutation(registry, coordinator, 'services.stop-all', 'Stopping deployment services', ['deployment-ingress'], () => controller.stopAll());
  mutation(registry, coordinator, 'preflight.run', 'Running preflight', ['config', 'deployment-ingress', 'runtime'], () => controller.runPreflight(), true);
  mutation(registry, coordinator, 'diagnostics.run', 'Running diagnostics', ['evidence'], (payload) => controller.runDiagnostics(asObject(payload)));
  mutation(registry, coordinator, 'secrets.save', 'Saving deployment secrets', ['config'], async (payload) => {
    if (!deploymentSecrets) return controller.saveDeploymentSecrets(asObject(payload));
    await deploymentSecrets.save(payload as DeploymentSecretsPayload);
    const preflight = await deploymentSecrets.withMaterialized(() => controller.runPreflight());
    return { protected: true, status: deploymentSecrets.status(), preflight };
  });
  mutation(registry, coordinator, 'runtime.prepare', 'Preparing runtime', ['config', 'deployment-ingress', 'runtime', 'profile-payload'], () => controller.prepareRuntime(), true);
  mutation(registry, coordinator, 'project-root.update', 'Changing project root', ['config', 'deployment-ingress', 'runtime'], (payload) => {
    const input = asObject(payload);
    if (typeof input.projectRoot !== 'string') throw new ValidationError('The deployment project root is invalid.');
    assertSafeDeploymentRoot(input.projectRoot, options.appRoot, options.stateRoot);
    return controller.updateProjectRoot(input);
  });
  mutation(registry, coordinator, 'endpoint.update', 'Changing deployment endpoint', ['config', 'deployment-ingress', 'runtime', 'os-cache'], (payload) => controller.changeEndpoint(asObject(payload)), true);
  mutation(registry, coordinator, 'network.prepare', 'Preparing network gateway', ['config', 'deployment-ingress'], (payload) => controller.prepareNetworkGateway(asObject(payload)), true);
  mutation(registry, coordinator, 'network.remove', 'Removing network gateway', ['config', 'deployment-ingress'], () => controller.removeNetworkGateway());
  mutation(registry, coordinator, 'boot-mode.update', 'Changing boot mode', ['config', 'deployment-ingress', 'runtime'], (payload) => controller.changeBootMode((payload as BootModePayload).mode), true);
  mutation(registry, coordinator, 'dhcp-mode.update', 'Changing DHCP mode', ['config', 'deployment-ingress'], (payload) => controller.changeDhcpMode((payload as DhcpModePayload).mode), true);
  mutation(registry, coordinator, 'profile.publish', 'Publishing deployment profile', ['config', 'deployment-ingress', 'os-cache', 'profile-payload'], (payload) => controller.changeDeploymentProfile((payload as IdPayload).id), true);
  mutation(registry, coordinator, 'profile.create', 'Creating deployment profile', ['config', 'profile-payload'], (payload) => controller.addDeploymentProfile(asObject(payload)));
  mutation(registry, coordinator, 'profile.update', 'Updating deployment profile', ['config', 'profile-payload'], (payload) => controller.updateActiveDeploymentProfile(asObject(payload)));
  mutation(registry, coordinator, 'profile.delete', 'Deleting deployment profile', ['config', 'profile-payload'], (payload) => controller.removeDeploymentProfile((payload as IdPayload).id));
  mutation(registry, coordinator, 'software-test.configure', 'Configuring Software Test VM', ['config', 'software-test-vm'], (payload) => controller.configureSoftwareTest(asObject(payload)));
  mutation(registry, coordinator, 'os-image.delete', 'Deleting OS image', ['os-cache', 'profile-payload'], (payload) => controller.deleteOsImage((payload as IdPayload).id));
  if (uploadStore) {
    uploadAndCreate(registry, coordinator, uploadStore, controller, 'software.create', 'software', onProductStateChanged);
  }
  mutation(registry, coordinator, 'software.delete', 'Deleting software package', ['config', 'profile-payload'], (payload) => controller.removeSoftwarePackage((payload as IdPayload).id));
  mutation(registry, coordinator, 'software.script.open', 'Opening software install script', [], (payload) => controller.openSoftwareInstallScript((payload as IdPayload).id));
  if (uploadStore) {
    uploadAndCreate(registry, coordinator, uploadStore, controller, 'custom-script.create', 'custom-script', onProductStateChanged);
  }
  mutation(registry, coordinator, 'custom-script.delete', 'Deleting custom script', ['config', 'profile-payload'], (payload) => controller.removeCustomScript((payload as IdPayload).id));
  mutation(registry, coordinator, 'status.clear', 'Clearing deployment evidence', ['evidence'], () => controller.clearStatusFiles());
  mutation(registry, coordinator, 'status.run.delete', 'Deleting deployment run', ['evidence'], (payload) => controller.deleteStatusRun((payload as IdPayload).id));
  mutation(registry, coordinator, 'status.runs.delete', 'Deleting deployment runs', ['evidence'], (payload) => controller.deleteStatusRuns((payload as IdsPayload).ids));
  mutation(registry, coordinator, 'status.runs.archive', 'Archiving deployment runs', ['evidence'], (payload) => controller.archiveStatusRuns((payload as IdsPayload).ids));
  mutation(registry, coordinator, 'status.runs.restore', 'Restoring deployment runs', ['evidence'], (payload) => controller.restoreStatusRuns((payload as IdsPayload).ids));
  mutation(registry, coordinator, 'status.archive.delete', 'Deleting archived runs', ['evidence'], (payload) => controller.deleteArchivedRuns((payload as IdsPayload).ids));

  background(registry, coordinator, 'offline-iso.start', 'Creating offline ISO', ['config', 'runtime', 'os-cache', 'profile-payload', 'evidence'], () => controller.runExternallyCoordinated(() => controller.startOfflineIsoExport()), onEvidenceChanged, deploymentSecrets);
  if (uploadStore) {
    uploadCommit(registry, coordinator, uploadStore, controller, 'upload.os-image.commit', 'os-image', onProductStateChanged);
    uploadCommit(registry, coordinator, uploadStore, controller, 'upload.software.commit', 'software');
  }
}

function registerMutation(
  registry: AgentCommandRegistry,
  coordinator: OperationCoordinator,
  command: AgentCommandName,
  label: string,
  resources: OperationResource[],
  action: (payload: unknown) => unknown,
): void {
  registry.register(command, (payload) => {
    const started = coordinator.start({ label, resources }, () => action(payload));
    void started.promise.catch(() => undefined);
    return { operationId: started.operationId };
  });
}

function background(
  registry: AgentCommandRegistry,
  coordinator: OperationCoordinator,
  command: AgentCommandName,
  label: string,
  resources: OperationResource[],
  action: () => { promise?: Promise<unknown>; [key: string]: unknown },
  onCompleted?: () => void | Promise<void>,
  deploymentSecrets?: DeploymentSecretStore,
): void {
  registry.register(command, () => {
    const started = coordinator.start({ label, resources }, async () => {
      const execute = async (): Promise<Record<string, unknown>> => {
      const result = action();
      await result.promise;
      await onCompleted?.();
      const safe = { ...result };
      delete safe.promise;
      return safe;
      };
      return deploymentSecrets ? deploymentSecrets.withMaterialized(execute) : execute();
    });
    void started.promise.catch(() => undefined);
    return { operationId: started.operationId };
  });
}

function asObject(payload: unknown): SafeObjectPayload {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as SafeObjectPayload : {};
}

function uploadCommit(
  registry: AgentCommandRegistry,
  coordinator: OperationCoordinator,
  uploadStore: UploadStore,
  controller: LegacyController,
  command: 'upload.os-image.commit' | 'upload.software.commit' | 'upload.custom-script.commit',
  kind: Exclude<StagedFileKind, 'diagnostics'>,
  onProductStateChanged?: () => void | Promise<void>,
): void {
  const resources: OperationResource[] = kind === 'os-image' ? ['os-cache'] : ['config', 'profile-payload'];
  registry.register(command, (payload) => {
    const { uploadToken } = payload as UploadTokenPayload;
    const started = coordinator.start({ label: `Importing ${kind} upload`, resources }, async () => {
      return controller.runExternallyCoordinated(async () => {
        const staged = await uploadStore.resolve(uploadToken, kind);
        const input = { fileName: staged.fileName, size: staged.sizeBytes, stream: createReadStream(staged.path) };
        const result = kind === 'os-image'
          ? await controller.uploadOsImage(input)
          : kind === 'software'
            ? await controller.uploadSoftwareInstaller(input)
            : await controller.uploadCustomScript(input);
        uploadStore.consume(uploadToken);
        if (kind === 'os-image') await onProductStateChanged?.();
        return result;
      });
    });
    void started.promise.catch(() => undefined);
    return { operationId: started.operationId };
  });
}

function uploadAndCreate(
  registry: AgentCommandRegistry,
  coordinator: OperationCoordinator,
  uploadStore: UploadStore,
  controller: LegacyController,
  command: 'software.create' | 'custom-script.create',
  kind: 'software' | 'custom-script',
  onProductStateChanged?: () => void | Promise<void>,
): void {
  registry.register(command, (rawPayload) => {
    const payload = rawPayload as SoftwareCreatePayload | CustomScriptCreatePayload;
    const started = coordinator.start({
      label: kind === 'software' ? 'Creating software package' : 'Creating custom script',
      resources: ['config', 'profile-payload'],
    }, () => controller.runExternallyCoordinated(async () => {
      const staged = await uploadStore.resolve(payload.uploadToken, kind);
      const uploadInput = { fileName: staged.fileName, size: staged.sizeBytes, stream: createReadStream(staged.path) };
      const uploaded = kind === 'software'
        ? await controller.uploadSoftwareInstaller(uploadInput)
        : await controller.uploadCustomScript(uploadInput);
      const uploadId = objectValue(uploaded).uploadId;
      if (typeof uploadId !== 'string' || uploadId.length === 0) {
        throw new ValidationError('The privileged upload adapter did not return an upload ID.');
      }
      const input = { ...payload, uploadId } as Record<string, unknown>;
      delete input.uploadToken;
      const result = kind === 'software'
        ? await controller.addSoftwarePackage(input)
        : await controller.addCustomScript(input);
      uploadStore.consume(payload.uploadToken);
      await onProductStateChanged?.();
      return result;
    }));
    void started.promise.catch(() => undefined);
    return { operationId: started.operationId };
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isProductStateResource(resource: OperationResource): boolean {
  return resource === 'config' || resource === 'os-cache' || resource === 'profile-payload';
}

function publicStagedFile(staged: { uploadToken: string; fileName: string; sizeBytes: number; sha256: string }): Record<string, unknown> {
  return { uploadToken: staged.uploadToken, fileName: staged.fileName, sizeBytes: staged.sizeBytes, sha256: staged.sha256 };
}

function assertSafeDeploymentRoot(value: string, appRoot: string, stateRoot: string): void {
  if (!win32.isAbsolute(value) || value.includes('..')) throw new ValidationError('The deployment project root must be an absolute Windows path without traversal.');
  const root = win32.resolve(value);
  if (win32.dirname(root) === root) throw new ValidationError('A drive root cannot be used as the deployment project root.');
  const protectedRoots = [appRoot, stateRoot, process.env.SystemRoot, process.env.ProgramFiles]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => win32.resolve(candidate).toLowerCase());
  const normalized = root.toLowerCase();
  if (protectedRoots.some((candidate) => normalized === candidate || normalized.startsWith(`${candidate}\\`))) {
    throw new ValidationError('The deployment project root cannot be inside an application, State, Windows, or Program Files directory.');
  }
}
