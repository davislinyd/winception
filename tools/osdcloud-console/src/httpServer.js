import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  stateRootForConfig,
  trackerAnnounceUrl,
  osWebSeedUrl,
  osTorrentUrl,
  osTorrentManifestName,
} from './config.js';
import { driverPackCacheStage, handleDriverPackCacheRequest } from './driverPackCache.js';
import { appendLog, formatSyslog } from './logger.js';
import { buildRunsIndex, isRunTerminal, updateRunSummary } from './runSummary.js';

function loadSecrets(config) {
  const stateRoot = stateRootForConfig(config);
  const secretsPath = path.join(stateRoot, 'config', 'osdcloud-secrets.json');
  let fileSecrets = {};
  if (fs.existsSync(secretsPath)) {
    try {
      const raw = fs.readFileSync(secretsPath, 'utf8').replace(/^\uFEFF/u, '');
      fileSecrets = raw.trim() ? JSON.parse(raw) : {};
    } catch {}
  }
  return {
    windowsUsername: process.env.OSDCLOUD_WINDOWS_USERNAME || fileSecrets.windowsUsername || 'Administrator',
    windowsPassword: process.env.OSDCLOUD_WINDOWS_PASSWORD || fileSecrets.windowsPassword || '',
    pxeinstallPassword: process.env.OSDCLOUD_PXEINSTALL_PASSWORD || fileSecrets.pxeinstallPassword || '',
  };
}

export function sanitizeName(value) {
  return String(value ?? 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120) || 'unknown';
}

export function parseRange(rangeHeader, fileSize) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return null;
  }

  let start = match[1] === '' ? null : Number.parseInt(match[1], 10);
  let end = match[2] === '' ? null : Number.parseInt(match[2], 10);
  if (start === null && end === null) {
    return null;
  }
  if (start === null) {
    start = Math.max(0, fileSize - end);
    end = fileSize - 1;
  } else if (end === null || end >= fileSize) {
    end = fileSize - 1;
  }
  if (start < 0 || end < start || start >= fileSize) {
    return null;
  }

  return { start, end };
}

export function resolveRequestPath(root, requestUrl, host = '127.0.0.1', port = 80) {
  const url = new URL(requestUrl, `http://${host}:${port}`);
  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!relative) {
    relative = 'index.txt';
  }

  const resolved = path.resolve(root, relative);
  const rootFull = path.resolve(root);
  const rootWithSeparator = rootFull.endsWith(path.sep) ? rootFull : `${rootFull}${path.sep}`;
  if (resolved !== rootFull && !resolved.startsWith(rootWithSeparator)) {
    return null;
  }

  return { relative, resolved };
}

function readRequestBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Request body too large: ${total} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readRequestBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Request body too large: ${total} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function isPngBuffer(buffer) {
  return buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
}

function getMetaValue(req, requestUrl, queryName, headerNames) {
  const queryValue = requestUrl.searchParams.get(queryName);
  if (queryValue) {
    return queryValue;
  }

  for (const headerName of headerNames) {
    const value = req.headers[headerName.toLowerCase()];
    if (Array.isArray(value)) {
      const first = value.find(Boolean);
      if (first) {
        return first;
      }
    } else if (value) {
      return value;
    }
  }

  return '';
}

function nextAvailablePath(directory, baseName, extension) {
  let fileName = `${baseName}${extension}`;
  let filePath = path.join(directory, fileName);
  let index = 1;
  while (fs.existsSync(filePath)) {
    fileName = `${baseName}-${index}${extension}`;
    filePath = path.join(directory, fileName);
    index += 1;
  }
  return filePath;
}

export class MediaHttpServer extends EventEmitter {
  constructor(config, torrentCoordinator = null) {
    super();
    this.config = config;
    this.torrentCoordinator = torrentCoordinator;
    this.server = null;
  }

  setTorrentCoordinator(coordinator) {
    this.torrentCoordinator = coordinator;
  }

  get running() {
    return Boolean(this.server);
  }

  get address() {
    return this.server?.address();
  }

  log(message) {
    const line = appendLog(this.config.logPath, message);
    this.emit('log', line);
  }

  queueDriverPackCacheRequest(event) {
    if (event.stage !== driverPackCacheStage) {
      return;
    }

    void handleDriverPackCacheRequest(event, this.config, {
      log: (message) => this.log(message),
    }).then((result) => {
      if (result) {
        this.emit('driver-pack-cache', result);
      }
    }).catch((error) => {
      this.log(`Driver pack cache request failed outside status path: ${error.message}`);
    });
  }

  async start() {
    if (this.server) {
      return;
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        this.log(`ERROR ${req.method} ${req.url} ${error.message}`);
        if (!res.headersSent) {
          sendJson(res, 500, { error: error.message });
        } else {
          res.destroy(error);
        }
      });
    });
    // WinPE reporters run every 3-5 seconds. Keep the reusable socket alive
    // longer than that cadence so a client never races the default 5-second
    // Node timeout while posting status, screenshots, or torrent telemetry.
    this.server.keepAliveTimeout = 30_000;
    this.server.headersTimeout = 35_000;

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.config.port ?? 80, this.config.host, () => {
        this.server.off('error', reject);
        const address = this.server.address();
        this.log(`START node=${process.version} root=${this.config.root} prefix=http://${this.config.host}:${address.port}/ status=${this.config.statusRoot}`);
        resolve();
      });
    });
  }

  async stop() {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(resolve));
    this.log('HTTP media/status server stopped');
  }

  handleHealth(req, res, remote, requestUrl) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      this.log(`${remote} ${req.method} ${requestUrl.pathname} 405 bytes=0`);
      return;
    }

    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    this.log(`${remote} ${req.method} ${requestUrl.pathname} 204 bytes=0`);
  }

  async handleStatus(req, res, remote, requestUrl) {
    const statusRoot = this.config.statusRoot;
    const statusLogPath = path.join(statusRoot, 'progress.jsonl');
    const latestStatusPath = path.join(statusRoot, 'latest.json');

    if (req.method === 'GET') {
      if (requestUrl.pathname === '/osdcloud/status/runs') {
        sendJson(res, 200, buildRunsIndex(statusRoot));
        this.log(`${remote} GET ${requestUrl.pathname} 200 file=${path.join(statusRoot, 'runs-index.json')}`);
        return;
      }

      if (requestUrl.pathname === '/osdcloud/status/events') {
        if (!fs.existsSync(statusLogPath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('No status events');
          this.log(`${remote} GET ${requestUrl.pathname} 404 bytes=0`);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        fs.createReadStream(statusLogPath).pipe(res);
        this.log(`${remote} GET ${requestUrl.pathname} 200 file=${statusLogPath}`);
        return;
      }

      if (!fs.existsSync(latestStatusPath)) {
        sendJson(res, 404, { error: 'No deployment status has been reported yet.' });
        this.log(`${remote} GET ${requestUrl.pathname} 404 bytes=0`);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      fs.createReadStream(latestStatusPath).pipe(res);
      this.log(`${remote} GET ${requestUrl.pathname} 200 file=${latestStatusPath}`);
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, POST' });
      res.end();
      this.log(`${remote} ${req.method} ${requestUrl.pathname} 405 bytes=0`);
      return;
    }

    let payload;
    try {
      const body = await readRequestBody(req);
      payload = body.trim() ? JSON.parse(body) : {};
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      this.log(`${remote} POST ${requestUrl.pathname} 400 error=${error.message}`);
      return;
    }

    const event = {
      receivedAt: new Date().toISOString(),
      remote,
      ...payload,
    };
    
    const remoteIp = remote.split(':')[0].replace(/[^0-9.]/g, '');
    const sanitizedIp = remoteIp.replace(/\./g, '_');
    const bootingSummaryPath = path.join(statusRoot, `booting-${sanitizedIp}.summary.json`);
    if (fs.existsSync(bootingSummaryPath)) {
      try {
        fs.unlinkSync(bootingSummaryPath);
      } catch (e) {
        this.log(`Failed to delete synthetic booting summary: ${e.message}`);
      }
    }

    const rawRunId = event.runId;
    const runId = sanitizeName(rawRunId);
    const warnings = new Set(Array.isArray(event.warnings) ? event.warnings : []);
    if (!rawRunId) {
      warnings.add('missing-run-id');
    } else if (runId !== String(rawRunId)) {
      warnings.add('run-id-sanitized');
    }
    event.runId = runId;
    if (warnings.size > 0) {
      event.warnings = [...warnings];
    }
    const line = `${JSON.stringify(event)}\n`;

    fs.mkdirSync(statusRoot, { recursive: true });
    if (isRunTerminal(statusRoot, runId)) {
      fs.appendFileSync(path.join(statusRoot, 'late-events.jsonl'), line, 'utf8');
      fs.appendFileSync(path.join(statusRoot, `${runId}.late.jsonl`), line, 'utf8');
      this.log(`${remote} POST ${requestUrl.pathname} 204 run=${runId} stage=${event.stage ?? '-'} audit=late-terminal-event`);
      res.writeHead(204);
      res.end();
      return;
    }
    fs.appendFileSync(statusLogPath, line, 'utf8');
    fs.appendFileSync(path.join(statusRoot, `${runId}.jsonl`), line, 'utf8');
    fs.writeFileSync(latestStatusPath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(statusRoot, `${runId}.latest.json`), `${JSON.stringify(event, null, 2)}\n`, 'utf8');
    const runSummary = updateRunSummary(statusRoot, event);

    const logsDir = this.config.paths?.logsDir || path.join(path.dirname(statusRoot), 'logs');
    const runLogDir = path.join(logsDir, 'runs', runId);
    fs.mkdirSync(runLogDir, { recursive: true });
    const runLogPath = path.join(runLogDir, 'deployment.log');

    let clientAppName = 'Client-Deployment';
    const stage = String(event.stage ?? '').toLowerCase();
    if (stage.startsWith('winpe') || stage.includes('osdcloud') || stage.startsWith('reporter')) {
      clientAppName = 'Client-WinPE';
    } else if (stage.startsWith('windows-apps') || stage.startsWith('windows-setupcomplete')) {
      clientAppName = 'Client-SetupComplete';
    } else if (stage.startsWith('windows-logon') || stage.startsWith('windows-desktop')) {
      clientAppName = 'Client-DesktopReady';
    }

    let clientSeverity = 6;
    if (stage.includes('error') || String(event.message).toUpperCase().includes('ERROR') || String(event.message).toUpperCase().includes('FAILED')) {
      clientSeverity = 3;
    } else if (stage.includes('warn') || String(event.message).toUpperCase().includes('WARN')) {
      clientSeverity = 4;
    }

    const clientSyslogLine = formatSyslog({
      severity: clientSeverity,
      facility: 1,
      timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
      hostname: event.computerName || event.clientId || 'client',
      appName: clientAppName,
      procId: runId,
      msgId: event.stage || '-',
      structuredData: `[deployment percent="${event.percent ?? '-'}" stage="${event.stage ?? '-'}"]`,
      message: event.message || '',
    });
    fs.appendFileSync(runLogPath, `${clientSyslogLine}\n`, 'utf8');


    const details = [
      `run=${runId}`,
      event.clientId ? `client=${sanitizeName(event.clientId)}` : null,
      event.stage ? `stage=${event.stage}` : null,
      Number.isFinite(event.percent) ? `percent=${event.percent}` : null,
      event.message ? `message=${String(event.message).replace(/\s+/g, ' ').slice(0, 180)}` : null,
    ].filter(Boolean).join(' ');

    res.writeHead(204);
    res.end();
    this.log(`${remote} POST ${requestUrl.pathname} 204 ${details}`);
    this.emit('status', { event, ...runSummary });
    this.queueDriverPackCacheRequest(event);
  }

  async handleScreenshot(req, res, remote, requestUrl) {
    const maxBytes = 5 * 1024 * 1024;

    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      this.log(`${remote} ${req.method} ${requestUrl.pathname} 405 bytes=0`);
      return;
    }

    const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'image/png') {
      sendJson(res, 415, { error: 'Only image/png screenshots are accepted.' });
      this.log(`${remote} POST ${requestUrl.pathname} 415 contentType=${contentType || 'missing'}`);
      return;
    }

    const contentLength = Number.parseInt(String(req.headers['content-length'] ?? ''), 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      req.resume();
      sendJson(res, 413, { error: `Screenshot exceeds ${maxBytes} byte limit.` });
      this.log(`${remote} POST ${requestUrl.pathname} 413 bytes=${contentLength}`);
      return;
    }

    let body;
    try {
      body = await readRequestBuffer(req, maxBytes);
    } catch (error) {
      sendJson(res, 413, { error: error.message });
      this.log(`${remote} POST ${requestUrl.pathname} 413 error=${error.message}`);
      return;
    }

    if (!isPngBuffer(body)) {
      sendJson(res, 400, { error: 'Invalid PNG screenshot body.' });
      this.log(`${remote} POST ${requestUrl.pathname} 400 invalid-png bytes=${body.length}`);
      return;
    }

    const now = new Date().toISOString();
    const timestamp = getMetaValue(req, requestUrl, 'timestamp', ['x-osdcloud-timestamp']) || now;
    const runId = sanitizeName(getMetaValue(req, requestUrl, 'runId', ['x-osdcloud-run-id', 'x-osdcloud-runid']));
    const clientId = sanitizeName(getMetaValue(req, requestUrl, 'clientId', ['x-osdcloud-client-id', 'x-osdcloud-clientid']));
    const stage = sanitizeName(getMetaValue(req, requestUrl, 'stage', ['x-osdcloud-stage']));
    const source = sanitizeName(getMetaValue(req, requestUrl, 'source', ['x-osdcloud-source']));

    const statusRoot = this.config.statusRoot;
    const screenshotDir = path.join(statusRoot, 'screenshots', runId);
    fs.mkdirSync(screenshotDir, { recursive: true });

    const filenameBase = `${sanitizeName(timestamp)}-${stage}`.slice(0, 180);
    const filePath = nextAvailablePath(screenshotDir, filenameBase, '.png');
    fs.writeFileSync(filePath, body);

    // Duplicate screenshot under logs/runs/<runId>/screenshots/
    const logsDir = this.config.paths?.logsDir || path.join(path.dirname(statusRoot), 'logs');
    const runScreenshotDir = path.join(logsDir, 'runs', runId, 'screenshots');
    fs.mkdirSync(runScreenshotDir, { recursive: true });
    const runScreenshotPath = nextAvailablePath(runScreenshotDir, filenameBase, '.png');
    fs.writeFileSync(runScreenshotPath, body);


    const metadata = {
      receivedAt: now,
      runId,
      clientId,
      stage,
      source,
      timestamp,
      filePath,
      bytes: body.length,
    };
    const line = `${JSON.stringify(metadata)}\n`;
    fs.appendFileSync(path.join(statusRoot, `${runId}.screenshots.jsonl`), line, 'utf8');
    fs.writeFileSync(path.join(statusRoot, 'latest-screenshot.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

    sendJson(res, 201, metadata);
    this.log(`${remote} POST ${requestUrl.pathname} 201 run=${runId} client=${clientId} stage=${stage} source=${source} bytes=${body.length} file=${filePath}`);
    this.emit('screenshot', metadata);
  }

  async handleBootConfig(req, res, remote, requestUrl) {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      res.end();
      return;
    }

    const secrets = loadSecrets(this.config);
    const serverIp = this.config.host || '127.0.0.1';
    const share = this.config.smb?.share || '';
    const shareName = share.split('\\').filter(Boolean).at(-1) || 'OSDCloudiPXE';

    sendJson(res, 200, {
      ok: true,
      server: serverIp,
      share: `\\\\${serverIp}\\${shareName}`,
      smbUser: 'pxeinstall',
      smbPassword: secrets.pxeinstallPassword,
      windowsUsername: secrets.windowsUsername,
      windowsPassword: secrets.windowsPassword,
      ...this.torrentBootConfig(serverIp),
    });
    this.log(`${remote} GET ${requestUrl.pathname} 200`);
  }

  async handleTorrentTelemetry(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }
    if (!this.torrentCoordinator) {
      sendJson(res, 503, { ok: false, error: 'Torrent coordinator unavailable' });
      return;
    }
    try {
      const body = await readRequestBody(req, 32 * 1024);
      const payload = body.trim() ? JSON.parse(body) : {};
      const inferredIp = String(req.socket.remoteAddress ?? '').replace(/^::ffff:/u, '');
      const result = this.torrentCoordinator.receiveTelemetry(payload, inferredIp);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  handleTorrentControl(req, res, requestUrl) {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      res.end();
      return;
    }
    if (!this.torrentCoordinator) {
      sendJson(res, 503, { ok: false, error: 'Torrent coordinator unavailable' });
      return;
    }
    const runId = requestUrl.searchParams.get('runId');
    if (!runId) {
      sendJson(res, 400, { ok: false, error: 'runId is required' });
      return;
    }
    sendJson(res, 200, { ok: true, ...this.torrentCoordinator.getControl(runId) });
  }

  // Advertise P2P details to WinPE clients. Returns torrentEnabled:false unless
  // the torrent feature is on AND a generated torrent + its sidecar manifest exist
  // next to the active OS WIM (so an un-published or torrent-less image cleanly
  // falls back to SMB-direct apply on the client).
  torrentBootConfig(serverIp) {
    const torrent = this.config.torrent ?? {};
    if (torrent.enabled === false) {
      return { torrentEnabled: false };
    }
    const cacheRoot = this.config.osCacheRoot;
    if (!cacheRoot) {
      return { torrentEnabled: false };
    }
    const httpPort = Number(torrent.httpPort ?? this.config.port ?? 80);
    const trackerPort = Number(torrent.trackerPort ?? 6969);
    const ip = torrent.serverIp || serverIp;
    try {
      const manifestPath = path.join(cacheRoot, osTorrentManifestName);
      if (!fs.existsSync(manifestPath)) {
        return { torrentEnabled: false };
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/u, ''));
      const fileName = manifest.fileName;
      if (!fileName) {
        return { torrentEnabled: false };
      }
      const wimPath = path.join(cacheRoot, fileName);
      const torrentPath = `${wimPath}.torrent`;
      if (!fs.existsSync(wimPath) || !fs.existsSync(torrentPath)) {
        return { torrentEnabled: false };
      }
      return {
        torrentEnabled: true,
        torrentUrl: osTorrentUrl(ip, httpPort, fileName),
        webSeedUrl: osWebSeedUrl(ip, httpPort, fileName),
        trackerUrl: trackerAnnounceUrl(ip, trackerPort),
        osWimFileName: fileName,
        osWimSha256: manifest.wimSha256 || '',
        seedMinutes: Number(torrent.seedMinutes ?? 30),
      };
    } catch (error) {
      this.log(`torrent boot-config unavailable: ${error.message}`);
      return { torrentEnabled: false };
    }
  }

  // Serve the OS WIM and its .torrent (BEP19 webseed origin). The OS cache lives
  // outside http.root, so this route maps /osdcloud/os/<file> to osCacheRoot with
  // path-traversal protection and HTTP range support (clients/webseed use ranges).
  async handleOsImage(req, res, remote, requestUrl) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      this.log(`${remote} ${req.method} ${requestUrl.pathname} 405 bytes=0`);
      return;
    }

    const cacheRoot = this.config.osCacheRoot;
    if (!cacheRoot) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('OS image cache is not configured');
      this.log(`${remote} ${req.method} ${requestUrl.pathname} 404 no-os-cache-root`);
      return;
    }

    const rel = decodeURIComponent(requestUrl.pathname.slice('/osdcloud/os/'.length));
    const rootFull = path.resolve(cacheRoot);
    const resolved = path.resolve(rootFull, rel);
    const rootWithSeparator = rootFull.endsWith(path.sep) ? rootFull : `${rootFull}${path.sep}`;
    if (!rel || (resolved !== rootFull && !resolved.startsWith(rootWithSeparator))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      this.log(`${remote} ${req.method} ${requestUrl.pathname} 403 traversal`);
      return;
    }
    const lower = resolved.toLowerCase();
    if (!lower.endsWith('.wim') && !lower.endsWith('.torrent')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      this.log(`${remote} ${req.method} ${requestUrl.pathname} 403 type`);
      return;
    }

    this.sendFileRange(req, res, remote, resolved, `osdcloud/os/${rel}`);
  }

  sendFileRange(req, res, remote, filePath, label) {
    fs.stat(filePath, (statError, stats) => {
      if (statError || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Not found: ${label}`);
        this.log(`${remote} ${req.method} /${label} 404 bytes=0`);
        return;
      }

      const range = parseRange(req.headers.range, stats.size);
      const headers = {
        'Accept-Ranges': 'bytes',
        'Content-Type': 'application/octet-stream',
      };
      let statusCode = 200;
      let start = 0;
      let end = stats.size - 1;
      if (range) {
        statusCode = 206;
        start = range.start;
        end = range.end;
        headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`;
      }
      const contentLength = Math.max(0, end - start + 1);
      headers['Content-Length'] = String(contentLength);
      res.writeHead(statusCode, headers);

      if (req.method === 'HEAD') {
        res.end();
        this.log(`${remote} HEAD /${label} ${statusCode} bytes=${contentLength}`);
        return;
      }

      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', (error) => {
        this.log(`${remote} ${req.method} /${label} 500 error=${error.message}`);
        res.destroy(error);
      });
      res.on('finish', () => {
        this.log(`${remote} ${req.method} /${label} ${statusCode} bytes=${contentLength}`);
      });
      res.on('close', () => {
        if (!res.writableEnded) {
          this.log(`${remote} ${req.method} /${label} aborted bytes=${contentLength}`);
        }
      });
      stream.pipe(res);
    });
  }

  async handleRequest(req, res) {
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : this.config.port;
    const remote = `${req.socket.remoteAddress ?? ''}:${req.socket.remotePort ?? ''}`;
    const requestUrl = new URL(req.url ?? '/', `http://${this.config.host}:${port}`);

    if (requestUrl.pathname === '/osdcloud/health') {
      this.handleHealth(req, res, remote, requestUrl);
      return;
    }

    if (requestUrl.pathname === '/osdcloud/status' || requestUrl.pathname === '/osdcloud/status/events' || requestUrl.pathname === '/osdcloud/status/runs') {
      await this.handleStatus(req, res, remote, requestUrl);
      return;
    }

    if (requestUrl.pathname === '/osdcloud/screenshot') {
      await this.handleScreenshot(req, res, remote, requestUrl);
      return;
    }

    if (requestUrl.pathname === '/osdcloud/boot-config') {
      await this.handleBootConfig(req, res, remote, requestUrl);
      return;
    }

    if (requestUrl.pathname === '/osdcloud/torrent-telemetry') {
      await this.handleTorrentTelemetry(req, res);
      return;
    }

    if (requestUrl.pathname === '/osdcloud/torrent-control') {
      this.handleTorrentControl(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith('/osdcloud/os/')) {
      await this.handleOsImage(req, res, remote, requestUrl);
      return;
    }

    const requestPath = resolveRequestPath(this.config.root, req.url ?? '/', this.config.host, port);
    if (!requestPath) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      this.log(`${remote} ${req.method} ${req.url} 403 bytes=9`);
      return;
    }

    fs.stat(requestPath.resolved, (statError, stats) => {
      if (statError || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Not found: ${requestPath.relative}`);
        this.log(`${remote} ${req.method} /${requestPath.relative} 404 bytes=0`);
        return;
      }

      // Check if boot.wim is requested
      const relativeNormalized = requestPath.relative.replace(/\\/g, '/');
      if (req.method === 'GET' && relativeNormalized === 'osdcloud/boot.wim') {
        const remoteIp = remote.split(':')[0].replace(/[^0-9.]/g, '');
        const sanitizedIp = remoteIp.replace(/\./g, '_');
        // Endpoint Sync writes a boot.wim.sync.json marker next to the published image
        // once it has been customized. Its absence means the served image was never
        // customized (the client would hang at the command prompt after wpeinit).
        // Use a cheap existence check here to avoid hashing the wim on every boot request.
        const syncMarker = `${requestPath.resolved}.sync.json`;
        if (!fs.existsSync(syncMarker)) {
          this.log(`WARNING: CLIENT ${remoteIp} REQUESTED UN-CUSTOMIZED boot.wim (no Endpoint Sync marker). Client will hang at command prompt after wpeinit!`);
        }

        // Create synthetic run summary for booting client
        const statusRoot = this.config.statusRoot;
        const bootingSummaryPath = path.join(statusRoot, `booting-${sanitizedIp}.summary.json`);
        if (!fs.existsSync(bootingSummaryPath)) {
          const nowStr = new Date().toISOString();
          const bootingSummary = {
            runId: `booting-${sanitizedIp}`,
            clientId: remoteIp,
            status: 'running',
            startedAt: nowStr,
            startedTimestamp: nowStr,
            startStage: 'pxe-booting',
            eventCount: 1,
            latestStage: 'pxe-booting',
            latestMessage: 'Client requested boot.wim from PXE HTTP server',
            elapsedSeconds: 0,
            lastReceivedAt: nowStr,
            warnings: ['uncustomized-check-pending']
          };
          try {
            fs.mkdirSync(statusRoot, { recursive: true });
            fs.writeFileSync(bootingSummaryPath, `${JSON.stringify(bootingSummary, null, 2)}\n`, 'utf8');
            
            // Rebuild runs index
            const indexJson = buildRunsIndex(statusRoot, new Date());
            fs.writeFileSync(path.join(statusRoot, 'runs-index.json'), `${JSON.stringify(indexJson, null, 2)}\n`, 'utf8');
            this.emit('status', { event: bootingSummary, summary: bootingSummary, runsIndex: indexJson });
          } catch (e) {
            this.log(`Failed to create synthetic booting summary: ${e.message}`);
          }
        }
      }

      const range = parseRange(req.headers.range, stats.size);
      const headers = {
        'Accept-Ranges': 'bytes',
        'Content-Type': 'application/octet-stream',
      };

      let statusCode = 200;
      let start = 0;
      let end = stats.size - 1;
      if (range) {
        statusCode = 206;
        start = range.start;
        end = range.end;
        headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`;
      }

      const contentLength = Math.max(0, end - start + 1);
      headers['Content-Length'] = String(contentLength);
      res.writeHead(statusCode, headers);

      if (req.method === 'HEAD') {
        res.end();
        this.log(`${remote} HEAD /${requestPath.relative} ${statusCode} bytes=${contentLength}`);
        return;
      }

      const stream = fs.createReadStream(requestPath.resolved, { start, end });
      stream.on('error', (error) => {
        this.log(`${remote} ${req.method} /${requestPath.relative} 500 error=${error.message}`);
        res.destroy(error);
      });
      res.on('finish', () => {
        this.log(`${remote} ${req.method} /${requestPath.relative} ${statusCode} bytes=${contentLength}`);
      });
      res.on('close', () => {
        if (!res.writableEnded) {
          this.log(`${remote} ${req.method} /${requestPath.relative} aborted bytes=${contentLength}`);
        }
      });
      stream.pipe(res);
    });
  }
}
