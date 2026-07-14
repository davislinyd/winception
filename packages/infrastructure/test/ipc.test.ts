import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection, createServer, type Socket } from 'node:net';
import test from 'node:test';
import { AgentCommandRegistry, AgentPipeClient, createAgentPipeServer } from '../src/ipc.js';
import { ValidationError } from '../../domain/src/errors.js';

const token = 'test-token-that-is-longer-than-thirty-two-characters';

function testEndpoint(): string {
  return process.platform === 'win32'
    ? String.raw`\\.\pipe\Winception.Test.${randomUUID()}`
    : join(process.cwd(), `.tmp-v2-${randomUUID()}.sock`);
}

test('named-pipe agent executes only registered, schema-valid commands', async () => {
  const endpoint = testEndpoint();
  const registry = new AgentCommandRegistry();
  registry.register('system.health', () => ({ ok: true }));
  const server = createAgentPipeServer({ endpoint, authToken: token, registry });
  server.listen(endpoint);
  await once(server, 'listening');
  try {
    const client = new AgentPipeClient({ endpoint, authToken: token });
    assert.deepEqual(await client.request('system.health', {}), { ok: true });
    await assert.rejects(client.request('software-test.start', {}), (error) => {
      return error instanceof Error && 'code' in error && error.code === 'VALIDATION_FAILED';
    });
    const unauthorized = new AgentPipeClient({ endpoint, authToken: `${token}-wrong` });
    await assert.rejects(unauthorized.request('system.health', {}), (error) => {
      return error instanceof Error && 'code' in error && error.code === 'AGENT_AUTH_FAILED';
    });
    await assert.rejects(client.request('operations.list', {}), (error) => {
      return error instanceof Error && 'code' in error && error.code === 'COMMAND_NOT_ENABLED';
    });
    assert.throws(() => registry.register('system.health', () => ({})), /already registered/u);
  }
  finally {
    server.close();
    await once(server, 'close');
    if (process.platform !== 'win32') rmSync(endpoint, { force: true });
  }
});

test('Agent command validation accepts valid IPv4 endpoint payloads and rejects invalid addresses', async () => {
  const registry = new AgentCommandRegistry();
  registry.register('endpoint.update', (payload) => payload);
  const valid = { interfaceAlias: 'Ethernet 2', ipAddress: '192.168.77.2', prefixLength: 24, gateway: '192.168.77.1' };
  assert.deepEqual(await registry.execute('endpoint.update', valid), valid);
  assert.throws(() => registry.execute('endpoint.update', { ...valid, ipAddress: '999.168.77.2' }), /payload is invalid/u);
});

test('Agent IPC rejects weak tokens and redacts unexpected privileged failures', async () => {
  assert.throws(() => new AgentPipeClient({ authToken: 'short' }), /at least 32/u);
  assert.throws(() => createAgentPipeServer({ authToken: 'short', registry: new AgentCommandRegistry() }), /at least 32/u);
  const endpoint = testEndpoint();
  const registry = new AgentCommandRegistry();
  registry.register('system.health', () => { throw new Error('secret PowerShell command and path'); });
  const server = createAgentPipeServer({ endpoint, authToken: token, registry });
  server.listen(endpoint);
  await once(server, 'listening');
  try {
    const client = new AgentPipeClient({ endpoint, authToken: token });
    await assert.rejects(client.request('system.health', {}), (error) => {
      assert.ok(error instanceof Error);
      assert.equal('code' in error ? error.code : '', 'AGENT_COMMAND_FAILED');
      assert.doesNotMatch(error.message, /secret|PowerShell|path/u);
      return true;
    });
  }
  finally {
    server.close();
    await once(server, 'close');
    if (process.platform !== 'win32') rmSync(endpoint, { force: true });
  }
});

test('Agent IPC preserves only safe validation guidance', async () => {
  const endpoint = testEndpoint();
  const registry = new AgentCommandRegistry();
  registry.register('system.health', () => { throw new ValidationError('Safe validation message.', 'Use the product control.'); });
  const server = createAgentPipeServer({ endpoint, authToken: token, registry });
  server.listen(endpoint);
  await once(server, 'listening');
  try {
    const client = new AgentPipeClient({ endpoint, authToken: token });
    await assert.rejects(client.request('system.health', {}), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Safe validation message.');
      assert.equal('correctiveAction' in error ? error.correctiveAction : '', 'Use the product control.');
      return true;
    });
  }
  finally {
    server.close();
    await once(server, 'close');
    if (process.platform !== 'win32') rmSync(endpoint, { force: true });
  }
});

test('Agent IPC accepts only JSON payloads and JSON-safe handler results', async () => {
  const endpoint = testEndpoint();
  const registry = new AgentCommandRegistry();
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  registry.register('system.health', () => cyclic);
  registry.register('operations.list', () => 'x'.repeat(32_769));
  registry.register('system.state', () => undefined);
  const server = createAgentPipeServer({ endpoint, authToken: token, registry });
  server.listen(endpoint);
  await once(server, 'listening');
  try {
    const client = new AgentPipeClient({ endpoint, authToken: token });
    assert.throws(() => client.request('system.health', undefined), /valid JSON/u);
    await assert.rejects(client.request('system.health', {}), /cannot be serialized safely/u);
    await assert.rejects(client.request('operations.list', {}), /outside the response contract/u);
    assert.equal(await client.request('system.state', {}), null);
  }
  finally {
    server.close();
    await once(server, 'close');
    if (process.platform !== 'win32') rmSync(endpoint, { force: true });
  }
});

test('Agent client rejects missing endpoints and response contract mismatch', async () => {
  const missing = testEndpoint();
  await assert.rejects(new AgentPipeClient({ endpoint: missing, authToken: token, timeoutMs: 100 }).request('system.health', {}), /not running|connection failed/u);

  const endpoint = testEndpoint();
  const server = createServer((socket) => {
    socket.once('data', () => socket.end(`${JSON.stringify({ contractVersion: 1, id: 'wrong-id', ok: true, result: {} })}\n`));
  });
  server.listen(endpoint);
  await once(server, 'listening');
  try {
    await assert.rejects(new AgentPipeClient({ endpoint, authToken: token }).request('system.health', {}), /contract mismatch/u);
  }
  finally {
    server.close();
    await once(server, 'close');
    if (process.platform !== 'win32') rmSync(endpoint, { force: true });
  }
});

test('Agent server rejects malformed wire requests without executing handlers', async () => {
  const endpoint = testEndpoint();
  const registry = new AgentCommandRegistry();
  let executed = false;
  registry.register('system.health', () => { executed = true; return {}; });
  const server = createAgentPipeServer({ endpoint, authToken: token, registry });
  server.listen(endpoint);
  await once(server, 'listening');
  try {
    const socket = createConnection(endpoint);
    socket.end('{not-json}\n');
    let response = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { response += String(chunk); });
    await once(socket, 'close');
    assert.equal(executed, false);
    assert.equal(JSON.parse(response).ok, false);
  }
  finally {
    server.close();
    await once(server, 'close');
    if (process.platform !== 'win32') rmSync(endpoint, { force: true });
  }
});

test('Agent client enforces response timeout and maximum response size', async () => {
  const timeoutEndpoint = testEndpoint();
  let timeoutPeer: Socket | undefined;
  const timeoutServer = createServer((socket) => { timeoutPeer = socket; });
  timeoutServer.listen(timeoutEndpoint);
  await once(timeoutServer, 'listening');
  try {
    await assert.rejects(new AgentPipeClient({ endpoint: timeoutEndpoint, authToken: token, timeoutMs: 20 }).request('system.health', {}), /did not respond/u);
  }
  finally {
    timeoutPeer?.destroy();
    timeoutServer.close();
    await once(timeoutServer, 'close');
    if (process.platform !== 'win32') rmSync(timeoutEndpoint, { force: true });
  }

  const largeEndpoint = testEndpoint();
  let largePeer: Socket | undefined;
  const largeServer = createServer((socket) => { largePeer = socket; socket.end('x'.repeat(1024 * 1024 + 1)); });
  largeServer.listen(largeEndpoint);
  await once(largeServer, 'listening');
  try {
    await assert.rejects(new AgentPipeClient({ endpoint: largeEndpoint, authToken: token }).request('system.health', {}), /connection failed|size limit/u);
  }
  finally {
    largePeer?.destroy();
    largeServer.close();
    await once(largeServer, 'close');
    if (process.platform !== 'win32') rmSync(largeEndpoint, { force: true });
  }
});
