import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mediaHttpServerConfig } from './config.js';
import {
  createDeploymentProfile,
  deleteDeploymentProfile,
  publishDeploymentProfile,
  updateDeploymentProfileSoftware,
} from './deploymentProfiles.js';
import { MediaHttpServer } from './httpServer.js';
import { publishSelectedOsImage } from './osImages.js';
import { ServiceController } from './serviceController.js';
import { TftpResponder } from './tftp.js';
import { WebManagementServer } from './webServer.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-console-smoke-'));
const httpRoot = path.join(root, 'http');
const tftpRoot = path.join(root, 'tftp');
const statusRoot = path.join(httpRoot, 'status');
const driverPackCacheRoot = path.join(root, 'driverpacks');
const osCacheRoot = path.join(root, 'OS');
const osDownloadStagingRoot = path.join(osCacheRoot, '.downloads');
const osCatalogPath = path.join(root, 'os-image-catalog.json');
const appsRoot = path.join(root, 'Apps');
const softwareRoot = path.join(root, 'Softwares');
const profilesRoot = path.join(root, 'profiles');
const driverPackFileName = 'PA14250-YWNJX_Win11_1.0_A06.exe';
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
fs.mkdirSync(path.join(httpRoot, 'osdcloud'), { recursive: true });
fs.mkdirSync(tftpRoot, { recursive: true });
fs.mkdirSync(osCacheRoot, { recursive: true });
fs.writeFileSync(path.join(httpRoot, 'osdcloud', 'boot.ipxe'), '#!ipxe\n');
fs.writeFileSync(path.join(httpRoot, 'osdcloud', 'boot.wim'), 'boot-image');
fs.writeFileSync(path.join(httpRoot, 'osdcloud', 'driverpack.exe'), 'driver-pack-smoke');
fs.writeFileSync(path.join(tftpRoot, 'snponly.efi'), 'efi');
fs.writeFileSync(path.join(osCacheRoot, 'install.esd'), 'install image');
fs.mkdirSync(path.join(softwareRoot, 'smoke-app'), { recursive: true });
fs.mkdirSync(path.join(softwareRoot, 'smoke-extra'), { recursive: true });
fs.mkdirSync(profilesRoot, { recursive: true });
fs.writeFileSync(path.join(root, 'Install-Apps.ps1'), "Write-Host 'smoke installer'\n", 'utf8');
fs.writeFileSync(path.join(softwareRoot, 'smoke-app', 'install.ps1'), "Write-Host 'smoke app'\n", 'utf8');
fs.writeFileSync(path.join(softwareRoot, 'smoke-extra', 'install.ps1'), "Write-Host 'smoke extra'\n", 'utf8');
fs.writeFileSync(path.join(root, 'software-catalog.json'), JSON.stringify({
  software: [
    { id: 'smoke-app', name: 'Smoke App', source: 'smoke-app' },
    { id: 'smoke-extra', name: 'Smoke Extra', source: 'smoke-extra' },
  ],
}, null, 2));
fs.writeFileSync(path.join(profilesRoot, 'default.json'), JSON.stringify({
  id: 'default',
  name: 'Default',
  software: ['smoke-app'],
}, null, 2));
fs.writeFileSync(osCatalogPath, JSON.stringify({
  images: [{
    id: 'SMOKE-WIN11-PRO',
    name: 'Smoke Windows 11 Pro',
    version: 'Windows 11 Smoke',
    language: 'en-us',
    locale: 'en-US',
    timeZone: 'UTC',
    edition: 'Pro',
    editionId: 'Professional',
    activation: 'Retail',
    imageIndex: 6,
    fileName: 'install.esd',
    size: 'install image'.length,
  }],
}, null, 2));

async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail('Timed out waiting for smoke condition');
}

const config = {
  adapter: {
    interfaceAlias: 'Loopback',
    serverIp: '127.0.0.1',
    prefixLength: 8,
  },
  dhcp: {
    listenIp: '127.0.0.1',
    listenPort: 0,
    replyPort: 0,
    leaseStartIp: '127.0.0.200',
    leaseEndIp: '127.0.0.250',
    subnetMask: '255.0.0.0',
    router: '127.0.0.1',
    bootFile: 'snponly.efi',
    ipxeBootUrl: 'http://127.0.0.1/osdcloud/boot.ipxe',
  },
  tftp: {
    root: tftpRoot,
    listenIp: '127.0.0.1',
    port: 0,
    logPath: path.join(root, 'tftp.log'),
  },
  paths: {
    repoRoot: root,
    expectedHttpFiles: ['osdcloud\\boot.ipxe', 'osdcloud\\boot.wim'],
    statusLatest: path.join(statusRoot, 'latest.json'),
    statusEvents: path.join(statusRoot, 'progress.jsonl'),
    imageNamePattern: 'install.esd',
  },
  http: {
    root: httpRoot,
    host: '127.0.0.1',
    port: 0,
    logPath: path.join(root, 'http.log'),
    statusRoot,
  },
  smb: {
    share: '\\\\127.0.0.1\\OSDCloudiPXE',
    imagePath: path.join(osCacheRoot, 'install.esd'),
  },
  driverPackCache: {
    enabled: true,
    root: driverPackCacheRoot,
    allowedHosts: ['127.0.0.1'],
  },
  osImage: {
    activeImage: 'SMOKE-WIN11-PRO',
    catalogPath: osCatalogPath,
    downloadSourcesPath: path.join(root, 'os-download-sources.json'),
    cacheRoot: osCacheRoot,
    downloadStagingRoot: osDownloadStagingRoot,
    validateDismOnPreflight: false,
    validateDismOnPublish: false,
  },
  deploymentProfiles: {
    activeProfile: 'default',
    profilesRoot,
    softwareCatalogPath: path.join(root, 'software-catalog.json'),
    softwareSourceRoot: softwareRoot,
    appsRoot,
    installerScript: path.join(root, 'Install-Apps.ps1'),
  },
  web: {
    host: '127.0.0.1',
    port: 0,
  },
  __configPath: path.join(root, 'osdcloud-console.json'),
};

const publishedOsImage = await publishSelectedOsImage(config, null, { validateDism: false });
assert.equal(publishedOsImage.image.id, 'SMOKE-WIN11-PRO');
assert.equal(fs.existsSync(path.join(osCacheRoot, 'selected-os.json')), true);
const publishedProfile = await publishDeploymentProfile(config);
assert.equal(publishedProfile.profile.id, 'default');
assert.equal(fs.existsSync(path.join(appsRoot, 'selected-profile.json')), true);
assert.equal(fs.existsSync(path.join(appsRoot, 'smoke-app', 'install.ps1')), true);
const createdProfile = createDeploymentProfile(config, { name: 'Smoke Copy' });
assert.match(createdProfile.profile.id, /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{8}$/u);
assert.deepEqual(createdProfile.profile.softwareIds, ['smoke-app']);
assert.equal(fs.existsSync(path.join(appsRoot, createdProfile.profile.id)), false);
updateDeploymentProfileSoftware(config, 'default', ['smoke-extra']);
const republishedProfile = await publishDeploymentProfile(config);
assert.equal(republishedProfile.profile.id, 'default');
const selectedProfile = JSON.parse(fs.readFileSync(path.join(appsRoot, 'selected-profile.json'), 'utf8'));
assert.deepEqual(selectedProfile.selectedSoftware, ['smoke-extra']);
assert.equal(fs.existsSync(path.join(appsRoot, 'smoke-extra', 'install.ps1')), true);
assert.equal(fs.existsSync(path.join(appsRoot, 'smoke-app')), false);
deleteDeploymentProfile(config, createdProfile.profile.id);
assert.equal(fs.existsSync(path.join(profilesRoot, `${createdProfile.profile.id}.json`)), false);

const httpServer = new MediaHttpServer(mediaHttpServerConfig(config));

const tftpServer = new TftpResponder({
  root: tftpRoot,
  listenIp: '127.0.0.1',
  port: 0,
  logPath: path.join(root, 'tftp.log'),
});

try {
  await httpServer.start();
  await tftpServer.start();
  const port = httpServer.address.port;
  const base = `http://127.0.0.1:${port}`;

  let response = await fetch(`${base}/osdcloud/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: 'smoke-a',
      clientId: 'test-client-a',
      stage: 'winpe-start',
      message: 'smoke test a',
    }),
  });
  assert.equal(response.status, 204);

  response = await fetch(`${base}/osdcloud/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: 'smoke-b',
      clientId: 'test-client-b',
      computerName: 'DESKTOP-SMOKE',
      stage: 'windows-driverpack-cache-request',
      percent: 98,
      driverPacks: [{
        manufacturer: 'Dell',
        model: 'Dell Pro 14 Premium',
        product: ['0CE4'],
        name: 'Dell Pro 14 Premium Windows 11 Driver Pack',
        packageId: 'YWNJX',
        fileName: driverPackFileName,
        url: `${base}/osdcloud/driverpack.exe`,
      }],
    }),
  });
  assert.equal(response.status, 204);
  await waitFor(() => fs.existsSync(path.join(driverPackCacheRoot, driverPackFileName)));
  const driverPackManifest = fs.readFileSync(path.join(driverPackCacheRoot, 'driverpack-cache.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(driverPackManifest[0].status, 'downloaded');
  assert.equal(driverPackManifest[0].fileName, driverPackFileName);

  response = await fetch(`${base}/osdcloud/status`);
  assert.equal(response.status, 200);
  const latest = await response.json();
  assert.equal(latest.runId, 'smoke-b');
  assert.equal(latest.stage, 'windows-driverpack-cache-request');

  response = await fetch(`${base}/osdcloud/status/runs`);
  assert.equal(response.status, 200);
  const runs = await response.json();
  assert.equal(runs.total, 2);
  assert.equal(runs.counts.running, 2);
  assert.equal(runs.counts.completed, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(statusRoot, 'runs-index.json'), 'utf8')).total, 2);

  response = await fetch(`${base}/osdcloud/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: 'smoke-b',
      clientId: 'test-client-b',
      stage: 'windows-desktop-ready',
      percent: 100,
      message: 'smoke test b',
    }),
  });
  assert.equal(response.status, 204);

  response = await fetch(`${base}/osdcloud/status/runs`);
  assert.equal(response.status, 200);
  const completedRuns = await response.json();
  assert.equal(completedRuns.total, 2);
  assert.equal(completedRuns.counts.running, 1);
  assert.equal(completedRuns.counts.completed, 1);

  response = await fetch(`${base}/osdcloud/screenshot?runId=smoke-a&clientId=test-client-a&stage=winpe-start&source=smoke&timestamp=2026-05-09T08:00:00%2B08:00`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: onePixelPng,
  });
  assert.equal(response.status, 201);
  const screenshot = await response.json();
  assert.ok(fs.existsSync(screenshot.filePath));
  assert.equal(JSON.parse(fs.readFileSync(path.join(statusRoot, 'latest-screenshot.json'), 'utf8')).stage, 'winpe-start');
  assert.match(fs.readFileSync(path.join(statusRoot, 'smoke-a.screenshots.jsonl'), 'utf8'), /winpe-start/);

  response = await fetch(`${base}/osdcloud/boot.wim`, {
    headers: { range: 'bytes=0-3' },
  });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'boot');

  const webController = new ServiceController({
    config,
    dependencies: {
      listOsDownloadCatalog: async () => [{
        id: 'SMOKE-DOWNLOAD-PRO',
        name: 'Smoke Download Pro',
        version: 'Windows 11 Smoke',
        language: 'en-us',
        locale: 'en-US',
        timeZone: 'UTC',
        edition: 'Pro',
        editionId: 'Professional',
        activation: 'Retail',
        imageIndex: 6,
        fileName: 'download.esd',
        url: `${webBase}/osdcloud/boot.wim`,
      }],
      downloadOsImageFromCatalog: async () => ({
        status: 'downloaded',
        image: {
          id: 'SMOKE-DOWNLOAD-PRO',
          fileName: 'download.esd',
        },
        bytes: 10,
        filePath: path.join(osCacheRoot, 'download.esd'),
      }),
      deleteCachedOsImage: async (_config, imageId) => ({
        status: 'deleted',
        image: {
          id: imageId,
          fileName: 'download.esd',
        },
        fileDeleted: true,
        bytes: 10,
        filePath: path.join(osCacheRoot, 'download.esd'),
        catalogPath: osCatalogPath,
      }),
      uploadOsImageFile: async (_config, input) => {
        let bytes = 0;
        for await (const chunk of input.stream) {
          bytes += chunk.length;
        }
        return {
          uploadId: 'SMOKE-UPLOAD',
          sourcePath: path.join(osDownloadStagingRoot, 'uploads', 'SMOKE-UPLOAD', input.fileName),
          originalFileName: input.fileName,
          sourceType: 'wim',
          bytes,
          indexes: [{
            imageIndex: 6,
            name: 'Windows 11 Pro',
            suggested: {
              id: 'SMOKE-UPLOAD-PRO',
              name: 'Smoke Upload Pro',
              version: 'Windows 11 Smoke',
              language: 'en-us',
              edition: 'Pro',
              imageIndex: 6,
              fileName: 'uploaded.wim',
            },
          }],
        };
      },
      importUploadedOsImage: async () => ({
        status: 'imported',
        image: {
          id: 'SMOKE-UPLOAD-PRO',
          fileName: 'uploaded.wim',
        },
        bytes: 10,
        filePath: path.join(osCacheRoot, 'uploaded.wim'),
      }),
    },
  });
  const webServer = new WebManagementServer({ controller: webController });
  await webServer.start({ host: '127.0.0.1', port: 0 });
  const webBase = `http://127.0.0.1:${webServer.address.port}`;
  try {
    response = await fetch(`${webBase}/api/state`);
    assert.equal(response.status, 200);
    const webState = await response.json();
    assert.equal(webState.ok, true);
    assert.equal(webState.state.web.host, '127.0.0.1');
    assert.equal(webState.state.osImage.activeImage.id, 'SMOKE-WIN11-PRO');

    response = await fetch(`${webBase}/api/os-images`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).osImage.activeImage.id, 'SMOKE-WIN11-PRO');

    response = await fetch(`${webBase}/api/os-download-catalog`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).catalog[0].id, 'SMOKE-DOWNLOAD-PRO');

    response = await fetch(`${webBase}/api/preflight`, { method: 'POST' });
    assert.equal(response.status, 200);

    response = await fetch(`${webBase}/api/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 'default' }),
    });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(fs.readFileSync(config.__configPath, 'utf8')).deploymentProfiles.activeProfile, 'default');

    response = await fetch(`${webBase}/api/os-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageId: 'SMOKE-WIN11-PRO' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${webBase}/api/os-download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catalogId: 'SMOKE-DOWNLOAD-PRO' }),
    });
    assert.equal(response.status, 202);
    let osDownloadStatus = null;
    await waitFor(async () => {
      const stateResponse = await fetch(`${webBase}/api/state`);
      const statePayload = await stateResponse.json();
      osDownloadStatus = statePayload.state.osDownloadStatus;
      return osDownloadStatus?.status === 'downloaded';
    });
    assert.equal(osDownloadStatus.running, false);
    assert.equal(osDownloadStatus.imageId, 'SMOKE-DOWNLOAD-PRO');

    response = await fetch(`${webBase}/api/os-image-delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageId: 'SMOKE-DOWNLOAD-PRO' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.status, 'deleted');

    response = await fetch(`${webBase}/api/os-image-inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourcePath: path.join(root, 'import.wim') }),
    });
    assert.equal(response.status, 404);

    response = await fetch(`${webBase}/api/os-image-import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourcePath: path.join(root, 'import.wim'),
        imageIndex: 6,
        metadata: { id: 'SMOKE-IMPORT-PRO', fileName: 'imported.wim' },
      }),
    });
    assert.equal(response.status, 404);

    response = await fetch(`${webBase}/api/os-image-upload?fileName=upload.wim`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: 'uploaded bytes',
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.uploadId, 'SMOKE-UPLOAD');

    response = await fetch(`${webBase}/api/os-image-upload-import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uploadId: 'SMOKE-UPLOAD',
        imageIndex: 6,
        metadata: { id: 'SMOKE-UPLOAD-PRO', fileName: 'uploaded.wim' },
      }),
    });
    assert.equal(response.status, 200);
  } finally {
    await webServer.stop();
  }

  assert.ok(tftpServer.running);
  console.log(`Smoke test passed: ${root}`);
} finally {
  await Promise.allSettled([tftpServer.stop(), httpServer.stop()]);
  fs.rmSync(root, { recursive: true, force: true });
}
