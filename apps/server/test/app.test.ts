import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentCommandName, DeploymentSnapshotResult, SystemState } from '../../../packages/contracts/src/index.js';
import { CONTRACT_VERSION, WINCEPTION_V2_VERSION } from '../../../packages/contracts/src/index.js';
import { createWebApp, deploymentSnapshotFingerprint } from '../src/app.js';
import type { AgentClientPort } from '../src/ports.js';
import { UploadStore } from '../../../packages/infrastructure/src/uploadStore.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const managementToken = 'management-token-that-is-longer-than-thirty-two-characters';

class FakeAgent implements AgentClientPort {
  calls: Array<{ command: AgentCommandName; payload: unknown }> = [];
  failure: Error | null = null;

  async request<T>(command: AgentCommandName, payload: unknown): Promise<T> {
    this.calls.push({ command, payload });
    if (this.failure) throw this.failure;
    if (command === 'system.state') return state() as T;
    if (command === 'operations.list') return [] as T;
    return { operationId: 'operation-1' } as T;
  }
}

test('management API requires a session and enforces same-origin mutation headers', async () => {
  const agent = new FakeAgent();
  const app = await createWebApp({ agent, managementToken, secureCookie: false });
  try {
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/v2/state' });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(unauthenticated.json().error.code, 'AUTH_REQUIRED');

    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/session', payload: { token: managementToken } });
    assert.equal(login.statusCode, 200);
    assert.match(String(login.headers['content-security-policy']), /default-src 'self'/u);
    assert.equal(login.headers['x-frame-options'], 'DENY');
    assert.equal(login.headers['strict-transport-security'], undefined);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const stateResponse = await app.inject({ method: 'GET', url: '/api/v2/state', headers: { cookie } });
    assert.equal(stateResponse.statusCode, 200);
    assert.equal(stateResponse.json().app.version, WINCEPTION_V2_VERSION);

    const blockedMutation = await app.inject({
      method: 'POST', url: '/api/v2/os-images/download', headers: { cookie }, payload: { imageId: 'win11' },
    });
    assert.equal(blockedMutation.statusCode, 400);
    assert.equal(blockedMutation.json().error.code, 'VALIDATION_FAILED');

    const mutation = await app.inject({
      method: 'POST',
      url: '/api/v2/os-images/download',
      headers: { cookie, origin: 'http://localhost', host: 'localhost', 'x-winception-requested-with': 'web' },
      payload: { imageId: 'win11' },
    });
    assert.equal(mutation.statusCode, 202);
    assert.equal(mutation.json().operationId, 'operation-1');
    assert.equal(agent.calls.at(-1)?.command, 'os-image.download.start');

    const tokenMutation = await app.inject({
      method: 'POST', url: '/api/v2/os-images/reexport', headers: { 'x-winception-token': managementToken }, payload: { imageId: 'win11' },
    });
    assert.equal(tokenMutation.statusCode, 202);
  }
  finally {
    await app.close();
  }
});

test('torrent release and extend keep their versioned payload boundary', async () => {
  const agent = new FakeAgent();
  const app = await createWebApp({ agent, managementToken, secureCookie: false });
  try {
    const headers = { 'x-winception-token': managementToken };
    const invalidExtend = await app.inject({ method: 'POST', url: '/api/v2/torrent/extend', headers, payload: { runId: 'run-1' } });
    assert.equal(invalidExtend.statusCode, 400);
    assert.equal(invalidExtend.json().error.code, 'VALIDATION_FAILED');

    const extend = await app.inject({ method: 'POST', url: '/api/v2/torrent/extend', headers, payload: { runId: 'run-1', additionalMinutes: 15 } });
    assert.equal(extend.statusCode, 202);
    assert.deepEqual(agent.calls.at(-1), { command: 'torrent.client.extend', payload: { runId: 'run-1', additionalMinutes: 15 } });

    const release = await app.inject({ method: 'POST', url: '/api/v2/torrent/release', headers, payload: { allWaiting: true } });
    assert.equal(release.statusCode, 202);
    assert.deepEqual(agent.calls.at(-1), { command: 'torrent.client.release', payload: { allWaiting: true } });
  }
  finally {
    await app.close();
  }
});

test('deployment snapshot fingerprints ignore generatedAt and retain live Fleet changes', () => {
  const base = { generatedAt: '2026-07-16T00:00:00.000Z', fleet: { runs: [{ runId: 'run-1', percent: 20 }] } } as unknown as DeploymentSnapshotResult;
  const timestampOnly = { ...base, generatedAt: '2026-07-16T00:00:02.000Z' };
  const changedFleet = { ...base, fleet: { runs: [{ runId: 'run-1', percent: 21 }] } };
  assert.equal(deploymentSnapshotFingerprint(base), deploymentSnapshotFingerprint(timestampOnly));
  assert.notEqual(deploymentSnapshotFingerprint(base), deploymentSnapshotFingerprint(changedFleet));
});

test('binary uploads are staged under opaque tokens and require an explicit commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'winception-web-upload-'));
  const agent = new FakeAgent();
  const app = await createWebApp({ agent, managementToken, secureCookie: false, uploadStore: new UploadStore(root) });
  try {
    const upload = await app.inject({
      method: 'POST', url: '/api/v2/uploads/custom-script',
      headers: {
        'x-winception-token': managementToken,
        'x-winception-file-name': 'install.ps1',
        'content-type': 'application/octet-stream',
        'content-length': '12',
      },
      payload: 'Write-Output',
    });
    assert.equal(upload.statusCode, 201);
    const uploadBody = upload.json<{ uploadToken: string }>();
    assert.match(uploadBody.uploadToken, /^[0-9a-f-]{36}$/u);
    assert.equal(agent.calls.some((call) => call.command === 'upload.custom-script.commit'), false);

    const commit = await app.inject({
      method: 'POST', url: '/api/v2/uploads/custom-script/commit',
      headers: { 'x-winception-token': managementToken },
      payload: { uploadToken: uploadBody.uploadToken },
    });
    assert.equal(commit.statusCode, 202);
    assert.equal(agent.calls.at(-1)?.command, 'upload.custom-script.commit');
  }
  finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('unexpected Agent errors are redacted behind a correlation ID', async () => {
  const agent = new FakeAgent();
  agent.failure = new Error('raw PowerShell path C:\\sensitive and command line');
  const app = await createWebApp({ agent, managementToken, secureCookie: false });
  try {
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/session', payload: { token: managementToken } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const response = await app.inject({ method: 'GET', url: '/api/v2/state', headers: { cookie } });
    const body = response.json();
    assert.equal(response.statusCode, 500);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(body), /PowerShell|sensitive|command line/u);
    assert.equal(typeof body.error.correlationId, 'string');
  }
  finally {
    await app.close();
  }
});

test('offline manual is public, route-safe and uses generated CSP hashes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'winception-manual-'));
  mkdirSync(join(root, 'manual', 'en', 'docs', 'install'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<h1>web</h1>');
  writeFileSync(join(root, 'manual', 'index.html'), '<h1>manual</h1>');
  writeFileSync(join(root, 'manual', '404.html'), '<h1>not found</h1>');
  writeFileSync(join(root, 'manual', 'en', 'docs', 'install', 'index.html'), '<h1>install</h1>');
  writeFileSync(join(root, 'manual', 'csp-hashes.json'), JSON.stringify({ schemaVersion: 1, hashes: ['sha256-YWJj'] }));
  const app = await createWebApp({ agent: new FakeAgent(), managementToken, secureCookie: false, staticRoot: root });
  try {
    const redirect = await app.inject({ method: 'GET', url: '/manual' });
    assert.equal(redirect.statusCode, 302);
    assert.equal(redirect.headers.location, '/manual/');
    const home = await app.inject({ method: 'GET', url: '/manual/' });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /manual/u);
    assert.match(String(home.headers['content-security-policy']), /script-src 'self' 'sha256-YWJj'/u);
    const nested = await app.inject({ method: 'GET', url: '/manual/en/docs/install/' });
    assert.equal(nested.statusCode, 200);
    assert.match(nested.body, /install/u);
    const traversal = await app.inject({ method: 'GET', url: '/manual/%2e%2e/service-settings.json' });
    assert.doesNotMatch(traversal.body, /managementTokenProtected|service-settings/u);
  }
  finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});

function state(): SystemState {
  return {
    app: { version: WINCEPTION_V2_VERSION, contractVersion: CONTRACT_VERSION },
    services: { agent: 'connected', deploymentIngress: 'stopped' },
    fleet: { activeRuns: 0 },
    operations: [],
    updatedAt: new Date().toISOString(),
  };
}
