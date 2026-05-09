import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? 'C:\\OSDCloud\\Win11-iPXE-Lab\\PXE-HttpRoot');
const host = process.argv[3] ?? '192.168.100.1';
const port = Number.parseInt(process.argv[4] ?? '80', 10);
const logPath = process.argv[5] ?? 'C:\\OSDCloud\\Win11-iPXE-Lab\\PXE-HttpRoot\\host-http.log';
const statusRoot = path.resolve(process.argv[6] ?? path.join(root, 'status'));
const statusLogPath = path.join(statusRoot, 'progress.jsonl');
const latestStatusPath = path.join(statusRoot, 'latest.json');

function writeLog(message) {
  const line = `${new Date().toISOString()} ${message}`;
  fs.appendFileSync(logPath, `${line}\n`, 'ascii');
  console.log(line);
}

function sanitizeName(value) {
  return String(value ?? 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120) || 'unknown';
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

async function handleStatus(req, res, remote) {
  const requestUrl = new URL(req.url ?? '/', `http://${host}:${port}`);

  if (req.method === 'GET') {
    if (requestUrl.pathname === '/osdcloud/status/events') {
      if (!fs.existsSync(statusLogPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('No status events');
        writeLog(`${remote} GET ${requestUrl.pathname} 404 bytes=0`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      fs.createReadStream(statusLogPath).pipe(res);
      writeLog(`${remote} GET ${requestUrl.pathname} 200 file=${statusLogPath}`);
      return;
    }

    if (!fs.existsSync(latestStatusPath)) {
      sendJson(res, 404, { error: 'No deployment status has been reported yet.' });
      writeLog(`${remote} GET ${requestUrl.pathname} 404 bytes=0`);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    fs.createReadStream(latestStatusPath).pipe(res);
    writeLog(`${remote} GET ${requestUrl.pathname} 200 file=${latestStatusPath}`);
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'GET, POST' });
    res.end();
    writeLog(`${remote} ${req.method} ${requestUrl.pathname} 405 bytes=0`);
    return;
  }

  let payload;
  try {
    const body = await readRequestBody(req);
    payload = body.trim() ? JSON.parse(body) : {};
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    writeLog(`${remote} POST ${requestUrl.pathname} 400 error=${error.message}`);
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
  writeLog(`${remote} POST ${requestUrl.pathname} 204 ${details}`);
}

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, `http://${host}:${port}`);
  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!relative) {
    relative = 'index.txt';
  }

  const resolved = path.resolve(root, relative);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSeparator)) {
    return null;
  }

  return { relative, resolved };
}

function parseRange(rangeHeader, fileSize) {
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

const server = http.createServer(async (req, res) => {
  const remote = `${req.socket.remoteAddress ?? ''}:${req.socket.remotePort ?? ''}`;
  const requestUrl = new URL(req.url ?? '/', `http://${host}:${port}`);

  if (requestUrl.pathname === '/osdcloud/status' || requestUrl.pathname === '/osdcloud/status/events') {
    await handleStatus(req, res, remote);
    return;
  }

  const requestPath = resolveRequestPath(req.url ?? '/');

  if (!requestPath) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    writeLog(`${remote} ${req.method} ${req.url} 403 bytes=9`);
    return;
  }

  fs.stat(requestPath.resolved, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${requestPath.relative}`);
      writeLog(`${remote} ${req.method} /${requestPath.relative} 404 bytes=0`);
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
      writeLog(`${remote} HEAD /${requestPath.relative} ${statusCode} bytes=${contentLength}`);
      return;
    }

    const stream = fs.createReadStream(requestPath.resolved, { start, end });
    stream.on('error', (error) => {
      writeLog(`${remote} ${req.method} /${requestPath.relative} 500 error=${error.message}`);
      res.destroy(error);
    });
    res.on('finish', () => {
      writeLog(`${remote} ${req.method} /${requestPath.relative} ${statusCode} bytes=${contentLength}`);
    });
    res.on('close', () => {
      if (!res.writableEnded) {
        writeLog(`${remote} ${req.method} /${requestPath.relative} aborted bytes=${contentLength}`);
      }
    });
    stream.pipe(res);
  });
});

server.listen(port, host, () => {
  const scriptPath = fileURLToPath(import.meta.url);
  writeLog(`START node=${process.version} script=${scriptPath} root=${root} prefix=http://${host}:${port}/ status=${statusRoot}`);
});
