import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MediaHttpServer } from './httpServer.js';
import { TftpResponder } from './tftp.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-tui-smoke-'));
const httpRoot = path.join(root, 'http');
const tftpRoot = path.join(root, 'tftp');
const statusRoot = path.join(httpRoot, 'status');
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
fs.mkdirSync(path.join(httpRoot, 'osdcloud'), { recursive: true });
fs.mkdirSync(tftpRoot, { recursive: true });
fs.writeFileSync(path.join(httpRoot, 'osdcloud', 'boot.ipxe'), '#!ipxe\n');
fs.writeFileSync(path.join(httpRoot, 'osdcloud', 'boot.wim'), 'boot-image');
fs.writeFileSync(path.join(tftpRoot, 'snponly.efi'), 'efi');

const httpServer = new MediaHttpServer({
  root: httpRoot,
  host: '127.0.0.1',
  port: 0,
  logPath: path.join(root, 'http.log'),
  statusRoot,
});

const tftpServer = new TftpResponder({
  root: tftpRoot,
  listenIp: '127.0.0.1',
  port: 0,
  logPath: path.join(root, 'tftp.log'),
});

try {
  await httpServer.start();
  await tftpServer.start();
  const port = httpServer.address.port;
  const base = `http://127.0.0.1:${port}`;

  let response = await fetch(`${base}/osdcloud/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: 'smoke-a',
      clientId: 'test-client-a',
      stage: 'winpe-start',
      message: 'smoke test a',
    }),
  });
  assert.equal(response.status, 204);

  response = await fetch(`${base}/osdcloud/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: 'smoke-b',
      clientId: 'test-client-b',
      stage: 'windows-desktop-ready',
      percent: 100,
      message: 'smoke test b',
    }),
  });
  assert.equal(response.status, 204);

  response = await fetch(`${base}/osdcloud/status`);
  assert.equal(response.status, 200);
  const latest = await response.json();
  assert.equal(latest.runId, 'smoke-b');
  assert.equal(latest.stage, 'windows-desktop-ready');

  response = await fetch(`${base}/osdcloud/status/runs`);
  assert.equal(response.status, 200);
  const runs = await response.json();
  assert.equal(runs.total, 2);
  assert.equal(runs.counts.running, 1);
  assert.equal(runs.counts.completed, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(statusRoot, 'runs-index.json'), 'utf8')).total, 2);

  response = await fetch(`${base}/osdcloud/screenshot?runId=smoke-a&clientId=test-client-a&stage=winpe-start&source=smoke&timestamp=2026-05-09T08:00:00%2B08:00`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: onePixelPng,
  });
  assert.equal(response.status, 201);
  const screenshot = await response.json();
  assert.ok(fs.existsSync(screenshot.filePath));
  assert.equal(JSON.parse(fs.readFileSync(path.join(statusRoot, 'latest-screenshot.json'), 'utf8')).stage, 'winpe-start');
  assert.match(fs.readFileSync(path.join(statusRoot, 'smoke-a.screenshots.jsonl'), 'utf8'), /winpe-start/);

  response = await fetch(`${base}/osdcloud/boot.wim`, {
    headers: { range: 'bytes=0-3' },
  });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'boot');

  assert.ok(tftpServer.running);
  console.log(`Smoke test passed: ${root}`);
} finally {
  await Promise.allSettled([tftpServer.stop(), httpServer.stop()]);
  fs.rmSync(root, { recursive: true, force: true });
}
