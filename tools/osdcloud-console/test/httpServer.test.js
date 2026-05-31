import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MediaHttpServer, parseRange, resolveRequestPath, sanitizeName } from '../src/httpServer.js';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function waitFor(condition, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('Timed out waiting for condition');
}

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

    response = await fetch(`http://127.0.0.1:${port}/osdcloud/status/runs`);
    assert.equal(response.status, 200);
    const runs = await response.json();
    assert.equal(runs.total, 1);
    assert.equal(runs.counts.running, 1);
    assert.equal(runs.runs[0].runId, 'test-run');

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

test('keeps status POST successful when driver pack cache backfill rejects metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-http-driverpack-test-'));
  const statusRoot = path.join(root, 'status');
  const cacheRoot = path.join(root, 'driverpacks');
  const server = new MediaHttpServer({
    root,
    host: '127.0.0.1',
    port: 0,
    logPath: path.join(root, 'http.log'),
    statusRoot,
    driverPackCache: {
      enabled: true,
      root: cacheRoot,
      allowedHosts: ['downloads.dell.com'],
    },
  });

  try {
    await server.start();
    const port = server.address.port;
    const response = await fetch(`http://127.0.0.1:${port}/osdcloud/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: 'driverpack-run',
        stage: 'windows-driverpack-cache-request',
        driverPacks: [{
          fileName: '..\\evil.exe',
          url: 'https://downloads.dell.com/FOLDER/evil.exe',
        }],
      }),
    });
    assert.equal(response.status, 204);

    assert.equal(JSON.parse(fs.readFileSync(path.join(statusRoot, 'latest.json'), 'utf8')).stage, 'windows-driverpack-cache-request');
    await waitFor(() => fs.existsSync(path.join(cacheRoot, 'driverpack-cache.jsonl')));
    const manifest = fs.readFileSync(path.join(cacheRoot, 'driverpack-cache.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(manifest[0].status, 'rejected');
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tracks multiple status runs and buckets missing run ids', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-http-runs-test-'));
  const statusRoot = path.join(root, 'status');
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
    const base = `http://127.0.0.1:${port}`;

    for (const payload of [
      { runId: 'run-a', clientId: 'client-a', stage: 'winpe-start' },
      { runId: 'run-b', clientId: 'client-b', stage: 'winpe-start' },
      { runId: 'run-a', clientId: 'client-a', stage: 'apply-image', percent: 50 },
      { runId: 'run-b', clientId: 'client-b', stage: 'windows-desktop-ready', percent: 100 },
      { clientId: 'legacy-client', stage: 'winpe-start' },
    ]) {
      const response = await fetch(`${base}/osdcloud/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 204);
    }

    const response = await fetch(`${base}/osdcloud/status/runs`);
    assert.equal(response.status, 200);
    const index = await response.json();
    assert.equal(index.total, 3);
    assert.equal(index.counts.running, 2);
    assert.equal(index.counts.completed, 1);
    assert.deepEqual(index.runs.map((run) => run.runId), ['unknown', 'run-a', 'run-b']);
    assert.deepEqual(index.runs.find((run) => run.runId === 'unknown').warnings, ['missing-run-id']);
    assert.equal(fs.existsSync(path.join(statusRoot, 'runs-index.json')), true);
    assert.equal(fs.existsSync(path.join(statusRoot, 'unknown.summary.json')), true);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sanitizes status run ids before writing summary files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-http-sanitize-test-'));
  const statusRoot = path.join(root, 'status');
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
    const response = await fetch(`http://127.0.0.1:${port}/osdcloud/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: '..\\evil', clientId: 'client-1', stage: 'winpe-start' }),
    });
    assert.equal(response.status, 204);

    const latest = JSON.parse(fs.readFileSync(path.join(statusRoot, 'latest.json'), 'utf8'));
    assert.equal(latest.runId, '.._evil');
    assert.deepEqual(latest.warnings, ['run-id-sanitized']);
    assert.equal(fs.existsSync(path.join(statusRoot, '.._evil.summary.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'evil.summary.json')), false);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('accepts PNG screenshots and writes sanitized metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-screenshot-test-'));
  const statusRoot = path.join(root, 'status');
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
    const response = await fetch(`http://127.0.0.1:${port}/osdcloud/screenshot?runId=..%5Cevil&clientId=client-1&stage=apply%2Fimage&source=winpe&timestamp=2026-05-09T08%3A00%3A00%2B08%3A00`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: onePixelPng,
    });
    assert.equal(response.status, 201);
    const metadata = await response.json();
    assert.equal(metadata.runId, '.._evil');
    assert.equal(metadata.stage, 'apply_image');
    assert.equal(metadata.bytes, onePixelPng.length);
    assert.ok(metadata.filePath.startsWith(path.join(statusRoot, 'screenshots', '.._evil')));
    assert.ok(fs.existsSync(metadata.filePath));

    const latest = JSON.parse(fs.readFileSync(path.join(statusRoot, 'latest-screenshot.json'), 'utf8'));
    assert.equal(latest.filePath, metadata.filePath);
    const jsonl = fs.readFileSync(path.join(statusRoot, '.._evil.screenshots.jsonl'), 'utf8').trim();
    assert.equal(JSON.parse(jsonl).stage, 'apply_image');
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects non-PNG screenshot content types and oversized bodies', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-screenshot-reject-'));
  const server = new MediaHttpServer({
    root,
    host: '127.0.0.1',
    port: 0,
    logPath: path.join(root, 'http.log'),
    statusRoot: path.join(root, 'status'),
  });

  try {
    await server.start();
    const port = server.address.port;
    let response = await fetch(`http://127.0.0.1:${port}/osdcloud/screenshot?runId=test`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not png',
    });
    assert.equal(response.status, 415);

    response = await fetch(`http://127.0.0.1:${port}/osdcloud/screenshot?runId=test`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.alloc((5 * 1024 * 1024) + 1),
    });
    assert.equal(response.status, 413);

    response = await fetch(`http://127.0.0.1:${port}/osdcloud/screenshot?runId=test`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('not a png'),
    });
    assert.equal(response.status, 400);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('serves boot configuration with secrets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-bootconfig-test-'));
  const statusRoot = path.join(root, 'status');
  const secretsDir = path.join(root, 'config');
  fs.mkdirSync(secretsDir, { recursive: true });
  fs.writeFileSync(
    path.join(secretsDir, 'osdcloud-secrets.json'),
    JSON.stringify({ windowsUsername: 'custom-user', windowsPassword: 'custom-pass', pxeinstallPassword: 'pxe-pass' }),
    'utf8',
  );

  const server = new MediaHttpServer({
    root,
    host: '127.0.0.1',
    port: 0,
    logPath: path.join(root, 'http.log'),
    statusRoot,
    paths: { stateRoot: root },
    smb: { share: '\\\\127.0.0.1\\OSDCloudiPXE' },
  });

  try {
    await server.start();
    const port = server.address.port;
    const response = await fetch(`http://127.0.0.1:${port}/osdcloud/boot-config`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.server, '127.0.0.1');
    assert.equal(body.share, '\\\\127.0.0.1\\OSDCloudiPXE');
    assert.equal(body.smbUser, 'pxeinstall');
    assert.equal(body.smbPassword, 'pxe-pass');
    assert.equal(body.windowsUsername, 'custom-user');
    assert.equal(body.windowsPassword, 'custom-pass');
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writes RFC 5424 syslog and duplicates screenshots under logs directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-logs-test-'));
  const statusRoot = path.join(root, 'status');
  const logsDir = path.join(root, 'logs');
  const server = new MediaHttpServer({
    root,
    host: '127.0.0.1',
    port: 0,
    logPath: path.join(root, 'http.log'),
    statusRoot,
    paths: { logsDir },
  });

  try {
    await server.start();
    const port = server.address.port;
    const base = `http://127.0.0.1:${port}`;

    const statusResponse = await fetch(`${base}/osdcloud/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: 'syslog-run',
        clientId: 'syslog-client',
        stage: 'winpe-start',
        message: 'Started WinPE run test',
        percent: 10,
        timestamp: '2026-05-30T12:00:00.000Z',
      }),
    });
    assert.equal(statusResponse.status, 204);

    const deploymentLogPath = path.join(logsDir, 'runs', 'syslog-run', 'deployment.log');
    assert.ok(fs.existsSync(deploymentLogPath), 'deployment.log should exist');
    const logContent = fs.readFileSync(deploymentLogPath, 'utf8').trim();

    assert.match(logContent, /^<\d+>1 \S+ syslog-client Client-WinPE syslog-run winpe-start \[deployment percent="10" stage="winpe-start"\] Started WinPE run test$/);

    const screenshotResponse = await fetch(`${base}/osdcloud/screenshot?runId=syslog-run&clientId=syslog-client&stage=winpe-start&source=winpe&timestamp=2026-05-30T12:00:00.000Z`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: onePixelPng,
    });
    assert.equal(screenshotResponse.status, 201);

    const runScreenshotDir = path.join(logsDir, 'runs', 'syslog-run', 'screenshots');
    assert.ok(fs.existsSync(runScreenshotDir), 'runs/syslog-run/screenshots directory should exist');
    const screenshots = fs.readdirSync(runScreenshotDir);
    assert.equal(screenshots.length, 1);
    assert.match(screenshots[0], /winpe-start\.png$/);
    const screenshotBytes = fs.readFileSync(path.join(runScreenshotDir, screenshots[0]));
    assert.deepEqual(screenshotBytes, onePixelPng);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

