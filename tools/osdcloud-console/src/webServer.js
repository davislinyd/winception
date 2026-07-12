import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webServerConfig } from './config.js';
import { ServiceController } from './controller/index.js';
import { ensureWebConsoleToken, tokenMatches, webAuthState } from './webAuth.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultStaticRoot = path.resolve(moduleDir, '..', 'web');
const defaultManualRoot = path.resolve(moduleDir, '..', '..', '..', 'docs');
const manualFileName = 'winception-operations-manual.html';
const manualAssetsPath = '/manual/manual-assets/';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.zip', 'application/zip'],
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

function resolveManualPath(root, requestPath) {
  if (requestPath === '/manual/') {
    return path.join(path.resolve(root), manualFileName);
  }
  if (!requestPath.startsWith(manualAssetsPath)) {
    return null;
  }
  return resolveStaticPath(path.join(root, 'manual-assets'), requestPath.slice(manualAssetsPath.length));
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

function parseCsvParam(searchParams, name) {
  return searchParams.getAll(name)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseOsDownloadCatalogFilters(searchParams) {
  return {
    osFamily: parseCsvParam(searchParams, 'osFamily'),
    language: parseCsvParam(searchParams, 'language'),
    releaseId: parseCsvParam(searchParams, 'releaseId'),
    edition: parseCsvParam(searchParams, 'edition'),
    activation: parseCsvParam(searchParams, 'activation'),
    sourceType: parseCsvParam(searchParams, 'sourceType'),
  };
}

function headerValue(headers, name) {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

const json16KiB = 16 * 1024;
const apiRouteTable = [
  { method: 'GET', path: '/api/auth/status', auth: false },
  { method: 'GET', path: '/api/state' },
  { method: 'GET', path: '/api/interfaces' },
  { method: 'GET', path: '/api/network/state' },
  { method: 'GET', path: '/api/profiles' },
  { method: 'GET', path: '/api/os-images' },
  { method: 'GET', path: '/api/os-download-catalog' },
  { method: 'GET', path: '/api/diagnostics/latest' },
  { method: 'GET', path: '/api/software-test/status' },
  { method: 'GET', path: '/api/diagnostics/download' },
  { method: 'GET', path: '/api/software/script' },
  { method: 'GET', path: '/api/scripts/content' },
  { method: 'POST', path: '/api/services/start-all' },
  { method: 'POST', path: '/api/services/stop-all' },
  { method: 'POST', path: '/api/torrent/release', bodyLimit: json16KiB },
  { method: 'POST', path: '/api/torrent/settings', bodyLimit: json16KiB },
  { method: 'POST', path: '/api/torrent/extend', bodyLimit: json16KiB },
  { method: 'POST', path: '/api/preflight' },
  { method: 'POST', path: '/api/diagnostics/run', bodyLimit: json16KiB },
  { method: 'POST', path: '/api/secrets', bodyLimit: json16KiB },
  { method: 'POST', path: '/api/runtime/prepare' },
  { method: 'POST', path: '/api/project-root' },
  { method: 'POST', path: '/api/endpoint' },
  { method: 'POST', path: '/api/boot-mode' },
  { method: 'POST', path: '/api/dhcp-mode' },
  { method: 'POST', path: '/api/network/prepare' },
  { method: 'POST', path: '/api/network/remove' },
  { method: 'POST', path: '/api/profile' },
  { method: 'POST', path: '/api/software-test/config' },
  { method: 'POST', path: '/api/software-test/run' },
  { method: 'POST', path: '/api/os-image-delete' },
  { method: 'POST', path: '/api/os-download' },
  { method: 'POST', path: '/api/offline-iso/create' },
  { method: 'POST', path: '/api/os-image-reexport' },
  { method: 'POST', path: '/api/os-image-upload' },
  { method: 'POST', path: '/api/os-image-upload-import' },
  { method: 'POST', path: '/api/software-upload' },
  { method: 'POST', path: '/api/software/create' },
  { method: 'POST', path: '/api/software/script/open' },
  { method: 'POST', path: '/api/software/delete' },
  { method: 'POST', path: '/api/script-upload' },
  { method: 'POST', path: '/api/scripts/create' },
  { method: 'POST', path: '/api/scripts/delete' },
  { method: 'POST', path: '/api/profiles/create' },
  { method: 'POST', path: '/api/profile/software' },
  { method: 'POST', path: '/api/profiles/delete' },
  { method: 'POST', path: '/api/status/clear' },
  { method: 'POST', path: '/api/status/run/delete' },
  { method: 'POST', path: '/api/status/runs/delete' },
  { method: 'POST', path: '/api/status/runs/archive' },
  { method: 'POST', path: '/api/status/runs/restore' },
  { method: 'POST', path: '/api/status/archive/delete' },
];

function matchApiRoute(method, pathname) {
  const serviceRoute = parseServiceRoute(pathname);
  if (serviceRoute) {
    return method === 'POST'
      ? { method: 'POST', path: pathname, serviceRoute }
      : null;
  }
  return apiRouteTable.find((route) => route.method === method && route.path === pathname) ?? null;
}

function allowedApiMethods(pathname) {
  const methods = new Set(apiRouteTable
    .filter((route) => route.path === pathname)
    .map((route) => route.method));
  if (parseServiceRoute(pathname)) {
    methods.add('POST');
  }
  return [...methods].sort();
}

export class WebManagementServer {
  constructor(options = {}) {
    this.controller = options.controller ?? new ServiceController(options);
    this.staticRoot = options.staticRoot ?? defaultStaticRoot;
    this.manualRoot = options.manualRoot ?? defaultManualRoot;
    this.server = null;
    this.listenHost = null;
    this.authToken = null;
    this.eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
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
    this.listenHost = host;
    if (this.authStatus().required) {
      this.authToken = ensureWebConsoleToken(this.controller.config).token;
    } else {
      this.authToken = null;
    }
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        const statusCode = error.statusCode ?? (error instanceof SyntaxError ? 400 : 500);
        const payload = { ok: false, error: error.message };
        if (error.profiles) {
          payload.profiles = error.profiles;
        }
        sendJson(res, statusCode, payload);
      });
    });
    this.eventLoopDelay.enable();
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
    this.listenHost = null;
    this.authToken = null;
    this.eventLoopDelay.disable();
    await new Promise((resolve) => server.close(resolve));
  }

  authStatus() {
    const config = {
      ...this.controller.config,
      web: {
        ...(this.controller.config.web ?? {}),
        host: this.listenHost ?? webServerConfig(this.controller.config).host,
      },
    };
    return webAuthState(config);
  }

  ensureAuthorized(req, res) {
    const status = this.authStatus();
    if (!status.required) {
      return true;
    }
    const token = this.authToken ?? ensureWebConsoleToken(this.controller.config).token;
    this.authToken = token;
    const provided = headerValue(req.headers, 'x-winception-token');
    if (tokenMatches(provided, token)) {
      return true;
    }
    sendJson(res, 401, {
      ok: false,
      error: 'Winception Web Console token required.',
      required: true,
      hostMode: status.hostMode,
    });
    return false;
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
    if (requestUrl.pathname === '/manual/' || requestUrl.pathname.startsWith(manualAssetsPath)) {
      await this.handleManual(req, res, requestUrl);
      return;
    }
    await this.handleStatic(req, res, requestUrl);
  }

  async handleManual(req, res, requestUrl) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    const filePath = resolveManualPath(this.manualRoot, requestUrl.pathname);
    if (!filePath) {
      sendText(res, 403, 'Forbidden');
      return;
    }
    await this.sendFile(req, res, filePath);
  }

  async handleApi(req, res, requestUrl) {
    const { pathname } = requestUrl;
    const routeMeta = matchApiRoute(req.method, pathname);
    if (!routeMeta) {
      const allowed = allowedApiMethods(pathname);
      if (allowed.length > 0) {
        res.writeHead(405, { Allow: allowed.join(', ') });
        res.end();
        return;
      }
      if (!this.ensureAuthorized(req, res)) {
        return;
      }
      sendJson(res, 404, { ok: false, error: `Unknown API path: ${pathname}` });
      return;
    }
    if (routeMeta.auth !== false && !this.ensureAuthorized(req, res)) {
      return;
    }
    const readBody = (fallbackLimit) => readJsonBody(req, routeMeta.bodyLimit ?? fallbackLimit);

    if (req.method === 'GET' && pathname === '/api/auth/status') {
      sendJson(res, 200, this.authStatus());
      return;
    }
    if (req.method === 'GET' && pathname === '/api/state') {
      const snapshotStartedAt = performance.now();
      const state = this.controller.getState({
        selectedRunId: requestUrl.searchParams.get('runId') ?? undefined,
        includeEvidence: requestUrl.searchParams.get('includeEvidence') === '1',
      });
      const eventLoopLagMs = this.eventLoopDelay.mean / 1e6;
      state.health = {
        stateSnapshotMs: Math.round((performance.now() - snapshotStartedAt) * 10) / 10,
        eventLoopLagMs: Number.isFinite(eventLoopLagMs) ? Math.round(eventLoopLagMs * 10) / 10 : null,
        lastSuccessfulStateAt: new Date().toISOString(),
      };
      this.eventLoopDelay.reset();
      sendJson(res, 200, { ok: true, state });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/interfaces') {
      sendJson(res, 200, { ok: true, interfaces: await this.controller.listInterfaces() });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/network/state') {
      sendJson(res, 200, { ok: true, gateway: await this.controller.inspectNetworkGateway() });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/profiles') {
      sendJson(res, 200, { ok: true, profile: this.controller.getProfiles() });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/os-images') {
      sendJson(res, 200, { ok: true, osImage: this.controller.getOsImages() });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/os-download-catalog') {
      sendJson(res, 200, { ok: true, catalog: await this.controller.getOsDownloadCatalog(parseOsDownloadCatalogFilters(requestUrl.searchParams)) });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/diagnostics/latest') {
      sendJson(res, 200, { ok: true, result: this.controller.diagnosticsSummary() });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/diagnostics/download') {
      const bundleName = requestUrl.searchParams.get('name');
      const filePath = this.controller.diagnosticsDownloadPath(bundleName);
      if (!filePath) {
        sendJson(res, 404, { ok: false, error: 'Diagnostic bundle not found.' });
        return;
      }
      await this.sendFile(req, res, filePath);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/software/script') {
      const result = this.controller.readSoftwareInstallScript(requestUrl.searchParams.get('softwareId'));
      sendJson(res, 200, { ok: true, result });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/scripts/content') {
      const scriptId = requestUrl.searchParams.get('scriptId')
        ?? requestUrl.searchParams.get('id');
      const result = this.controller.readCustomScriptContent(scriptId);
      sendJson(res, 200, { ok: true, result });
      return;
    }

    const route = routeMeta.serviceRoute;
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
    if (pathname === '/api/torrent/release') {
      const body = await readBody(json16KiB);
      const result = this.controller.releaseTorrentClients(body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/torrent/settings') {
      const body = await readBody(json16KiB);
      const result = this.controller.updateTorrentSettings(body.seedMinutes);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/torrent/extend') {
      const body = await readBody(json16KiB);
      try {
        const result = this.controller.extendTorrentClient(body);
        sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return;
    }
    if (pathname === '/api/preflight') {
      const result = await this.controller.runPreflight();
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/diagnostics/run') {
      const body = await readBody(json16KiB);
      const result = await this.controller.runDiagnostics(body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/software-test/status') {
      sendJson(res, 200, { ok: true, result: this.controller.getSoftwareTestStatus(), state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/secrets') {
      const body = await readBody(json16KiB);
      const result = await this.controller.saveDeploymentSecrets(body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/runtime/prepare') {
      const result = await this.controller.prepareRuntime();
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/project-root') {
      const body = await readBody();
      const result = await this.controller.updateProjectRoot(body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/endpoint') {
      const body = await readBody();
      const result = await this.controller.changeEndpoint(body.interface ?? body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/network/prepare') {
      const body = await readBody();
      const result = await this.controller.prepareNetworkGateway(body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/network/remove') {
      const result = await this.controller.removeNetworkGateway();
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/boot-mode') {
      const body = await readBody();
      const result = await this.controller.changeBootMode(body.mode ?? body.bootMode);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/dhcp-mode') {
      const body = await readBody();
      const result = await this.controller.changeDhcpMode(body.mode ?? body.dhcpMode);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/profile') {
      const body = await readBody();
      const result = await this.controller.changeDeploymentProfile(body.profileId ?? body.id);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/software-test/config') {
      const body = await readBody(json16KiB);
      const result = await this.controller.configureSoftwareTest(body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/software-test/run') {
      const body = await readBody(json16KiB);
      const result = await this.controller.startSoftwareTest(body.profileId ?? body.id);
      sendJson(res, 202, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/os-image-delete') {
      const body = await readBody();
      const result = await this.controller.deleteOsImage(body.imageId ?? body.id);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/os-download') {
      const body = await readBody();
      const { promise: _promise, ...result } = this.controller.startOsDownload(body.catalogId ?? body.id);
      sendJson(res, 202, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/offline-iso/create') {
      const { promise: _promise, ...result } = this.controller.startOfflineIsoExport();
      sendJson(res, 202, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/os-image-reexport') {
      const body = await readBody();
      const { promise: _promise, ...result } = this.controller.startReexportOsImage(body.imageId ?? body.id);
      sendJson(res, 202, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/os-image-upload') {
      const fileName = requestUrl.searchParams.get('fileName')
        ?? headerValue(req.headers, 'x-os-image-file-name');
      const size = Number(headerValue(req.headers, 'content-length') ?? 0) || null;
      const result = await this.controller.uploadOsImage({
        fileName,
        size,
        stream: req,
      });
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/os-image-upload-import') {
      const body = await readBody();
      const result = await this.controller.importUploadedOsImage(body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/software-upload') {
      const fileName = requestUrl.searchParams.get('fileName')
        ?? headerValue(req.headers, 'x-software-file-name');
      const size = Number(headerValue(req.headers, 'content-length') ?? 0) || null;
      const result = await this.controller.uploadSoftwareInstaller({
        fileName,
        size,
        stream: req,
      });
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/software/create') {
      const body = await readBody();
      const result = await this.controller.addSoftwarePackage(body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/software/script/open') {
      const body = await readBody();
      const result = await this.controller.openSoftwareInstallScript(body.softwareId ?? body.id);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/software/delete') {
      const body = await readBody();
      const result = await this.controller.removeSoftwarePackage(body.softwareId ?? body.id);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/script-upload') {
      const fileName = requestUrl.searchParams.get('fileName')
        ?? headerValue(req.headers, 'x-script-file-name');
      const size = Number(headerValue(req.headers, 'content-length') ?? 0) || null;
      const result = await this.controller.uploadCustomScript({
        fileName,
        size,
        stream: req,
      });
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/scripts/create') {
      const body = await readBody();
      const result = await this.controller.addCustomScript(body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/scripts/delete') {
      const body = await readBody();
      const result = await this.controller.removeCustomScript(body.scriptId ?? body.id);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/profiles/create') {
      const body = await readBody();
      const result = await this.controller.addDeploymentProfile(body);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/profile/software') {
      const body = await readBody();
      const hasSoftware = Object.prototype.hasOwnProperty.call(body, 'softwareIds')
        || Object.prototype.hasOwnProperty.call(body, 'software');
      const hasOsImage = Object.prototype.hasOwnProperty.call(body, 'osImageId')
        || Object.prototype.hasOwnProperty.call(body, 'osImage');
      const hasInstallSequence = Object.prototype.hasOwnProperty.call(body, 'installSequence');
      const hasExecution = Object.prototype.hasOwnProperty.call(body, 'execution');
      const hasLocale = Object.prototype.hasOwnProperty.call(body, 'locale');
      const hasDisplayLanguage = Object.prototype.hasOwnProperty.call(body, 'displayLanguage');
      const hasInputLanguage = Object.prototype.hasOwnProperty.call(body, 'inputLanguage');
      const hasTimeZone = Object.prototype.hasOwnProperty.call(body, 'timeZone');
      const result = await this.controller.updateActiveDeploymentProfile({
        profileId: body.profileId ?? body.id,
        name: body.name,
        description: body.description,
        softwareIds: hasSoftware ? (body.softwareIds ?? body.software) : undefined,
        installSequence: hasInstallSequence ? body.installSequence : undefined,
        execution: hasExecution ? body.execution : undefined,
        osImageId: hasOsImage ? (body.osImageId ?? body.osImage) : undefined,
        ...(hasDisplayLanguage ? { displayLanguage: body.displayLanguage } : {}),
        ...(hasLocale ? { locale: body.locale } : {}),
        ...(hasInputLanguage ? { inputLanguage: body.inputLanguage } : {}),
        ...(hasTimeZone ? { timeZone: body.timeZone } : {}),
      });
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/profiles/delete') {
      const body = await readBody();
      const result = await this.controller.removeDeploymentProfile(body.profileId ?? body.id);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/status/clear') {
      const result = await this.controller.clearStatusFiles();
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/status/run/delete') {
      const body = await readBody();
      const result = await this.controller.deleteStatusRun(body.runId ?? body.id);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/status/runs/delete') {
      const body = await readBody();
      const result = await this.controller.deleteStatusRuns(body.runIds ?? body.ids ?? []);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/status/runs/archive') {
      const body = await readBody();
      const result = await this.controller.archiveStatusRuns(body.runIds ?? body.ids ?? []);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/status/runs/restore') {
      const body = await readBody();
      const result = await this.controller.restoreStatusRuns(body.runIds ?? body.ids ?? []);
      sendJson(res, 200, { ok: true, result, state: this.controller.getState() });
      return;
    }
    if (pathname === '/api/status/archive/delete') {
      const body = await readBody();
      const result = await this.controller.deleteArchivedRuns(body.runIds ?? body.ids ?? []);
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

    await this.sendFile(req, res, filePath);
  }

  async sendFile(req, res, filePath) {

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
