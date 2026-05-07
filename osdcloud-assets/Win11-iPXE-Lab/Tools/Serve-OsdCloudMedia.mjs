import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? 'C:\\OSDCloud\\Win11-iPXE-Lab\\PXE-HttpRoot');
const host = process.argv[3] ?? '192.168.100.1';
const port = Number.parseInt(process.argv[4] ?? '80', 10);
const logPath = process.argv[5] ?? 'C:\\OSDCloud\\Win11-iPXE-Lab\\PXE-HttpRoot\\host-http.log';

function writeLog(message) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'ascii');
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

const server = http.createServer((req, res) => {
  const remote = `${req.socket.remoteAddress ?? ''}:${req.socket.remotePort ?? ''}`;
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
  writeLog(`START node=${process.version} script=${scriptPath} root=${root} prefix=http://${host}:${port}/`);
});
