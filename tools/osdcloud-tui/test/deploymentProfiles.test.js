import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createSoftwarePackage,
  createDeploymentProfile,
  deleteDeploymentProfile,
  deleteSoftwarePackage,
  deploymentProfileOptions,
  evaluateDeploymentProfilePayload,
  generateDeploymentProfileId,
  generateSoftwareId,
  loadDeploymentProfiles,
  loadSoftwareCatalog,
  publishDeploymentProfile,
  openSoftwareInstallScript,
  readSoftwareInstallScript,
  resolveDeploymentProfileState,
  updateDeploymentProfile,
  updateDeploymentProfileSoftware,
  uploadSoftwareInstaller,
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

test('loads active deployment profile with selected software order', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['two', 'one'],
      },
    });
    const state = resolveDeploymentProfileState(configFor(root));

    assert.equal(state.activeProfile.id, 'default');
    assert.deepEqual(state.activeProfile.softwareIds, ['two', 'one']);
    assert.deepEqual(state.selectedSoftware.map((software) => software.id), ['two', 'one']);
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

test('uploads and creates software package without publishing or changing active profile', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);

    const uploaded = await uploadSoftwareInstaller(config, {
      fileName: 'ToolSetup.msi',
      size: Buffer.byteLength('msi bytes'),
      buffer: Buffer.from('msi bytes'),
    }, {
      uploadId: 'upload-tool',
    });
    assert.equal(uploaded.fileName, 'ToolSetup.msi');
    assert.equal(uploaded.sha256.length, 64);
    assert.equal(fs.existsSync(path.join(root, '.osdcloud-tui', 'software-uploads', 'upload-tool', 'ToolSetup.msi')), true);

    const created = await createSoftwarePackage(config, {
      uploadId: 'upload-tool',
      name: 'Tool App',
      scriptMode: 'template',
      installerType: 'msi',
      silentArgs: '/qn /norestart REBOOT=ReallySuppress',
      successExitCodes: '0,1641,3010',
      verifyPath: 'C:\\Program Files\\Tool\\tool.exe',
    }, {
      randomInt: () => 26,
    });

    assert.equal(created.software.id, 'SW-AAAAAAA0');
    assert.equal(created.software.installerFileName, 'ToolSetup.msi');
    assert.equal(created.sha256.length, 64);
    assert.equal(fs.existsSync(path.join(root, 'Softwares', 'SW-AAAAAAA0', 'ToolSetup.msi')), true);
    const installScript = fs.readFileSync(path.join(root, 'Softwares', 'SW-AAAAAAA0', 'install.ps1'), 'utf8');
    assert.match(installScript, /\$ErrorActionPreference = 'Stop'/);
    assert.match(installScript, /msiexec\.exe/);
    assert.match(installScript, /C:\\Program Files\\Tool\\tool\.exe/);
    assert.match(installScript, /verification file was not found/);
    assert.equal(fs.existsSync(path.join(root, '.osdcloud-tui', 'software-uploads', 'upload-tool')), false);

    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'software-catalog.json'), 'utf8'));
    assert.deepEqual(catalog.software.map((software) => software.id), ['one', 'two', 'SW-AAAAAAA0']);
    const catalogEntry = catalog.software.find((software) => software.id === 'SW-AAAAAAA0');
    assert.equal(catalogEntry.scriptMode, 'template');
    assert.equal(catalogEntry.installerType, 'msi');
    assert.equal(catalogEntry.installerFileName, 'ToolSetup.msi');
    assert.equal(catalogEntry.silentArgs, '/qn /norestart REBOOT=ReallySuppress');
    assert.deepEqual(catalogEntry.successExitCodes, [0, 1641, 3010]);
    assert.equal(catalogEntry.verifyPath, 'C:\\Program Files\\Tool\\tool.exe');
    assert.equal(catalogEntry.verificationMode, 'installed file');
    assert.equal(catalogEntry.installerBytes, Buffer.byteLength('msi bytes'));
    assert.equal(catalogEntry.installerSha256.length, 64);
    const state = resolveDeploymentProfileState(config);
    assert.deepEqual(state.activeProfile.softwareIds, ['one']);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'selected-profile.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loads software install details from legacy generated install script', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      catalog: [{ id: 'tool', name: 'Tool App', source: 'tool' }],
    });
    const softwareRoot = path.join(root, 'Softwares', 'tool');
    fs.mkdirSync(softwareRoot, { recursive: true });
    fs.writeFileSync(path.join(softwareRoot, 'tool.msi'), 'tool installer', 'utf8');
    fs.writeFileSync(path.join(softwareRoot, 'install.ps1'), `$ErrorActionPreference = 'Stop'
$installerPath = Join-Path $PSScriptRoot 'tool.msi'
$silentArgs = '/qn /norestart'
$successExitCodes = @(0, 1641, 3010)
Write-Host ('Tool App' + ' installed; no installed-file verification configured')
`, 'utf8');

    const catalog = loadSoftwareCatalog(configFor(root));
    const software = catalog.byId.get('tool');
    assert.equal(software.scriptMode, 'template');
    assert.equal(software.installerFileName, 'tool.msi');
    assert.equal(software.installerType, 'msi');
    assert.equal(software.silentArgs, '/qn /norestart');
    assert.deepEqual(software.successExitCodes, [0, 1641, 3010]);
    assert.equal(software.verificationMode, 'installer exit code only');
    assert.equal(software.installerBytes, Buffer.byteLength('tool installer'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('creates template software package without installed-file verification', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);

    await uploadSoftwareInstaller(config, {
      fileName: 'ExitCodeOnly.msi',
      buffer: Buffer.from('msi bytes'),
    }, {
      uploadId: 'upload-exit-code-only',
    });

    const created = await createSoftwarePackage(config, {
      uploadId: 'upload-exit-code-only',
      name: 'Exit Code Only App',
      scriptMode: 'template',
      installerType: 'msi',
      silentArgs: '/qn /norestart REBOOT=ReallySuppress',
      successExitCodes: '0,1641,3010',
    }, {
      randomInt: () => 27,
    });

    assert.equal(created.software.id, 'SW-AAAAAAA1');
    const installScript = fs.readFileSync(path.join(root, 'Softwares', 'SW-AAAAAAA1', 'install.ps1'), 'utf8');
    assert.match(installScript, /Installer not found/);
    assert.match(installScript, /msiexec\.exe/);
    assert.match(installScript, /\$successExitCodes = @\(0, 1641, 3010\)/);
    assert.match(installScript, /no installed-file verification configured/);
    assert.doesNotMatch(installScript, /\$verifyPath =/);
    assert.doesNotMatch(installScript, /verification file was not found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('creates software package with raw install script', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);

    await uploadSoftwareInstaller(config, {
      fileName: 'tool.exe',
      buffer: Buffer.from('exe bytes'),
    }, {
      uploadId: 'upload-raw',
    });

    await createSoftwarePackage(config, {
      uploadId: 'upload-raw',
      name: 'Raw Tool',
      scriptMode: 'raw',
      installerType: 'exe',
      rawScript: "$ErrorActionPreference = 'Stop'\nWrite-Host 'raw install'\n",
    }, {
      randomInt: () => 27,
    });

    assert.equal(
      fs.readFileSync(path.join(root, 'Softwares', 'SW-AAAAAAA1', 'install.ps1'), 'utf8'),
      "$ErrorActionPreference = 'Stop'\nWrite-Host 'raw install'\n",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software package onboarding rejects unsafe inputs and user supplied ids', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);

    await assert.rejects(() => uploadSoftwareInstaller(config, {
      fileName: '..\\bad.msi',
      buffer: Buffer.from('bad'),
    }), /plain file name/);
    await assert.rejects(() => uploadSoftwareInstaller(config, {
      fileName: 'bad.zip',
      buffer: Buffer.from('bad'),
    }), /\.msi or \.exe/);

    await uploadSoftwareInstaller(config, {
      fileName: 'explicit.msi',
      buffer: Buffer.from('explicit'),
    }, {
      uploadId: 'upload-explicit',
    });
    await assert.rejects(() => createSoftwarePackage(config, {
      uploadId: 'upload-explicit',
      id: 'one',
      name: 'Explicit One',
      scriptMode: 'template',
      installerType: 'msi',
      verifyPath: 'C:\\Program Files\\One\\one.exe',
    }), /generated by the server/);
    assert.equal(fs.existsSync(path.join(root, 'Softwares', 'one')), true);
    assert.equal(fs.existsSync(path.join(root, '.osdcloud-tui', 'software-uploads', 'upload-explicit')), true);

    await assert.rejects(() => createSoftwarePackage(config, {
      uploadId: 'bad\\upload',
      name: 'Bad ID',
      scriptMode: 'raw',
      installerType: 'msi',
      rawScript: 'Write-Host bad',
    }), /Invalid software upload id/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software id generation avoids reserved catalog ids and source folders', () => {
  assert.equal(
    generateSoftwareId(['SW-AAAAAAA0', 'sw-aaaaaaa1'], {
      randomInt: () => 26,
      maxAttempts: 1,
    }),
    'SW-AAAAAAA2',
  );
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

    const updated = updateDeploymentProfileSoftware(configFor(root), 'default', ['two', 'one']);

    assert.deepEqual(updated.profile.softwareIds, ['two', 'one']);
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'default.json'), 'utf8'));
    assert.deepEqual(raw, {
      id: 'default',
      name: 'Default',
      description: 'Keep me',
      software: ['two', 'one'],
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

test('deletes unused software package from catalog and source folder', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);

    const deleted = deleteSoftwarePackage(config, 'two');

    assert.equal(deleted.software.id, 'two');
    assert.equal(fs.existsSync(path.join(root, 'Softwares', 'two')), false);
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'software-catalog.json'), 'utf8'));
    assert.deepEqual(catalog.software.map((software) => software.id), ['one']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('delete software package rejects software used by any profile', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['one'],
      },
    });
    const config = configFor(root);

    assert.throws(() => deleteSoftwarePackage(config, 'one'), /still used by deployment profiles: Default/);
    assert.equal(fs.existsSync(path.join(root, 'Softwares', 'one')), true);
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'software-catalog.json'), 'utf8'));
    assert.deepEqual(catalog.software.map((software) => software.id), ['one', 'two']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reads catalog install.ps1 content safely', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);

    const result = readSoftwareInstallScript(config, 'one');

    assert.equal(result.softwareId, 'one');
    assert.equal(result.filePath, path.join(root, 'Softwares', 'one', 'install.ps1'));
    assert.match(result.content, /installed/);
    assert.throws(() => readSoftwareInstallScript(config, 'missing'), /Software not found: missing/);
    assert.throws(() => readSoftwareInstallScript(config, '..\\bad'), /Invalid software id/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('opens catalog install.ps1 with Open With first', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);
    const calls = [];

    const result = await openSoftwareInstallScript(config, 'one', {
      openScript: async (scriptPath, method) => {
        calls.push({ scriptPath, method });
      },
    });

    assert.equal(result.softwareId, 'one');
    assert.equal(result.filePath, path.join(root, 'Softwares', 'one', 'install.ps1'));
    assert.equal(result.opened, true);
    assert.equal(result.method, 'open-with');
    assert.deepEqual(calls, [
      { scriptPath: path.join(root, 'Softwares', 'one', 'install.ps1'), method: 'open-with' },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('open catalog install.ps1 falls back to default open', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);
    const calls = [];

    const result = await openSoftwareInstallScript(config, 'one', {
      openScript: async (scriptPath, method) => {
        calls.push({ scriptPath, method });
        throw new Error('chooser failed');
      },
      openDefaultScript: async (scriptPath, error) => {
        calls.push({ scriptPath, method: 'default-open', error: error.message });
      },
    });

    assert.equal(result.softwareId, 'one');
    assert.equal(result.opened, true);
    assert.equal(result.method, 'default-open');
    assert.deepEqual(calls, [
      { scriptPath: path.join(root, 'Softwares', 'one', 'install.ps1'), method: 'open-with' },
      { scriptPath: path.join(root, 'Softwares', 'one', 'install.ps1'), method: 'default-open', error: 'chooser failed' },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('read install script rejects missing script', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      catalog: [
        { id: 'missing-script', name: 'Missing Script', source: 'missing-script' },
      ],
      defaultProfile: { id: 'default', name: 'Default', software: [] },
    });
    fs.mkdirSync(path.join(root, 'Softwares', 'missing-script'), { recursive: true });
    const config = configFor(root);

    assert.throws(() => readSoftwareInstallScript(config, 'missing-script'), /install\.ps1 not found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('read install script rejects escaped catalog source', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      catalog: [
        { id: 'escaped', name: 'Escaped', source: '..\\outside' },
      ],
      defaultProfile: { id: 'default', name: 'Default', software: [] },
    });
    const config = configFor(root);

    assert.throws(() => readSoftwareInstallScript(config, 'escaped'), /escapes root/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publishes only selected software and removes stale apps', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['two', 'one'],
      },
    });
    fs.mkdirSync(path.join(root, 'Apps', 'stale'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Apps', 'stale', 'install.ps1'), "Write-Host 'stale'\n", 'utf8');

    const result = publishDeploymentProfile(configFor(root));

    assert.equal(result.profile.id, 'default');
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'Install-Apps.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'selected-profile.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'one', 'install.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'two', 'install.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'stale')), false);
    assert.deepEqual(result.copied, ['two', 'one']);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Apps', 'selected-profile.json'), 'utf8'));
    assert.equal(manifest.profileId, 'default');
    assert.deepEqual(manifest.selectedSoftware, ['two', 'one']);
    assert.deepEqual(manifest.software.map((software) => software.id), ['two', 'one']);
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

test('installer script installs selected apps in selected-profile order', () => {
  if (process.platform !== 'win32') {
    return;
  }

  const root = makeRoot('osdcloud-installer-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    fs.mkdirSync(path.join(appsRoot, 'one'), { recursive: true });
    fs.mkdirSync(path.join(appsRoot, 'two'), { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    fs.writeFileSync(path.join(appsRoot, 'one', 'install.ps1'), "Add-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'order.marker') -Value 'one'\nSet-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'one.marker') -Value 'one'\n", 'utf8');
    fs.writeFileSync(path.join(appsRoot, 'two', 'install.ps1'), "Add-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'order.marker') -Value 'two'\nSet-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'two.marker') -Value 'two'\n", 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'default',
      selectedSoftware: ['two', 'one'],
      software: [
        { id: 'two', name: 'Two App' },
        { id: 'one', name: 'One App' },
      ],
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
    assert.equal(fs.existsSync(path.join(appsRoot, 'two.marker')), true);
    const order = fs.readFileSync(path.join(appsRoot, 'order.marker'), 'utf8').trim().split(/\r?\n/u);
    assert.deepEqual(order, ['two', 'one']);
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
