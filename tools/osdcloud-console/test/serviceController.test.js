import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ServiceController } from '../src/controller/index.js';
import { appVersion } from '../src/version.js';

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
    osImage: {
      activeImage: 'SMOKE-WIN11-PRO',
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
      catalog: {
        software: [
          { id: '7zip', name: '7-Zip' },
          { id: 'chrome', name: 'Chrome' },
        ],
      },
      activeProfile: { id: 'default', name: 'Default' },
      selectedSoftware: [{ id: '7zip', name: '7-Zip' }],
      profiles: [{ id: 'default', name: 'Default', description: '', softwareIds: ['7zip'] }],
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
      downloadSourcesPath: path.join(root, 'os-download-sources.json'),
      cacheRoot: path.join(root, 'OS'),
      downloadStagingRoot: path.join(root, 'OS', '.downloads'),
      selectedOsPath: path.join(root, 'OS', 'selected-os.json'),
      cacheLogPath: path.join(root, 'OS', 'os-image-cache.jsonl'),
    }),
    listOsDownloadCatalog: async () => [{
      id: 'SMOKE-DOWNLOAD-PRO',
      name: 'Smoke Download Pro',
      version: 'Windows 11 Smoke',
      language: 'en-us',
      edition: 'Pro',
      imageIndex: 6,
      fileName: 'download.esd',
    }],
    publishSelectedOsImage: async (_config, imageId) => ({
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
    downloadOsImageFromCatalog: async (_config, catalogId) => ({
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
    runPreflight: async () => [{ name: 'Smoke', ok: true, detail: 'test' }],
    isElevated: () => true,
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
    assert.equal(state.app.version, appVersion);
    assert.equal(state.services.http.running, false);
    assert.equal(state.profile.activeProfile.id, 'default');
    assert.deepEqual(state.profile.softwareCatalog.map((software) => software.id), ['7zip', 'chrome']);
    assert.deepEqual(state.profile.softwareCatalog.find((software) => software.id === '7zip').usedByProfiles, [{ id: 'default', name: 'Default' }]);
    assert.equal(fs.existsSync(statusRoot), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('state exposes the latest diagnostics summary when available', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-diag-state-'));
  try {
    const latest = {
      overallStatus: 'fail',
      headline: 'OS download catalog probe',
      probableCause: 'Invoke-WebRequest failed',
      generatedAt: '2026-07-08T00:00:00.000Z',
      bundleName: 'diag.zip',
    };
    const { controller } = makeController(root, {
      dependencies: {
        readLatestDiagnostics: () => latest,
      },
    });
    const state = controller.getState();
    assert.deepEqual(state.diagnostics, latest);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('catalog probe failure captures host diagnostics once per failing request', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-diag-catalog-'));
  try {
    const calls = [];
    const { controller } = makeController(root, {
      dependencies: {
        listOsDownloadCatalog: async () => {
          throw new Error('catalog offline');
        },
        runDiagnostics: async (_config, input) => {
          calls.push(input);
          return {
            summary: {
              generatedAt: '2026-07-08T00:00:00.000Z',
              overallStatus: 'fail',
              headline: 'OS download catalog probe',
            },
            bundleName: 'catalog-fail.zip',
            bundlePath: path.join(root, 'catalog-fail.zip'),
          };
        },
      },
    });

    await assert.rejects(() => controller.getOsDownloadCatalog(), /catalog offline/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].scope, 'host');
    assert.equal(calls[0].trigger, 'os-catalog-failure');
    assert.equal(controller.getState().diagnostics.bundleName, 'catalog-fail.zip');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('failed and stale runs auto-generate diagnostics only once per terminal status', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-diag-run-'));
  try {
    const calls = [];
    const { controller, services } = makeController(root, {
      dependencies: {
        runDiagnostics: async (_config, input) => {
          calls.push(input);
          return {
            summary: {
              generatedAt: '2026-07-08T00:00:00.000Z',
              overallStatus: 'fail',
              headline: 'Deployment run run-a',
            },
            bundleName: `diag-${calls.length}.zip`,
            bundlePath: path.join(root, `diag-${calls.length}.zip`),
          };
        },
      },
    });

    services.http.emit('status', { summary: { runId: 'run-a', status: 'failed' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    services.http.emit('status', { summary: { runId: 'run-a', status: 'failed' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    services.http.emit('status', { summary: { runId: 'run-a', status: 'stale' } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(calls.map((input) => [input.scope, input.runId, input.trigger]), [
      ['run', 'run-a', 'run-failed'],
      ['run', 'run-a', 'run-stale'],
    ]);
    assert.equal(controller.getState().diagnostics.bundleName, 'diag-2.zip');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('initialization state guides first deployment through preflight and service start', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-init-guide-'));
  try {
    const { controller } = makeController(root, {
      dependencies: {
        getDeploymentSecretsStatus: () => ({
          ready: true,
          missing: [],
          status: {
            windowsUsername: { present: true, source: 'file' },
            windowsPassword: { present: true, source: 'file' },
            pxeinstallPassword: { present: true, source: 'file' },
          },
          windowsUsername: 'LabAdmin',
        }),
        getRuntimeReadiness: () => ({
          ready: true,
          requiredCount: 1,
          readyCount: 1,
          missingCount: 0,
          missing: [],
          artifacts: [],
        }),
        evaluateDeploymentProfilePayload: () => ({
          name: 'Deployment profile',
          ok: true,
          detail: 'Active profile payload is published.',
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
          downloadSourcesPath: path.join(root, 'os-download-sources.json'),
          cacheRoot: path.join(root, 'OS'),
          downloadStagingRoot: path.join(root, 'OS', '.downloads'),
          selectedOsPath: path.join(root, 'OS', 'selected-os.json'),
          cacheLogPath: path.join(root, 'OS', 'os-image-cache.jsonl'),
        }),
        readFleetStatus: () => ({ total: 0, counts: {}, runs: [] }),
      },
    });
    const localConfigPath = path.join(root, 'osdcloud-console.local.json');
    fs.writeFileSync(localConfigPath, JSON.stringify({
      adapter: { interfaceAlias: 'LAN', serverIp: '10.10.10.1', prefixLength: 24 },
      dhcp: { ipxeBootUrl: 'http://10.10.10.1/osdcloud/boot.ipxe' },
      http: { host: '10.10.10.1' },
      tftp: { listenIp: '10.10.10.1' },
      smb: { share: '\\\\10.10.10.1\\OSDCloudiPXE' },
    }), 'utf8');
    controller.config.__localConfigPath = localConfigPath;

    let state = controller.getState();
    assert.equal(state.initialization.initialized, true);
    assert.equal(state.initialization.deploymentReady, false);
    assert.equal(state.initialization.deploymentLive, false);
    assert.equal(state.initialization.nextStepId, 'preflight');
    assert.match(
      state.initialization.steps.find((step) => step.id === 'services').safetyNote,
      /DHCP server/,
    );
    assert.match(
      state.initialization.steps.find((step) => step.id === 'client').doneWhen,
      /windows-desktop-ready/,
    );

    await controller.runPreflight();
    state = controller.getState();
    assert.equal(state.initialization.deploymentReady, true);
    assert.equal(state.initialization.nextStepId, 'services');

    await controller.startAll();
    state = controller.getState();
    assert.equal(state.initialization.deploymentLive, true);
    assert.equal(state.initialization.nextStepId, 'client');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preflight warnings do not block deployment readiness or the Start services step', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-pf-warn-'));
  try {
    const { controller } = makeController(root, {
      dependencies: {
        // A non-blocking warning (ok:true + warn) — e.g. the service IP is
        // configured and bindable but the LAN link is not up yet.
        runPreflight: async () => [
          { name: 'Administrator', ok: true, detail: 'running elevated' },
          { name: 'Service IP 192.168.88.1', ok: true, warn: true, detail: 'LAN link is not up; IP is bindable.' },
        ],
      },
    });

    await controller.runPreflight();
    const state = controller.getState();
    assert.equal(state.initialization.deploymentReady, true);
    const preflightStep = state.initialization.steps.find((step) => step.id === 'preflight');
    assert.equal(preflightStep.done, true);
    assert.equal(preflightStep.ran, true);
    assert.match(preflightStep.detail, /warning/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('state includes selected run events from per-run history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-selected-events-'));
  try {
    let selectedEventReads = 0;
    const { controller } = makeController(root, {
      dependencies: {
        readFleetStatus: () => ({
          total: 2,
          counts: { completed: 2 },
          runs: [
            { runId: 'new-run', clientId: 'client-a', status: 'completed' },
            { runId: 'old-run', clientId: 'client-a', status: 'completed' },
          ],
        }),
        readStatusEvents: () => [
          { runId: 'new-run', stage: 'windows-desktop-ready', explorerRunning: true },
        ],
        readRunStatusEvents: (_config, runId) => {
          selectedEventReads += 1;
          return runId === 'old-run'
            ? [
                { runId: 'old-run', stage: 'smb-mounted', imagePath: 'Z:\\OSDCloud\\OS\\install.esd', osImageIndex: 6 },
                { runId: 'old-run', stage: 'windows-desktop-ready', desktopReadyFile: true },
              ]
            : [];
        },
      },
    });

    const defaultState = controller.getState({ selectedRunId: 'old-run' });
    assert.equal(defaultState.selectedRunEvents.length, 0);
    assert.equal(selectedEventReads, 0);

    const state = controller.getState({ selectedRunId: 'old-run', includeEvidence: true });

    assert.equal(state.selectedRunId, 'old-run');
    assert.equal(state.statusEvents.length, 1);
    assert.equal(state.statusEvents[0].runId, 'new-run');
    assert.equal(state.selectedRunEvents.length, 2);
    assert.equal(state.selectedRunEvents[0].imagePath, 'Z:\\OSDCloud\\OS\\install.esd');
    assert.equal(state.selectedRunEvents[1].desktopReadyFile, true);
    assert.equal(selectedEventReads, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('delete status run clears selected run and returns updated fleet', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-run-delete-'));
  try {
    let deletedRunId = null;
    let includeDeleted = true;
    const { controller } = makeController(root, {
      dependencies: {
        readFleetStatus: () => ({
          total: includeDeleted ? 2 : 1,
          counts: { completed: includeDeleted ? 2 : 1 },
          runs: [
            ...(includeDeleted ? [{ runId: 'run-a', clientId: 'client-a', status: 'completed' }] : []),
            { runId: 'run-b', clientId: 'client-a', status: 'completed' },
          ],
        }),
        deleteStatusRun: (_config, runId) => {
          deletedRunId = runId;
          includeDeleted = false;
          return { runId, removed: 4 };
        },
      },
    });

    controller.getState({ selectedRunId: 'run-a' });
    const result = await controller.deleteStatusRun('run-a');
    const state = controller.getState();

    assert.equal(result.runId, 'run-a');
    assert.equal(deletedRunId, 'run-a');
    assert.equal(state.selectedRunId, 'run-b');
    assert.deepEqual(state.fleet.runs.map((run) => run.runId), ['run-b']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deployment profile management actions create, update active software, and delete inactive profiles', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-profiles-'));
  try {
    let createdInput = null;
    let updatedInput = null;
    let updatedSoftwareIds = [];
    let updatedName = null;
    let updatedDescription = null;
    let deletedProfileId = null;
    const { controller, services } = makeController(root, {
      dependencies: {
        createDeploymentProfile(_config, input) {
          createdInput = input;
          return {
            profile: { id: 'AAAAAAA0', name: input.name, description: '', softwareIds: ['7zip'] },
            filePath: path.join(root, 'AAAAAAA0.json'),
          };
        },
        updateDeploymentProfile(_config, profileId, input) {
          updatedInput = input;
          updatedName = input.name;
          updatedDescription = input.description;
          if (input.softwareIds !== undefined) {
            updatedSoftwareIds = input.softwareIds;
          }
          return {
            profile: {
              id: profileId,
              name: input.name ?? 'Default',
              description: input.description ?? '',
              softwareIds: updatedSoftwareIds,
            },
            filePath: path.join(root, `${profileId}.json`),
          };
        },
        publishDeploymentProfile(_config, profileId) {
          return {
            profile: { id: profileId, name: 'Default', description: '', softwareIds: updatedSoftwareIds },
            selectedSoftware: updatedSoftwareIds.map((id) => ({ id, name: id })),
            appsRoot: path.join(root, 'Apps'),
            softwarePayloads: updatedSoftwareIds.map((id) => ({ id, status: id === 'chrome' ? 'downloaded' : 'reused' })),
          };
        },
        deleteDeploymentProfile(_config, profileId) {
          deletedProfileId = profileId;
          return {
            profile: { id: profileId, name: 'Other', description: '', softwareIds: [] },
            filePath: path.join(root, `${profileId}.json`),
          };
        },
      },
    });

    const created = await controller.addDeploymentProfile({ name: 'Field', description: 'Field laptops' });
    assert.deepEqual(createdInput, { name: 'Field', description: 'Field laptops' });
    assert.equal(created.profile.id, 'AAAAAAA0');

    await controller.startAll();
    const updated = await controller.updateActiveDeploymentProfile({
      name: 'Renamed',
      description: 'Updated active profile',
      softwareIds: ['chrome', '7zip'],
      execution: { defaultTimeoutSeconds: 1200 },
      installSequence: [
        { type: 'software', id: 'chrome', timeoutSeconds: 45 },
        { type: 'script', id: 'SC-TEST001' },
        { type: 'software', id: '7zip' },
      ],
    });
    assert.equal(updatedName, 'Renamed');
    assert.equal(updatedDescription, 'Updated active profile');
    assert.deepEqual(updatedSoftwareIds, ['chrome', '7zip']);
    assert.deepEqual(updatedInput.execution, { defaultTimeoutSeconds: 1200 });
    assert.deepEqual(updatedInput.installSequence, [
      { type: 'software', id: 'chrome', timeoutSeconds: 45 },
      { type: 'script', id: 'SC-TEST001' },
      { type: 'software', id: '7zip' },
    ]);
    assert.equal(updated.profile.id, 'default');
    assert.equal(updated.profile.name, 'Renamed');
    assert.equal(updated.profile.description, 'Updated active profile');
    assert.equal(updated.preflight[0].ok, true);
    assert.match(controller.getLogs().join('\n'), /Software payload downloaded: chrome/);
    assert.match(controller.getLogs().join('\n'), /Software payload reused: 7zip/);
    assert.equal(services.http.running, false);
    assert.equal(services.tftp.running, false);
    assert.equal(services.dhcp.running, false);

    const renamedOnly = await controller.updateActiveDeploymentProfile({ name: 'Display Name Only' });
    assert.equal(updatedName, 'Display Name Only');
    assert.deepEqual(updatedSoftwareIds, ['chrome', '7zip']);
    assert.deepEqual(renamedOnly.profile.softwareIds, ['chrome', '7zip']);

    const deleted = await controller.removeDeploymentProfile('minimal');
    assert.equal(deletedProfileId, 'minimal');
    assert.equal(deleted.profile.id, 'minimal');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('editing an inactive deployment profile only rewrites JSON and leaves services and Apps payload alone', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-inactive-edit-'));
  try {
    let updatedProfileId = null;
    let updatedInput = null;
    let publishCalled = false;
    let preflightCalled = false;
    const { controller, services } = makeController(root, {
      dependencies: {
        resolveDeploymentProfileState: () => ({
          catalog: { software: [{ id: '7zip', name: '7-Zip' }, { id: 'chrome', name: 'Chrome' }] },
          activeProfile: { id: 'default', name: 'Default' },
          selectedSoftware: [{ id: '7zip', name: '7-Zip' }],
          profiles: [
            { id: 'default', name: 'Default', description: '', softwareIds: ['7zip'] },
            { id: 'minimal', name: 'Minimal', description: '', softwareIds: [] },
          ],
        }),
        updateDeploymentProfile(_config, profileId, input) {
          updatedProfileId = profileId;
          updatedInput = input;
          return {
            profile: {
              id: profileId,
              name: input.name ?? 'Minimal',
              description: input.description ?? '',
              softwareIds: input.softwareIds ?? [],
              osImageId: input.osImageId ?? 'SMOKE-WIN11-PRO',
            },
            filePath: path.join(root, `${profileId}.json`),
          };
        },
        publishDeploymentProfile() {
          publishCalled = true;
          return { profile: {}, selectedSoftware: [], appsRoot: '' };
        },
        runPreflight: async () => {
          preflightCalled = true;
          return [];
        },
      },
    });

    await controller.startAll();
    assert.equal(services.http.running, true);
    assert.equal(services.tftp.running, true);
    assert.equal(services.dhcp.running, true);

    const result = await controller.updateActiveDeploymentProfile({
      profileId: 'minimal',
      name: 'Minimal Renamed',
      softwareIds: ['chrome'],
      execution: { defaultTimeoutSeconds: 600 },
      installSequence: [{ type: 'software', id: 'chrome', timeoutSeconds: 30 }],
    });

    assert.equal(updatedProfileId, 'minimal');
    assert.equal(updatedInput.name, 'Minimal Renamed');
    assert.deepEqual(updatedInput.softwareIds, ['chrome']);
    assert.deepEqual(updatedInput.execution, { defaultTimeoutSeconds: 600 });
    assert.deepEqual(updatedInput.installSequence, [{ type: 'software', id: 'chrome', timeoutSeconds: 30 }]);
    assert.equal(publishCalled, false);
    assert.equal(preflightCalled, false);
    assert.equal(services.http.running, true);
    assert.equal(services.tftp.running, true);
    assert.equal(services.dhcp.running, true);
    assert.equal(result.profile.id, 'minimal');
    assert.equal(result.profile.name, 'Minimal Renamed');
    assert.equal(result.selectedSoftware, undefined);
    assert.equal(result.preflight, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software package actions upload and add catalog entry without publishing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-software-'));
  try {
    let uploadedInput = null;
    let createInput = null;
    let publishCalled = false;
    const { controller, services } = makeController(root, {
      dependencies: {
        uploadSoftwareInstaller: async (_config, input) => {
          uploadedInput = input;
          return {
            uploadId: 'upload-tool',
            fileName: input.fileName,
            bytes: 8,
            sha256: 'A'.repeat(64),
          };
        },
        createSoftwarePackage: async (_config, input) => {
          createInput = input;
          return {
            software: {
              id: input.softwareId,
              name: input.name,
              installerFileName: 'tool.msi',
            },
            bytes: 8,
            sha256: 'B'.repeat(64),
          };
        },
        publishDeploymentProfile() {
          publishCalled = true;
          return {
            profile: { id: 'default', name: 'Default', description: '', softwareIds: ['7zip'] },
            selectedSoftware: [{ id: '7zip', name: '7-Zip' }],
            appsRoot: path.join(root, 'Apps'),
          };
        },
      },
    });

    await controller.startAll();
    const uploaded = await controller.uploadSoftwareInstaller({
      fileName: 'tool.msi',
      size: 8,
      buffer: Buffer.from('tool msi'),
    });
    const created = await controller.addSoftwarePackage({
      uploadId: uploaded.uploadId,
      softwareId: 'tool-app',
      name: 'Tool App',
      scriptMode: 'template',
    });

    assert.equal(uploadedInput.fileName, 'tool.msi');
    assert.equal(createInput.softwareId, 'tool-app');
    assert.equal(created.software.id, 'tool-app');
    assert.equal(publishCalled, false);
    assert.equal(services.http.running, true);
    assert.equal(services.tftp.running, true);
    assert.equal(services.dhcp.running, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software package delete runs through controller without publishing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-software-delete-'));
  try {
    let deletedSoftwareId = null;
    let publishCalled = false;
    const { controller, services } = makeController(root, {
      dependencies: {
        deleteSoftwarePackage: (_config, softwareId) => {
          deletedSoftwareId = softwareId;
          return {
            software: { id: softwareId, name: 'Tool App', source: softwareId },
            catalogPath: path.join(root, 'software-catalog.json'),
            sourceRemoved: true,
            usedByProfiles: [],
          };
        },
        publishDeploymentProfile() {
          publishCalled = true;
          return {
            profile: { id: 'default', name: 'Default', description: '', softwareIds: ['7zip'] },
            selectedSoftware: [{ id: '7zip', name: '7-Zip' }],
            appsRoot: path.join(root, 'Apps'),
          };
        },
      },
    });

    await controller.startAll();
    const deleted = await controller.removeSoftwarePackage('SW-TOOL001');

    assert.equal(deletedSoftwareId, 'SW-TOOL001');
    assert.equal(deleted.software.id, 'SW-TOOL001');
    assert.equal(publishCalled, false);
    assert.equal(services.http.running, true);
    assert.equal(services.tftp.running, true);
    assert.equal(services.dhcp.running, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software install script read and open run through controller', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-software-script-'));
  try {
    let readSoftwareId = null;
    let openSoftwareId = null;
    const { controller } = makeController(root, {
      dependencies: {
        readSoftwareInstallScript: (_config, softwareId) => {
          readSoftwareId = softwareId;
          return {
            softwareId,
            filePath: path.join(root, 'Softwares', softwareId, 'install.ps1'),
            content: "Write-Host 'script'\n",
          };
        },
        openSoftwareInstallScript: (_config, softwareId) => {
          openSoftwareId = softwareId;
          return {
            softwareId,
            filePath: path.join(root, 'Softwares', softwareId, 'install.ps1'),
            opened: true,
            method: 'open-with',
          };
        },
      },
    });

    const read = controller.readSoftwareInstallScript('chrome');
    const opened = await controller.openSoftwareInstallScript('chrome');

    assert.equal(readSoftwareId, 'chrome');
    assert.equal(read.content, "Write-Host 'script'\n");
    assert.equal(openSoftwareId, 'chrome');
    assert.equal(opened.softwareId, 'chrome');
    assert.equal(opened.opened, true);
    assert.equal(opened.method, 'open-with');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS image download runs through host catalog without an explicit publish action', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-osimage-'));
  try {
    let downloadedCatalogId = null;
    const { controller } = makeController(root, {
      dependencies: {
        downloadOsImageFromCatalog: async (_config, catalogId) => {
          downloadedCatalogId = catalogId;
          return {
            status: 'downloaded',
            image: { id: catalogId, fileName: 'download.esd' },
            bytes: 42,
            filePath: path.join(root, 'OS', 'download.esd'),
          };
        },
      },
    });

    await controller.startAll();
    assert.equal(typeof controller.changeOsImage, 'undefined');

    const catalog = await controller.getOsDownloadCatalog();
    assert.equal(catalog[0].id, 'SMOKE-DOWNLOAD-PRO');

    const downloaded = await controller.downloadOsImage('SMOKE-DOWNLOAD-PRO');
    assert.equal(downloadedCatalogId, 'SMOKE-DOWNLOAD-PRO');
    assert.equal(downloaded.status, 'downloaded');
    assert.equal(controller.getState().osDownloadStatus.status, 'downloaded');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS image download runs as a recoverable background job', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-osdownload-job-'));
  try {
    let releaseDownload = null;
    let downloadedCatalogId = null;
    const { controller } = makeController(root, {
      dependencies: {
        downloadOsImageFromCatalog: async (_config, catalogId, options = {}) => {
          downloadedCatalogId = catalogId;
          options.onProgress?.({
            status: 'downloading',
            phase: 'downloading-source',
            message: 'Downloading source image...',
            bytes: 12,
            totalBytes: 100,
            fileName: 'download.esd',
          });
          await new Promise((resolve) => {
            releaseDownload = resolve;
          });
          return {
            status: 'downloaded',
            image: { id: catalogId, fileName: 'download.esd' },
            bytes: 100,
            filePath: path.join(root, 'OS', 'download.esd'),
          };
        },
      },
    });

    const job = controller.startOsDownload('SMOKE-DOWNLOAD-PRO');
    assert.equal(job.catalogId, 'SMOKE-DOWNLOAD-PRO');
    assert.equal(job.running, true);
    assert.match(job.jobId, /^os-download-/);

    await Promise.resolve();
    let downloadStatus = controller.getState().osDownloadStatus;
    assert.equal(downloadedCatalogId, 'SMOKE-DOWNLOAD-PRO');
    assert.equal(downloadStatus.status, 'downloading');
    assert.equal(downloadStatus.phase, 'downloading-source');
    assert.equal(downloadStatus.message, 'Downloading source image...');
    assert.equal(downloadStatus.bytes, 12);
    assert.equal(downloadStatus.totalBytes, 100);
    assert.equal(downloadStatus.running, true);
    assert.throws(
      () => controller.startOsDownload('SECOND-DOWNLOAD'),
      /Operation already running/,
    );

    releaseDownload();
    const downloaded = await job.promise;
    assert.equal(downloaded.status, 'downloaded');
    downloadStatus = controller.getState().osDownloadStatus;
    assert.equal(downloadStatus.status, 'downloaded');
    assert.equal(downloadStatus.phase, 'downloaded');
    assert.equal(downloadStatus.message, 'Cached download.esd.');
    assert.equal(downloadStatus.running, false);
    assert.equal(downloadStatus.imageId, 'SMOKE-DOWNLOAD-PRO');
    assert.equal(downloadStatus.fileName, 'download.esd');
    assert.equal(downloadStatus.bytes, 100);
    assert.equal(downloadStatus.error, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS image background download failure records state without changing active image', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-osdownload-fail-'));
  try {
    const { controller } = makeController(root, {
      dependencies: {
        downloadOsImageFromCatalog: async () => {
          controller.osDownloadStatus = {
            ...controller.osDownloadStatus,
            status: 'downloading',
            phase: 'exporting-wim',
            message: 'Exporting deployable WIM with DISM. This can take several minutes.',
          };
          throw new Error('download exploded');
        },
      },
    });
    const before = controller.getState().osImage.activeImage?.id;

    const job = controller.startOsDownload('BROKEN-DOWNLOAD');
    await assert.rejects(job.promise, /download exploded/);

    const downloadStatus = controller.getState().osDownloadStatus;
    assert.equal(downloadStatus.status, 'failed');
    assert.equal(downloadStatus.phase, 'exporting-wim');
    assert.equal(downloadStatus.message, 'Exporting deployable WIM with DISM. This can take several minutes.');
    assert.equal(downloadStatus.running, false);
    assert.equal(downloadStatus.error, 'download exploded');
    assert.equal(controller.getState().osImage.activeImage?.id, before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS image delete runs through controller and waits for active download to finish', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-osdelete-'));
  try {
    let deletedImageId = null;
    let releaseDownload = null;
    const { controller } = makeController(root, {
      dependencies: {
        deleteCachedOsImage: (_config, imageId) => {
          deletedImageId = imageId;
          return {
            status: 'deleted',
            image: { id: imageId, fileName: 'download.esd' },
            fileDeleted: true,
            filePath: path.join(root, 'OS', 'download.esd'),
            catalogPath: path.join(root, 'os-image-catalog.json'),
            bytes: 10,
          };
        },
        downloadOsImageFromCatalog: async () => {
          await new Promise((resolve) => {
            releaseDownload = resolve;
          });
          return {
            status: 'downloaded',
            image: { id: 'SMOKE-DOWNLOAD-PRO', fileName: 'download.esd' },
            bytes: 10,
            filePath: path.join(root, 'OS', 'download.esd'),
          };
        },
      },
    });

    const job = controller.startOsDownload('SMOKE-DOWNLOAD-PRO');
    assert.equal(controller.getState().osDownloadStatus.running, true);
    await assert.rejects(
      () => controller.deleteOsImage('SMOKE-DOWNLOAD-PRO'),
      /Operation already running/,
    );
    releaseDownload();
    await job.promise;

    const deleted = await controller.deleteOsImage('SMOKE-DOWNLOAD-PRO');
    assert.equal(deleted.status, 'deleted');
    assert.equal(deletedImageId, 'SMOKE-DOWNLOAD-PRO');
    assert.equal(controller.getState().osDownloadStatus.running, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uploaded OS image import stays cache-only', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-osimport-'));
  try {
    let importedInput = null;
    const { controller } = makeController(root, {
      dependencies: {
        importUploadedOsImage: async (_config, input) => {
          importedInput = input;
          return {
            status: 'imported',
            image: { id: input.metadata.id, fileName: input.metadata.fileName },
            bytes: 20,
            filePath: path.join(root, 'OS', input.metadata.fileName),
          };
        },
      },
    });

    const imported = await controller.importUploadedOsImage({
      uploadId: 'UPLOAD-WIN11',
      imageIndex: 6,
      metadata: { id: 'IMPORTED-WIN11-PRO', fileName: 'imported.wim' },
    });
    assert.equal(imported.status, 'imported');
    assert.equal(importedInput.imageIndex, 6);
    assert.equal(importedInput.uploadId, 'UPLOAD-WIN11');
    assert.equal(controller.config.osImage.activeImage, 'SMOKE-WIN11-PRO');
    assert.equal(controller.getState().osImportStatus.status, 'imported');
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

test('endpoint changes stop services, save config, sync repo-sourced endpoint files, and run preflight', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-endpoint-'));
  try {
    let syncOptions = null;
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
        syncIpxeEndpoint: async (_config, options) => {
          syncOptions = options;
          options.onOutput?.('sync ok\n', 'stdout');
          return 'ok';
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
    assert.equal(syncOptions.commitWinPe, true);
    assert.equal(syncOptions.syncAssets, false);
    assert.match(controller.getLogs().join('\n'), /sync ok/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime readiness is exposed and prepare runtime runs without starting services', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-runtime-'));
  try {
    let prepared = false;
    const { controller, services } = makeController(root, {
      dependencies: {
        getRuntimeReadiness: () => ({
          ready: prepared,
          requiredCount: 1,
          readyCount: prepared ? 1 : 0,
          missingCount: prepared ? 0 : 1,
          missing: prepared ? [] : [{
            id: 'boot-wim',
            name: 'WinPE boot image',
            kind: 'winpe',
            sourceType: 'generated-winpe',
            status: 'blocked-by-dependency',
            prepareGroup: 'winpe-workspace',
            prepareReason: 'Build from ADK WinPE template',
            blockedBy: [{ id: 'adk-winpe', name: 'Windows ADK WinPE files', status: 'blocked' }],
            targets: [
              { reason: 'missing', filePath: 'boot.wim' },
              { reason: 'missing', filePath: 'published\\boot.wim' },
            ],
          }],
          artifacts: [],
        }),
        prepareRuntimeArtifacts: async (_config, options = {}) => {
          options.onOutput?.('runtime ok\n', 'stdout');
          prepared = true;
          return 'runtime ok';
        },
      },
    });

    const blockedState = controller.getState();
    assert.equal(blockedState.runtime.ready, false);
    const runtimeStep = blockedState.initialization.steps.find((step) => step.id === 'runtime');
    assert.deepEqual(runtimeStep.detailItems, [{
      title: 'WinPE boot image',
      meta: 'winpe / generated-winpe / winpe-workspace',
      detail: 'missing boot.wim (2 targets); blocked by Windows ADK WinPE files; Prepare runtime will rebuild winpe-workspace; Build from ADK WinPE template',
      status: 'blocked-by-dependency',
    }]);
    const result = await controller.prepareRuntime();
    assert.equal(result.readiness.ready, true);
    const readyState = controller.getState();
    assert.equal(readyState.runtime.ready, true);
    assert.equal(
      readyState.initialization.steps.find((step) => step.id === 'runtime').detailItems,
      undefined,
    );
    assert.equal(services.http.running, false);
    assert.equal(services.tftp.running, false);
    assert.equal(services.dhcp.running, false);
    assert.match(controller.getLogs().join('\n'), /runtime ok/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prepare runtime is blocked early when Web console is not elevated', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-runtime-admin-'));
  try {
    let prepareCalled = false;
    const { controller } = makeController(root, {
      dependencies: {
        isElevated: () => false,
        getRuntimeReadiness: () => ({
          ready: false,
          requiredCount: 1,
          readyCount: 0,
          missingCount: 1,
          missing: [{
            id: 'boot-wim',
            name: 'WinPE boot image',
            kind: 'winpe',
            sourceType: 'generated-winpe',
            status: 'blocked',
            prepareGroup: 'winpe-workspace',
            targets: [{ reason: 'missing', filePath: 'boot.wim' }],
          }],
          artifacts: [],
        }),
        prepareRuntimeArtifacts: async () => {
          prepareCalled = true;
          return 'unexpected';
        },
      },
    });

    const runtimeStep = controller.getState().initialization.steps.find((step) => step.id === 'runtime');
    assert.match(runtimeStep.detail, /elevated PowerShell session/i);
    assert.equal(runtimeStep.detailItems[0].title, 'Administrator');
    assert.equal(runtimeStep.detailItems[0].status, 'blocked');

    await assert.rejects(
      controller.prepareRuntime(),
      /Prepare runtime requires an elevated Web console session/i,
    );
    assert.equal(prepareCalled, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prepare runtime suppresses benign ObjectSecurity TypeData duplicate noise', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-runtime-typedata-'));
  try {
    const { controller } = makeController(root, {
      dependencies: {
        getRuntimeReadiness: () => ({
          ready: true,
          requiredCount: 1,
          readyCount: 1,
          missingCount: 0,
          missing: [],
          artifacts: [],
        }),
        prepareRuntimeArtifacts: async (_config, options = {}) => {
          options.onOutput?.('TypeData "System.Security.AccessControl.ObjectSecurity" 中有錯誤: Group 成員已經存在。\n', 'stdout');
          options.onOutput?.('TypeData "System.Security.AccessControl.ObjectSecurity" 中有錯誤: AuditToString 成員已經存在。\n', 'stdout');
          options.onOutput?.('TypeData "System.Security.AccessControl.ObjectSecurity" 中有錯誤: AccessToString 成員已經存在。\n', 'stdout');
          options.onOutput?.('TypeData "System.Security.AccessControl.ObjectSecurity" 中有錯誤: Sddl 成員已經存在。\n', 'stdout');
          options.onOutput?.('Error in TypeData "System.Security.AccessControl.ObjectSecurity": The member Owner is already present.\n', 'stderr');
          options.onOutput?.('restore completed\n', 'stdout');
          return 'restore completed';
        },
      },
    });

    await controller.prepareRuntime();
    const logs = controller.getLogs().join('\n');
    assert.doesNotMatch(logs, /System\.Security\.AccessControl\.ObjectSecurity/u);
    assert.doesNotMatch(logs, /成員已經存在/u);
    assert.match(logs, /restore completed/u);
    assert.match(logs, /Preparing runtime artifacts complete/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prepare runtime fails when post-prepare readiness is still blocked', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-runtime-blocked-'));
  try {
    const blockedReadiness = {
      ready: false,
      requiredCount: 1,
      readyCount: 0,
      missingCount: 1,
      missing: [{
        id: 'boot-wim',
        name: 'WinPE boot image',
        kind: 'winpe',
        sourceType: 'generated-winpe',
        status: 'blocked',
        prepareGroup: 'winpe-workspace',
        prepareReason: 'Build from ADK WinPE template',
        blockedBy: [],
        targets: [
          { reason: 'size-mismatch', filePath: 'C:\\OSDCloud\\Media\\sources\\boot.wim' },
        ],
      }],
      artifacts: [],
    };
    const { controller, services } = makeController(root, {
      dependencies: {
        getRuntimeReadiness: () => blockedReadiness,
        prepareRuntimeArtifacts: async (_config, options = {}) => {
          options.onOutput?.('restore completed\n', 'stdout');
          return 'restore completed';
        },
      },
    });

    await assert.rejects(
      () => controller.prepareRuntime(),
      /Runtime prepare finished, but 1 artifact group\(s\) are still not ready: WinPE boot image: size-mismatch C:\\OSDCloud\\Media\\sources\\boot\.wim/u,
    );
    const state = controller.getState();
    assert.equal(state.operation.status, 'failed');
    assert.match(state.operation.error, /WinPE boot image: size-mismatch/u);
    assert.equal(services.http.running, false);
    assert.equal(services.tftp.running, false);
    assert.equal(services.dhcp.running, false);
    assert.match(controller.getLogs().join('\n'), /restore completed/);
    assert.match(controller.getLogs().join('\n'), /Preparing runtime artifacts failed/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('addOperationVerboseLog writes syslog and updates runtimeLog', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-verbose-log-'));
  try {
    const { controller } = makeController(root);
    const testLogPath = path.join(root, 'logs', 'test-verbose.log');
    
    // Call addOperationVerboseLog
    const line = controller.addOperationVerboseLog('verbose output line', testLogPath, 'TEST-APP');
    
    // Verify it returned a syslog formatted line
    assert.match(line, /<14>1 \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+.* localhost TEST-APP \d+ - - verbose output line/);
    
    // Verify file content
    assert.ok(fs.existsSync(testLogPath));
    const fileContent = fs.readFileSync(testLogPath, 'utf8');
    assert.match(fileContent, /TEST-APP/);
    assert.match(fileContent, /verbose output line/);

    // Verify it streamed to runtimeLog in formatted/clean display form
    const logs = controller.getLogs();
    assert.ok(logs.some(l => l.includes('verbose output line') && l.includes('[TEST-APP]')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prepareRuntime and changeEndpoint write stdout to dedicated logs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-dedicated-paths-'));
  try {
    let prepared = false;
    const { controller, config } = makeController(root, {
      dependencies: {
        getRuntimeReadiness: () => ({
          ready: prepared,
          requiredCount: 1,
          readyCount: prepared ? 1 : 0,
          missingCount: prepared ? 0 : 1,
          missing: prepared ? [] : [{
            id: 'boot-wim',
            name: 'WinPE boot image',
            kind: 'winpe',
            sourceType: 'generated-winpe',
            status: 'blocked-by-dependency',
            prepareGroup: 'winpe-workspace',
            prepareReason: 'Build from ADK WinPE template',
            blockedBy: [{ id: 'adk-winpe', name: 'Windows ADK WinPE files', status: 'blocked' }],
            targets: [
              { reason: 'missing', filePath: 'boot.wim' },
            ],
          }],
          artifacts: [],
        }),
        prepareRuntimeArtifacts: async (_config, options = {}) => {
          options.onOutput?.('WIM building stdout output\n', 'stdout');
          options.onOutput?.('WIM building stderr output\n', 'stderr');
          prepared = true;
          return 'ok';
        },
        syncIpxeEndpoint: async (_config, options = {}) => {
          options.onOutput?.('syncing custom file details\n', 'stdout');
          return 'ok';
        },
      },
    });

    // Override path logsDir to target our root temp folder
    config.paths = config.paths || {};
    config.paths.logsDir = path.join(root, 'logs');

    // Call prepareRuntime
    await controller.prepareRuntime();

    // Verify runtime-prepare.log got stdout & stderr details
    const prepareLogPath = path.join(config.paths.logsDir, 'runtime-prepare.log');
    assert.ok(fs.existsSync(prepareLogPath), 'runtime-prepare.log should exist');
    const prepareContent = fs.readFileSync(prepareLogPath, 'utf8');
    assert.match(prepareContent, /WEB-OP-PREPARE/);
    assert.match(prepareContent, /WIM building stdout output/);
    assert.match(prepareContent, /WIM building stderr output/);

    // Call changeEndpoint
    await controller.changeEndpoint({
      interfaceAlias: 'Lab',
      ipAddress: '10.20.30.1',
      prefixLength: 24,
    });

    // Verify endpoint-sync.log got stdout details
    const syncLogPath = path.join(config.paths.logsDir, 'endpoint-sync.log');
    assert.ok(fs.existsSync(syncLogPath), 'endpoint-sync.log should exist');
    const syncContent = fs.readFileSync(syncLogPath, 'utf8');
    assert.match(syncContent, /WEB-OP-SYNC/);
    assert.match(syncContent, /syncing custom file details/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('torrent tracker is part of servicesState and start/stop all', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-torrent-ctl-'));
  try {
    const config = {
      adapter: { interfaceAlias: 'LAN', serverIp: '10.10.10.1', prefixLength: 24 },
      dhcp: { listenIp: '10.10.10.1', logPath: path.join(root, 'svc.log') },
      tftp: { listenIp: '10.10.10.1', root: path.join(root, 'tftp') },
      http: { host: '10.10.10.1', port: 80, root: path.join(root, 'http'), statusRoot: path.join(root, 'status') },
      paths: { logsDir: root },
      torrent: { enabled: true, trackerPort: 6969, pieceLengthBytes: 4194304, seedMinutes: 30 },
    };
    const services = {
      dhcp: new FakeService(config.dhcp),
      tftp: new FakeService(config.tftp),
      http: new FakeService(config.http),
      torrent: new FakeService(config.torrent),
    };
    const controller = new ServiceController({ config, services, dependencies: {} });

    let state = controller.servicesState();
    assert.equal(state.torrent.running, false);
    assert.equal(state.torrent.enabled, true);
    assert.equal(state.torrent.trackerPort, 6969);
    assert.equal(state.torrent.serverIp, '10.10.10.1');

    await controller.startAll();
    assert.equal(controller.servicesState().torrent.running, true);
    assert.equal(services.torrent.starts, 1);

    await controller.stopAll();
    assert.equal(controller.servicesState().torrent.running, false);
    assert.equal(services.torrent.stops, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('torrent tracker is not started by startAll when disabled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-torrent-off-'));
  try {
    const config = {
      adapter: { interfaceAlias: 'LAN', serverIp: '10.10.10.1', prefixLength: 24 },
      dhcp: { listenIp: '10.10.10.1', logPath: path.join(root, 'svc.log') },
      tftp: { listenIp: '10.10.10.1', root: path.join(root, 'tftp') },
      http: { host: '10.10.10.1', port: 80, root: path.join(root, 'http'), statusRoot: path.join(root, 'status') },
      paths: { logsDir: root },
      torrent: { enabled: false, trackerPort: 6969 },
    };
    const services = {
      dhcp: new FakeService(config.dhcp),
      tftp: new FakeService(config.tftp),
      http: new FakeService(config.http),
      torrent: new FakeService(config.torrent),
    };
    const controller = new ServiceController({ config, services, dependencies: {} });
    await controller.startAll();
    assert.equal(services.torrent.starts, 0);
    assert.equal(controller.servicesState().torrent.enabled, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('changeBootMode persists the mode, refreshes services, and reruns preflight', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-boot-mode-'));
  try {
    const saved = [];
    const { controller, config } = makeController(root, {
      dependencies: {
        saveConfig: (nextConfig) => {
          saved.push(nextConfig.dhcp.bootMode);
          return path.join(root, 'config.json');
        },
      },
    });

    const result = await controller.changeBootMode('ipxe');
    assert.equal(result.bootMode, 'ipxe');
    assert.equal(config.dhcp.bootMode, 'ipxe');
    assert.equal(config.dhcp.secureBootFile, 'bootmgfw.efi');
    assert.deepEqual(saved, ['ipxe']);
    assert.equal(controller.servicesState().dhcp.bootMode, 'ipxe');
    assert.ok(Array.isArray(result.preflight));

    await controller.changeBootMode('secureboot');
    assert.equal(config.dhcp.bootMode, 'secureboot');
    assert.equal(controller.getState().config.dhcp.bootMode, 'secureboot');

    await assert.rejects(() => controller.changeBootMode('bogus'), /Invalid boot mode/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dual NIC NAT preparation forces DHCP Server and preserves the service lifecycle boundary', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-gateway-'));
  try {
    const calls = [];
    const { controller, config, services } = makeController(root, {
      dependencies: {
        saveConfig: () => path.join(root, 'config.json'),
        loadConfig: () => config,
        prepareNetworkGateway: async (nextConfig, input) => {
          calls.push({ nextConfig, input });
          return {
            topology: 'dual-nic-nat', ready: true,
            virtualAdapter: { name: 'vEthernet (Winception-PXE)' },
            wan: { name: 'Wi-Fi' }, nat: { name: 'WinceptionNAT' },
          };
        },
      },
    });

    const result = await controller.prepareNetworkGateway({
      wanInterfaceAlias: 'Wi-Fi', pxeInterfaceAlias: 'Ethernet', internalSubnet: '192.168.100.0/24',
    });
    assert.equal(result.gateway.ready, true);
    assert.equal(config.network.topology, 'dual-nic-nat');
    assert.equal(config.network.nat.wanInterfaceAlias, 'Wi-Fi');
    assert.equal(config.network.nat.pxeInterfaceAlias, 'Ethernet');
    assert.equal(config.dhcp.dhcpMode, 'server');
    assert.equal(calls.length, 1);
    assert.ok(services.dhcp.stops >= 1);
    await assert.rejects(() => controller.changeDhcpMode('proxy'), /requires DHCP Server mode/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
