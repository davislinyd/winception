import { join, resolve } from 'node:path';
import { createAgentPipeServer, DEFAULT_AGENT_PIPE } from '../../../packages/infrastructure/src/ipc.js';
import { WinceptionDatabase } from '../../../packages/infrastructure/src/database.js';
import { DeploymentSecretStore } from '../../../packages/infrastructure/src/deploymentSecrets.js';
import { DpapiSecretProtector } from '../../../packages/infrastructure/src/dpapi.js';
import { ProductStateStore, type ProductStateSnapshot } from '../../../packages/infrastructure/src/productState.js';
import { EvidenceManager } from '../../../packages/infrastructure/src/evidence.js';
import { applyNamedPipeAcl } from '../../../packages/infrastructure/src/pipeAcl.js';
import { UploadStore } from '../../../packages/infrastructure/src/uploadStore.js';
import { loadServiceSettings } from '../../../packages/infrastructure/src/serviceSettings.js';
import { addPackagedPowerShellModulePath } from '../../../packages/infrastructure/src/powerShellModules.js';
import { loadLegacyController } from './legacyController.js';
import { createAgentRuntime } from './runtime.js';

async function main(): Promise<void> {
  const installed = process.env.WINCEPTION_AGENT_TOKEN ? undefined : await loadServiceSettings();
  const authToken = process.env.WINCEPTION_AGENT_TOKEN ?? installed?.agentToken ?? '';
  if (authToken.length < 32) throw new Error('WINCEPTION_AGENT_TOKEN must be provisioned by the installer.');
  const appRoot = resolve(process.env.WINCEPTION_APP_ROOT ?? installed?.appRoot ?? process.cwd());
  addPackagedPowerShellModulePath(appRoot);
  const stateRoot = resolve(process.env.WINCEPTION_V2_STATE_ROOT ?? installed?.stateRoot ?? 'C:\\ProgramData\\Winception\\State');
  const database = new WinceptionDatabase(join(stateRoot, 'winception-v2.db'));
  database.recoverInterruptedOperations();
  const uploadStore = new UploadStore(join(stateRoot, 'staging'));
  uploadStore.prune();
  const productState = new ProductStateStore({ database, appRoot, stateRoot });
  productState.initialize();
  const deploymentSecrets = new DeploymentSecretStore({
    database,
    protector: new DpapiSecretProtector(join(appRoot, 'tools', 'v2', 'Protect-WinceptionSecret.ps1')),
    materializedPath: join(productState.legacyRoot, 'config', 'osdcloud-secrets.json'),
  });
  deploymentSecrets.clearMaterialized();
  const controller = await loadLegacyController({
    appRoot,
    configPath: productState.configPath,
    dependencies: {
      getDeploymentSecretsStatus: () => deploymentSecrets.status(),
      readDeploymentSecrets: () => deploymentSecrets.read(),
    },
  });
  const evidence = new EvidenceManager({
    database,
    stateRoot,
    protectedRoots: [appRoot, process.env.SystemRoot, process.env.ProgramFiles].filter((value): value is string => Boolean(value)),
  });
  const maintainEvidence = async (): Promise<void> => {
    await evidence.maintain(statusRoot(controller.exportProductState()));
  };
  await maintainEvidence();
  const checkpoint = (): void => {
    try {
      productState.capture(controller.exportProductState());
    } catch (error) {
      productState.materialize();
      controller.reloadProductState(productState.configPath);
      throw error;
    }
  };
  const runtime = createAgentRuntime({
    controller, operationRepository: database, uploadStore, appRoot, stateRoot,
    deploymentSecrets,
    onProductStateChanged: checkpoint,
    onEvidenceChanged: maintainEvidence,
  });
  const retentionTimer = setInterval(() => {
    try {
      const started = runtime.coordinator.start({ label: 'Maintaining evidence retention', resources: ['evidence'] }, maintainEvidence);
      void started.promise.catch(() => undefined);
    } catch { return; }
  }, 60 * 60 * 1000);
  retentionTimer.unref();
  const endpoint = process.env.WINCEPTION_AGENT_PIPE ?? installed?.agentPipe ?? DEFAULT_AGENT_PIPE;
  const server = createAgentPipeServer({ endpoint, authToken, registry: runtime.registry });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => { server.off('error', reject); resolveListen(); });
  });
  const requirePipeAcl = installed !== undefined || process.env.WINCEPTION_REQUIRE_PIPE_ACL === '1';
  if (requirePipeAcl) {
    await applyNamedPipeAcl({ endpoint, scriptPath: join(appRoot, 'tools', 'v2', 'Set-WinceptionNamedPipeAcl.ps1') });
  }
  console.log('Winception Agent v2 is ready.');

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(retentionTimer);
    server.close();
    await controller.shutdown();
    database.close();
  };
  process.once('SIGINT', () => { void stop().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void stop().finally(() => process.exit(0)); });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Winception Agent failed to start.');
  process.exitCode = 1;
});

function statusRoot(snapshot: ProductStateSnapshot): string {
  const http = snapshot.config.http;
  if (!http || typeof http !== 'object' || Array.isArray(http) || typeof (http as Record<string, unknown>).statusRoot !== 'string') {
    throw new Error('The SQLite product configuration does not define an evidence status root.');
  }
  return (http as Record<string, unknown>).statusRoot as string;
}
