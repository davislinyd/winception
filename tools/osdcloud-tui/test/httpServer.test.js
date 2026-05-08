import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MediaHttpServer, parseRange, resolveRequestPath, sanitizeName } from '../src/httpServer.js';

test('sanitizes status run names', () => {
  assert.equal(sanitizeName('run:one/two'), 'run_one_two');
});

test('parses valid HTTP byte ranges', () => {
  assert.deepEqual(parseRange('bytes=1-3', 10), { start: 1, end: 3 });
  assert.deepEqual(parseRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=-4', 10), { start: 6, end: 9 });
  assert.equal(parseRange('bytes=20-30', 10), null);
});

test('keeps HTTP file resolution under root', () => {
  const root = path.join(os.tmpdir(), 'http-root');
  assert.equal(resolveRequestPath(root, '/%5c..%5csecret'), null);
  assert.ok(resolveRequestPath(root, '/osdcloud/boot.ipxe').resolved.startsWith(path.resolve(root)));
});

test('serves status and ranged files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-http-test-'));
  const statusRoot = path.join(root, 'status');
  fs.mkdirSync(path.join(root, 'osdcloud'), { recursive: true });
  fs.writeFileSync(path.join(root, 'osdcloud', 'boot.wim'), 'abcdef');
  const server = new MediaHttpServer({
    root,
    host: '127.0.0.1',
    port: 0,
    logPath: path.join(root, 'http.log'),
    statusRoot,
  });

  try {
    await server.start();
    const port = server.address.port;
    let response = await fetch(`http://127.0.0.1:${port}/osdcloud/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'test-run', stage: 'apply-image' }),
    });
    assert.equal(response.status, 204);

    response = await fetch(`http://127.0.0.1:${port}/osdcloud/status`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).stage, 'apply-image');

    response = await fetch(`http://127.0.0.1:${port}/osdcloud/boot.wim`, {
      headers: { range: 'bytes=2-4' },
    });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), 'cde');
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
