import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createOsImageTorrent, NodeSuperSeeder, TorrentTracker } from '../src/torrent.js';

const aria2Exe = process.env.ARIA2_EXE;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function rpc(port, secret, method, gid) {
  const response = await fetch(`http://127.0.0.1:${port}/jsonrpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'offload-test',
      method,
      params: [`token:${secret}`, gid, ['status', 'uploadLength', 'completedLength', 'totalLength']],
    }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

test('two aria2 clients exchange host-assigned stripes before fallback', {
  skip: !aria2Exe,
  timeout: 120000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'torrent-offload-'));
  const cacheRoot = path.join(root, 'OS');
  const fileName = 'offload-test.wim';
  const fileBytes = 32 * 1024 * 1024;
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(path.join(cacheRoot, fileName), Buffer.alloc(fileBytes, 0x5a));

  const trackerPort = await freePort();
  const seederPort = await freePort();
  const tracker = new TorrentTracker({ enabled: true, serverIp: '127.0.0.1', trackerPort });
  let seeder;
  const clients = [];
  try {
    const config = {
      http: { host: '127.0.0.1', port: 80 },
      osImage: { cacheRoot },
      torrent: { enabled: true, trackerPort, pieceLengthBytes: 256 * 1024 },
    };
    const torrent = await createOsImageTorrent(config, { fileName });
    await tracker.start();
    seeder = new NodeSuperSeeder({
      enabled: true,
      osCacheRoot: cacheRoot,
      serverIp: '127.0.0.1',
      trackerPort,
      seederListenPort: seederPort,
      pieceLengthBytes: 256 * 1024,
    });
    await seeder.start();

    for (let i = 0; i < 2; i++) {
      const dir = path.join(root, `client-${i}`);
      fs.mkdirSync(dir, { recursive: true });
      const peerPort = await freePort();
      const rpcPort = await freePort();
      const gid = `a00000000000000${i}`;
      const secret = `offload-secret-${i}`;
      const proc = spawn(aria2Exe, [
        `--dir=${dir}`,
        '--check-integrity=true',
        '--seed-time=2',
        '--seed-ratio=0.0',
        '--file-allocation=none',
        '--enable-dht=false',
        '--enable-dht6=false',
        '--bt-enable-lpd=false',
        '--enable-peer-exchange=true',
        '--bt-tracker-interval=1',
        `--listen-port=${peerPort}`,
        `--gid=${gid}`,
        '--enable-rpc=true',
        '--rpc-listen-all=false',
        `--rpc-listen-port=${rpcPort}`,
        `--rpc-secret=${secret}`,
        '--console-log-level=warn',
        '--summary-interval=0',
        torrent.torrentPath,
      ], { windowsHide: true, stdio: 'ignore' });
      clients.push({ proc, dir, rpcPort, gid, secret });
    }

    const deadline = Date.now() + 90000;
    let statuses = [];
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        statuses = await Promise.all(clients.map((client) => rpc(
          client.rpcPort,
          client.secret,
          'aria2.tellStatus',
          client.gid,
        )));
        if (statuses.every((status) => status.completedLength === status.totalLength)) break;
      } catch {}
    }

    assert.equal(statuses.length, 2, 'both aria2 RPC endpoints responded');
    assert.ok(statuses.every((status) => status.completedLength === status.totalLength), 'both clients completed');
    assert.ok(statuses.every((status) => Number(status.uploadLength) > 0), 'both clients uploaded pieces');
    assert.ok(seeder.totalServedBytes >= fileBytes * 0.9, 'host supplied the initial complete piece set');
    assert.ok(seeder.totalServedBytes <= fileBytes * 1.15, 'host did not upload one full copy per client');
    for (const client of clients) {
      assert.equal(fs.statSync(path.join(client.dir, fileName)).size, fileBytes);
    }
  } finally {
    for (const client of clients) client.proc.kill();
    await seeder?.stop();
    await tracker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
