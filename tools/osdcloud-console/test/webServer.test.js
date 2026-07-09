import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ServiceController } from '../src/controller/index.js';
import { WebManagementServer } from '../src/webServer.js';
import { appVersion } from '../src/version.js';

class FakeService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.runningValue = false;
  }

  get running() {
    return this.runningValue;
  }

  async start() {
    this.runningValue = true;
  }

  async stop() {
    this.runningValue = false;
  }

  refreshLeasePool() {
  }
}

function makeConfig(root) {
  return {
    adapter: { interfaceAlias: 'LAN', serverIp: '127.0.0.1', prefixLength: 24 },
    dhcp: {
      listenIp: '127.0.0.1',
      listenPort: 6767,
      leaseStartIp: '127.0.0.20',
      leaseEndIp: '127.0.0.30',
      subnetMask: '255.0.0.0',
      router: '127.0.0.1',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://127.0.0.1/osdcloud/boot.ipxe',
    },
    tftp: { root: path.join(root, 'tftp'), listenIp: '127.0.0.1', port: 6969 },
    http: { root: path.join(root, 'http'), host: '127.0.0.1', port: 0, statusRoot: path.join(root, 'status') },
    paths: {
      repoRoot: root,
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      statusEvents: path.join(root, 'status', 'progress.jsonl'),
      statusLatest: path.join(root, 'status', 'latest.json'),
      imageNamePattern: 'install.esd',
    },
    smb: { share: '\\\\127.0.0.1\\OSDCloudiPXE', imagePath: path.join(root, 'install.esd') },
    web: { host: '127.0.0.1', port: 0 },
  };
}

async function makeServer(root, overrides = {}) {
  const config = makeConfig(root);
  if (overrides.config) {
    Object.assign(config, overrides.config);
  }
  const osCatalogCalls = [];
  const services = {
    dhcp: new FakeService(config.dhcp),
    tftp: new FakeService(config.tftp),
    http: new FakeService(config.http),
  };
  const controller = new ServiceController({
    config,
    services,
    dependencies: {
      listIpv4ServiceInterfaces: async () => [{ interfaceAlias: 'LAN', ipAddress: '127.0.0.1', prefixLength: 24 }],
      isElevated: () => true,
      readFleetStatus: () => ({ total: 1, counts: { running: 1 }, runs: [{ runId: 'run-1', status: 'running', latestStage: 'winpe-start' }] }),
      readRecentScreenshotMetadata: () => [],
      readRunLatestScreenshot: () => null,
      readStatusEvents: () => [],
      getDeploymentSecretsStatus: () => ({
        ready: false,
        missing: ['windowsUsername', 'windowsPassword', 'pxeinstallPassword'],
        status: {
          windowsUsername: { present: false, source: 'missing' },
          windowsPassword: { present: false, source: 'missing' },
          pxeinstallPassword: { present: false, source: 'missing' },
        },
      }),
      getRuntimeReadiness: () => ({
        ready: false,
        requiredCount: 1,
        readyCount: 0,
        missingCount: 1,
        missing: [{ id: 'boot-wim', targetPath: path.join(root, 'http', 'osdcloud', 'boot.wim') }],
        artifacts: [],
      }),
      resolveDeploymentProfileState: () => ({
        catalog: {
          software: [
            { id: '7zip', name: '7-Zip' },
            { id: 'chrome', name: 'Chrome' },
          ],
        },
        activeProfile: { id: 'default', name: 'Default' },
        selectedSoftware: [],
        profiles: [
          { id: 'default', name: 'Default', description: '', softwareIds: [] },
          { id: 'minimal', name: 'Minimal', description: '', softwareIds: [] },
        ],
      }),
      resolveOsImageState: () => ({
        activeImageId: 'SMOKE-WIN11-PRO',
        activeImage: {
          id: 'SMOKE-WIN11-PRO',
          name: 'Smoke Windows 11 Pro',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 6,
          fileName: 'install.esd',
          cached: true,
          bytes: 12,
        },
        images: [{
          id: 'SMOKE-WIN11-PRO',
          name: 'Smoke Windows 11 Pro',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 6,
          fileName: 'install.esd',
          cached: true,
          bytes: 12,
        }],
        cachedFiles: [],
        selectedOs: { id: 'SMOKE-WIN11-PRO', fileName: 'install.esd', imageIndex: 6 },
        catalogPath: path.join(root, 'os-image-catalog.json'),
        cacheRoot: path.join(root, 'OS'),
        downloadStagingRoot: path.join(root, 'OS', '.downloads'),
        selectedOsPath: path.join(root, 'OS', 'selected-os.json'),
        cacheLogPath: path.join(root, 'OS', 'os-image-cache.jsonl'),
      }),
      listOsDownloadCatalog: async (_config, options = {}) => {
        osCatalogCalls.push(options.filters ?? {});
        return [{
          id: 'SMOKE-DOWNLOAD-PRO',
          name: 'Smoke Download Pro',
          version: 'Windows 11 Smoke',
          osFamily: 'win11',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 6,
          fileName: 'download.esd',
        }];
      },
      createDeploymentProfile: (_config, input) => ({
        profile: { id: 'AAAAAAA0', name: input.name, description: input.description ?? '', softwareIds: [] },
        filePath: path.join(root, 'AAAAAAA0.json'),
      }),
      updateDeploymentProfile: (_config, profileId, input) => ({
        profile: {
          id: profileId,
          name: input.name ?? 'Default',
          description: input.description ?? '',
          softwareIds: input.softwareIds,
          installSequence: input.installSequence,
          osImageId: input.osImageId,
          displayLanguage: input.displayLanguage,
          locale: input.locale,
          inputLanguage: input.inputLanguage,
          timeZone: input.timeZone,
        },
        filePath: path.join(root, `${profileId}.json`),
      }),
      publishDeploymentProfile: (_config, profileId) => ({
        profile: { id: profileId, name: 'Default', description: '', softwareIds: [] },
        selectedSoftware: [],
        appsRoot: path.join(root, 'Apps'),
      }),
      publishSelectedOsImage: (_config, imageId) => ({
        image: {
          id: imageId,
          name: 'Smoke Windows 11 Pro',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 6,
          fileName: 'install.esd',
        },
        manifestPath: path.join(root, 'OS', 'selected-os.json'),
      }),
      downloadOsImageFromCatalog: (_config, catalogId) => ({
        status: 'downloaded',
        image: { id: catalogId, fileName: 'download.esd' },
        bytes: 10,
        filePath: path.join(root, 'OS', 'download.esd'),
      }),
      deleteCachedOsImage: (_config, imageId) => ({
        status: 'deleted',
        image: { id: imageId, fileName: 'download.esd' },
        fileDeleted: true,
        filePath: path.join(root, 'OS', 'download.esd'),
        catalogPath: path.join(root, 'os-image-catalog.json'),
        bytes: 10,
      }),
      uploadOsImageFile: async (_config, input) => {
        let bytes = 0;
        for await (const chunk of input.stream) {
          bytes += chunk.length;
        }
        return {
          uploadId: 'UPLOAD-WIN11',
          sourcePath: path.join(root, 'uploads', input.fileName),
          originalFileName: input.fileName,
          sourceType: 'wim',
          bytes,
          indexes: [{
            imageIndex: 6,
            name: 'Windows 11 Pro',
            suggested: {
              id: 'UPLOADED-WIN11-PRO',
              name: 'Uploaded Windows 11 Pro',
              version: 'Windows 11 Uploaded',
              language: 'en-us',
              edition: 'Pro',
              imageIndex: 6,
              fileName: 'uploaded.wim',
            },
          }],
        };
      },
      importUploadedOsImage: (_config, input) => ({
        status: 'imported',
        image: {
          id: input.metadata?.id ?? 'UPLOADED-WIN11-PRO',
          fileName: input.metadata?.fileName ?? 'uploaded.wim',
        },
        bytes: 30,
        filePath: path.join(root, 'OS', input.metadata?.fileName ?? 'uploaded.wim'),
      }),
      createOfflineIso: async () => {
        const outputDirectory = path.join(root, 'Exports');
        const outputPath = path.join(outputDirectory, 'Winception-USB-20260710-090000.iso');
        fs.mkdirSync(outputDirectory, { recursive: true });
        fs.writeFileSync(outputPath, 'iso image', 'utf8');
        return {
          outputPath,
          outputDirectory,
          fileName: path.basename(outputPath),
          bytes: Buffer.byteLength('iso image'),
        };
      },
      uploadSoftwareInstaller: async (_config, input) => {
        if (String(input.fileName ?? '').includes('..') || String(input.fileName ?? '').includes('/')) {
          const error = new Error('Invalid software installer fileName');
          error.statusCode = 400;
          throw error;
        }
        let bytes = 0;
        for await (const chunk of input.stream) {
          bytes += chunk.length;
        }
        return {
          uploadId: 'SOFTWARE-UPLOAD',
          fileName: input.fileName,
          bytes,
          sha256: 'A'.repeat(64),
        };
      },
      createSoftwarePackage: (_config, input) => {
        if (!input.name) {
          const error = new Error('Software name is required');
          error.statusCode = 400;
          throw error;
        }
        return {
          software: {
            id: input.softwareId,
            name: input.name,
            source: input.softwareId,
            installerFileName: 'tool.msi',
          },
          bytes: 4,
          sha256: 'B'.repeat(64),
          catalogPath: path.join(root, 'software-catalog.json'),
          uploadRemoved: true,
        };
      },
      deleteSoftwarePackage: (_config, softwareId) => {
        if (softwareId === '7zip') {
          const error = new Error('Software 7zip is still used by deployment profiles: Default');
          error.statusCode = 409;
          error.profiles = [{ id: 'default', name: 'Default' }];
          throw error;
        }
        return {
          software: { id: softwareId, name: 'Tool App', source: softwareId },
          catalogPath: path.join(root, 'software-catalog.json'),
          sourceRemoved: true,
          usedByProfiles: [],
        };
      },
      readSoftwareInstallScript: (_config, softwareId) => ({
        softwareId,
        filePath: path.join(root, 'Softwares', softwareId, 'install.ps1'),
        content: "Write-Host 'script'\n",
      }),
      readCustomScriptContent: (_config, scriptId) => {
        if (scriptId !== 'SC-TEST001') {
          const error = new Error(`Custom script not found: ${scriptId}`);
          error.statusCode = 404;
          throw error;
        }
        return {
          scriptId,
          filePath: path.join(root, 'Scripts', scriptId, 'run.ps1'),
          content: "Write-Host 'custom script'\n",
        };
      },
      openSoftwareInstallScript: (_config, softwareId) => ({
        softwareId,
        filePath: path.join(root, 'Softwares', softwareId, 'install.ps1'),
        opened: true,
        method: 'open-with',
      }),
      deleteDeploymentProfile: (_config, profileId) => ({
        profile: { id: profileId, name: 'Minimal', description: '', softwareIds: [] },
        filePath: path.join(root, `${profileId}.json`),
      }),
      deleteStatusRun: (_config, runId) => {
        if (!runId) {
          const error = new Error('Run ID is required.');
          error.statusCode = 400;
          throw error;
        }
        return { runId, removed: 3 };
      },
      deleteStatusRuns: (_config, runIds) => ({
        results: runIds.map((runId) => ({ runId, removed: 3, ok: true })),
        runsIndex: { total: 0, counts: {}, runs: [] },
      }),
      archiveStatusRuns: (_config, runIds) => ({
        results: runIds.map((runId) => ({ runId, moved: 5, ok: true })),
        runsIndex: { total: 0, counts: {}, runs: [] },
      }),
      restoreStatusRuns: (_config, runIds) => ({
        results: runIds.map((runId) => ({ runId, moved: 5, ok: true })),
        runsIndex: { total: 0, counts: {}, runs: [] },
      }),
      deleteArchivedRuns: (_config, runIds) => ({
        results: runIds.map((runId) => ({ runId, removed: 3, ok: true })),
      }),
      readArchivedFleet: () => ({ total: 0, counts: {}, runs: [] }),
      runPreflight: async () => [{ name: 'Smoke', ok: true, detail: 'test' }],
      saveConfig: () => path.join(root, 'config.json'),
      summarizeValidation: () => [],
      tailFile: () => [],
      isElevated: () => true,
      ...(overrides.dependencies ?? {}),
    },
  });
  const staticRoot = path.join(root, 'web');
  fs.mkdirSync(staticRoot, { recursive: true });
  fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><title>Smoke</title>');
  const manualRoot = path.join(root, 'docs');
  const manualAssetsRoot = path.join(manualRoot, 'manual-assets');
  fs.mkdirSync(manualAssetsRoot, { recursive: true });
  fs.writeFileSync(path.join(manualRoot, 'winception-operations-manual.html'), '<!doctype html><title>Winception Manual</title>');
  fs.writeFileSync(path.join(manualAssetsRoot, 'flow.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  fs.writeFileSync(path.join(manualAssetsRoot, 'screen.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const server = new WebManagementServer({ controller, staticRoot, manualRoot });
  server.osCatalogCalls = osCatalogCalls;
  await server.start({ host: overrides.listenHost ?? '127.0.0.1', port: 0 });
  return server;
}

test('serves static UI and read-only state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-state-'));
  const server = await makeServer(root);
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    let response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Smoke/);

    response = await fetch(`${base}/api/state`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.state.app.version, appVersion);
    assert.equal(payload.state.fleet.total, 1);
    assert.equal(payload.state.osImage.activeImage.id, 'SMOKE-WIN11-PRO');
    assert.equal(payload.state.initialization.initialized, false);
    assert.equal(payload.state.initialization.nextStepId, 'secrets');
    const secretsStep = payload.state.initialization.steps.find((step) => step.id === 'secrets');
    assert.equal(secretsStep.done, false);
    assert.equal(secretsStep.action, 'secrets');
    assert.equal(secretsStep.detail, 'Missing: windowsUsername, windowsPassword, pxeinstallPassword');
    assert.equal(fs.existsSync(path.join(root, 'status')), false);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('API auth status reports loopback bypass without requiring a token', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-auth-loopback-'));
  const server = await makeServer(root);
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    let response = await fetch(`${base}/api/auth/status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, required: false, hostMode: 'loopback' });

    response = await fetch(`${base}/api/state`);
    assert.equal(response.status, 200);
    assert.equal(fs.existsSync(path.join(root, 'config', 'web-console-token.json')), false);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('API auth gate protects non-loopback listeners while static and manual stay readable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-auth-token-'));
  const server = await makeServer(root, { listenHost: '0.0.0.0' });
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    let response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Smoke/);

    response = await fetch(`${base}/manual/`);
    assert.equal(response.status, 200);

    response = await fetch(`${base}/api/auth/status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, required: true, hostMode: 'non-loopback' });

    response = await fetch(`${base}/api/state`);
    assert.equal(response.status, 401);
    let payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.required, true);
    assert.equal(JSON.stringify(payload).includes('token'), true);
    assert.equal(JSON.stringify(payload).includes('web-console-token.json'), false);

    const tokenPath = path.join(root, 'config', 'web-console-token.json');
    const saved = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    assert.match(saved.token, /^[A-Za-z0-9_-]{32,}$/);

    response = await fetch(`${base}/api/state`, {
      headers: { 'x-winception-token': saved.token },
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.state.app.version, appVersion);
    assert.equal(JSON.stringify(payload).includes(saved.token), false);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('serves only the packaged manual and its assets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-manual-'));
  const server = await makeServer(root);
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    let response = await fetch(`${base}/manual/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/u);
    assert.match(await response.text(), /Winception Manual/);

    response = await fetch(`${base}/manual/`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');

    response = await fetch(`${base}/manual/manual-assets/flow.svg`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml');

    response = await fetch(`${base}/manual/manual-assets/screen.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');

    response = await fetch(`${base}/manual/manual-assets/missing.png`);
    assert.equal(response.status, 404);

    response = await fetch(`${base}/manual/manual-assets/%2e%2e%2fwinception-operations-manual.html`);
    assert.equal(response.status, 403);

    response = await fetch(`${base}/manual/`, { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');

    response = await fetch(`${base}/manual/not-exposed.html`);
    assert.equal(response.status, 404);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('diagnostics API returns the latest summary and serves the ZIP bundle', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-diagnostics-'));
  const zipPath = path.join(root, 'diag.zip');
  fs.writeFileSync(zipPath, 'zip-bundle', 'utf8');
  let latestDiagnostics = null;
  const server = await makeServer(root, {
    dependencies: {
      runDiagnostics: async (_config, input) => {
        latestDiagnostics = {
          generatedAt: '2026-07-08T00:00:00.000Z',
          trigger: input.trigger,
          scope: input.scope,
          overallStatus: 'fail',
          headline: 'Manual host diagnostics',
          probableCause: 'Catalog probe failed.',
          recommendedAction: 'Repair OSD modules.',
          bundleName: 'diag.zip',
        };
        return {
          summary: latestDiagnostics,
          bundleName: 'diag.zip',
          bundlePath: zipPath,
        };
      },
      readLatestDiagnostics: () => latestDiagnostics,
      resolveDiagnosticsBundlePath: (_config, bundleName) => bundleName === 'diag.zip' ? zipPath : null,
    },
  });
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    let response = await fetch(`${base}/api/diagnostics/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'host', trigger: 'manual-ui' }),
    });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.result.bundleName, 'diag.zip');
    assert.equal(payload.result.bundlePath, zipPath);
    assert.equal(payload.state.diagnostics.bundleName, 'diag.zip');
    assert.equal(payload.state.diagnostics.trigger, 'manual-ui');

    response = await fetch(`${base}/api/diagnostics/latest`);
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.bundleName, 'diag.zip');
    assert.equal(payload.result.overallStatus, 'fail');

    response = await fetch(`${base}/api/diagnostics/download?name=diag.zip`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'zip-bundle');

    response = await fetch(`${base}/api/diagnostics/download?name=missing.zip`);
    assert.equal(response.status, 404);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('torrent release API supports one waiting run and all waiting runs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-torrent-release-'));
  const server = await makeServer(root);
  try {
    const coordinator = server.controller.torrentCoordinator;
    coordinator.configureTorrent({ infoHash: 'a'.repeat(40), totalPieces: 4, wimBytes: 1024 });
    coordinator.receiveTelemetry({ runId: 'run-a', clientId: 'a', phase: 'waiting' }, '10.0.0.1');
    coordinator.receiveTelemetry({ runId: 'run-b', clientId: 'b', phase: 'waiting' }, '10.0.0.2');
    const base = `http://127.0.0.1:${server.address.port}`;
    let response = await fetch(`${base}/api/torrent/release`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: 'run-a' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result.released, ['run-a']);
    response = await fetch(`${base}/api/torrent/release`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allWaiting: true }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result.released.sort(), ['run-a', 'run-b']);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('secrets API writes local secrets and never returns plaintext passwords', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-secrets-'));
  const server = await makeServer(root);
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    const response = await fetch(`${base}/api/secrets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        windowsUsername: 'custom-admin',
        windowsPassword: 'local-windows-secret',
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const serialized = JSON.stringify(payload);
    assert.equal(payload.ok, true);
    assert.equal(payload.result.ready, true);
    assert.equal(payload.result.status.windowsUsername.present, true);
    assert.equal(payload.result.status.windowsPassword.present, true);
    assert.equal(payload.result.status.pxeinstallPassword.present, true);
    // The account name is not a secret and is intentionally returned for pre-fill on edit.
    assert.equal(payload.result.windowsUsername, 'custom-admin');
    // Passwords must never be echoed back to the client.
    assert.doesNotMatch(serialized, /local-windows-secret/);

    const secretPath = path.join(root, 'config', 'osdcloud-secrets.json');
    const bytes = fs.readFileSync(secretPath);
    assert.notEqual(bytes[0], 0xef);
    const saved = JSON.parse(bytes.toString('utf8'));
    assert.equal(saved.windowsUsername, 'custom-admin');
    assert.equal(saved.windowsPassword, 'local-windows-secret');
    assert.match(saved.pxeinstallPassword, /^[a-zA-Z0-9]{24}$/);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('secrets API rejects reserved Windows account names', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-secrets-reserved-'));
  const server = await makeServer(root);
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    const response = await fetch(`${base}/api/secrets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        windowsUsername: 'Administrator',
        windowsPassword: 'local-windows-secret',
      }),
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(JSON.stringify(payload), /reserved Windows account name/);
    assert.equal(fs.existsSync(path.join(root, 'config', 'osdcloud-secrets.json')), false);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('state initialization becomes true only when live prerequisites are present', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-init-ready-'));
  const localConfigPath = path.join(root, 'config', 'osdcloud-console.local.json');
  fs.mkdirSync(path.dirname(localConfigPath), { recursive: true });
  fs.writeFileSync(localConfigPath, JSON.stringify({
    adapter: { interfaceAlias: 'LAN', serverIp: '127.0.0.1', prefixLength: 24 },
    http: { host: '127.0.0.1' },
    tftp: { listenIp: '127.0.0.1' },
    dhcp: { ipxeBootUrl: 'http://127.0.0.1/osdcloud/boot.ipxe' },
    smb: { share: '\\\\127.0.0.1\\OSDCloudiPXE' },
  }, null, 2), 'utf8');
  const server = await makeServer(root, {
    dependencies: {
      getRuntimeReadiness: () => ({
        ready: true,
        requiredCount: 1,
        readyCount: 1,
        missingCount: 0,
        missing: [],
        artifacts: [{ id: 'boot-wim', exists: true }],
      }),
      getDeploymentSecretsStatus: () => ({
        ready: true,
        missing: [],
        status: {
          windowsUsername: { present: true, source: 'file' },
          windowsPassword: { present: true, source: 'file' },
          pxeinstallPassword: { present: true, source: 'file' },
        },
      }),
      evaluateDeploymentProfilePayload: () => ({ name: 'Deployment profile', ok: true, detail: 'default published' }),
      resolveOsImageState: () => ({
        activeImageId: 'SMOKE-WIN11-PRO',
        activeImage: {
          id: 'SMOKE-WIN11-PRO',
          name: 'Smoke Windows 11 Pro',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 1,
          fileName: 'install.wim',
          cached: true,
          bytes: 12,
        },
        images: [{
          id: 'SMOKE-WIN11-PRO',
          name: 'Smoke Windows 11 Pro',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 1,
          fileName: 'install.wim',
          cached: true,
          bytes: 12,
        }],
        cachedFiles: [],
        selectedOs: { id: 'SMOKE-WIN11-PRO', fileName: 'install.wim', imageIndex: 1 },
        catalogPath: path.join(root, 'os-image-catalog.json'),
        cacheRoot: path.join(root, 'OS'),
        downloadStagingRoot: path.join(root, 'OS', '.downloads'),
        selectedOsPath: path.join(root, 'OS', 'selected-os.json'),
        cacheLogPath: path.join(root, 'OS', 'os-image-cache.jsonl'),
      }),
    },
  });
  server.controller.config.__localConfigPath = localConfigPath;
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    const response = await fetch(`${base}/api/state`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.state.initialization.initialized, true);
    assert.equal(payload.state.initialization.nextStepId, 'preflight');
    const secretsStep = payload.state.initialization.steps.find((step) => step.id === 'secrets');
    assert.equal(secretsStep.done, true);
    assert.equal(secretsStep.detail, 'windowsUsername, windowsPassword and pxeinstallPassword are present.');
    assert.deepEqual(
      payload.state.initialization.steps.filter((step) => step.required).map((step) => [step.id, step.done]),
      [
        ['project-root', true],
        ['web', true],
        ['secrets', true],
        ['runtime', true],
        ['endpoint', true],
        ['os-image', true],
        ['profile', true],
      ],
    );
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runs mutating API actions through the controller', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-actions-'));
  const server = await makeServer(root);
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    let response = await fetch(`${base}/api/services/http/start`, { method: 'POST' });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.state.services.http.running, true);

    response = await fetch(`${base}/api/preflight`, { method: 'POST' });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.deepEqual(payload.result, [{ name: 'Smoke', ok: true, detail: 'test' }]);

    let prepareCalled = false;
    server.controller.dependencies.prepareRuntimeArtifacts = async () => {
      prepareCalled = true;
      return 'runtime prepared';
    };
    server.controller.dependencies.getRuntimeReadiness = () => ({
      ready: true,
      requiredCount: 1,
      readyCount: 1,
      missingCount: 0,
      missing: [],
      artifacts: [{ id: 'boot-wim', exists: true }],
    });
    response = await fetch(`${base}/api/runtime/prepare`, { method: 'POST' });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(prepareCalled, true);
    assert.match(payload.result.output, /runtime prepared/);
    assert.equal(payload.result.readiness.ready, true);
    assert.equal(payload.state.runtime.ready, true);
    assert.equal(payload.state.services.tftp.running, false);
    assert.equal(payload.state.services.dhcp.running, false);

    response = await fetch(`${base}/api/interfaces`);
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.interfaces[0].interfaceAlias, 'LAN');

    response = await fetch(`${base}/api/profiles/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Field', description: 'Field laptops' }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.profile.id, 'AAAAAAA0');
    assert.equal(payload.result.profile.name, 'Field');
    assert.equal(payload.result.profile.description, 'Field laptops');

    response = await fetch(`${base}/api/profile/software`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Renamed Default',
        description: 'Chrome build',
        softwareIds: ['chrome', '7zip'],
        execution: { defaultTimeoutSeconds: 1200 },
        displayLanguage: 'en-US',
        locale: 'en-US',
        inputLanguage: 'en-US',
        timeZone: 'Taipei Standard Time',
        installSequence: [
          { type: 'script', id: 'SC-TEST001' },
          { type: 'software', id: 'chrome', timeoutSeconds: 45 },
          { type: 'software', id: '7zip' },
        ],
      }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.profile.name, 'Renamed Default');
    assert.equal(payload.result.profile.description, 'Chrome build');
    assert.equal(payload.result.profile.displayLanguage, 'en-US');
    assert.equal(payload.result.profile.locale, 'en-US');
    assert.equal(payload.result.profile.inputLanguage, 'en-US');
    assert.equal(payload.result.profile.timeZone, 'Taipei Standard Time');
    assert.deepEqual(payload.result.profile.softwareIds, ['chrome', '7zip']);
    assert.deepEqual(payload.result.profile.installSequence, [
      { type: 'script', id: 'SC-TEST001' },
      { type: 'software', id: 'chrome', timeoutSeconds: 45 },
      { type: 'software', id: '7zip' },
    ]);

    response = await fetch(`${base}/api/profile/software`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Legacy Default', softwareIds: [] }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.profile.name, 'Legacy Default');
    assert.deepEqual(payload.result.profile.softwareIds, []);

    response = await fetch(`${base}/api/profiles/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 'minimal' }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.profile.id, 'minimal');

    response = await fetch(`${base}/api/software-upload?fileName=tool.msi`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from('tool'),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.uploadId, 'SOFTWARE-UPLOAD');
    assert.equal(payload.result.bytes, 4);

    response = await fetch(`${base}/api/software-upload?fileName=..%2Fbad.exe`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from('bad'),
    });
    assert.equal(response.status, 400);
    payload = await response.json();
    assert.equal(payload.ok, false);

    response = await fetch(`${base}/api/software/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uploadId: 'SOFTWARE-UPLOAD',
        softwareId: 'tool-app',
        name: 'Tool App',
        scriptMode: 'template',
        installerType: 'msi',
      }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.software.id, 'tool-app');
    assert.equal(payload.result.uploadRemoved, true);

    response = await fetch(`${base}/api/software/script?softwareId=chrome`);
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.softwareId, 'chrome');
    assert.match(payload.result.content, /script/);

    response = await fetch(`${base}/api/scripts/content?scriptId=SC-TEST001`);
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.scriptId, 'SC-TEST001');
    assert.match(payload.result.content, /custom script/);

    response = await fetch(`${base}/api/scripts/content?scriptId=SC-NOPE001`);
    assert.equal(response.status, 404);
    payload = await response.json();
    assert.equal(payload.ok, false);

    response = await fetch(`${base}/api/software/script/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ softwareId: 'chrome' }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.softwareId, 'chrome');
    assert.equal(payload.result.opened, true);
    assert.equal(payload.result.method, 'open-with');
    assert.match(payload.result.filePath, /install\.ps1$/);

    response = await fetch(`${base}/api/software/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ softwareId: 'SW-TEST001' }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.software.id, 'SW-TEST001');

    response = await fetch(`${base}/api/software/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ softwareId: '7zip' }),
    });
    assert.equal(response.status, 409);
    payload = await response.json();
    assert.equal(payload.ok, false);
    assert.deepEqual(payload.profiles, [{ id: 'default', name: 'Default' }]);

    response = await fetch(`${base}/api/software/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    payload = await response.json();
    assert.equal(payload.ok, false);

    response = await fetch(`${base}/api/status/run/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1' }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.runId, 'run-1');
    assert.equal(payload.result.removed, 3);

    response = await fetch(`${base}/api/status/run/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    payload = await response.json();
    assert.equal(payload.ok, false);

    for (const [pathname, key] of [
      ['/api/status/runs/delete', 'removed'],
      ['/api/status/runs/archive', 'moved'],
      ['/api/status/runs/restore', 'moved'],
      ['/api/status/archive/delete', 'removed'],
    ]) {
      response = await fetch(`${base}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runIds: ['run-1', 'run-2'] }),
      });
      assert.equal(response.status, 200, pathname);
      payload = await response.json();
      assert.equal(payload.ok, true, pathname);
      assert.deepEqual(payload.result.results.map((item) => item.runId), ['run-1', 'run-2'], pathname);
      assert.ok(payload.result.results.every((item) => item.ok && Number.isFinite(item[key])), pathname);
    }

    response = await fetch(`${base}/api/os-images`);
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.osImage.activeImage.id, 'SMOKE-WIN11-PRO');

    response = await fetch(`${base}/api/os-download-catalog`);
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.catalog[0].id, 'SMOKE-DOWNLOAD-PRO');
    assert.deepEqual(server.osCatalogCalls.at(-1), {
      osFamily: [],
      edition: [],
      language: [],
      releaseId: [],
      activation: ['Retail'],
      sourceType: [],
    });

    response = await fetch(`${base}/api/os-download-catalog?osFamily=win11&edition=Pro&language=en-us,zh-tw&releaseId=25H2`);
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.catalog[0].osFamily, 'win11');
    assert.deepEqual(server.osCatalogCalls.at(-1), {
      osFamily: ['win11'],
      edition: ['Pro'],
      language: ['en-us', 'zh-tw'],
      releaseId: ['25H2'],
      activation: ['Retail'],
      sourceType: [],
    });

    response = await fetch(`${base}/api/os-download-catalog?activation=Retail&sourceType=official`);
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.catalog[0].id, 'SMOKE-DOWNLOAD-PRO');
    assert.deepEqual(server.osCatalogCalls.at(-1), {
      osFamily: [],
      edition: [],
      language: [],
      releaseId: [],
      activation: ['Retail'],
      sourceType: ['official'],
    });

    response = await fetch(`${base}/api/os-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageId: 'SMOKE-WIN11-PRO' }),
    });
    assert.equal(response.status, 404);

    response = await fetch(`${base}/api/os-download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catalogId: 'SMOKE-DOWNLOAD-PRO' }),
    });
    assert.equal(response.status, 202);
    payload = await response.json();
    assert.equal(payload.result.catalogId, 'SMOKE-DOWNLOAD-PRO');
    assert.equal(payload.result.running, true);
    assert.match(payload.result.jobId, /^os-download-/);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(server.controller.getState().osDownloadStatus.status, 'downloaded');

    response = await fetch(`${base}/api/os-image-delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageId: 'SMOKE-DOWNLOAD-PRO' }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.status, 'deleted');
    assert.equal(payload.result.image.id, 'SMOKE-DOWNLOAD-PRO');

    response = await fetch(`${base}/api/os-image-inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourcePath: path.join(root, 'import.wim') }),
    });
    assert.equal(response.status, 404);

    response = await fetch(`${base}/api/os-image-import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourcePath: path.join(root, 'import.wim'),
        imageIndex: 6,
        metadata: { id: 'IMPORTED-WIN11-PRO', fileName: 'imported.wim' },
      }),
    });
    assert.equal(response.status, 404);

    response = await fetch(`${base}/api/os-image-upload?fileName=upload.wim`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: 'uploaded bytes',
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.uploadId, 'UPLOAD-WIN11');
    assert.equal(payload.result.bytes, Buffer.byteLength('uploaded bytes'));
    assert.equal(payload.result.indexes[0].suggested.id, 'UPLOADED-WIN11-PRO');

    response = await fetch(`${base}/api/os-image-upload-import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uploadId: 'UPLOAD-WIN11',
        imageIndex: 6,
        metadata: { id: 'UPLOADED-WIN11-PRO', fileName: 'uploaded.wim' },
      }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.status, 'imported');
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('editing an inactive profile via /api/profile/software keeps services running and skips republish', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-inactive-edit-'));
  let publishCalled = false;
  const server = await makeServer(root, {
    dependencies: {
      publishDeploymentProfile: (_config, profileId) => {
        publishCalled = true;
        return {
          profile: { id: profileId, name: 'Default', description: '', softwareIds: [] },
          selectedSoftware: [],
          appsRoot: path.join(root, 'Apps'),
        };
      },
    },
  });
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    let response = await fetch(`${base}/api/services/http/start`, { method: 'POST' });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.state.services.http.running, true);

    response = await fetch(`${base}/api/profile/software`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profileId: 'minimal',
        name: 'Minimal Renamed',
        softwareIds: ['chrome'],
        execution: { defaultTimeoutSeconds: 600 },
        installSequence: [{ type: 'software', id: 'chrome', timeoutSeconds: 30 }],
      }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.profile.id, 'minimal');
    assert.equal(payload.result.profile.name, 'Minimal Renamed');
    assert.deepEqual(payload.result.profile.softwareIds, ['chrome']);
    assert.deepEqual(payload.result.profile.installSequence, [{ type: 'software', id: 'chrome', timeoutSeconds: 30 }]);
    assert.equal(payload.result.selectedSoftware, undefined);
    assert.equal(publishCalled, false);
    assert.equal(payload.state.services.http.running, true);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS image download API starts a background job and rejects concurrent downloads', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-download-job-'));
  let releaseDownload = null;
  const server = await makeServer(root, {
    dependencies: {
      downloadOsImageFromCatalog: async (_config, catalogId, options = {}) => {
        options.onProgress?.({
          status: 'downloading',
          bytes: 64,
          totalBytes: 128,
          fileName: 'download.esd',
        });
        await new Promise((resolve) => {
          releaseDownload = resolve;
        });
        return {
          status: 'downloaded',
          image: { id: catalogId, fileName: 'download.esd' },
          bytes: 128,
          filePath: path.join(root, 'OS', 'download.esd'),
        };
      },
    },
  });
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    let response = await fetch(`${base}/api/os-download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catalogId: 'SMOKE-DOWNLOAD-PRO' }),
    });
    assert.equal(response.status, 202);
    let payload = await response.json();
    assert.equal(payload.result.catalogId, 'SMOKE-DOWNLOAD-PRO');
    assert.equal(payload.result.running, true);

    response = await fetch(`${base}/api/os-download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catalogId: 'SECOND-DOWNLOAD' }),
    });
    assert.equal(response.status, 409);
    payload = await response.json();
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Operation already running/);

    assert.equal(server.controller.getState().osDownloadStatus.running, true);
    await Promise.resolve();
    releaseDownload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(server.controller.getState().osDownloadStatus.status, 'downloaded');
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('offline ISO API starts a background job, returns host paths, and rejects concurrent exports', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-offline-iso-job-'));
  let releaseExport = null;
  const server = await makeServer(root, {
    config: {
      runtimeArtifacts: { liveRoot: root },
    },
    dependencies: {
      getRuntimeReadiness: () => ({
        ready: true,
        requiredCount: 1,
        readyCount: 1,
        missingCount: 0,
        missing: [],
        artifacts: [{ id: 'boot-wim', exists: true }],
      }),
      resolveOsImageState: () => ({
        activeImageId: 'SMOKE-WIN11-PRO',
        activeImage: {
          id: 'SMOKE-WIN11-PRO',
          name: 'Smoke Windows 11 Pro',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 1,
          fileName: 'install.wim',
          cached: true,
          bytes: 12,
        },
        images: [{
          id: 'SMOKE-WIN11-PRO',
          name: 'Smoke Windows 11 Pro',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 1,
          fileName: 'install.wim',
          cached: true,
          bytes: 12,
        }],
        cachedFiles: [],
        selectedOs: { id: 'SMOKE-WIN11-PRO', fileName: 'install.wim', imageIndex: 1 },
        catalogPath: path.join(root, 'os-image-catalog.json'),
        cacheRoot: path.join(root, 'OS'),
        downloadStagingRoot: path.join(root, 'OS', '.downloads'),
        selectedOsPath: path.join(root, 'OS', 'selected-os.json'),
        cacheLogPath: path.join(root, 'OS', 'os-image-cache.jsonl'),
      }),
      createOfflineIso: async () => {
        await new Promise((resolve) => {
          releaseExport = resolve;
        });
        const outputDirectory = path.join(root, 'Exports');
        const outputPath = path.join(outputDirectory, 'Winception-USB-20260710-100000.iso');
        fs.mkdirSync(outputDirectory, { recursive: true });
        fs.writeFileSync(outputPath, 'iso image', 'utf8');
        return {
          outputPath,
          outputDirectory,
          fileName: path.basename(outputPath),
          bytes: Buffer.byteLength('iso image'),
        };
      },
    },
  });
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    let response = await fetch(`${base}/api/offline-iso/create`, { method: 'POST' });
    assert.equal(response.status, 202);
    let payload = await response.json();
    assert.equal(payload.result.running, true);
    assert.equal(payload.result.status, 'starting');
    assert.match(payload.result.jobId, /^offline-iso-/);
    assert.equal(payload.result.outputDirectory, path.join(root, 'Exports'));
    assert.equal(payload.state.offlineIsoStatus.running, true);

    response = await fetch(`${base}/api/offline-iso/create`, { method: 'POST' });
    assert.equal(response.status, 409);
    payload = await response.json();
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Operation already running/);

    await Promise.resolve();
    releaseExport();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(server.controller.getState().offlineIsoStatus.status, 'completed');
    assert.equal(server.controller.getState().offlineIsoStatus.outputPath, path.join(root, 'Exports', 'Winception-USB-20260710-100000.iso'));
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('offline ISO API rejects non-elevated sessions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-web-offline-iso-elevation-'));
  const server = await makeServer(root, {
    dependencies: {
      isElevated: () => false,
      getRuntimeReadiness: () => ({
        ready: true,
        requiredCount: 1,
        readyCount: 1,
        missingCount: 0,
        missing: [],
        artifacts: [{ id: 'boot-wim', exists: true }],
      }),
      resolveOsImageState: () => ({
        activeImageId: 'SMOKE-WIN11-PRO',
        activeImage: {
          id: 'SMOKE-WIN11-PRO',
          name: 'Smoke Windows 11 Pro',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 1,
          fileName: 'install.wim',
          cached: true,
          bytes: 12,
        },
        images: [],
        cachedFiles: [],
        selectedOs: { id: 'SMOKE-WIN11-PRO', fileName: 'install.wim', imageIndex: 1 },
      }),
    },
  });
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    const response = await fetch(`${base}/api/offline-iso/create`, { method: 'POST' });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.match(payload.error, /elevated Web console session/i);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
