import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
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

  const torrentBuffer = await new Promise((resolve, reject) => {
    createTorrent(wimPath, {
      name: fileName,
      pieceLength: torrent.pieceLengthBytes,
      private: true,
      announceList: [[announce]],
      urlList: [webSeed],
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
