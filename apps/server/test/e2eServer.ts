import type { AgentCommandName, OperationRecord, SystemState } from '../../../packages/contracts/src/index.js';
import { CONTRACT_VERSION, WINCEPTION_V2_VERSION } from '../../../packages/contracts/src/index.js';
import { createWebApp } from '../src/app.js';
import type { AgentClientPort } from '../src/ports.js';

const operations: OperationRecord[] = [];

class E2eAgent implements AgentClientPort {
  async request<T>(command: AgentCommandName): Promise<T> {
    if (command === 'system.state') return state() as T;
    if (command === 'operations.list') return operations as T;
    const operationId = `e2e-${operations.length + 1}`;
    operations.unshift({
      id: operationId, label: command, resources: ['runtime'], status: 'running',
      startedAt: new Date().toISOString(),
    });
    setTimeout(() => {
      const operation = operations.find((candidate) => candidate.id === operationId);
      if (operation) { operation.status = 'succeeded'; operation.finishedAt = new Date().toISOString(); }
    }, 250).unref();
    return { operationId } as T;
  }
}

const app = await createWebApp({
  agent: new E2eAgent(),
  managementToken: 'winception-e2e-management-token-0000000000000000',
  secureCookie: false,
  staticRoot: 'dist/v2/web',
});
await app.listen({ host: '127.0.0.1', port: 18080 });

function state(): SystemState {
  return {
    app: { version: WINCEPTION_V2_VERSION, contractVersion: CONTRACT_VERSION },
    services: { agent: 'connected', deploymentIngress: 'stopped' },
    fleet: { activeRuns: 0 },
    operations: operations.filter((operation) => operation.status === 'running'),
    updatedAt: new Date().toISOString(),
  };
}

async function stop(): Promise<void> { await app.close(); }
process.once('SIGINT', () => { void stop().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { void stop().finally(() => process.exit(0)); });
