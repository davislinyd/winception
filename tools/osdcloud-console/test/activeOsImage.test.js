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
