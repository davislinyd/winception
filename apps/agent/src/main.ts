import { join, resolve } from 'node:path';
import { createAgentPipeServer, DEFAULT_AGENT_PIPE } from '../../../packages/infrastructure/src/ipc.js';
import { WinceptionDatabase } from '../../../packages/infrastructure/src/database.js';
import { UploadStore } from '../../../packages/infrastructure/src/uploadStore.js';
import { loadServiceSettings } from '../../../packages/infrastructure/src/serviceSettings.js';
import { loadLegacyController } from './legacyController.js';
import { createAgentRuntime } from './runtime.js';

async function main(): Promise<void> {
  const installed = process.env.WINCEPTION_AGENT_TOKEN ? undefined : await loadServiceSettings();
  const authToken = process.env.WINCEPTION_AGENT_TOKEN ?? installed?.agentToken ?? '';
  if (authToken.length < 32) throw new Error('WINCEPTION_AGENT_TOKEN must be provisioned by the installer.');
  const appRoot = resolve(process.env.WINCEPTION_APP_ROOT ?? installed?.appRoot ?? process.cwd());
  const stateRoot = resolve(process.env.WINCEPTION_V2_STATE_ROOT ?? installed?.stateRoot ?? 'C:\\ProgramData\\Winception\\State');
  const database = new WinceptionDatabase(join(stateRoot, 'winception-v2.db'));
  database.recoverInterruptedOperations();
  const uploadStore = new UploadStore(join(stateRoot, 'staging'));
  uploadStore.prune();
  const configPath = process.env.OSDCLOUD_CONSOLE_CONFIG ?? installed?.legacyConfigPath;
  const controller = await loadLegacyController(configPath ? { appRoot, configPath } : { appRoot });
  const runtime = createAgentRuntime({ controller, operationRepository: database, uploadStore, appRoot, stateRoot });
  const endpoint = process.env.WINCEPTION_AGENT_PIPE ?? installed?.agentPipe ?? DEFAULT_AGENT_PIPE;
  const server = createAgentPipeServer({ endpoint, authToken, registry: runtime.registry });
  server.listen(endpoint, () => console.log('Winception Agent v2 is ready.'));

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
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
