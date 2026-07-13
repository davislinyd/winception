import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { ServerOptions } from 'node:https';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  ApiErrorSchema,
  AuthSessionRequestSchema,
  AuthStatusSchema,
  HealthSchema,
  OperationRecordSchema,
  SuccessSchema,
  SystemStateSchema,
  UploadStagedSchema,
  WINCEPTION_V2_VERSION,
  CONTRACT_VERSION,
  type OperationRecord,
  type SystemState,
} from '../../../packages/contracts/src/index.js';
import { AgentUnavailableError, OperationConflictError, ValidationError } from '../../../packages/domain/src/errors.js';
import { ManagementAuth } from './auth.js';
import { ServerEventHub } from './events.js';
import { registerAgentRoutes } from './agentRoutes.js';
import type { AgentClientPort } from './ports.js';
import type { UploadStore, StagedFileKind } from '../../../packages/infrastructure/src/uploadStore.js';

export interface WebAppOptions {
  agent: AgentClientPort;
  managementToken: string;
  secureCookie: boolean;
  staticRoot?: string;
  logger?: boolean;
  tls?: ServerOptions;
  uploadStore?: UploadStore;
}

export async function createWebApp(options: WebAppOptions): Promise<FastifyInstance> {
  const baseApp = options.tls
    ? Fastify({ logger: options.logger ?? false, https: options.tls })
    : Fastify({ logger: options.logger ?? false });
  const app = (baseApp as FastifyInstance).withTypeProvider<TypeBoxTypeProvider>();
  const auth = new ManagementAuth(options.managementToken, options.secureCookie);
  const events = new ServerEventHub();
  const transport = options.secureCookie ? 'https' : 'loopback-http';
  const staticRoot = resolve(options.staticRoot ?? 'dist/v2/web');
  const manualRoot = resolve(staticRoot, 'manual');
  const manualCspHashes = readManualCspHashes(manualRoot);

  app.addHook('onRequest', async (request, reply) => {
    if (/^\/manual\/(?:\.{2}|%2e)/iu.test(request.raw.url ?? '')) return reply.code(404).send();
    const scriptHashes = request.url === '/manual' || request.url.startsWith('/manual/') ? ` ${manualCspHashes.map((hash) => `'${hash}'`).join(' ')}` : '';
    reply.header('Content-Security-Policy', `default-src 'self'; connect-src 'self'; font-src 'self' data:; img-src 'self' data:; script-src 'self'${scriptHashes}; style-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    if (options.secureCookie) reply.header('Strict-Transport-Security', 'max-age=31536000');
  });

  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));

  await app.register(fastifySwagger, {
    openapi: {
      info: { title: 'Winception Management API', version: WINCEPTION_V2_VERSION },
      servers: [{ url: '/api/v2' }],
    },
  });

  app.get('/api/v2/health', { schema: { response: { 200: HealthSchema } } }, () => ({
    ok: true, service: 'web', version: WINCEPTION_V2_VERSION, contractVersion: CONTRACT_VERSION, at: new Date().toISOString(),
  } as const));

  app.get('/api/v2/auth/status', { schema: { response: { 200: AuthStatusSchema } } }, (request) => ({
    ok: true, authenticated: auth.isAuthenticated(request), authenticationRequired: true, transport,
  } as const));

  app.post('/api/v2/auth/session', {
    schema: { body: AuthSessionRequestSchema, response: { 200: SuccessSchema, 400: ApiErrorSchema } },
  }, (request, reply) => {
    const session = auth.createSession(request.body.token);
    reply.header('Set-Cookie', session.cookie);
    return { ok: true } as const;
  });

  app.delete('/api/v2/auth/session', (request, reply) => {
    auth.assertRequest(request);
    reply.header('Set-Cookie', auth.deleteSession(request));
    return { ok: true } as const;
  });

  app.get('/api/v2/openapi.json', (request) => {
    auth.assertRequest(request);
    return app.swagger();
  });

  app.get('/api/v2/state', { schema: { response: { 200: SystemStateSchema, 503: ApiErrorSchema } } }, async (request) => {
    auth.assertRequest(request);
    return options.agent.request<SystemState>('system.state', {});
  });

  app.get('/api/v2/operations', { schema: { response: { 200: Type.Object({ ok: Type.Literal(true), result: Type.Array(OperationRecordSchema) }) } } }, async (request) => {
    auth.assertRequest(request);
    return { ok: true, result: await options.agent.request<OperationRecord[]>('operations.list', {}) } as const;
  });

  app.get('/api/v2/events', (request, reply) => {
    auth.assertRequest(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 2500\n\n');
    events.add(reply);
  });

  registerAgentRoutes(app, auth, options.agent);

  if (options.uploadStore) registerFileRoutes(app, auth, options.uploadStore);

  app.setErrorHandler((error, request, reply) => {
    const correlationId = request.id;
    const normalized = normalizeError(error, correlationId);
    request.log.error({ err: error, correlationId }, 'request failed');
    void reply.code(normalized.statusCode).send(normalized.body);
  });

  if (existsSync(staticRoot)) {
    await app.register(fastifyStatic, { root: staticRoot, wildcard: false, index: false });
    app.get('/manual', (_request, reply) => reply.redirect('/manual/'));
    app.get('/manual/', (_request, reply) => reply.header('Cache-Control', 'no-cache').sendFile('manual/index.html'));
    app.get('/manual/*', (request, reply) => {
      const relative = String((request.params as { '*': string })['*'] ?? '').replace(/^\/+|\/+$/gu, '');
      if (!relative || relative.split('/').some((segment) => segment === '..') || relative.includes('\\') || relative.includes('\0')) return reply.code(404).send();
      const candidates = [`${relative}/index.html`, `${relative}.html`];
      const found = candidates.find((candidate) => {
        const path = resolve(manualRoot, candidate);
        return path.startsWith(`${manualRoot}${sep}`) && existsSync(path);
      });
      return reply.header('Cache-Control', 'no-cache').sendFile(found ? `manual/${found}` : 'manual/404.html');
    });
    app.get('/*', (_request, reply) => reply.sendFile('index.html'));
  }

  const heartbeat = setInterval(() => {
    auth.prune();
    events.heartbeat();
  }, 15_000);
  let polling = false;
  let stateFingerprint = '';
  let operationFingerprint = '';
  const poll = setInterval(() => {
    if (polling) return;
    polling = true;
    void Promise.all([
      options.agent.request<SystemState>('system.state', {}),
      options.agent.request('operations.list', {}),
    ]).then(([state, operations]) => {
      const stableState = { ...state, updatedAt: '' };
      const nextState = JSON.stringify(stableState);
      const nextOperations = JSON.stringify(operations);
      if (stateFingerprint && stateFingerprint !== nextState) events.publish('state.changed', state);
      if (operationFingerprint && operationFingerprint !== nextOperations) events.publish('operation.changed', operations);
      stateFingerprint = nextState;
      operationFingerprint = nextOperations;
    }).catch(() => undefined).finally(() => { polling = false; });
  }, 2_000);
  heartbeat.unref();
  poll.unref();
  app.addHook('onClose', () => { clearInterval(heartbeat); clearInterval(poll); });
  return app;
}

function readManualCspHashes(manualRoot: string): string[] {
  const path = resolve(manualRoot, 'csp-hashes.json');
  if (!existsSync(path)) return [];
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { schemaVersion?: unknown; hashes?: unknown };
    if (value.schemaVersion !== 1 || !Array.isArray(value.hashes)) return [];
    return value.hashes.filter((hash): hash is string => typeof hash === 'string' && /^sha256-[A-Za-z0-9+/]+=*$/u.test(hash));
  } catch { return []; }
}

function registerFileRoutes(app: FastifyInstance, auth: ManagementAuth, uploads: UploadStore): void {
  app.post('/api/v2/uploads/:kind', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['kind'],
        properties: { kind: { enum: ['os-image', 'software', 'custom-script'] } },
      },
      response: { 201: UploadStagedSchema, 400: ApiErrorSchema, 401: ApiErrorSchema },
    },
  }, async (request, reply) => {
    auth.assertRequest(request);
    const kind = (request.params as { kind: StagedFileKind }).kind;
    const encodedFileName = request.headers['x-winception-file-name'];
    const contentLength = request.headers['content-length'];
    if (typeof encodedFileName !== 'string' || typeof contentLength !== 'string') {
      throw new ValidationError('Upload filename and Content-Length are required.');
    }
    let fileName: string;
    try { fileName = decodeURIComponent(encodedFileName); }
    catch { throw new ValidationError('Upload filename encoding is invalid.'); }
    const declaredSize = Number(contentLength);
    const stream = request.body;
    if (!stream || typeof (stream as NodeJS.ReadableStream).pipe !== 'function') {
      throw new ValidationError('The upload body must use application/octet-stream.');
    }
    const staged = await uploads.stage(kind, fileName, stream as Readable, declaredSize);
    return reply.code(201).send({
      ok: true, uploadToken: staged.uploadToken, fileName: staged.fileName,
      sizeBytes: staged.sizeBytes, sha256: staged.sha256,
    });
  });

  app.get('/api/v2/downloads/:uploadToken', async (request, reply) => {
    auth.assertRequest(request);
    const { uploadToken } = request.params as { uploadToken: string };
    const staged = await uploads.resolve(uploadToken, 'diagnostics');
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Length', String(staged.sizeBytes));
    reply.header('Content-Disposition', `attachment; filename="${staged.fileName}"`);
    return reply.send(createReadStream(staged.path));
  });
}

function normalizeError(error: unknown, correlationId: string): { statusCode: number; body: { error: {
  code: string; message: string; correctiveAction?: string; correlationId: string; conflicts?: OperationConflictError['conflicts'];
} } } {
  if (error instanceof OperationConflictError) {
    return { statusCode: 409, body: { error: { code: error.code, message: error.message, correlationId, conflicts: error.conflicts } } };
  }
  if (error instanceof ValidationError) {
    const detail: { code: string; message: string; correctiveAction?: string; correlationId: string } = {
      code: error.code, message: error.message, correlationId,
    };
    if (error.correctiveAction) detail.correctiveAction = error.correctiveAction;
    return { statusCode: error.statusCode, body: { error: detail } };
  }
  if (error instanceof AgentUnavailableError) {
    return { statusCode: error.statusCode, body: { error: { code: error.code, message: error.message, correlationId } } };
  }
  const candidate = error instanceof Error
    ? error as Error & { code?: string; statusCode?: number; correctiveAction?: string }
    : new Error('Unknown request failure.') as Error & { code?: string; statusCode?: number; correctiveAction?: string };
  const allowed = new Set(['AUTH_REQUIRED', 'AGENT_AUTH_FAILED', 'COMMAND_NOT_ENABLED', 'VALIDATION_FAILED']);
  const code = candidate.code && allowed.has(candidate.code) ? candidate.code : 'INTERNAL_ERROR';
  const statusCode = candidate.statusCode && candidate.statusCode >= 400 && candidate.statusCode < 600
    ? candidate.statusCode : code === 'AUTH_REQUIRED' ? 401 : 500;
  const message = code === 'INTERNAL_ERROR' ? 'The request failed. Review the local service log using the correlation ID.' : candidate.message;
  const detail: { code: string; message: string; correctiveAction?: string; correlationId: string } = { code, message, correlationId };
  if (candidate.correctiveAction && code !== 'INTERNAL_ERROR') detail.correctiveAction = candidate.correctiveAction;
  return { statusCode, body: { error: detail } };
}
