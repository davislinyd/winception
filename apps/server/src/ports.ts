import type { AgentCommandName } from '../../../packages/contracts/src/index.js';

export interface AgentClientPort {
  request<T>(command: AgentCommandName, payload: unknown): Promise<T>;
}
