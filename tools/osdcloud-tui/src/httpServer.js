import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { appendLog } from './logger.js';

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

function sendJson(res, statusCode, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export class MediaHttpServer extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.server = null;
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

  async handleStatus(req, res, remote, requestUrl) {
    const statusRoot = this.config.statusRoot;
    const statusLogPath = path.join(statusRoot, 'progress.jsonl');
    const latestStatusPath = path.join(statusRoot, 'latest.json');

    if (req.method === 'GET') {
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
    const runId = sanitizeName(event.runId);
    const line = `${JSON.stringify(event)}\n`;

    fs.mkdirSync(statusRoot, { recursive: true });
    fs.appendFileSync(statusLogPath, line, 'utf8');
    fs.appendFileSync(path.join(statusRoot, `${runId}.jsonl`), line, 'utf8');
    fs.writeFileSync(latestStatusPath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(statusRoot, `${runId}.latest.json`), `${JSON.stringify(event, null, 2)}\n`, 'utf8');

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
  }

  async handleRequest(req, res) {
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : this.config.port;
    const remote = `${req.socket.remoteAddress ?? ''}:${req.socket.remotePort ?? ''}`;
    const requestUrl = new URL(req.url ?? '/', `http://${this.config.host}:${port}`);

    if (requestUrl.pathname === '/osdcloud/status' || requestUrl.pathname === '/osdcloud/status/events') {
      await this.handleStatus(req, res, remote, requestUrl);
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
