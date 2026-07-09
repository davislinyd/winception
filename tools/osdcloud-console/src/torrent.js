import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import bencode from 'bencode';
import Wire from 'bittorrent-protocol';
import createTorrent from 'create-torrent';
import { TorrentDistributionCoordinator } from './torrentCoordinator.js';
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

function percentDecodeBuffer(value = '') {
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '%' && /^[0-9a-f]{2}$/iu.test(value.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
    } else if (char === '+') {
      bytes.push(0x20);
    } else {
      bytes.push(...Buffer.from(char, 'utf8'));
    }
  }
  return Buffer.from(bytes);
}

function encodeBinaryParam(buffer) {
  return [...Buffer.from(buffer)].map((byte) => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`).join('');
}

function parseTrackerQuery(rawUrl = '') {
  const query = rawUrl.split('?', 2)[1] ?? '';
  const params = new Map();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [rawKey, rawValue = ''] = pair.split('=', 2);
    const key = percentDecodeBuffer(rawKey).toString('utf8');
    params.set(key, rawValue);
  }
  const text = (name, fallback = '') => percentDecodeBuffer(params.get(name) ?? fallback).toString('utf8');
  const number = (name, fallback = 0) => {
    const parsed = Number(text(name, String(fallback)));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    infoHash: percentDecodeBuffer(params.get('info_hash') ?? ''),
    peerId: percentDecodeBuffer(params.get('peer_id') ?? ''),
    port: number('port'),
    uploaded: number('uploaded'),
    downloaded: number('downloaded'),
    left: number('left'),
    compact: text('compact') === '1',
    event: text('event'),
  };
}

function trackerEventName(value) {
  if (value === 'started') return 'start';
  if (value === 'completed') return 'complete';
  if (value === 'stopped') return 'stop';
  return 'update';
}

function normalizePeerIp(ip) {
  return String(ip ?? '').replace(/^::ffff:/u, '');
}

function compactPeer(peer) {
  const bytes = normalizePeerIp(peer.ip).split('.').map((part) => Number(part));
  if (bytes.length !== 4 || bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  const result = Buffer.alloc(6);
  for (let index = 0; index < 4; index += 1) result[index] = bytes[index];
  result.writeUInt16BE(Number(peer.port) & 0xffff, 4);
  return result;
}

class LocalTrackerServer extends EventEmitter {
  constructor({ intervalMs = 5000 } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.http = null;
    this.torrents = new Map();
  }

  listen(port, host, callback) {
    this.http = http.createServer((req, res) => this.handleRequest(req, res));
    this.http.on('error', (error) => this.emit('error', error));
    this.http.listen(port, host, callback);
  }

  close(callback) {
    if (!this.http) {
      callback?.();
      return;
    }
    const server = this.http;
    this.http = null;
    server.close(callback);
  }

  handleRequest(req, res) {
    if (req.method !== 'GET' || !String(req.url ?? '').startsWith('/announce')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    try {
      const announce = parseTrackerQuery(req.url);
      if (announce.infoHash.length !== 20 || announce.peerId.length === 0 || announce.port <= 0) {
        throw new Error('invalid announce request');
      }
      const ip = normalizePeerIp(req.socket.remoteAddress);
      const event = trackerEventName(announce.event);
      const infoHash = announce.infoHash.toString('hex');
      const peerKey = announce.peerId.toString('hex');
      const torrent = this.torrents.get(infoHash) ?? new Map();
      this.torrents.set(infoHash, torrent);
      if (event === 'stop') {
        torrent.delete(peerKey);
      } else {
        torrent.set(peerKey, {
          peerId: announce.peerId,
          ip,
          port: announce.port,
          left: announce.left,
          downloaded: announce.downloaded,
          uploaded: announce.uploaded,
          complete: event === 'complete' || announce.left === 0,
          updatedAt: Date.now(),
        });
      }
      const peers = [...torrent.entries()]
        .filter(([key]) => key !== peerKey)
        .map(([, peer]) => peer);
      const compactPeers = peers.map(compactPeer).filter(Boolean);
      const body = bencode.encode({
        interval: Math.max(1, Math.round(this.intervalMs / 1000)),
        complete: peers.filter((peer) => peer.complete).length,
        incomplete: peers.filter((peer) => !peer.complete).length,
        peers: Buffer.concat(compactPeers),
      });
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': body.length,
      });
      res.end(body);
      this.emit(event, `${ip}:${announce.port}`, {
        ip,
        port: announce.port,
        left: announce.left,
        downloaded: announce.downloaded,
        uploaded: announce.uploaded,
        peer_id: announce.peerId,
        peerId: announce.peerId,
      });
    } catch (error) {
      const body = bencode.encode({ 'failure reason': error.message });
      res.writeHead(400, {
        'Content-Type': 'text/plain',
        'Content-Length': body.length,
      });
      res.end(body);
      this.emit('warning', error);
    }
  }
}

class LocalTrackerAnnouncer {
  constructor({ announceUrl, infoHash, peerId, port, intervalMs = 5000 }) {
    this.announceUrl = announceUrl;
    this.infoHash = infoHash;
    this.peerId = peerId;
    this.port = port;
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  url(event = '') {
    const separator = this.announceUrl.includes('?') ? '&' : '?';
    const params = [
      `info_hash=${encodeBinaryParam(this.infoHash)}`,
      `peer_id=${encodeBinaryParam(this.peerId)}`,
      `port=${encodeURIComponent(String(this.port))}`,
      'uploaded=0',
      'downloaded=0',
      'left=0',
      'compact=1',
      event ? `event=${encodeURIComponent(event)}` : '',
    ].filter(Boolean).join('&');
    return `${this.announceUrl}${separator}${params}`;
  }

  async announce(event = '') {
    const response = await fetch(this.url(event));
    if (!response.ok) {
      throw new Error(`tracker announce failed: HTTP ${response.status}`);
    }
    return response.arrayBuffer();
  }

  async start() {
    await this.announce('started');
    this.timer = setInterval(() => {
      void this.announce().catch(() => {});
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    void this.announce('stopped').catch(() => {});
  }
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

// Lightweight host-side BitTorrent tracker. It implements the small HTTP
// announce surface aria2 needs in WinPE, keeping the deployment LAN path local
// and avoiding a broad tracker dependency tree.
export class TorrentTracker extends EventEmitter {
  constructor(config = {}, coordinator = null) {
    super();
    this.config = config;
    this.server = null;
    this._running = false;
    this._logStream = null;
    // Live swarm peer map. Keyed by 'ip:port'; populated from tracker announce events.
    // Provides real-time per-VM download progress for the dashboard UI.
    this._swarmPeers = new Map();
    this.coordinator = coordinator;
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
    const torrents = this.server?.torrents ?? new Map();
    const lines = [];
    for (const [infoHash, peers] of torrents.entries()) {
      const values = [...peers.values()];
      const count = values.length;
      const complete = values.filter((peer) => peer.complete).length;
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

    // Deployment clients finish in minutes, so the tracker announces every five
    // seconds instead of using a typical long public-tracker interval.
    const server = new LocalTrackerServer({ intervalMs: 5000 });
    server.on('error', (error) => this.emit('error', error));
    server.on('warning', (error) => this.emit('log', `WARNING ${error.message}`));
    for (const event of ['start', 'update', 'complete', 'stop']) {
      server.on(event, (addr, params) => {
        const peer = (params && (params.ip || params.addr)) ? `${params.ip ?? ''}:${params.port ?? ''}` : String(addr ?? '');
        const left = params?.left;
        this.coordinator?.noteTrackerPeer(params?.peer_id ?? params?.peerId, { complete: Number(left) === 0 });
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
      this._swarmPeers.clear();
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
  constructor(config = {}, coordinator = null) {
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
    this._totalServedBytes = 0;
    this.coordinator = coordinator ?? new TorrentDistributionCoordinator(config);
    this.coordinator.on('batch-released', ({ batch, peers }) => {
      for (const assignment of peers) this._advertiseAssignment(assignment, batch);
    });
    this.coordinator.on('emergency', (details) => this._activateEmergencyFallback(details));
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

  get totalServedBytes() {
    return this.coordinator?.state().hostServedBytes ?? this._totalServedBytes;
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

  // Divide pieces into interleaved stripes across the peers that actually join
  // the same deployment wave. Unlike expectedPeers-based fixed quarters, this
  // works for either two or four concurrent clients and makes the host upload
  // approximately one complete image across the wave.
  _buildStripedBitfield(slot, peerCount) {
    const buf = Buffer.alloc(Math.ceil(this._totalPieces / 8), 0);
    for (let i = slot; i < this._totalPieces; i += peerCount) {
      buf[i >> 3] |= 0x80 >> (i & 7);
    }
    return buf;
  }

  _advertiseAssignment(assignment, batch = assignment.batch) {
    const peer = assignment?.wire?.deploymentPeer;
    if (!peer || peer.closed || !assignment.released) return;
    peer.key = assignment.key;
    peer.batch = assignment.batch;
    peer.slot = assignment.slot;
    peer.peerCount = assignment.peerCount;
    const emergency = Boolean(this.coordinator.state().emergency);
    peer.mode = emergency && assignment.mode !== 'seeder' ? 'emergency-host-fallback' : assignment.mode;
    peer.released = true;
    const bitfield = peer.mode === 'full-single' || peer.mode === 'emergency-host-fallback'
      ? this._buildFullBitfield()
      : (peer.mode === 'striped'
        ? this._buildStripedBitfield(assignment.slot, assignment.peerCount)
        : Buffer.alloc(Math.ceil(this._totalPieces / 8), 0));
    peer.wire.bitfield(bitfield);
    peer.wire.unchoke();
    this._seederLog(
      `PEER-RELEASE ${peer.remoteName} wave=${this.coordinator.state().waveId}`
      + ` batch=${batch} slot=${assignment.slot}/${assignment.peerCount} mode=${peer.mode}`,
    );
  }

  _activateEmergencyFallback(details) {
    for (const wire of this._peers) {
      const peer = wire.deploymentPeer;
      if (!peer || peer.closed || !peer.released || peer.mode === 'seeder') continue;
      peer.mode = 'emergency-host-fallback';
      for (let piece = 0; piece < this._totalPieces; piece += 1) wire.have(piece);
    }
    this._seederLog(
      `EMERGENCY-FALLBACK wave=${details.waveId} reason=${details.reason}`
      + ` budgetBytes=${details.budgetBytes} servedBytes=${details.servedBytesAtStart}`,
    );
    this.emit('log', `Torrent seeder: emergency host fallback active (${details.reason})`);
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

    const peer = {
      wire,
      remoteName,
      closed: false,
      released: false,
      full: false,
      slot: 0,
      peerCount: 1,
      servedBytes: 0,
      requests: 0,
      nextStatsBytes: 256 * 1024 * 1024,
      key: null,
      mode: 'pending',
    };
    wire.deploymentPeer = peer;
    this._peers.push(wire);

    const cleanup = () => {
      if (peer.closed) return;
      peer.closed = true;
      try { if (fd !== null) { fs.closeSync(fd); fd = null; } } catch {}
      const idx = this._peers.indexOf(wire);
      if (idx !== -1) this._peers.splice(idx, 1);
      if (peer.key) this.coordinator.disconnectPeer(peer.key);
    };

    wire.on('error', (err) => {
      this._seederLog(`PEER-ERROR ${remoteName} ${err.message}`);
      cleanup();
    });

    wire.on('close', () => {
      this._seederLog(
        `PEER-DISCONNECT ${remoteName} batch=${peer.batch ?? '-'} slot=${peer.slot}/${peer.peerCount}`
        + ` requests=${peer.requests} servedBytes=${peer.servedBytes}`,
      );
      this.emit('log', `Torrent seeder: peer ${remoteName} disconnected`);
      cleanup();
    });

    wire.on('handshake', (infoHashHex, peerId) => {
      if (infoHashHex !== this._infoHash.toString('hex')) {
        wire.destroy();
        return;
      }
      wire.handshake(this._infoHash, this._peerId);
      const assignment = this.coordinator.registerPeer({
        infoHash: infoHashHex,
        peerId,
        ip: String(socket.remoteAddress ?? '').replace(/^::ffff:/u, ''),
        port: socket.remotePort ?? 0,
        wire,
      });
      if (!assignment) {
        wire.destroy();
        return;
      }
      peer.key = assignment.key;
      const peerIndex = this._peerIndex++;
      this._seederLog(
        `PEER-CONNECT ${remoteName} index=${peerIndex}`
        + ` reconnect=${assignment.reconnect} batch=${assignment.batch} mode=${assignment.mode}`,
      );
      this.emit('log', `Torrent seeder: peer ${remoteName} connected; batch=${assignment.batch}`);
      if (assignment.released) this._advertiseAssignment({ ...assignment, wire });
    });

    wire.on('have', (piece) => {
      if (peer.key) this.coordinator.recordHave(peer.key, piece);
    });

    wire.on('bitfield', (bitfield) => {
      if (peer.key) this.coordinator.recordBitfield(peer.key, bitfield);
    });

    wire.on('interested', () => {
      wire.unchoke();
    });

    wire.on('request', (pieceIndex, offset, length, respond) => {
      const assigned = peer.mode === 'full-single'
        || peer.mode === 'emergency-host-fallback'
        || (peer.released && peer.mode === 'striped' && pieceIndex % peer.peerCount === peer.slot);
      if (!assigned) {
        respond(new Error('piece not advertised to this deployment peer'));
        return;
      }
      const fileOffset = pieceIndex * this._pieceLengthBytes + offset;
      const buf = Buffer.allocUnsafe(length);
      fs.read(fd, buf, 0, length, fileOffset, (err, bytesRead) => {
        if (err || bytesRead !== length) {
          respond(err ?? new Error(`short read: expected ${length} got ${bytesRead}`));
          return;
        }
        peer.requests += 1;
        if (!this.coordinator.allowHostBytes(bytesRead)) {
          respond(new Error('normal wave host budget exhausted'));
          return;
        }
        peer.servedBytes += bytesRead;
        this._totalServedBytes += bytesRead;
        this.coordinator.recordHostBytes(bytesRead);
        if (peer.servedBytes >= peer.nextStatsBytes) {
          this._seederLog(
            `PEER-STATS ${remoteName} batch=${peer.batch ?? '-'} slot=${peer.slot}/${peer.peerCount}`
            + ` servedBytes=${peer.servedBytes} totalServedBytes=${this._totalServedBytes}`,
          );
          peer.nextStatsBytes += 256 * 1024 * 1024;
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
    this._totalServedBytes = 0;
    this._peerId = this._generatePeerId();
    this.coordinator.updateConfig(this.config);
    this.coordinator.configureTorrent({
      infoHash: this._infoHash.toString('hex'),
      totalPieces: this._totalPieces,
      wimBytes: wimStat.size,
    });
    this.coordinator.setHostPeerId(this._peerId);

    const logPath = this.config.seederLogPath;
    if (logPath) {
      try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        this._logStream = fs.createWriteStream(logPath, { flags: 'a' });
        this._logStream.write(
          `\n===== seeder start ${new Date().toISOString()} ${target.fileName}`
          + ` pieces=${this._totalPieces} batchWindowSeconds=24 budgetRatio=1.15`
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
      const trackerClient = new LocalTrackerAnnouncer({
        announceUrl,
        infoHash: this._infoHash,
        peerId: this._peerId,
        port: listenPort,
      });
      await trackerClient.start();
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
    this._totalServedBytes = 0;

    this.emit('log', 'Torrent seeder stopped');
  }
}

export { NodeSuperSeeder as TorrentSeeder };
