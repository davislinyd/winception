import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  evaluateDeploymentProfilePayload,
  loadDeploymentProfiles,
  loadSoftwareCatalog,
  publishDeploymentProfile,
  resolveDeploymentProfileState,
} from '../src/deploymentProfiles.js';

function makeRoot(prefix = 'osdcloud-profile-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeSoftware(root, id, script = "Write-Host 'installed'\n") {
  const softwareRoot = path.join(root, 'Softwares', id);
  fs.mkdirSync(softwareRoot, { recursive: true });
  fs.writeFileSync(path.join(softwareRoot, 'install.ps1'), script, 'utf8');
}

function writeInstallerScript(root) {
  const filePath = path.join(root, 'Install-Apps.ps1');
  fs.writeFileSync(filePath, "Write-Host 'profile installer'\n", 'utf8');
  return filePath;
}

function configFor(root, overrides = {}) {
  return {
    paths: { repoRoot: root },
    deploymentProfiles: {
      activeProfile: 'default',
      profilesRoot: 'profiles',
      softwareCatalogPath: 'software-catalog.json',
      softwareSourceRoot: 'Softwares',
      appsRoot: path.join(root, 'Apps'),
      installerScript: 'Install-Apps.ps1',
      ...overrides,
    },
  };
}

function writeBaseFiles(root, options = {}) {
  writeSoftware(root, 'one');
  writeSoftware(root, 'two');
  writeInstallerScript(root);
  writeJson(path.join(root, 'software-catalog.json'), {
    software: options.catalog ?? [
      { id: 'one', name: 'One App', source: 'one' },
      { id: 'two', name: 'Two App', source: 'two' },
    ],
  });
  writeJson(path.join(root, 'profiles', 'default.json'), options.defaultProfile ?? {
    id: 'default',
    name: 'Default',
    software: ['one'],
  });
}

test('loads active deployment profile with selected software', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const state = resolveDeploymentProfileState(configFor(root));

    assert.equal(state.activeProfile.id, 'default');
    assert.deepEqual(state.selectedSoftware.map((software) => software.id), ['one']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects duplicate software ids', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      catalog: [
        { id: 'one', name: 'One App', source: 'one' },
        { id: 'one', name: 'Duplicate One', source: 'one' },
      ],
    });

    assert.throws(() => loadSoftwareCatalog(configFor(root)), /Duplicate software id/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unknown software in profile', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['missing'],
      },
    });

    assert.throws(() => loadDeploymentProfiles(configFor(root)), /unknown software/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects missing software source folder', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      catalog: [
        { id: 'one', name: 'One App', source: 'missing-folder' },
      ],
    });

    assert.throws(() => loadSoftwareCatalog(configFor(root)), /source folder not found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsafe catalog source traversal', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      catalog: [
        { id: 'one', name: 'One App', source: '..\\outside' },
      ],
    });

    assert.throws(() => loadSoftwareCatalog(configFor(root)), /escapes root/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('accepts empty software profile', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: [],
      },
    });

    const state = resolveDeploymentProfileState(configFor(root));
    assert.deepEqual(state.selectedSoftware, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publishes only selected software and removes stale apps', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    fs.mkdirSync(path.join(root, 'Apps', 'stale'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Apps', 'stale', 'install.ps1'), "Write-Host 'stale'\n", 'utf8');

    const result = publishDeploymentProfile(configFor(root));

    assert.equal(result.profile.id, 'default');
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'Install-Apps.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'selected-profile.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'one', 'install.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'two')), false);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'stale')), false);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Apps', 'selected-profile.json'), 'utf8'));
    assert.equal(manifest.profileId, 'default');
    assert.deepEqual(manifest.selectedSoftware, ['one']);
    assert.equal(evaluateDeploymentProfilePayload(configFor(root)).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to publish outside an Apps folder', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);

    assert.throws(
      () => publishDeploymentProfile(configFor(root, { appsRoot: path.join(root, 'not-apps') })),
      /outside an Apps folder/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script installs only selected apps', () => {
  if (process.platform !== 'win32') {
    return;
  }

  const root = makeRoot('osdcloud-installer-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    fs.mkdirSync(path.join(appsRoot, 'one'), { recursive: true });
    fs.mkdirSync(path.join(appsRoot, 'two'), { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    fs.writeFileSync(path.join(appsRoot, 'one', 'install.ps1'), "Set-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'one.marker') -Value 'one'\n", 'utf8');
    fs.writeFileSync(path.join(appsRoot, 'two', 'install.ps1'), "Set-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'two.marker') -Value 'two'\n", 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'default',
      selectedSoftware: ['one'],
      software: [{ id: 'one', name: 'One App' }],
    });

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(appsRoot, 'Install-Apps.ps1'),
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(path.join(appsRoot, 'one.marker')), true);
    assert.equal(fs.existsSync(path.join(appsRoot, 'two.marker')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script fails when selected app is missing', () => {
  if (process.platform !== 'win32') {
    return;
  }

  const root = makeRoot('osdcloud-installer-missing-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    fs.mkdirSync(appsRoot, { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'default',
      selectedSoftware: ['missing'],
      software: [{ id: 'missing', name: 'Missing App' }],
    });

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(appsRoot, 'Install-Apps.ps1'),
    ], { encoding: 'utf8' });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Selected software installer not found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
