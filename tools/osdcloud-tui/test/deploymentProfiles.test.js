import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createDeploymentProfile,
  deleteDeploymentProfile,
  deploymentProfileOptions,
  evaluateDeploymentProfilePayload,
  generateDeploymentProfileId,
  loadDeploymentProfiles,
  loadSoftwareCatalog,
  publishDeploymentProfile,
  resolveDeploymentProfileState,
  updateDeploymentProfile,
  updateDeploymentProfileSoftware,
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

test('resolves relative deployment profile paths from derived repo root by default', () => {
  const options = deploymentProfileOptions({
    deploymentProfiles: {
      profilesRoot: 'config\\deployment-profiles',
      softwareCatalogPath: 'config\\software-catalog.json',
      softwareSourceRoot: 'Softwares',
      appsRoot: 'C:\\OSDCloud\\Win11-iPXE-Lab\\Media\\OSDCloud\\Apps',
      installerScript: 'Softwares\\Install-Apps.ps1',
    },
  });

  assert.equal(options.profilesRoot, path.resolve('config\\deployment-profiles'));
  assert.equal(options.softwareCatalogPath, path.resolve('config\\software-catalog.json'));
  assert.equal(options.softwareSourceRoot, path.resolve('Softwares'));
  assert.equal(options.installerScript, path.resolve('Softwares\\Install-Apps.ps1'));
  assert.equal(options.appsRoot, path.resolve('C:\\OSDCloud\\Win11-iPXE-Lab\\Media\\OSDCloud\\Apps'));
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

test('creates a deployment profile by copying active profile software', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);

    const created = createDeploymentProfile(configFor(root), {
      name: 'Field Tech',
    }, {
      randomInt: () => 26,
    });

    assert.equal(created.profile.id, 'AAAAAAA0');
    assert.deepEqual(created.profile.softwareIds, ['one']);
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'AAAAAAA0.json'), 'utf8'));
    assert.deepEqual(raw, {
      id: 'AAAAAAA0',
      name: 'Field Tech',
      software: ['one'],
    });
    assert.equal(resolveDeploymentProfileState(configFor(root)).activeProfile.id, 'default');
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'selected-profile.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('creates a deployment profile with optional description', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);

    const created = createDeploymentProfile(configFor(root), {
      name: 'Field Tech',
      description: '  Laptop staging profile  ',
    }, {
      randomInt: () => 26,
    });

    assert.equal(created.profile.description, 'Laptop staging profile');
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'AAAAAAA0.json'), 'utf8'));
    assert.equal(raw.description, 'Laptop staging profile');
    assert.deepEqual(raw.software, ['one']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('create deployment profile generates non-colliding 8 digit ids', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    writeJson(path.join(root, 'profiles', '00000000.json'), {
      id: '00000000',
      name: 'Reserved zero',
      software: [],
    });
    writeJson(path.join(root, 'profiles', 'AAAAAAA0.json'), {
      id: 'AAAAAAA0',
      name: 'Reserved random',
      software: [],
    });

    const created = createDeploymentProfile(configFor(root), { name: 'Collision safe' }, {
      maxAttempts: 1,
      randomInt: () => 26,
    });

    assert.equal(created.profile.id, 'AAAAAAA1');
    assert.match(created.profile.id, /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{8}$/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generate deployment profile id reports exhausted id space', () => {
  assert.throws(
    () => generateDeploymentProfileId(['A1'], {
      alphabet: 'A1',
      idLength: 2,
      idSpaceSize: 2,
      maxAttempts: 0,
      randomInt: () => 0,
    }),
    /No available deployment profile ids remain/,
  );
});

test('create deployment profile rejects missing names', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);

    assert.throws(
      () => createDeploymentProfile(configFor(root), { name: '   ' }),
      /Deployment profile name is required/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('updates deployment profile software while preserving other fields', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        description: 'Keep me',
        software: ['one'],
        owner: 'ops',
      },
    });

    const updated = updateDeploymentProfileSoftware(configFor(root), 'default', ['two']);

    assert.deepEqual(updated.profile.softwareIds, ['two']);
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'default.json'), 'utf8'));
    assert.deepEqual(raw, {
      id: 'default',
      name: 'Default',
      description: 'Keep me',
      software: ['two'],
      owner: 'ops',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('updates deployment profile name and software without changing its id', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        description: 'Keep me',
        software: ['one'],
        owner: 'ops',
      },
    });

    const updated = updateDeploymentProfile(configFor(root), 'default', {
      name: 'Renamed Default',
      description: 'Updated description',
      softwareIds: ['two'],
    });

    assert.equal(updated.profile.id, 'default');
    assert.equal(updated.profile.name, 'Renamed Default');
    assert.equal(updated.profile.description, 'Updated description');
    assert.deepEqual(updated.profile.softwareIds, ['two']);
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'default.json'), 'utf8'));
    assert.deepEqual(raw, {
      id: 'default',
      name: 'Renamed Default',
      description: 'Updated description',
      software: ['two'],
      owner: 'ops',
    });
    assert.equal(resolveDeploymentProfileState(configFor(root)).activeProfile.id, 'default');

    const renamedOnly = updateDeploymentProfile(configFor(root), 'default', {
      name: 'Display Name Only',
    });
    assert.equal(renamedOnly.profile.id, 'default');
    assert.equal(renamedOnly.profile.name, 'Display Name Only');
    assert.equal(renamedOnly.profile.description, 'Updated description');
    assert.deepEqual(renamedOnly.profile.softwareIds, ['two']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('update deployment profile rejects id changes and empty names', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);

    assert.throws(
      () => updateDeploymentProfile(configFor(root), 'default', { id: 'renamed', name: 'Renamed' }),
      /id cannot be changed/,
    );
    assert.throws(
      () => updateDeploymentProfile(configFor(root), 'default', { name: '   ' }),
      /name is required/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('updates deployment profile software to an empty list', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);

    updateDeploymentProfileSoftware(configFor(root), 'default', []);
    const state = resolveDeploymentProfileState(configFor(root));

    assert.deepEqual(state.activeProfile.softwareIds, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('update deployment profile software rejects unknown and duplicate software', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);

    assert.throws(
      () => updateDeploymentProfileSoftware(configFor(root), 'default', ['one', 'one']),
      /Duplicate software id one/,
    );
    assert.throws(
      () => updateDeploymentProfileSoftware(configFor(root), 'default', ['missing']),
      /unknown software/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deletes inactive deployment profile', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    writeJson(path.join(root, 'profiles', 'inactive.json'), {
      id: 'inactive',
      name: 'Inactive',
      software: ['two'],
    });

    const deleted = deleteDeploymentProfile(configFor(root), 'inactive');

    assert.equal(deleted.profile.id, 'inactive');
    assert.equal(fs.existsSync(path.join(root, 'profiles', 'inactive.json')), false);
    assert.equal(resolveDeploymentProfileState(configFor(root)).activeProfile.id, 'default');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('delete deployment profile rejects active profile', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);

    assert.throws(
      () => deleteDeploymentProfile(configFor(root), 'default'),
      /Cannot delete active deployment profile/,
    );
    assert.equal(fs.existsSync(path.join(root, 'profiles', 'default.json')), true);
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
