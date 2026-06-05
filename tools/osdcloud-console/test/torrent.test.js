import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createOsImageTorrent, TorrentTracker, TorrentSeeder, NodeSuperSeeder } from '../src/torrent.js';
import { osTorrentManifestName, torrentServerConfig } from '../src/config.js';

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'torrent-test-'));
  const cacheRoot = path.join(dir, 'OS');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const fileName = 'Win11_25H2_zh-TW.wim';
  fs.writeFileSync(path.join(cacheRoot, fileName), Buffer.alloc(1024 * 1024, 7));
  const config = {
    http: { host: '192.168.88.1', port: 80 },
    osImage: { cacheRoot },
    torrent: { enabled: true, trackerPort: 6969, pieceLengthBytes: 262144, seedMinutes: 30 },
  };
  return { dir, cacheRoot, fileName, config };
}

test('createOsImageTorrent builds a BT-only torrent (announce, no webseed) and manifest', async () => {
  const { dir, cacheRoot, fileName, config } = makeFixture();
  try {
    const meta = await createOsImageTorrent(config, { fileName });
    assert.equal(meta.fileName, fileName);
    assert.equal(meta.announce, 'http://192.168.88.1:6969/announce');
    assert.equal(meta.webSeedUrl, 'http://192.168.88.1/osdcloud/os/Win11_25H2_zh-TW.wim');
    assert.equal(meta.torrentUrl, 'http://192.168.88.1/osdcloud/os/Win11_25H2_zh-TW.wim.torrent');
    assert.equal(meta.pieceLengthBytes, 262144);
    assert.match(meta.wimSha256, /^[0-9A-F]{64}$/);

    // The torrent must NOT embed an HTTP webseed (url-list): aria2 treats it as a
    // primary source, which would make every client pull the full WIM from the
    // host and defeat P2P offload. Clients must use BitTorrent instead.
    const torrentBytes = fs.readFileSync(meta.torrentPath).toString('latin1');
    assert.ok(!torrentBytes.includes('url-list'), 'torrent must not contain a webseed url-list');
    assert.ok(torrentBytes.includes('announce'), 'torrent must contain the tracker announce');

    assert.ok(fs.existsSync(meta.torrentPath), 'writes the .torrent next to the WIM');
    const manifestPath = path.join(cacheRoot, osTorrentManifestName);
    assert.ok(fs.existsSync(manifestPath), 'writes the sidecar manifest');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.fileName, fileName);
    assert.equal(manifest.wimSha256, meta.wimSha256);
    assert.equal(manifest.pieceLengthBytes, 262144);

    // The non-standard port should appear in the webseed when not port 80.
    const altConfig = { ...config, http: { host: '10.0.0.1', port: 8081 } };
    const alt = await createOsImageTorrent(altConfig, { fileName, cacheRoot });
    assert.equal(alt.webSeedUrl, 'http://10.0.0.1:8081/osdcloud/os/Win11_25H2_zh-TW.wim');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createOsImageTorrent requires a fileName and an existing image', async () => {
  const { dir, cacheRoot, config } = makeFixture();
  try {
    await assert.rejects(() => createOsImageTorrent(config, {}), /fileName is required/);
    await assert.rejects(
      () => createOsImageTorrent(config, { fileName: 'missing.wim', cacheRoot }),
      /OS image not found/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('torrentServerConfig derives service IP and ports from http config', () => {
  const resolved = torrentServerConfig({
    http: { host: '192.168.88.1', port: 80 },
    osImage: { cacheRoot: 'C:/OSDCloud/Media/OSDCloud/OS' },
    torrent: { enabled: true, trackerPort: 6969, pieceLengthBytes: 4194304, seedMinutes: 15 },
  });
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.serverIp, '192.168.88.1');
  assert.equal(resolved.httpPort, 80);
  assert.equal(resolved.trackerPort, 6969);
  assert.equal(resolved.seedMinutes, 15);
  assert.equal(resolved.osCacheRoot, 'C:/OSDCloud/Media/OSDCloud/OS');
});

test('TorrentTracker starts and stops on an ephemeral port', async () => {
  const tracker = new TorrentTracker({ enabled: true, serverIp: '127.0.0.1', trackerPort: 0 });
  const logs = [];
  tracker.on('log', (line) => logs.push(line));
  assert.equal(tracker.running, false);
  await tracker.start();
  assert.equal(tracker.running, true);
  assert.ok(tracker.address, 'exposes the bound address while running');
  await tracker.stop();
  assert.equal(tracker.running, false);
  assert.ok(logs.some((line) => line.startsWith('START tracker')), 'logs the announce URL');
});

test('TorrentTracker is a no-op when disabled', async () => {
  const tracker = new TorrentTracker({ enabled: false, serverIp: '127.0.0.1', trackerPort: 0 });
  await tracker.start();
  assert.equal(tracker.running, false);
  assert.equal(tracker.address, null);
  await tracker.stop();
});

test('TorrentSeeder resolves the active torrent from the manifest', async () => {
  const { dir, cacheRoot, fileName, config } = makeFixture();
  try {
    // Before a torrent exists, there is nothing to seed.
    const seederBefore = new TorrentSeeder({ enabled: true, osCacheRoot: cacheRoot });
    assert.equal(seederBefore.resolveTorrentToSeed(), null);

    await createOsImageTorrent(config, { fileName });
    const seeder = new TorrentSeeder({ enabled: true, osCacheRoot: cacheRoot });
    const target = seeder.resolveTorrentToSeed();
    assert.ok(target, 'resolves a target after the torrent is generated');
    assert.equal(target.fileName, fileName);
    assert.ok(target.torrentPath.endsWith('.torrent'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('torrentServerConfig resolves a default seeder log path under the live root', () => {
  const resolved = torrentServerConfig({
    http: { host: '192.168.77.1', port: 80 },
    osImage: { cacheRoot: 'C:/OSDCloud/Media/OSDCloud/OS' },
    runtimeArtifacts: { liveRoot: 'C:/OSDCloud' },
    torrent: { enabled: true },
  });
  assert.equal(resolved.seederLogPath, 'C:\\OSDCloud\\logs\\torrent-seeder.log');
  assert.equal(resolved.expectedPeers, 4);
});

test('NodeSuperSeeder partitions pieces across peers and gives full bitfield to overflow', () => {
  const seeder = new NodeSuperSeeder({ expectedPeers: 4 });
  seeder._totalPieces = 100;
  // P = ceil(100/4) = 25
  assert.deepEqual(seeder._assignedPieceRange(0), { firstPiece: 0,  lastPiece: 24, full: false });
  assert.deepEqual(seeder._assignedPieceRange(1), { firstPiece: 25, lastPiece: 49, full: false });
  assert.deepEqual(seeder._assignedPieceRange(2), { firstPiece: 50, lastPiece: 74, full: false });
  assert.deepEqual(seeder._assignedPieceRange(3), { firstPiece: 75, lastPiece: 99, full: false });
  assert.deepEqual(seeder._assignedPieceRange(4), { firstPiece: 0,  lastPiece: 99, full: true });
  assert.deepEqual(seeder._assignedPieceRange(10), { firstPiece: 0, lastPiece: 99, full: true });
});

test('NodeSuperSeeder start is a no-op when disabled', async () => {
  const { dir, cacheRoot, fileName, config } = makeFixture();
  try {
    await createOsImageTorrent(config, { fileName });
    const logs = [];
    const disabled = new NodeSuperSeeder({ enabled: false, osCacheRoot: cacheRoot });
    disabled.on('log', (l) => logs.push(l));
    await disabled.start();
    assert.equal(disabled.running, false);
    assert.ok(logs.some((l) => /disabled/i.test(l)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('NodeSuperSeeder start logs and skips when no torrent manifest exists', async () => {
  const { dir, cacheRoot } = makeFixture();
  try {
    const logs = [];
    const seeder = new NodeSuperSeeder({ enabled: true, osCacheRoot: cacheRoot });
    seeder.on('log', (l) => logs.push(l));
    await seeder.start();
    assert.equal(seeder.running, false);
    assert.ok(logs.some((l) => /no published/i.test(l)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('NodeSuperSeeder starts TCP server and stops cleanly', async () => {
  const { dir, cacheRoot, fileName, config } = makeFixture();
  try {
    await createOsImageTorrent(config, { fileName });
    const logs = [];
    // Use port 0 for ephemeral binding; disable tracker announce (no tracker running)
    const seeder = new NodeSuperSeeder({
      enabled: true,
      osCacheRoot: cacheRoot,
      seederListenPort: 0,
      serverIp: '127.0.0.1',
      trackerPort: 0,
      expectedPeers: 4,
    });
    seeder.on('log', (l) => logs.push(l));
    await seeder.start();
    assert.equal(seeder.running, true);
    assert.equal(seeder.seeding, fileName);
    assert.ok(logs.some((l) => l.startsWith('START seeder')), 'logs the start line');
    await seeder.stop();
    assert.equal(seeder.running, false);
    assert.equal(seeder.seeding, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
