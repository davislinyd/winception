import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import createTorrent from 'create-torrent';
import { Server as TrackerServer } from 'bittorrent-tracker';
import {
  torrentServerConfig,
  trackerAnnounceUrl,
  osWebSeedUrl,
  osTorrentUrl,
  osTorrentManifestName,
} from './config.js';

function sha256FileStream(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });
}

// Generate the .torrent for the active deployable WIM and write it next to the
// image. Returns the metadata the boot-config endpoint advertises to clients.
export async function createOsImageTorrent(config, options = {}) {
  const torrent = torrentServerConfig(config);
  const cacheRoot = options.cacheRoot ?? torrent.osCacheRoot;
  const fileName = options.fileName;
  if (!cacheRoot) {
    throw new Error('OS image cache root is not configured (config.osImage.cacheRoot)');
  }
  if (!fileName) {
    throw new Error('fileName is required to build the OS image torrent');
  }

  const wimPath = path.join(cacheRoot, fileName);
  if (!fs.existsSync(wimPath)) {
    throw new Error(`OS image not found for torrent generation: ${wimPath}`);
  }

  const announce = trackerAnnounceUrl(torrent.serverIp, torrent.trackerPort);
  const webSeed = osWebSeedUrl(torrent.serverIp, torrent.httpPort, fileName);

  // Intentionally NO urlList (BEP19 webseed): aria2 treats an HTTP webseed as a
  // primary source, so every client would pull the full WIM from the host and
  // P2P would offload nothing. Clients must use BitTorrent (tracker + peers +
  // the host BT seeder), which coordinates pieces so the host uploads ~one copy
  // while peers redistribute. The /osdcloud/os route still serves the .torrent.
  const torrentBuffer = await new Promise((resolve, reject) => {
    createTorrent(wimPath, {
      name: fileName,
      pieceLength: torrent.pieceLengthBytes,
      private: true,
      announceList: [[announce]],
      comment: 'winception OSDCloud P2P OS image',
      createdBy: 'winception',
    }, (error, result) => (error ? reject(error) : resolve(result)));
  });

  const torrentPath = `${wimPath}.torrent`;
  fs.writeFileSync(torrentPath, torrentBuffer);

  const torrentSha256 = createHash('sha256').update(torrentBuffer).digest('hex').toUpperCase();
  const wimSha256 = await sha256FileStream(wimPath);

  const result = {
    fileName,
    wimPath,
    torrentPath,
    torrentSha256,
    wimSha256,
    announce,
    webSeedUrl: webSeed,
    torrentUrl: osTorrentUrl(torrent.serverIp, torrent.httpPort, fileName),
    pieceLengthBytes: torrent.pieceLengthBytes,
    bytes: torrentBuffer.length,
  };

  const manifest = {
    fileName,
    wimSha256,
    torrentSha256,
    pieceLengthBytes: torrent.pieceLengthBytes,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(cacheRoot, osTorrentManifestName), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return result;
}

// Lightweight host-side BitTorrent tracker. Wraps bittorrent-tracker's HTTP-only
// Server and exposes the same lifecycle surface the other deployment services use
// (start/stop/running + 'log'/'error' events) so ServiceController can manage it.
export class TorrentTracker extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.server = null;
    this._running = false;
  }

  get running() {
    return this._running;
  }

  get address() {
    return this.server?.http?.address?.() ?? null;
  }

  async start() {
    if (this._running) {
      return;
    }
    if (this.config.enabled === false) {
      this.emit('log', 'Torrent tracker disabled by config; not starting');
      return;
    }

    const server = new TrackerServer({ http: true, udp: false, ws: false, stats: false });
    server.on('error', (error) => this.emit('error', error));
    server.on('warning', (error) => this.emit('log', `WARNING ${error.message}`));

    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once('error', onError);
      server.listen(this.config.trackerPort, this.config.serverIp, () => {
        server.off('error', onError);
        resolve();
      });
    });

    this.server = server;
    this._running = true;
    this.emit('log', `START tracker ${trackerAnnounceUrl(this.config.serverIp, this.config.trackerPort)}`);
  }

  async stop() {
    if (!this.server) {
      this._running = false;
      return;
    }
    const server = this.server;
    this.server = null;
    this._running = false;
    await new Promise((resolve) => server.close(() => resolve()));
    this.emit('log', 'Torrent tracker stopped');
  }
}

// Host-side BitTorrent seeder. Reuses the same aria2c.exe that Prepare runtime
// downloads, seeding the active OS .torrent against the on-disk WIM so the swarm
// has an origin. With BitTorrent piece coordination the seeder uploads roughly
// one copy and peers redistribute the rest — unlike the HTTP webseed, which
// served one full copy per client. Mirrors the service lifecycle interface so
// ServiceController can manage it (start/stop/running + 'log'/'error').
export class TorrentSeeder extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.child = null;
    this._running = false;
    this._seeding = null;
    this._logStream = null;
  }

  get running() {
    return this._running && Boolean(this.child) && this.child.exitCode === null;
  }

  get seeding() {
    return this._seeding;
  }

  get logPath() {
    return this.config.seederLogPath ?? null;
  }

  // aria2 args for the seeder. console-log-level=info captures peer connections
  // and announces; summary-interval emits periodic upload speed/ratio lines. The
  // child's stdout/stderr are written to seederLogPath so the host has a detailed
  // seeding log (peers + upload), since aria2 is reused as the seeder.
  buildSeederArgs(target) {
    const listenPort = this.config.seederListenPort ?? 6881;
    const logLevel = this.config.seederLogLevel ?? 'info';
    const summaryInterval = Number.isFinite(this.config.seederSummaryIntervalSeconds)
      ? this.config.seederSummaryIntervalSeconds
      : 30;
    return [
      `--dir=${target.cacheRoot}`,
      '--enable-rpc=false',
      '--bt-seed-unverified=true', // file came from this host; skip the multi-GB recheck
      '--seed-ratio=0.0', // seed indefinitely (until stopped), regardless of ratio
      `--listen-port=${listenPort}`,
      '--enable-dht=false',
      '--enable-dht6=false',
      '--bt-enable-lpd=false',
      `--console-log-level=${logLevel}`,
      `--summary-interval=${summaryInterval}`,
      `--bt-tracker-connect-timeout=10`,
      target.torrentPath,
    ];
  }

  // Locate the active OS torrent (and its complete WIM) to seed, via the sidecar
  // manifest written by createOsImageTorrent.
  resolveTorrentToSeed() {
    const cacheRoot = this.config.osCacheRoot;
    if (!cacheRoot) {
      return null;
    }
    try {
      const manifestPath = path.join(cacheRoot, osTorrentManifestName);
      if (!fs.existsSync(manifestPath)) {
        return null;
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/u, ''));
      const fileName = manifest.fileName;
      if (!fileName) {
        return null;
      }
      const wimPath = path.join(cacheRoot, fileName);
      const torrentPath = `${wimPath}.torrent`;
      if (!fs.existsSync(wimPath) || !fs.existsSync(torrentPath)) {
        return null;
      }
      return { cacheRoot, fileName, wimPath, torrentPath };
    } catch (error) {
      this.emit('log', `Torrent seeder: unable to resolve torrent (${error.message})`);
      return null;
    }
  }

  async start() {
    if (this._running) {
      return;
    }
    if (this.config.enabled === false) {
      this.emit('log', 'Torrent seeder disabled by config; not starting');
      return;
    }
    const aria2 = this.config.aria2cPath;
    if (!aria2 || !fs.existsSync(aria2)) {
      this.emit('log', `Torrent seeder: aria2c not found at ${aria2 ?? '(unset)'}; not seeding`);
      return;
    }
    const target = this.resolveTorrentToSeed();
    if (!target) {
      this.emit('log', 'Torrent seeder: no published OS torrent to seed yet');
      return;
    }

    const listenPort = this.config.seederListenPort ?? 6881;
    const args = this.buildSeederArgs(target);

    // Open a detailed server-side seeding log (peer connections + upload summary).
    let logStream = null;
    const logPath = this.config.seederLogPath;
    if (logPath) {
      try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        logStream = fs.createWriteStream(logPath, { flags: 'a' });
        logStream.write(`\n===== seeder start ${new Date().toISOString()} ${target.fileName} (listen ${listenPort}) =====\n`);
      } catch (error) {
        this.emit('log', `Torrent seeder: unable to open log ${logPath} (${error.message})`);
        logStream = null;
      }
    }
    this._logStream = logStream;

    const child = spawn(aria2, args, { windowsHide: true });
    child.on('error', (error) => this.emit('error', error));
    child.stdout?.on('data', (chunk) => { logStream?.write(chunk); });
    child.stderr?.on('data', (chunk) => { logStream?.write(chunk); });
    child.on('exit', (code) => {
      this._running = false;
      this._seeding = null;
      this.child = null;
      try { this._logStream?.write(`===== seeder exited (code ${code}) ${new Date().toISOString()} =====\n`); } catch {}
      try { this._logStream?.end(); } catch {}
      this._logStream = null;
      this.emit('log', `Torrent seeder exited (code ${code})`);
    });

    this.child = child;
    this._running = true;
    this._seeding = target.fileName;
    this.emit('log', `START seeder ${target.fileName} (port ${listenPort})${logPath ? ` log=${logPath}` : ''}`);
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this._running = false;
    this._seeding = null;
    try { this._logStream?.end(); } catch {}
    this._logStream = null;
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        child.once('exit', () => resolve());
        try {
          child.kill();
        } catch {
          resolve();
        }
        setTimeout(resolve, 3000);
      });
    }
  }
}
