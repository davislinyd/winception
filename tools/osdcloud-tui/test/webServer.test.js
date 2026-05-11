import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ServiceController } from '../src/serviceController.js';
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

async function makeServer(root) {
  const config = makeConfig(root);
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
      readFleetStatus: () => ({ total: 1, counts: { running: 1 }, runs: [{ runId: 'run-1', status: 'running', latestStage: 'winpe-start' }] }),
      readRecentScreenshotMetadata: () => [],
      readRunLatestScreenshot: () => null,
      readStatusEvents: () => [],
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
      createDeploymentProfile: (_config, input) => ({
        profile: { id: input.id, name: input.name, description: '', softwareIds: [] },
        filePath: path.join(root, `${input.id}.json`),
      }),
      updateDeploymentProfile: (_config, profileId, input) => ({
        profile: { id: profileId, name: input.name ?? 'Default', description: '', softwareIds: input.softwareIds },
        filePath: path.join(root, `${profileId}.json`),
      }),
      publishDeploymentProfile: (_config, profileId) => ({
        profile: { id: profileId, name: 'Default', description: '', softwareIds: [] },
        selectedSoftware: [],
        appsRoot: path.join(root, 'Apps'),
      }),
      deleteDeploymentProfile: (_config, profileId) => ({
        profile: { id: profileId, name: 'Minimal', description: '', softwareIds: [] },
        filePath: path.join(root, `${profileId}.json`),
      }),
      runPreflight: async () => [{ name: 'Smoke', ok: true, detail: 'test' }],
      saveConfig: () => path.join(root, 'config.json'),
      summarizeValidation: () => [],
      tailFile: () => [],
    },
  });
  const staticRoot = path.join(root, 'web');
  fs.mkdirSync(staticRoot, { recursive: true });
  fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><title>Smoke</title>');
  const server = new WebManagementServer({ controller, staticRoot });
  await server.start({ host: '127.0.0.1', port: 0 });
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
    assert.equal(fs.existsSync(path.join(root, 'status')), false);
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

    response = await fetch(`${base}/api/interfaces`);
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.interfaces[0].interfaceAlias, 'LAN');

    response = await fetch(`${base}/api/profiles/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'field', name: 'Field' }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.profile.id, 'field');

    response = await fetch(`${base}/api/profile/software`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Default', softwareIds: ['chrome'] }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.profile.name, 'Renamed Default');
    assert.deepEqual(payload.result.profile.softwareIds, ['chrome']);

    response = await fetch(`${base}/api/profiles/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 'minimal' }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.result.profile.id, 'minimal');
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
