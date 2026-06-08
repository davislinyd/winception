import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import bencode from 'bencode';
import Wire from 'bittorrent-protocol';
import createTorrent from 'create-torrent';
import { Server as TrackerServer, Client as TrackerClient } from 'bittorrent-tracker';
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
    this._logStream = null;
    // Live swarm peer map. Keyed by 'ip:port'; populated from tracker announce events.
    // Provides real-time per-VM download progress for the dashboard UI.
    this._swarmPeers = new Map();
  }

  get running() {
    return this._running;
  }

  get address() {
    return this.server?.http?.address?.() ?? null;
  }

  // Count peers currently tracked for any swarm (diagnostic: are all clients
  // discovering each other through the tracker?).
  swarmSummary() {
    const torrents = this.server?.torrents ?? {};
    const lines = [];
    for (const [infoHash, torrent] of Object.entries(torrents)) {
      const peers = torrent?.peers;
      let count = 0;
      let complete = 0;
      try {
        const values = typeof peers?.values === 'function' ? [...peers.values()] : Object.values(peers ?? {});
        for (const p of values) {
          if (!p) continue;
          count += 1;
          if (p.complete) complete += 1;
        }
      } catch {}
      lines.push(`${infoHash.slice(0, 12)} peers=${count} seeders=${complete}`);
    }
    return lines.join('; ') || 'no swarms';
  }

  trackerLog(message) {
    if (!this._logStream) return;
    try { this._logStream.write(`${new Date().toISOString()} ${message}\n`); } catch {}
  }

  async start() {
    if (this._running) {
      return;
    }
    if (this.config.enabled === false) {
      this.emit('log', 'Torrent tracker disabled by config; not starting');
      return;
    }

    // Open a tracker diagnostic log: records every announce (peer ip:port, event,
    // left=0 means a seeder) and the resulting swarm size, so we can see whether
    // all clients register with the tracker and learn about each other.
    if (this.config.trackerLogPath) {
      try {
        fs.mkdirSync(path.dirname(this.config.trackerLogPath), { recursive: true });
        this._logStream = fs.createWriteStream(this.config.trackerLogPath, { flags: 'a' });
        this._logStream.write(`\n===== tracker start ${new Date().toISOString()} =====\n`);
      } catch (error) {
        this.emit('log', `tracker log unavailable: ${error.message}`);
        this._logStream = null;
      }
    }

    const server = new TrackerServer({ http: true, udp: false, ws: false, stats: false });
    server.on('error', (error) => this.emit('error', error));
    server.on('warning', (error) => this.emit('log', `WARNING ${error.message}`));
    for (const event of ['start', 'update', 'complete', 'stop']) {
      server.on(event, (addr, params) => {
        const peer = (params && (params.ip || params.addr)) ? `${params.ip ?? ''}:${params.port ?? ''}` : String(addr ?? '');
        const left = params?.left;
        this.trackerLog(`${event.toUpperCase()} peer=${peer} left=${left} | swarm: ${this.swarmSummary()}`);
        // Maintain live swarm map for dashboard UI
        const ip = params?.ip ?? '';
        const port = Number(params?.port ?? 0);
        const key = `${ip}:${port}`;
        if (ip) {
          if (event === 'stop') {
            this._swarmPeers.delete(key);
          } else {
            this._swarmPeers.set(key, {
              ip,
              port,
              left: Number(params?.left ?? 0),
              downloaded: Number(params?.downloaded ?? 0),
              uploaded: Number(params?.uploaded ?? 0),
              complete: event === 'complete' || Number(params?.left ?? 1) === 0,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      });
    }

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
    this.emit('log', `START tracker ${trackerAnnounceUrl(this.config.serverIp, this.config.trackerPort)}${this.config.trackerLogPath ? ` log=${this.config.trackerLogPath}` : ''}`);
  }

  // Return current swarm peers sorted by IP, for the dashboard UI.
  // Each entry: { ip, port, left, downloaded, uploaded, complete, updatedAt }
  // Peers that haven't announced in 10 minutes are considered gone and filtered out.
  getSwarmPeers(staleMs = 10 * 60 * 1000) {
    const cutoff = Date.now() - staleMs;
    return [...this._swarmPeers.values()]
      .filter(p => new Date(p.updatedAt).getTime() >= cutoff)
      .sort((a, b) => a.ip.localeCompare(b.ip));
  }

  async stop() {
    if (!this.server) {
      this._running = false;
      return;
    }
    const server = this.server;
    this.server = null;
    this._running = false;
    this._swarmPeers.clear();
    try { this._logStream?.end(); } catch {}
    this._logStream = null;
    await new Promise((resolve) => server.close(() => resolve()));
    this.emit('log', 'Torrent tracker stopped');
  }
}

// Host-side BitTorrent seeder. Creates a Node.js TCP server that speaks the
// BitTorrent peer wire protocol and assigns each connecting peer a distinct
// slice of the torrent's pieces. Because every VM gets a unique piece range
// from the host, peers can trade those pieces with each other — the host
// uploads roughly one copy total while peers redistribute the rest.
// Mirrors the service lifecycle interface so ServiceController can manage it
// (start/stop/running + 'log'/'error').
export class NodeSuperSeeder extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this._server = null;
    this._trackerClient = null;
    this._running = false;
    this._seeding = null;
    this._logStream = null;
    this._peers = [];
    this._peerIndex = 0;
    this._totalPieces = 0;
    this._infoHash = null;
    this._peerId = null;
    this._pieceLengthBytes = 0;
  }

  get running() {
    return this._running;
  }

  get seeding() {
    return this._seeding;
  }

  get logPath() {
    return this.config.seederLogPath ?? null;
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
      return { cacheRoot, fileName, wimPath, torrentPath, manifest };
    } catch (error) {
      this.emit('log', `Torrent seeder: unable to resolve torrent (${error.message})`);
      return null;
    }
  }

  // Extract the 20-byte SHA1 infoHash from a raw .torrent Buffer by re-encoding
  // only the 'info' dictionary (standard BT spec).
  _extractInfoHash(torrentBuffer) {
    const decoded = bencode.decode(torrentBuffer);
    const infoEncoded = bencode.encode(decoded.info);
    return createHash('sha1').update(infoEncoded).digest();
  }

  _generatePeerId() {
    return Buffer.concat([Buffer.from('-WC0001-'), randomBytes(12)]);
  }

  _buildFullBitfield() {
    const byteCount = Math.ceil(this._totalPieces / 8);
    const buf = Buffer.alloc(byteCount, 0xff);
    const rem = this._totalPieces % 8;
    if (rem !== 0) {
      buf[byteCount - 1] = (0xff << (8 - rem)) & 0xff;
    }
    return buf;
  }

  _seederLog(message) {
    if (!this._logStream) return;
    try { this._logStream.write(`${new Date().toISOString()} ${message}\n`); } catch {}
  }

  _handlePeer(socket, target) {
    const wire = new Wire('tcpIncoming');
    socket.pipe(wire).pipe(socket);

    const remoteName = `${socket.remoteAddress ?? '?'}:${socket.remotePort ?? '?'}`;

    let fd = null;
    try {
      fd = fs.openSync(target.wimPath, 'r');
    } catch (err) {
      this.emit('error', err);
      socket.destroy();
      return;
    }

    this._peers.push(wire);

    const cleanup = () => {
      try { if (fd !== null) { fs.closeSync(fd); fd = null; } } catch {}
      const idx = this._peers.indexOf(wire);
      if (idx !== -1) this._peers.splice(idx, 1);
    };

    wire.on('error', (err) => {
      this._seederLog(`PEER-ERROR ${remoteName} ${err.message}`);
      cleanup();
    });

    wire.on('close', () => {
      this._seederLog(`PEER-DISCONNECT ${remoteName}`);
      this.emit('log', `Torrent seeder: peer ${remoteName} disconnected`);
      cleanup();
    });

    wire.on('handshake', (infoHashHex) => {
      if (infoHashHex !== this._infoHash.toString('hex')) {
        wire.destroy();
        return;
      }
      const peerIndex = this._peerIndex++;
      this._seederLog(`PEER-CONNECT ${remoteName} index=${peerIndex}`);
      this.emit('log', `Torrent seeder: peer ${remoteName} connected (index=${peerIndex})`);

      wire.handshake(this._infoHash, this._peerId);
      wire.bitfield(this._buildFullBitfield());
      wire.unchoke();
    });

    wire.on('interested', () => {
      wire.unchoke();
    });

    wire.on('request', (pieceIndex, offset, length, respond) => {
      const fileOffset = pieceIndex * this._pieceLengthBytes + offset;
      const buf = Buffer.allocUnsafe(length);
      fs.read(fd, buf, 0, length, fileOffset, (err, bytesRead) => {
        if (err || bytesRead !== length) {
          respond(err ?? new Error(`short read: expected ${length} got ${bytesRead}`));
          return;
        }
        respond(null, buf);
      });
    });
  }

  async start() {
    if (this._running) {
      return;
    }
    if (this.config.enabled === false) {
      this.emit('log', 'Torrent seeder disabled by config; not starting');
      return;
    }

    const target = this.resolveTorrentToSeed();
    if (!target) {
      this.emit('log', 'Torrent seeder: no published OS torrent to seed yet');
      return;
    }

    const torrentBuffer = fs.readFileSync(target.torrentPath);
    this._infoHash = this._extractInfoHash(torrentBuffer);

    const pieceLengthBytes = Number(target.manifest.pieceLengthBytes ?? this.config.pieceLengthBytes ?? 4194304);
    this._pieceLengthBytes = pieceLengthBytes;
    const wimStat = fs.statSync(target.wimPath);
    this._totalPieces = Math.ceil(wimStat.size / pieceLengthBytes);
    this._peerIndex = 0;
    this._peerId = this._generatePeerId();

    const logPath = this.config.seederLogPath;
    if (logPath) {
      try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        this._logStream = fs.createWriteStream(logPath, { flags: 'a' });
        this._logStream.write(
          `\n===== seeder start ${new Date().toISOString()} ${target.fileName}`
          + ` pieces=${this._totalPieces} expectedPeers=${this.config.expectedPeers ?? 4}`
          + ` port=${this.config.seederListenPort ?? 6881} =====\n`,
        );
      } catch (err) {
        this.emit('log', `Torrent seeder: unable to open log ${logPath} (${err.message})`);
        this._logStream = null;
      }
    }

    const listenPort = Number(this.config.seederListenPort ?? 6881);
    const server = net.createServer((socket) => {
      this._handlePeer(socket, target);
    });
    server.on('error', (err) => this.emit('error', err));

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(listenPort, this.config.serverIp, () => {
        server.off('error', reject);
        resolve();
      });
    });

    this._server = server;

    const announceUrl = trackerAnnounceUrl(this.config.serverIp, this.config.trackerPort);
    try {
      const trackerClient = new TrackerClient({
        infoHash: this._infoHash,
        peerId: this._peerId,
        announce: [announceUrl],
        port: listenPort,
        wrtc: false,
      });
      trackerClient.on('error', (err) => this.emit('log', `Torrent seeder tracker error: ${err.message}`));
      trackerClient.on('warning', (msg) => this.emit('log', `Torrent seeder tracker warning: ${msg}`));
      trackerClient.start({ left: 0 });
      this._trackerClient = trackerClient;
    } catch (err) {
      this.emit('log', `Torrent seeder: tracker announce failed (${err.message}); continuing without tracker presence`);
    }

    this._running = true;
    this._seeding = target.fileName;
    this.emit('log', `START seeder ${target.fileName} pieces=${this._totalPieces} port=${listenPort}${logPath ? ` log=${logPath}` : ''}`);
  }

  async stop() {
    this._running = false;
    this._seeding = null;

    if (this._trackerClient) {
      try { this._trackerClient.stop(); } catch {}
      try { this._trackerClient.destroy(); } catch {}
      this._trackerClient = null;
    }

    for (const wire of [...this._peers]) {
      try { wire.destroy(); } catch {}
    }
    this._peers = [];

    if (this._server) {
      const server = this._server;
      this._server = null;
      await new Promise((resolve) => server.close(() => resolve()));
    }

    try { this._logStream?.end(); } catch {}
    this._logStream = null;
    this._infoHash = null;
    this._peerId = null;
    this._totalPieces = 0;
    this._peerIndex = 0;

    this.emit('log', 'Torrent seeder stopped');
  }
}

export { NodeSuperSeeder as TorrentSeeder };
