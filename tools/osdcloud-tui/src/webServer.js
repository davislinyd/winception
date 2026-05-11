import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webServerConfig } from './config.js';
import { ServiceController } from './serviceController.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultStaticRoot = path.resolve(moduleDir, '..', 'web');

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function sendJson(res, statusCode, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function resolveStaticPath(root, requestPath) {
  const relative = decodeURIComponent(requestPath).replace(/^\/+/, '') || 'index.html';
  const normalized = relative === '' ? 'index.html' : relative;
  const resolved = path.resolve(root, normalized);
  const fullRoot = path.resolve(root);
  const rootWithSeparator = fullRoot.endsWith(path.sep) ? fullRoot : `${fullRoot}${path.sep}`;
  if (resolved !== fullRoot && !resolved.startsWith(rootWithSeparator)) {
    return null;
  }
  return resolved;
}

async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`Request body too large: ${total} bytes`);
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  return body ? JSON.parse(body) : {};
}

function parseServiceRoute(pathname) {
  const match = /^\/api\/services\/(http|tftp|dhcp)\/(start|stop)$/u.exec(pathname);
  return match ? { service: match[1], action: match[2] } : null;
}

export class WebManagementServer {
  constructor(options = {}) {
    this.controller = options.controller ?? new ServiceController(options);
    this.staticRoot = options.staticRoot ?? defaultStaticRoot;
    this.server = null;
  }

  get address() {
    return this.server?.address();
  }

  async start(options = {}) {
    if (this.server) {
      return;
    }
    const webConfig = webServerConfig(this.controller.config);
    const host = options.host ?? webConfig.host;
    const port = options.port ?? webConfig.port;
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        const statusCode = error.statusCode ?? (error instanceof SyntaxError ? 400 : 500);
        sendJson(res, statusCode, { ok: false, error: error.message });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
  }

  async stop() {
    await this.controller.shutdown();
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(resolve));
  }

  async handleRequest(req, res) {
    const address = this.address;
    const port = typeof address === 'object' && address ? address.port : 80;
    const host = typeof address === 'object' && address ? address.address : '127.0.0.1';
    const requestUrl = new URL(req.url ?? '/', `http://${host}:${port}`);

    if (requestUrl.pathname.startsWith('/api/')) {
      await this.handleApi(req, res, requestUrl);
      return;
    }
    await this.handleStatic(req, res, requestUrl);
  }

  async handleApi(req, res, requestUrl) {
    const { pathname } = requestUrl;
    if (req.method === 'GET' && pathname === '/api/state') {
      sendJson(res, 200, { ok: true, state: this.controller.getState({ selectedRunId: requestUrl.searchParams.get('runId') ?? undefined }) });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/interfaces') {
      sendJson(res, 200, { ok: true, interfaces: await this.controller.listInterfaces() });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/profiles') {
      sendJson(res, 200, { ok: true, profile: this.controller.getProfiles() });
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, POST' });
      res.end();
      return;
    }

    const route = parseServiceRoute(pathname);
    if (route) {
      const result = route.action === 'start'
        ? await this.controller.startService(route.service)
        : await this.controller.stopService(route.service);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }

    if (pathname === '/api/services/start-all') {
      const result = await this.controller.startAll();
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/services/stop-all') {
      const result = await this.controller.stopAll();
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/preflight') {
      const result = await this.controller.runPreflight();
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/endpoint') {
      const body = await readJsonBody(req);
      const result = await this.controller.changeEndpoint(body.interface ?? body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/profile') {
      const body = await readJsonBody(req);
      const result = await this.controller.changeDeploymentProfile(body.profileId ?? body.id);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/status/clear') {
      const result = await this.controller.clearStatusFiles();
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }

    sendJson(res, 404, { ok: false, error: `Unknown API path: ${pathname}` });
  }

  async handleStatic(req, res, requestUrl) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    const filePath = resolveStaticPath(this.staticRoot, requestUrl.pathname);
    if (!filePath) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    const finalPath = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
      ? path.join(filePath, 'index.html')
      : filePath;
    if (!fs.existsSync(finalPath) || !fs.statSync(finalPath).isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }

    const type = contentTypes.get(path.extname(finalPath).toLowerCase()) ?? 'application/octet-stream';
    const stats = fs.statSync(finalPath);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stats.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(finalPath).pipe(res);
  }
}

async function runCli() {
  const controller = new ServiceController();
  const server = new WebManagementServer({ controller });
  const config = webServerConfig(controller.config);
  await server.start(config);
  const address = server.address;
  const host = address?.address === '::' ? 'localhost' : config.host;
  const port = typeof address === 'object' && address ? address.port : config.port;
  console.log(`OSDCloud Web console listening at http://${host}:${port}`);

  async function stop() {
    await server.stop();
    process.exit(0);
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
