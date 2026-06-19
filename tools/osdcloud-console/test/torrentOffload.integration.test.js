import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createOsImageTorrent, NodeSuperSeeder, TorrentTracker } from '../src/torrent.js';
import { TorrentDistributionCoordinator } from '../src/torrentCoordinator.js';

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

async function spawnAriaClient({ root, torrentPath, index, seedMinutes = 2, maxUploadLimit = null }) {
  const dir = path.join(root, `client-${index}`);
  fs.mkdirSync(dir, { recursive: true });
  const peerPort = await freePort();
  const rpcPort = await freePort();
  const gid = Number(index + 1).toString(16).padStart(16, '0');
  const secret = `offload-secret-${index}`;
  const args = [
    `--dir=${dir}`,
    '--check-integrity=true',
    `--seed-time=${seedMinutes}`,
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
    torrentPath,
  ];
  if (maxUploadLimit) args.unshift(`--max-upload-limit=${maxUploadLimit}`);
  const proc = spawn(aria2Exe, args, { windowsHide: true, stdio: 'ignore' });
  return { proc, dir, rpcPort, gid, secret };
}

async function waitForStatuses(clients, timeoutMs, onPoll = null) {
  const deadline = Date.now() + timeoutMs;
  let statuses = [];
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      statuses = await Promise.all(clients.map((client) => rpc(client.rpcPort, client.secret, 'aria2.tellStatus', client.gid)));
      await onPoll?.(statuses);
      if (statuses.every((status) => status.completedLength === status.totalLength)) break;
    } catch {}
  }
  return statuses;
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

test('clients joining after the 24 second origin batch remain peer-only and offload through the prior seeder', {
  skip: !aria2Exe,
  timeout: 150000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'torrent-late-wave-'));
  const cacheRoot = path.join(root, 'OS');
  const fileName = 'late-wave.wim';
  const fileBytes = 24 * 1024 * 1024;
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(path.join(cacheRoot, fileName), Buffer.alloc(fileBytes, 0x3c));
  const trackerPort = await freePort();
  const seederPort = await freePort();
  const coordinator = new TorrentDistributionCoordinator({ stateRoot: root });
  const tracker = new TorrentTracker({ enabled: true, serverIp: '127.0.0.1', trackerPort }, coordinator);
  const clients = [];
  let seeder;
  try {
    const torrent = await createOsImageTorrent({
      http: { host: '127.0.0.1', port: 80 }, osImage: { cacheRoot },
      torrent: { enabled: true, trackerPort, pieceLengthBytes: 256 * 1024 },
    }, { fileName });
    await tracker.start();
    seeder = new NodeSuperSeeder({
      enabled: true, osCacheRoot: cacheRoot, serverIp: '127.0.0.1', trackerPort,
      seederListenPort: seederPort, pieceLengthBytes: 256 * 1024,
    }, coordinator);
    await seeder.start();
    clients.push(await spawnAriaClient({ root, torrentPath: torrent.torrentPath, index: 0, maxUploadLimit: '2M' }));
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    clients.push(await spawnAriaClient({ root, torrentPath: torrent.torrentPath, index: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 3000));
    clients.push(await spawnAriaClient({ root, torrentPath: torrent.torrentPath, index: 2 }));
    const statuses = await waitForStatuses(clients, 100_000);
    assert.ok(statuses.every((status) => status.completedLength === status.totalLength), 'origin and late clients complete');
    const lateAssignments = [...coordinator.assignments.values()].filter((item) => item.batch === 2);
    assert.equal(lateAssignments.length, 2);
    assert.ok(
      lateAssignments.every((item) => item.assignedMode === 'peer-only'),
      JSON.stringify([...coordinator.assignments.values()].map((item) => ({
        batch: item.batch, mode: item.mode, assignedMode: item.assignedMode, complete: item.complete,
        ageMs: Date.now() - item.lastSeen, peerId: item.peerId.slice(0, 12),
      }))),
    );
    assert.ok(statuses.slice(1).some((status) => Number(status.uploadLength) > 0), 'late batch redistributes data between its peers');
    assert.ok(seeder.totalServedBytes <= fileBytes * 1.15, 'late batch does not consume another host copy');
  } finally {
    for (const client of clients) client.proc.kill();
    await seeder?.stop();
    await tracker.stop();
    coordinator.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('peer-only aria2 client enters visible emergency fallback when no prior source remains', {
  skip: !aria2Exe,
  timeout: 60000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'torrent-emergency-'));
  const cacheRoot = path.join(root, 'OS');
  const fileName = 'emergency.wim';
  const fileBytes = 8 * 1024 * 1024;
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(path.join(cacheRoot, fileName), Buffer.alloc(fileBytes, 0x6d));
  const trackerPort = await freePort();
  const seederPort = await freePort();
  const coordinator = new TorrentDistributionCoordinator({ stateRoot: root }, { batchWindowMs: 1000, stallMs: 3000 });
  const tracker = new TorrentTracker({ enabled: true, serverIp: '127.0.0.1', trackerPort }, coordinator);
  const clients = [];
  let seeder;
  try {
    const torrent = await createOsImageTorrent({
      http: { host: '127.0.0.1', port: 80 }, osImage: { cacheRoot },
      torrent: { enabled: true, trackerPort, pieceLengthBytes: 256 * 1024 },
    }, { fileName });
    await tracker.start();
    seeder = new NodeSuperSeeder({
      enabled: true, osCacheRoot: cacheRoot, serverIp: '127.0.0.1', trackerPort,
      seederListenPort: seederPort, pieceLengthBytes: 256 * 1024,
    }, coordinator);
    await seeder.start();
    const origin = await spawnAriaClient({ root, torrentPath: torrent.torrentPath, index: 10 });
    clients.push(origin);
    const originStatuses = await waitForStatuses([origin], 20_000);
    assert.equal(originStatuses[0].completedLength, originStatuses[0].totalLength);
    const originAssignment = [...coordinator.assignments.values()][0];
    for (let piece = 0; piece < coordinator.totalPieces; piece += 1) coordinator.recordHave(originAssignment.key, piece);
    origin.proc.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const late = await spawnAriaClient({ root, torrentPath: torrent.torrentPath, index: 11 });
    clients.push(late);
    const statuses = await waitForStatuses([late], 30_000, async ([status]) => {
      coordinator.receiveTelemetry({
        runId: 'late-run', clientId: 'late-client', phase: 'downloading',
        completedLength: Number(status.completedLength), totalLength: Number(status.totalLength),
      }, '127.0.0.1');
    });
    assert.equal([...coordinator.assignments.values()].find((item) => item.batch === 2)?.assignedMode, 'peer-only');
    assert.ok(coordinator.state().emergency, 'emergency fallback is visible in coordinator state');
    assert.equal(statuses[0].completedLength, statuses[0].totalLength, 'emergency host fallback completes the download');
    assert.ok(seeder.totalServedBytes > fileBytes * 1.15, 'emergency fallback is allowed beyond normal budget');
  } finally {
    for (const client of clients) client.proc.kill();
    await seeder?.stop();
    await tracker.stop();
    coordinator.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
