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
import { TftpResponder } from './tftp.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-tui-smoke-'));
const httpRoot = path.join(root, 'http');
const tftpRoot = path.join(root, 'tftp');
const statusRoot = path.join(httpRoot, 'status');
const driverPackCacheRoot = path.join(root, 'driverpacks');
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
fs.writeFileSync(path.join(httpRoot, 'osdcloud', 'boot.ipxe'), '#!ipxe\n');
fs.writeFileSync(path.join(httpRoot, 'osdcloud', 'boot.wim'), 'boot-image');
fs.writeFileSync(path.join(httpRoot, 'osdcloud', 'driverpack.exe'), 'driver-pack-smoke');
fs.writeFileSync(path.join(tftpRoot, 'snponly.efi'), 'efi');
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

async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail('Timed out waiting for smoke condition');
}

const config = {
  paths: {
    repoRoot: root,
  },
  http: {
    root: httpRoot,
    host: '127.0.0.1',
    port: 0,
    logPath: path.join(root, 'http.log'),
    statusRoot,
  },
  driverPackCache: {
    enabled: true,
    root: driverPackCacheRoot,
    allowedHosts: ['127.0.0.1'],
  },
  deploymentProfiles: {
    activeProfile: 'default',
    profilesRoot,
    softwareCatalogPath: path.join(root, 'software-catalog.json'),
    softwareSourceRoot: softwareRoot,
    appsRoot,
    installerScript: path.join(root, 'Install-Apps.ps1'),
  },
};

const publishedProfile = publishDeploymentProfile(config);
assert.equal(publishedProfile.profile.id, 'default');
assert.equal(fs.existsSync(path.join(appsRoot, 'selected-profile.json')), true);
assert.equal(fs.existsSync(path.join(appsRoot, 'smoke-app', 'install.ps1')), true);
const createdProfile = createDeploymentProfile(config, { id: 'smoke-copy', name: 'Smoke Copy' });
assert.deepEqual(createdProfile.profile.softwareIds, ['smoke-app']);
assert.equal(fs.existsSync(path.join(appsRoot, 'smoke-copy')), false);
updateDeploymentProfileSoftware(config, 'default', ['smoke-extra']);
const republishedProfile = publishDeploymentProfile(config);
assert.equal(republishedProfile.profile.id, 'default');
const selectedProfile = JSON.parse(fs.readFileSync(path.join(appsRoot, 'selected-profile.json'), 'utf8'));
assert.deepEqual(selectedProfile.selectedSoftware, ['smoke-extra']);
assert.equal(fs.existsSync(path.join(appsRoot, 'smoke-extra', 'install.ps1')), true);
assert.equal(fs.existsSync(path.join(appsRoot, 'smoke-app')), false);
deleteDeploymentProfile(config, 'smoke-copy');
assert.equal(fs.existsSync(path.join(profilesRoot, 'smoke-copy.json')), false);

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

  assert.ok(tftpServer.running);
  console.log(`Smoke test passed: ${root}`);
} finally {
  await Promise.allSettled([tftpServer.stop(), httpServer.stop()]);
  fs.rmSync(root, { recursive: true, force: true });
}
