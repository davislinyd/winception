import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, createConnection, isIP, type Server, type Socket } from 'node:net';
import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  AGENT_COMMAND_PAYLOAD_SCHEMAS,
  AgentRequestSchema,
  AgentResponseSchema,
  CONTRACT_VERSION,
  JsonValueSchema,
  type AgentCommandName,
  type AgentRequest,
  type AgentResponse,
} from '../../contracts/src/index.js';
import { AgentUnavailableError, ValidationError } from '../../domain/src/errors.js';

export const DEFAULT_AGENT_PIPE = String.raw`\\.\pipe\ProtectedPrefix\Administrators\Winception.Agent.v2`;
const MAX_MESSAGE_BYTES = 1024 * 1024;

FormatRegistry.Set('ipv4', (value) => isIP(value) === 4);

export type AgentCommandHandler = (payload: unknown) => unknown;

export class AgentCommandRegistry {
  readonly #handlers = new Map<AgentCommandName, AgentCommandHandler>();

  register(command: AgentCommandName, handler: AgentCommandHandler): void {
    if (this.#handlers.has(command)) throw new Error(`Agent command already registered: ${command}`);
    this.#handlers.set(command, handler);
  }

  execute(command: AgentCommandName, payload: unknown): Promise<unknown> {
    const schema = AGENT_COMMAND_PAYLOAD_SCHEMAS[command];
    if (!Value.Check(schema, payload)) {
      throw new ValidationError('The command payload is invalid.', 'Refresh the console and retry the action.');
    }
    const handler = this.#handlers.get(command);
    if (!handler) {
      const error = new Error(`Command is not enabled: ${command}`) as Error & { code: string };
      error.code = 'COMMAND_NOT_ENABLED';
      throw error;
    }
    return Promise.resolve().then(() => handler(payload));
  }
}

export interface AgentPipeServerOptions {
  endpoint?: string;
  authToken: string;
  registry: AgentCommandRegistry;
}

export function createAgentPipeServer(options: AgentPipeServerOptions): Server {
  assertToken(options.authToken);
  return createServer({ allowHalfOpen: true }, (socket) => handleSocket(socket, options));
}

export class AgentPipeClient {
  readonly #endpoint: string;
  readonly #authToken: string;
  readonly #timeoutMs: number;

  constructor(options: { endpoint?: string; authToken: string; timeoutMs?: number }) {
    assertToken(options.authToken);
    this.#endpoint = options.endpoint ?? DEFAULT_AGENT_PIPE;
    this.#authToken = options.authToken;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  request<T>(command: AgentCommandName, payload: unknown): Promise<T> {
    if (!Value.Check(JsonValueSchema, payload)) throw new ValidationError('The Agent request payload must be valid JSON.');
    const request: AgentRequest = {
      contractVersion: CONTRACT_VERSION,
      id: randomUUID(),
      command,
      payload,
      authToken: this.#authToken,
    };
    return new Promise<T>((resolve, reject) => {
      const socket = createConnection(this.#endpoint);
      let buffer = '';
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new AgentUnavailableError('The privileged Winception Agent did not respond in time.'));
      }, this.#timeoutMs);
      timer.unref();
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) socket.destroy(new Error('Agent response exceeded the size limit.'));
      });
      socket.on('error', (error) => {
        clearTimeout(timer);
        reject(new AgentUnavailableError(safeConnectionMessage(error)));
      });
      socket.on('end', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(buffer.trim()) as unknown;
          if (!Value.Check(AgentResponseSchema, parsed)) throw new Error('Agent response contract mismatch.');
          const response: AgentResponse = parsed;
          if (response.id !== request.id || response.contractVersion !== CONTRACT_VERSION) {
            throw new Error('Agent response contract mismatch.');
          }
          if (!response.ok) {
            const error = new Error(response.error?.message ?? 'Agent command failed.') as Error & { code: string; correctiveAction?: string };
            error.code = response.error?.code ?? 'AGENT_COMMAND_FAILED';
            if (response.error?.correctiveAction) error.correctiveAction = response.error.correctiveAction;
            reject(error);
            return;
          }
          resolve(response.result as T);
        }
        catch (error) {
          reject(error instanceof Error ? error : new Error('Agent response parsing failed.'));
        }
      });
    });
  }
}

function handleSocket(socket: Socket, options: AgentPipeServerOptions): void {
  let buffer = '';
  let handled = false;
  socket.setEncoding('utf8');
  socket.setTimeout(15_000, () => socket.destroy());
  socket.on('data', (chunk: string) => {
    if (handled) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) socket.destroy();
    const newline = buffer.indexOf('\n');
    if (newline >= 0) {
      handled = true;
      socket.pause();
      void respond(socket, buffer.slice(0, newline), options);
    }
  });
  socket.on('error', () => undefined);
}

async function respond(socket: Socket, raw: string, options: AgentPipeServerOptions): Promise<void> {
  let id = 'invalid-request';
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    if (!Value.Check(AgentRequestSchema, parsed)) throw new ValidationError('The Agent request contract is invalid.');
    id = parsed.id;
    if (!tokensMatch(parsed.authToken, options.authToken)) {
      const error = new Error('Agent authentication failed.') as Error & { code: string };
      error.code = 'AGENT_AUTH_FAILED';
      throw error;
    }
    const result = normalizeJsonValue(await options.registry.execute(parsed.command, parsed.payload));
    socket.end(`${JSON.stringify({ contractVersion: CONTRACT_VERSION, id, ok: true, result } satisfies AgentResponse)}\n`);
  }
  catch (error) {
    socket.end(`${JSON.stringify({
      contractVersion: CONTRACT_VERSION,
      id,
      ok: false,
      error: safeAgentError(error),
    } satisfies AgentResponse)}\n`);
  }
}

function normalizeJsonValue(value: unknown): Exclude<AgentResponse['result'], undefined> {
  let normalized: unknown;
  try {
    normalized = value === undefined ? null : JSON.parse(JSON.stringify(value));
  }
  catch {
    throw new ValidationError('The Agent command returned data that cannot be serialized safely.');
  }
  if (!Value.Check(JsonValueSchema, normalized)) {
    throw new ValidationError('The Agent command returned data outside the response contract.');
  }
  return normalized;
}

function safeAgentError(error: unknown): { code: string; message: string; correctiveAction?: string } {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'AGENT_COMMAND_FAILED';
  const message = error instanceof ValidationError || code === 'COMMAND_NOT_ENABLED' || code === 'AGENT_AUTH_FAILED'
    ? error instanceof Error ? error.message : 'Agent command failed.'
    : 'The privileged operation failed. Review the local Agent log using the correlation ID.';
  const response: { code: string; message: string; correctiveAction?: string } = { code, message };
  if (error && typeof error === 'object' && 'correctiveAction' in error && typeof error.correctiveAction === 'string') {
    response.correctiveAction = error.correctiveAction;
  }
  return response;
}

function tokensMatch(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function assertToken(token: string): void {
  if (token.length < 32) throw new Error('Agent authentication token must contain at least 32 characters.');
}

function safeConnectionMessage(error: Error): string {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  return code === 'ENOENT' || code === 'ECONNREFUSED'
    ? 'The privileged Winception Agent is not running.'
    : 'The privileged Winception Agent connection failed.';
}
