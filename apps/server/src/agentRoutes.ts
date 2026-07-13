import type { FastifyInstance } from 'fastify';
import { Type, type TSchema } from '@sinclair/typebox';
import {
  AGENT_COMMAND_PAYLOAD_SCHEMAS,
  AGENT_COMMAND_RESULT_SCHEMAS,
  ApiErrorSchema,
  OperationAcceptedSchema,
  type AgentCommandName,
} from '../../../packages/contracts/src/index.js';
import type { ManagementAuth } from './auth.js';
import type { AgentClientPort } from './ports.js';

interface RouteDefinition {
  method: 'GET' | 'POST';
  url: string;
  command: AgentCommandName;
  mode: 'result' | 'accepted';
}

export const AGENT_HTTP_ROUTES: readonly RouteDefinition[] = Object.freeze([
  { method: 'POST', url: '/api/v2/deployment/snapshot', command: 'deployment.snapshot', mode: 'result' },
  { method: 'GET', url: '/api/v2/interfaces', command: 'interfaces.list', mode: 'result' },
  { method: 'GET', url: '/api/v2/network', command: 'network.inspect', mode: 'result' },
  { method: 'GET', url: '/api/v2/profiles', command: 'profiles.list', mode: 'result' },
  { method: 'GET', url: '/api/v2/os-images', command: 'os-images.list', mode: 'result' },
  { method: 'POST', url: '/api/v2/os-images/catalog/query', command: 'os-images.catalog', mode: 'result' },
  { method: 'GET', url: '/api/v2/diagnostics/latest', command: 'diagnostics.latest', mode: 'result' },
  { method: 'GET', url: '/api/v2/software/script', command: 'software.script.read', mode: 'result' },
  { method: 'GET', url: '/api/v2/custom-scripts/content', command: 'custom-script.read', mode: 'result' },
  { method: 'GET', url: '/api/v2/software-test/status', command: 'software-test.status', mode: 'result' },
  { method: 'POST', url: '/api/v2/services/start', command: 'service.start', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/services/stop', command: 'service.stop', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/services/start-all', command: 'services.start-all', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/services/stop-all', command: 'services.stop-all', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/preflight', command: 'preflight.run', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/diagnostics', command: 'diagnostics.run', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/diagnostics/bundle', command: 'diagnostics.bundle.stage', mode: 'result' },
  { method: 'POST', url: '/api/v2/secrets', command: 'secrets.save', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/runtime/prepare', command: 'runtime.prepare', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/project-root', command: 'project-root.update', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/endpoint', command: 'endpoint.update', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/network/prepare', command: 'network.prepare', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/network/remove', command: 'network.remove', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/boot-mode', command: 'boot-mode.update', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/dhcp-mode', command: 'dhcp-mode.update', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/profiles/publish', command: 'profile.publish', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/profiles/create', command: 'profile.create', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/profiles/update', command: 'profile.update', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/profiles/delete', command: 'profile.delete', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/software-test/configure', command: 'software-test.configure', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/software-test/start', command: 'software-test.start', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/software-test/abort', command: 'software-test.abort', mode: 'result' },
  { method: 'POST', url: '/api/v2/os-images/delete', command: 'os-image.delete', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/os-images/download', command: 'os-image.download.start', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/os-images/reexport', command: 'os-image.reexport.start', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/offline-iso', command: 'offline-iso.start', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/software/create', command: 'software.create', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/software/delete', command: 'software.delete', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/software/script/open', command: 'software.script.open', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/custom-scripts/create', command: 'custom-script.create', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/custom-scripts/delete', command: 'custom-script.delete', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/status/clear', command: 'status.clear', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/status/run/delete', command: 'status.run.delete', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/status/runs/delete', command: 'status.runs.delete', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/status/runs/archive', command: 'status.runs.archive', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/status/runs/restore', command: 'status.runs.restore', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/status/archive/delete', command: 'status.archive.delete', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/torrent/settings', command: 'torrent.settings.update', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/torrent/release', command: 'torrent.client.release', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/torrent/extend', command: 'torrent.client.extend', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/uploads/os-image/commit', command: 'upload.os-image.commit', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/uploads/software/commit', command: 'upload.software.commit', mode: 'accepted' },
  { method: 'POST', url: '/api/v2/uploads/custom-script/commit', command: 'upload.custom-script.commit', mode: 'accepted' },
]);

export function registerAgentRoutes(app: FastifyInstance, auth: ManagementAuth, agent: AgentClientPort): void {
  for (const route of AGENT_HTTP_ROUTES) {
    const payloadSchema = AGENT_COMMAND_PAYLOAD_SCHEMAS[route.command];
    const schema = route.method === 'GET'
      ? { querystring: payloadSchema, response: responseSchemas(route) }
      : { body: payloadSchema, response: responseSchemas(route) };
    app.route({
      method: route.method,
      url: route.url,
      schema,
      handler: async (request, reply) => {
        auth.assertRequest(request);
        const payload = route.method === 'GET' ? request.query : request.body;
        if (route.mode === 'accepted') {
          const result = await agent.request<{ operationId: string }>(route.command, payload);
          return reply.code(202).send({ ok: true, operationId: result.operationId });
        }
        return { ok: true, result: await agent.request(route.command, payload) };
      },
    });
  }
}

function responseSchemas(route: RouteDefinition): Record<number, TSchema> {
  const success = route.mode === 'accepted'
    ? OperationAcceptedSchema
    : Type.Object({
      ok: Type.Literal(true),
      result: AGENT_COMMAND_RESULT_SCHEMAS[route.command] ?? Type.Never(),
    }, { additionalProperties: false });
  return route.mode === 'accepted'
    ? { 202: OperationAcceptedSchema, 400: ApiErrorSchema, 401: ApiErrorSchema, 409: ApiErrorSchema, 503: ApiErrorSchema }
    : { 200: success, 400: ApiErrorSchema, 401: ApiErrorSchema, 409: ApiErrorSchema, 503: ApiErrorSchema };
}
