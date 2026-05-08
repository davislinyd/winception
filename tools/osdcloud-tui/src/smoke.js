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
      runId: 'smoke',
      clientId: 'test-client',
      stage: 'winpe-start',
      message: 'smoke test',
    }),
  });
  assert.equal(response.status, 204);

  response = await fetch(`${base}/osdcloud/status`);
  assert.equal(response.status, 200);
  const latest = await response.json();
  assert.equal(latest.runId, 'smoke');
  assert.equal(latest.stage, 'winpe-start');

  response = await fetch(`${base}/osdcloud/screenshot?runId=smoke&clientId=test-client&stage=winpe-start&source=smoke&timestamp=2026-05-09T08:00:00%2B08:00`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: onePixelPng,
  });
  assert.equal(response.status, 201);
  const screenshot = await response.json();
  assert.ok(fs.existsSync(screenshot.filePath));
  assert.equal(JSON.parse(fs.readFileSync(path.join(statusRoot, 'latest-screenshot.json'), 'utf8')).stage, 'winpe-start');
  assert.match(fs.readFileSync(path.join(statusRoot, 'smoke.screenshots.jsonl'), 'utf8'), /winpe-start/);

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
