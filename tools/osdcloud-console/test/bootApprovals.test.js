import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BootApprovals, bootPairingCode, isInClientSubnet } from '../src/bootApprovals.js';
import { MediaHttpServer } from '../src/httpServer.js';

test('approval is bound, expires, rejects replays, and limits the pending queue', () => {
  let now = 1_000;
  const approvals = new BootApprovals({ now: () => now, ttlMs: 100, limit: 2 });
  const identity = { key: { n: 'modulus', e: 'AQAB' }, nonce: 'one', bootId: 'boot',
    clientId: 'client', clientMac: 'AA-BB-CC-DD-EE-FF', runId: 'run', remoteIp: '10.0.0.50' };
  const request = approvals.submit(identity);
  assert.equal(approvals.submit(identity).requestId, request.requestId);
  assert.throws(() => approvals.decide(request.requestId, true, 'WRONG'), /does not match/);
  approvals.decide(request.requestId, true, request.pairingCode);
  approvals.issue(request.requestId, now + 100);
  const session = { ...identity, approvalId: request.requestId };
  assert.equal(approvals.valid(session), true);
  assert.equal(approvals.valid({ ...session, remoteIp: '10.0.0.51' }), false);
  assert.equal(approvals.valid({ ...session, bootId: 'another-boot' }), false);
  assert.equal(approvals.valid({ ...session, key: { ...identity.key, n: 'another-key' } }), false);
  for (const field of ['nonce', 'clientMac', 'clientId', 'runId']) assert.equal(approvals.valid({ ...session, [field]: 'different' }), false);
  assert.throws(() => approvals.submit(identity), /already used/);
  const rejected = approvals.submit({ ...identity, nonce: 'two' });
  approvals.decide(rejected.requestId, false);
  assert.throws(() => approvals.submit({ ...identity, nonce: 'two' }), /rejected/);
  assert.throws(() => approvals.submit({ ...identity, nonce: 'three' }), /queue is full/);
  now += 101;
  assert.equal(approvals.valid(session), false);
  assert.throws(() => approvals.decide(request.requestId, true, request.pairingCode), /no longer pending/);
  assert.deepEqual(approvals.list(), []);
});

test('pairing code is independently reproducible and client subnet uses the selected prefix', () => {
  const key = { n: 'modulus', e: 'AQAB' };
  const hex = crypto.createHash('sha256').update('modulus\nAQAB\nnonce\nboot').digest('hex').slice(0, 12).toUpperCase();
  assert.equal(bootPairingCode(key, 'nonce', 'boot'), `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`);
  assert.notEqual(bootPairingCode(key, 'another-nonce', 'boot'), bootPairingCode(key, 'nonce', 'boot'));
  assert.equal(isInClientSubnet('10.20.30.80', '10.20.30.1', 24), true);
  assert.equal(isInClientSubnet('10.20.31.80', '10.20.30.1', 24), false);
  assert.equal(isInClientSubnet('10.20.30.80', '10.20.30.1', null), false);
});

test('Proxy session waits without credentials, issues once after approval, and revokes on terminal status', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-proxy-pairing-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'osdcloud-secrets.json'), JSON.stringify({
    windowsUsername: 'test-user', windowsPassword: 'test-password', pxeinstallPassword: 'test-smb-password',
  }));
  const server = new MediaHttpServer({ root, host: '127.0.0.1', port: 0,
    logPath: path.join(root, 'http.log'), statusRoot: path.join(root, 'status'),
    paths: { stateRoot: root }, security: { requireBootSession: true, requireLeaseBinding: true },
    dhcp: { dhcpMode: 'proxy', listenIp: '127.0.0.1', prefixLength: 32 },
  }, null, { bootLeaseValidator: () => false });
  try {
    await server.start();
    const base = `http://127.0.0.1:${server.address.port}`;
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const request = { clientPublicKey: publicKey.export({ format: 'jwk' }), nonce: 'proxy-nonce',
      bootId: 'proxy-boot', clientId: 'proxy-client', clientMac: 'AA-BB-CC-DD-EE-FF', runId: 'proxy-run' };
    const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    server.acceptanceClients=new Set(['AABBCCDDEEFF']);
    const foreign=await post('/osdcloud/boot-session',{...request,clientMac:'AA-BB-CC-DD-EE-01'});
    assert.equal(foreign.status,403);assert.equal((await foreign.json()).envelope,undefined);
    assert.equal(server.bootApprovals.list().length,0);
    let response = await post('/osdcloud/boot-session', request);
    assert.equal(response.status, 202);
    const pending = await response.json();
    assert.deepEqual(Object.keys(pending).sort(), ['expiresAt', 'ok', 'pending', 'requestId']);
    const view = server.bootApprovals.list()[0];
    assert.equal(view.pairingCode, bootPairingCode(request.clientPublicKey, request.nonce, request.bootId));
    assert.equal(view.key, undefined);
    assert.equal(view.nonce, undefined);
    server.bootApprovals.decide(view.requestId, true, view.pairingCode);
    response = await post('/osdcloud/boot-session', { ...request, bootId: 'changed-boot' });
    assert.equal(response.status, 202);
    response = await post('/osdcloud/boot-session', request);
    assert.equal(response.status, 201);
    const session = await response.json();
    assert.ok(session.envelope);
    assert.equal(session.windowsPassword, undefined);
    response = await post('/osdcloud/boot-session', request);
    assert.equal(response.status, 403);
    response = await post('/osdcloud/status', { runId: request.runId, clientId: request.clientId, stage: 'windows-desktop-ready' }, {
      'x-winception-boot-session': session.sessionToken,
    });
    assert.equal(response.status, 204);
    response = await post('/osdcloud/status', { runId: request.runId, clientId: request.clientId, stage: 'winpe-start' }, {
      'x-winception-boot-session': session.sessionToken,
    });
    assert.equal(response.status, 401);
    const rejected = { ...request, nonce: 'rejected-nonce' };
    response = await post('/osdcloud/boot-session', rejected);
    const rejectedId = (await response.json()).requestId;
    server.bootApprovals.decide(rejectedId, false);
    response = await post('/osdcloud/boot-session', rejected);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).envelope, undefined);
    const expired = { ...request, nonce: 'expired-nonce' };
    response = await post('/osdcloud/boot-session', expired);
    const expiredId = (await response.json()).requestId;
    server.bootApprovals.requests.get(expiredId).expiresAt = Date.now() - 1;
    response = await post('/osdcloud/boot-session', expired);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).sessionToken, undefined);
    server.config.dhcp.listenIp = '10.0.0.1';
    response = await post('/osdcloud/boot-session', { ...request, nonce: 'out-of-subnet' });
    assert.equal(response.status, 403);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
