import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ServiceController } from '../src/serviceController.js';

class FakeService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.runningValue = false;
    this.starts = 0;
    this.stops = 0;
  }

  get running() {
    return this.runningValue;
  }

  async start() {
    this.starts += 1;
    this.runningValue = true;
    this.emit('log', 'started');
  }

  async stop() {
    this.stops += 1;
    this.runningValue = false;
    this.emit('log', 'stopped');
  }

  refreshLeasePool() {
  }
}

function makeConfig(root) {
  return {
    adapter: { interfaceAlias: 'LAN', serverIp: '10.10.10.1', prefixLength: 24 },
    dhcp: {
      listenIp: '10.10.10.1',
      listenPort: 67,
      leaseStartIp: '10.10.10.200',
      leaseEndIp: '10.10.10.250',
      subnetMask: '255.255.255.0',
      router: '10.10.10.1',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://10.10.10.1/osdcloud/boot.ipxe',
      logPath: path.join(root, 'dhcp.log'),
    },
    tftp: {
      root: path.join(root, 'tftp'),
      listenIp: '10.10.10.1',
      port: 69,
      logPath: path.join(root, 'tftp.log'),
    },
    http: {
      root: path.join(root, 'http'),
      host: '10.10.10.1',
      port: 80,
      logPath: path.join(root, 'http.log'),
      statusRoot: path.join(root, 'status'),
    },
    paths: {
      repoRoot: root,
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      statusEvents: path.join(root, 'status', 'progress.jsonl'),
      statusLatest: path.join(root, 'status', 'latest.json'),
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\10.10.10.1\\OSDCloudiPXE',
      imagePath: path.join(root, 'install.esd'),
    },
    deploymentProfiles: { activeProfile: 'default' },
    web: { host: '127.0.0.1', port: 0 },
  };
}

function makeController(root, overrides = {}) {
  const config = makeConfig(root);
  const services = {
    dhcp: new FakeService(config.dhcp),
    tftp: new FakeService(config.tftp),
    http: new FakeService(config.http),
  };
  const dependencies = {
    readFleetStatus: () => ({ total: 0, counts: {}, runs: [] }),
    readRecentScreenshotMetadata: () => [],
    readRunLatestScreenshot: () => null,
    readStatusEvents: () => [],
    resolveDeploymentProfileState: () => ({
      activeProfile: { id: 'default', name: 'Default' },
      selectedSoftware: [{ id: '7zip', name: '7-Zip' }],
      profiles: [{ id: 'default', name: 'Default', description: '', softwareIds: ['7zip'] }],
    }),
    runPreflight: async () => [{ name: 'Smoke', ok: true, detail: 'test' }],
    saveConfig: () => path.join(root, 'config.json'),
    summarizeValidation: () => [{ name: 'Fleet runs', ok: false, detail: 'no deployment runs' }],
    syncIpxeEndpoint: async (_config, options) => {
      options.onOutput?.('sync ok\n', 'stdout');
      return 'ok';
    },
    tailFile: () => [],
    ...overrides.dependencies,
  };
  return {
    config,
    services,
    controller: new ServiceController({ config, services, dependencies }),
  };
}

test('state reads do not create live status roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-readonly-'));
  try {
    const { controller, config } = makeController(root);
    const statusRoot = config.http.statusRoot;
    assert.equal(fs.existsSync(statusRoot), false);
    const state = controller.getState();
    assert.equal(state.services.http.running, false);
    assert.equal(state.profile.activeProfile.id, 'default');
    assert.equal(fs.existsSync(statusRoot), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('service actions start and stop through the controller', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-service-'));
  try {
    const { controller, services } = makeController(root);
    await controller.startService('http');
    assert.equal(services.http.running, true);
    assert.equal(services.http.starts, 1);
    await controller.stopService('http');
    assert.equal(services.http.running, false);
    assert.equal(services.http.stops, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('endpoint changes stop services, save config, sync assets, and run preflight', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-endpoint-'));
  try {
    const { controller, config, services } = makeController(root, {
      dependencies: {
        applyServiceEndpoint(target, choice) {
          target.adapter.interfaceAlias = choice.interfaceAlias;
          target.adapter.serverIp = choice.ipAddress;
          target.adapter.prefixLength = choice.prefixLength;
          target.dhcp.listenIp = choice.ipAddress;
          target.dhcp.ipxeBootUrl = `http://${choice.ipAddress}/osdcloud/boot.ipxe`;
          target.tftp.listenIp = choice.ipAddress;
          target.http.host = choice.ipAddress;
        },
      },
    });
    await controller.startAll();
    const result = await controller.changeEndpoint({
      interfaceAlias: 'Lab',
      ipAddress: '10.20.30.1',
      prefixLength: 24,
    });

    assert.equal(config.adapter.interfaceAlias, 'Lab');
    assert.equal(config.http.host, '10.20.30.1');
    assert.equal(services.http.running, false);
    assert.equal(services.tftp.running, false);
    assert.equal(services.dhcp.running, false);
    assert.equal(result.preflight[0].ok, true);
    assert.match(controller.getLogs().join('\n'), /sync ok/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
