import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

function sha256(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relativePath))).digest('hex').toUpperCase();
}

test('active deployment profile publishes the zh-TW Windows image', () => {
  const config = readJson('config/osdcloud-console.json');
  const activeProfileId = config.deploymentProfiles.activeProfile;
  const profile = readJson(path.join('config', 'deployment-profiles', `${activeProfileId}.json`));
  const catalog = readJson('config/os-image-catalog.json');
  const selectedProfile = readJson('osdcloud-assets/Win11-iPXE-Lab/Media/OSDCloud/Apps/selected-profile.json');
  const selectedOs = readJson('osdcloud-assets/Win11-iPXE-Lab/Media/OSDCloud/OS/selected-os.json');
  const catalogImage = catalog.images.find((image) => image.id === profile.osImage);

  assert.equal(activeProfileId, 'IZVZO7PU');
  assert.equal(profile.osImage, 'WIN11-25H2-ZHTW-PRO');
  assert.equal(config.osImage.activeImage, profile.osImage);
  assert.equal(selectedProfile.profileId, activeProfileId);
  assert.equal(selectedProfile.osImageId, profile.osImage);
  assert.equal(selectedProfile.osImage.id, profile.osImage);
  assert.equal(selectedOs.id, profile.osImage);
  assert.equal(catalogImage?.language, 'zh-tw');
  assert.equal(catalogImage?.locale, 'zh-TW');
  assert.equal(selectedOs.language, 'zh-tw');
  assert.equal(selectedOs.locale, 'zh-TW');
  assert.match(config.paths.imageNamePattern, /_zh-tw\.esd$/u);
  assert.match(config.smb.imagePath, /_zh-tw\.esd$/u);
});

test('active custom script is mirrored and handed off to deployed Windows', () => {
  const selectedProfile = readJson('osdcloud-assets/Win11-iPXE-Lab/Media/OSDCloud/Apps/selected-profile.json');
  const scriptEntry = selectedProfile.customScripts?.find((entry) => entry.id === 'SC-J5GF07Y2');
  const sourceScript = 'Scripts/SC-J5GF07Y2/run.ps1';
  const mirroredScript = 'osdcloud-assets/Win11-iPXE-Lab/Media/OSDCloud/Scripts/SC-J5GF07Y2/run.ps1';
  const shutdownScript = readText('osdcloud-assets/Win11-iPXE-Lab/Config/Scripts/Shutdown/Invoke-DavisOobe.ps1');
  const embeddedShutdownScript = readText('osdcloud-assets/Win11-iPXE-Lab/WinPE/OSDCloud/Config/Scripts/Shutdown/Invoke-DavisOobe.ps1');

  assert.equal(scriptEntry?.phase, 'after');
  assert.equal(fs.existsSync(path.join(repoRoot, mirroredScript)), true);
  assert.equal(sha256(mirroredScript), sha256(sourceScript));
  assert.match(shutdownScript, /ProgramData\\OSDCloud\\Scripts/u);
  assert.match(shutdownScript, /Client scripts source:/u);
  assert.match(embeddedShutdownScript, /ProgramData\\OSDCloud\\Scripts/u);
  assert.match(embeddedShutdownScript, /Client scripts target:/u);
});
