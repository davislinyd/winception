import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ServiceController } from '../src/serviceController.js';
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

test('state includes selected run events from per-run history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-selected-events-'));
  try {
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
        readRunStatusEvents: (_config, runId) => runId === 'old-run'
          ? [
              { runId: 'old-run', stage: 'smb-mounted', imagePath: 'Z:\\OSDCloud\\OS\\install.esd', osImageIndex: 6 },
              { runId: 'old-run', stage: 'windows-desktop-ready', desktopReadyFile: true },
            ]
          : [],
      },
    });

    const state = controller.getState({ selectedRunId: 'old-run' });

    assert.equal(state.selectedRunId, 'old-run');
    assert.equal(state.statusEvents.length, 1);
    assert.equal(state.statusEvents[0].runId, 'new-run');
    assert.equal(state.selectedRunEvents.length, 2);
    assert.equal(state.selectedRunEvents[0].imagePath, 'Z:\\OSDCloud\\OS\\install.esd');
    assert.equal(state.selectedRunEvents[1].desktopReadyFile, true);
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
    });
    assert.equal(updatedName, 'Renamed');
    assert.equal(updatedDescription, 'Updated active profile');
    assert.deepEqual(updatedSoftwareIds, ['chrome', '7zip']);
    assert.equal(updated.profile.id, 'default');
    assert.equal(updated.profile.name, 'Renamed');
    assert.equal(updated.profile.description, 'Updated active profile');
    assert.equal(updated.preflight[0].ok, true);
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
              id: 'SW-TOOL001',
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
      name: 'Tool App',
      scriptMode: 'template',
    });

    assert.equal(uploadedInput.fileName, 'tool.msi');
    assert.equal(Object.prototype.hasOwnProperty.call(createInput, 'id'), false);
    assert.equal(created.software.id, 'SW-TOOL001');
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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS image actions publish active image and download through host catalog', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-controller-osimage-'));
  try {
    let publishedImageId = null;
    let downloadedCatalogId = null;
    const { controller, services } = makeController(root, {
      dependencies: {
        publishSelectedOsImage: async (_config, imageId) => {
          publishedImageId = imageId;
          return {
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
          };
        },
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
    const published = await controller.changeOsImage('SMOKE-WIN11-PRO');
    assert.equal(publishedImageId, 'SMOKE-WIN11-PRO');
    assert.equal(published.image.id, 'SMOKE-WIN11-PRO');
    assert.equal(published.preflight[0].ok, true);
    assert.equal(services.http.running, false);
    assert.equal(services.tftp.running, false);
    assert.equal(services.dhcp.running, false);

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
          throw new Error('download exploded');
        },
      },
    });
    const before = controller.getState().osImage.activeImage?.id;

    const job = controller.startOsDownload('BROKEN-DOWNLOAD');
    await assert.rejects(job.promise, /download exploded/);

    const downloadStatus = controller.getState().osDownloadStatus;
    assert.equal(downloadStatus.status, 'failed');
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
