import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function normalizedText(relativePath) {
  return readText(relativePath).replace(/\r\n/gu, '\n');
}

test('fresh clone does not commit a preselected Windows image', () => {
  const config = readJson('config/osdcloud-console.json');
  const activeProfileId = config.deploymentProfiles.activeProfile;
  const profile = readJson(path.join('config', 'deployment-profiles', `${activeProfileId}.json`));
  const catalog = readJson('config/os-image-catalog.json');

  assert.equal(config.osImage.activeImage, null);
  assert.equal(config.paths.imageNamePattern, undefined);
  assert.equal(config.smb.imagePath, '');
  assert.deepEqual(catalog.images, []);
  assert.equal(profile.osImage, undefined);
  assert.equal(fs.existsSync(path.join(repoRoot, 'osdcloud-assets/OSDCloud/Media/OSDCloud/OS/selected-os.json')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'osdcloud-assets/OSDCloud/Media/OSDCloud/Apps/selected-profile.json')), false);
});

test('active custom script is mirrored and handed off to deployed Windows', () => {
  const profile = readJson('config/deployment-profiles/IZVZO7PU.json');
  const scriptEntry = profile.customScripts?.find((entry) => entry.id === 'SC-J5GF07Y2');
  const sourceScript = 'Scripts/SC-J5GF07Y2/run.ps1';
  const mirroredScript = 'osdcloud-assets/OSDCloud/Media/OSDCloud/Scripts/SC-J5GF07Y2/run.ps1';
  const shutdownScript = readText('osdcloud-assets/OSDCloud/Config/Scripts/Shutdown/Invoke-DavisOobe.ps1');
  const embeddedShutdownScript = readText('osdcloud-assets/OSDCloud/WinPE/OSDCloud/Config/Scripts/Shutdown/Invoke-DavisOobe.ps1');

  assert.equal(scriptEntry?.phase, 'after');
  assert.equal(fs.existsSync(path.join(repoRoot, mirroredScript)), true);
  assert.equal(normalizedText(mirroredScript), normalizedText(sourceScript));
  assert.match(shutdownScript, /ProgramData\\OSDCloud\\Scripts/u);
  assert.match(shutdownScript, /Client scripts source:/u);
  assert.match(embeddedShutdownScript, /ProgramData\\OSDCloud\\Scripts/u);
  assert.match(embeddedShutdownScript, /Client scripts target:/u);
});
