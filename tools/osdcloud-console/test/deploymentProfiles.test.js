import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createCustomScript,
  createSoftwarePackage,
  createDeploymentProfile,
  deleteCustomScript,
  deleteDeploymentProfile,
  deleteSoftwarePackage,
  deploymentProfileOptions,
  evaluateDeploymentProfilePayload,
  generateCustomScriptId,
  generateDeploymentProfileId,
  generateSoftwareId,
  loadCustomScriptCatalog,
  loadDeploymentProfiles,
  loadSoftwareCatalog,
  publishDeploymentProfile,
  openSoftwareInstallScript,
  readCustomScriptContent,
  readSoftwareInstallScript,
  resolveDeploymentProfileState,
  updateDeploymentProfile,
  updateDeploymentProfileSoftware,
  uploadCustomScript,
  uploadSoftwareInstaller,
} from '../src/deploymentProfiles.js';

function makeRoot(prefix = 'osdcloud-profile-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex').toUpperCase();
}

function catalogSoftware(id, name) {
  const installerContent = `${id} installer`;
  return {
    id,
    name,
    source: id,
    installerFileName: `${id}.msi`,
    installerBytes: Buffer.byteLength(installerContent),
    installerSha256: sha256Text(installerContent),
  };
}

function writeSoftware(root, id, script = "Write-Host 'installed'\n") {
  const softwareRoot = path.join(root, 'Softwares', id);
  fs.mkdirSync(softwareRoot, { recursive: true });
  fs.writeFileSync(path.join(softwareRoot, `${id}.msi`), `${id} installer`, 'utf8');
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
      softwarePayloadStagingRoot: path.join(root, '.downloads', 'software-payloads'),
      customScriptsCatalogPath: 'scripts-catalog.json',
      customScriptsSourceRoot: 'Scripts',
      customScriptsAppsRoot: path.join(root, 'Media', 'Scripts'),
      ...overrides,
    },
    osImage: {
      activeImage: 'TEST-OS',
    },
  };
}

function writeBaseFiles(root, options = {}) {
  writeSoftware(root, 'one');
  writeSoftware(root, 'two');
  writeInstallerScript(root);
  writeJson(path.join(root, 'software-catalog.json'), {
    software: options.catalog ?? [
      catalogSoftware('one', 'One App'),
      catalogSoftware('two', 'Two App'),
    ],
  });
  writeJson(path.join(root, 'profiles', 'default.json'), options.defaultProfile ?? {
    id: 'default',
    name: 'Default',
    software: ['one'],
    osImage: 'TEST-OS',
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
      appsRoot: 'C:\\OSDCloud\\Media\\OSDCloud\\Apps',
      installerScript: 'Softwares\\Install-Apps.ps1',
    },
  });

  assert.equal(options.profilesRoot, path.resolve('config\\deployment-profiles'));
  assert.equal(options.softwareCatalogPath, path.resolve('config\\software-catalog.json'));
  assert.equal(options.softwareSourceRoot, path.resolve('Softwares'));
  assert.equal(options.installerScript, path.resolve('Softwares\\Install-Apps.ps1'));
  assert.equal(options.appsRoot, path.resolve('C:\\OSDCloud\\Media\\OSDCloud\\Apps'));
});

test('resolves mutable deployment profile paths from state root and installer script from app root', () => {
  const appRoot = path.join(os.tmpdir(), 'osdcloud-app-root');
  const stateRoot = path.join(os.tmpdir(), 'osdcloud-state-root');
  const options = deploymentProfileOptions({
    paths: {
      appRoot,
      stateRoot,
    },
    deploymentProfiles: {
      profilesRoot: 'config\\deployment-profiles',
      softwareCatalogPath: 'config\\software-catalog.json',
      softwareSourceRoot: 'Softwares',
      appsRoot: 'C:\\OSDCloud\\Media\\OSDCloud\\Apps',
      installerScript: 'Softwares\\Install-Apps.ps1',
      customScriptsCatalogPath: 'config\\scripts-catalog.json',
      customScriptsSourceRoot: 'Scripts',
    },
  });

  assert.equal(options.profilesRoot, path.resolve(stateRoot, 'config\\deployment-profiles'));
  assert.equal(options.softwareCatalogPath, path.resolve(stateRoot, 'config\\software-catalog.json'));
  assert.equal(options.softwareSourceRoot, path.resolve(stateRoot, 'Softwares'));
  assert.equal(options.installerScript, path.resolve(appRoot, 'Softwares\\Install-Apps.ps1'));
  assert.equal(options.customScriptsCatalogPath, path.resolve(stateRoot, 'config\\scripts-catalog.json'));
  assert.equal(options.customScriptsSourceRoot, path.resolve(stateRoot, 'Scripts'));
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
    assert.equal(fs.existsSync(path.join(root, '.osdcloud-console', 'software-uploads', 'upload-tool', 'ToolSetup.msi')), true);

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
    assert.equal(fs.existsSync(path.join(root, '.osdcloud-console', 'software-uploads', 'upload-tool')), false);

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
    assert.equal(fs.existsSync(path.join(root, '.osdcloud-console', 'software-uploads', 'upload-explicit')), true);

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
      osImage: 'TEST-OS',
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
      osImage: 'TEST-OS',
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
      osImage: 'TEST-OS',
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

test('publishes only selected software and removes stale apps', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['two', 'one'],
        osImage: 'TEST-OS',
      },
    });
    fs.mkdirSync(path.join(root, 'Apps', 'stale'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Apps', 'stale', 'install.ps1'), "Write-Host 'stale'\n", 'utf8');

    const result = await publishDeploymentProfile(configFor(root));

    assert.equal(result.profile.id, 'default');
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'Install-Apps.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'selected-profile.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'one', 'install.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'two', 'install.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'stale')), false);
    assert.deepEqual(result.copied, ['two', 'one']);
    assert.deepEqual(result.softwarePayloads.map((payload) => `${payload.id}:${payload.status}`), ['two:reused', 'one:reused']);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Apps', 'selected-profile.json'), 'utf8'));
    assert.equal(manifest.profileId, 'default');
    assert.deepEqual(manifest.selectedSoftware, ['two', 'one']);
    assert.deepEqual(manifest.software.map((software) => software.id), ['two', 'one']);
    assert.equal(evaluateDeploymentProfilePayload(configFor(root)).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publishes Minimal profile without downloading software payloads', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Minimal',
        software: [],
        osImage: 'TEST-OS',
      },
    });
    const result = await publishDeploymentProfile(configFor(root), null, {
      downloadSoftwarePayload() {
        throw new Error('download should not run');
      },
    });

    assert.deepEqual(result.selectedSoftware, []);
    assert.deepEqual(result.softwarePayloads, []);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'Install-Apps.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'one')), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Apps', 'selected-profile.json'), 'utf8'));
    assert.deepEqual(manifest.selectedSoftware, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('profile publish downloads only missing selected software payloads', async () => {
  const root = makeRoot();
  try {
    const downloadedContent = 'one payload from catalog';
    writeBaseFiles(root, {
      catalog: [{
        ...catalogSoftware('one', 'One App'),
        installerBytes: Buffer.byteLength(downloadedContent),
        installerSha256: sha256Text(downloadedContent),
        downloadUrl: 'https://example.test/one.msi',
      }, catalogSoftware('two', 'Two App')],
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['one'],
        osImage: 'TEST-OS',
      },
    });
    fs.rmSync(path.join(root, 'Softwares', 'one', 'one.msi'));
    const downloadedIds = [];

    const result = await publishDeploymentProfile(configFor(root), null, {
      downloadSoftwarePayload(software, stagingPath) {
        downloadedIds.push(software.id);
        fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
        fs.writeFileSync(stagingPath, downloadedContent, 'utf8');
        return { filePath: stagingPath };
      },
    });

    assert.deepEqual(downloadedIds, ['one']);
    assert.deepEqual(result.copied, ['one']);
    assert.deepEqual(result.softwarePayloads.map((payload) => `${payload.id}:${payload.status}`), ['one:downloaded']);
    assert.equal(fs.readFileSync(path.join(root, 'Softwares', 'one', 'one.msi'), 'utf8'), downloadedContent);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'one', 'one.msi')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'two')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('profile publish allows downloadUrl-only selected software payloads', async () => {
  const root = makeRoot();
  try {
    const downloadedContent = 'latest payload without pinned metadata';
    writeBaseFiles(root, {
      catalog: [{
        id: 'one',
        name: 'One App',
        source: 'one',
        installerFileName: 'one.msi',
        downloadUrl: 'https://example.test/one.msi',
      }],
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['one'],
        osImage: 'TEST-OS',
      },
    });
    fs.rmSync(path.join(root, 'Softwares', 'one', 'one.msi'));

    const result = await publishDeploymentProfile(configFor(root), null, {
      downloadSoftwarePayload(_software, stagingPath) {
        fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
        fs.writeFileSync(stagingPath, downloadedContent, 'utf8');
        return { filePath: stagingPath };
      },
    });

    assert.deepEqual(result.softwarePayloads.map((payload) => `${payload.id}:${payload.status}`), ['one:downloaded']);
    assert.equal(fs.readFileSync(path.join(root, 'Softwares', 'one', 'one.msi'), 'utf8'), downloadedContent);
    assert.equal(fs.readFileSync(path.join(root, 'Apps', 'one', 'one.msi'), 'utf8'), downloadedContent);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('All in One publish restores only selected software payloads in profile order', async () => {
  const root = makeRoot();
  try {
    for (const id of ['7zip', 'chrome', 'SW-4UT7PDID', 'unused']) {
      writeSoftware(root, id);
    }
    writeInstallerScript(root);
    writeJson(path.join(root, 'software-catalog.json'), {
      software: [
        catalogSoftware('7zip', '7-Zip'),
        catalogSoftware('chrome', 'Chrome'),
        catalogSoftware('SW-4UT7PDID', 'Notepad++'),
        catalogSoftware('unused', 'Unused'),
      ],
    });
    writeJson(path.join(root, 'profiles', 'default.json'), {
      id: 'default',
      name: 'All in One',
      software: ['7zip', 'chrome', 'SW-4UT7PDID'],
      osImage: 'TEST-OS',
    });

    const result = await publishDeploymentProfile(configFor(root));

    assert.deepEqual(result.copied, ['7zip', 'chrome', 'SW-4UT7PDID']);
    assert.deepEqual(result.softwarePayloads.map((payload) => payload.id), ['7zip', 'chrome', 'SW-4UT7PDID']);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'unused')), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Apps', 'selected-profile.json'), 'utf8'));
    assert.deepEqual(manifest.selectedSoftware, ['7zip', 'chrome', 'SW-4UT7PDID']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('profile publish fails closed when selected installer is missing without downloadUrl', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['one'],
        osImage: 'TEST-OS',
      },
    });
    fs.mkdirSync(path.join(root, 'Apps', 'stale'), { recursive: true });
    fs.rmSync(path.join(root, 'Softwares', 'one', 'one.msi'));

    await assert.rejects(
      () => publishDeploymentProfile(configFor(root)),
      /Selected software payload missing for one .* no downloadUrl is configured/,
    );
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'stale')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'selected-profile.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('profile publish fails before live Apps changes when downloaded payload fails validation', async () => {
  const root = makeRoot();
  try {
    const expectedContent = 'expected one payload';
    writeBaseFiles(root, {
      catalog: [{
        ...catalogSoftware('one', 'One App'),
        installerBytes: Buffer.byteLength(expectedContent),
        installerSha256: sha256Text(expectedContent),
        downloadUrl: 'https://example.test/one.msi',
      }],
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['one'],
        osImage: 'TEST-OS',
      },
    });
    fs.mkdirSync(path.join(root, 'Apps', 'stale'), { recursive: true });
    fs.rmSync(path.join(root, 'Softwares', 'one', 'one.msi'));

    await assert.rejects(
      () => publishDeploymentProfile(configFor(root), null, {
        downloadSoftwarePayload(_software, stagingPath) {
          fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
          fs.writeFileSync(stagingPath, 'bad payload', 'utf8');
          return { filePath: stagingPath };
        },
      }),
      /Downloaded software payload failed validation for one/,
    );
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'stale')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'selected-profile.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'one')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to publish outside an Apps folder', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);

    await assert.rejects(
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
    ], {
      encoding: 'utf8',
      env: { ...process.env, OSDCloudLogDir: path.join(root, 'logs') },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(path.join(appsRoot, 'one.marker')), true);
    assert.equal(fs.existsSync(path.join(appsRoot, 'two.marker')), true);
    const order = fs.readFileSync(path.join(appsRoot, 'order.marker'), 'utf8').trim().split(/\r?\n/u);
    assert.deepEqual(order, ['two', 'one']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script follows unified software and script install sequence', () => {
  if (process.platform !== 'win32') {
    return;
  }
  const root = makeRoot();
  try {
    const appsRoot = path.join(root, 'Apps');
    const scriptsRoot = path.join(root, 'Scripts');
    const marker = path.join(appsRoot, 'order.marker');
    fs.mkdirSync(path.join(appsRoot, 'one'), { recursive: true });
    fs.mkdirSync(path.join(appsRoot, 'two'), { recursive: true });
    fs.mkdirSync(path.join(scriptsRoot, 'SC-MIDDLE1'), { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    fs.writeFileSync(path.join(appsRoot, 'one', 'install.ps1'), "Add-Content -LiteralPath $env:ORDER_MARKER -Value 'one'\n", 'utf8');
    fs.writeFileSync(path.join(appsRoot, 'two', 'install.ps1'), "Add-Content -LiteralPath $env:ORDER_MARKER -Value 'two'\n", 'utf8');
    fs.writeFileSync(path.join(scriptsRoot, 'SC-MIDDLE1', 'run.ps1'), "Add-Content -LiteralPath $env:ORDER_MARKER -Value 'script'\n", 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'default',
      selectedSoftware: ['one', 'two'],
      customScripts: [{ id: 'SC-MIDDLE1', name: 'Middle Script', phase: 'after' }],
      installSequence: [
        { type: 'software', id: 'one' },
        { type: 'script', id: 'SC-MIDDLE1', phase: 'after' },
        { type: 'software', id: 'two' },
      ],
    });

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(appsRoot, 'Install-Apps.ps1'),
    ], {
      encoding: 'utf8',
      env: { ...process.env, OSDCloudLogDir: path.join(root, 'logs'), ORDER_MARKER: marker },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(fs.readFileSync(marker, 'utf8').trim().split(/\r?\n/u), ['one', 'script', 'two']);
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
    ], {
      encoding: 'utf8',
      env: { ...process.env, OSDCloudLogDir: path.join(root, 'logs') },
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Selected app script not found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script runs custom scripts with per-script logs and summary', () => {
  if (process.platform !== 'win32') {
    return;
  }

  const root = makeRoot('osdcloud-custom-script-success-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    const scriptsRoot = path.join(root, 'Scripts');
    const logRoot = path.join(root, 'Logs');
    const marker = path.join(root, 'order.marker');
    fs.mkdirSync(path.join(scriptsRoot, 'SC-BEFORE01'), { recursive: true });
    fs.mkdirSync(path.join(scriptsRoot, 'SC-AFTER001'), { recursive: true });
    fs.mkdirSync(appsRoot, { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    fs.writeFileSync(path.join(scriptsRoot, 'SC-BEFORE01', 'run.ps1'), "Add-Content -LiteralPath $env:ORDER_MARKER -Value 'before'\n", 'utf8');
    fs.writeFileSync(path.join(scriptsRoot, 'SC-AFTER001', 'run.ps1'), "Add-Content -LiteralPath $env:ORDER_MARKER -Value 'after'\n", 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'default',
      selectedSoftware: [],
      customScripts: [
        { id: 'SC-AFTER001', name: 'After Script', phase: 'after' },
        { id: 'SC-BEFORE01', name: 'Before Script', phase: 'before' },
      ],
    });

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(appsRoot, 'Install-Apps.ps1'),
    ], {
      encoding: 'utf8',
      env: { ...process.env, OSDCloudLogDir: logRoot, ORDER_MARKER: marker },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const order = fs.readFileSync(marker, 'utf8').trim().split(/\r?\n/u);
    assert.deepEqual(order, ['before', 'after']);
    const summary = JSON.parse(fs.readFileSync(path.join(logRoot, 'custom-scripts-summary.json'), 'utf8'));
    assert.equal(summary.total, 2);
    assert.equal(summary.succeeded, 2);
    assert.equal(summary.failed, 0);
    assert.equal(summary.missing, 0);
    assert.deepEqual(summary.scripts.map((script) => script.status), ['succeeded', 'succeeded']);
    const logFiles = fs.readdirSync(path.join(logRoot, 'custom-scripts'));
    assert.equal(logFiles.length, 2);
    assert.ok(logFiles.some((name) => /^SC-BEFORE01-before-/u.test(name)));
    assert.ok(logFiles.some((name) => /^SC-AFTER001-after-/u.test(name)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script records failed and missing custom scripts before failing', () => {
  if (process.platform !== 'win32') {
    return;
  }

  const root = makeRoot('osdcloud-custom-script-failure-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    const scriptsRoot = path.join(root, 'Scripts');
    const logRoot = path.join(root, 'Logs');
    const marker = path.join(root, 'order.marker');
    fs.mkdirSync(path.join(scriptsRoot, 'SC-GOOD000'), { recursive: true });
    fs.mkdirSync(path.join(scriptsRoot, 'SC-BAD0000'), { recursive: true });
    fs.mkdirSync(appsRoot, { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    fs.writeFileSync(path.join(scriptsRoot, 'SC-GOOD000', 'run.ps1'), "Add-Content -LiteralPath $env:ORDER_MARKER -Value 'good'\n", 'utf8');
    fs.writeFileSync(path.join(scriptsRoot, 'SC-BAD0000', 'run.ps1'), "Write-Host 'bad script ran'\nexit 7\n", 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'default',
      selectedSoftware: [],
      customScripts: [
        { id: 'SC-GOOD000', name: 'Good Script', phase: 'before' },
        { id: 'SC-BAD0000', name: 'Bad Script', phase: 'after' },
        { id: 'SC-MISS000', name: 'Missing Script', phase: 'after' },
      ],
    });

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(appsRoot, 'Install-Apps.ps1'),
    ], {
      encoding: 'utf8',
      env: { ...process.env, OSDCloudLogDir: logRoot, ORDER_MARKER: marker },
    });

    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(marker, 'utf8').trim(), 'good');
    const summary = JSON.parse(fs.readFileSync(path.join(logRoot, 'custom-scripts-summary.json'), 'utf8'));
    assert.equal(summary.total, 3);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.missing, 1);
    assert.deepEqual(summary.scripts.map((script) => script.status), ['succeeded', 'failed', 'missing']);
    const bad = summary.scripts.find((script) => script.id === 'SC-BAD0000');
    assert.equal(bad.exitCode, 7);
    assert.match(bad.error, /exited with code 7/);
    const missing = summary.scripts.find((script) => script.id === 'SC-MISS000');
    assert.match(missing.error, /not found/);
    const logFiles = fs.readdirSync(path.join(logRoot, 'custom-scripts'));
    assert.equal(logFiles.length, 3);
    const badLog = fs.readFileSync(path.join(logRoot, 'custom-scripts', logFiles.find((name) => /^SC-BAD0000-after-/u.test(name))), 'utf8');
    assert.match(badLog, /bad script ran/);
    assert.match(badLog, /ExitCode: 7/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uploads and creates a custom script package', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);

    const uploaded = await uploadCustomScript(config, {
      fileName: 'firewall.ps1',
      buffer: Buffer.from("Write-Host 'firewall rule'\n"),
    }, {
      uploadId: 'upload-script',
    });
    assert.equal(uploaded.fileName, 'firewall.ps1');
    assert.equal(uploaded.sha256.length, 64);

    const created = await createCustomScript(config, {
      uploadId: 'upload-script',
      name: 'Firewall Tweaks',
      defaultPhase: 'after',
    }, {
      randomInt: () => 26,
    });
    assert.equal(created.script.id, 'SC-AAAAAAA0');
    assert.equal(created.script.fileName, 'firewall.ps1');
    assert.equal(created.script.defaultPhase, 'after');
    const runScriptPath = path.join(root, 'Scripts', 'SC-AAAAAAA0', 'run.ps1');
    assert.equal(fs.existsSync(runScriptPath), true);
    assert.equal(fs.readFileSync(runScriptPath, 'utf8'), "Write-Host 'firewall rule'\n");

    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'scripts-catalog.json'), 'utf8'));
    assert.deepEqual(catalog.scripts.map((script) => script.id), ['SC-AAAAAAA0']);
    assert.equal(catalog.scripts[0].defaultPhase, 'after');

    const content = readCustomScriptContent(config, 'SC-AAAAAAA0');
    assert.equal(content.content, "Write-Host 'firewall rule'\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects non-ps1 custom script upload', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);

    await assert.rejects(() => uploadCustomScript(config, {
      fileName: 'install.exe',
      buffer: Buffer.from('binary'),
    }, { uploadId: 'upload-bad' }), /must end with \.ps1/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('profile customScripts must reference a known script', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['one'],
        customScripts: [{ id: 'SC-NOPE0001', phase: 'after' }],
      },
    });

    assert.throws(() => loadDeploymentProfiles(configFor(root)), /unknown custom script/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('profile customScripts rejects invalid phase', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    fs.writeFileSync(path.join(root, 'scripts-catalog.json'), JSON.stringify({
      scripts: [{ id: 'SC-AAAAAAA0', name: 'Firewall', source: 'SC-AAAAAAA0', fileName: 'run.ps1', defaultPhase: 'after' }],
    }), 'utf8');
    fs.mkdirSync(path.join(root, 'Scripts', 'SC-AAAAAAA0'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Scripts', 'SC-AAAAAAA0', 'run.ps1'), "Write-Host 'fw'\n", 'utf8');
    writeJson(path.join(root, 'profiles', 'default.json'), {
      id: 'default',
      name: 'Default',
      software: ['one'],
      customScripts: [{ id: 'SC-AAAAAAA0', phase: 'midway' }],
      osImage: 'TEST-OS',
    });

    assert.throws(() => loadDeploymentProfiles(configFor(root)), /must be 'before' or 'after'/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDeploymentProfileState exposes selected custom scripts with phase', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);
    await uploadCustomScript(config, {
      fileName: 'firewall.ps1',
      buffer: Buffer.from("Write-Host 'firewall'\n"),
    }, { uploadId: 'upload-fw' });
    const created = await createCustomScript(config, {
      uploadId: 'upload-fw',
      name: 'Firewall',
      defaultPhase: 'before',
    }, { randomInt: () => 26 });

    const profile = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'default.json'), 'utf8'));
    profile.customScripts = [{ id: created.script.id, phase: 'after' }];
    fs.writeFileSync(path.join(root, 'profiles', 'default.json'), JSON.stringify(profile, null, 2), 'utf8');

    const state = resolveDeploymentProfileState(config);
    assert.equal(state.selectedScripts.length, 1);
    assert.equal(state.selectedScripts[0].id, created.script.id);
    assert.equal(state.selectedScripts[0].phase, 'after');
    assert.equal(state.selectedScripts[0].defaultPhase, 'before');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publishDeploymentProfile copies scripts and writes customScripts manifest', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);

    await uploadCustomScript(config, {
      fileName: 'before.ps1',
      buffer: Buffer.from("Write-Host 'before'\n"),
    }, { uploadId: 'upload-before' });
    const beforeScript = await createCustomScript(config, {
      uploadId: 'upload-before',
      name: 'Before Script',
      defaultPhase: 'before',
    }, { randomInt: () => 26 });

    await uploadCustomScript(config, {
      fileName: 'after.ps1',
      buffer: Buffer.from("Write-Host 'after'\n"),
    }, { uploadId: 'upload-after' });
    const afterScript = await createCustomScript(config, {
      uploadId: 'upload-after',
      name: 'After Script',
      defaultPhase: 'after',
    }, { randomInt: () => 27 });

    const profile = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'default.json'), 'utf8'));
    profile.customScripts = [
      { id: afterScript.script.id, phase: 'after' },
      { id: beforeScript.script.id, phase: 'before' },
    ];
    fs.writeFileSync(path.join(root, 'profiles', 'default.json'), JSON.stringify(profile, null, 2), 'utf8');

    const result = await publishDeploymentProfile(config);
    assert.equal(result.customScripts.copied.length, 2);
    const publishedScriptsRoot = path.join(root, 'Media', 'Scripts');
    assert.equal(fs.existsSync(path.join(publishedScriptsRoot, beforeScript.script.id, 'run.ps1')), true);
    assert.equal(fs.existsSync(path.join(publishedScriptsRoot, afterScript.script.id, 'run.ps1')), true);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Apps', 'selected-profile.json'), 'utf8'));
    assert.deepEqual(manifest.customScripts.map((entry) => entry.id), [beforeScript.script.id, afterScript.script.id]);
    assert.deepEqual(manifest.customScripts.map((entry) => entry.phase), ['before', 'after']);
    assert.deepEqual(manifest.installSequence, [
      { type: 'script', id: beforeScript.script.id, phase: 'before' },
      { type: 'software', id: 'one' },
      { type: 'script', id: afterScript.script.id, phase: 'after' },
    ]);
    assert.equal(evaluateDeploymentProfilePayload(config).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deleteCustomScript refuses when a profile still references it', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);

    await uploadCustomScript(config, {
      fileName: 'firewall.ps1',
      buffer: Buffer.from("Write-Host 'firewall'\n"),
    }, { uploadId: 'upload-fw' });
    const created = await createCustomScript(config, {
      uploadId: 'upload-fw',
      name: 'Firewall',
      defaultPhase: 'after',
    }, { randomInt: () => 26 });

    const profile = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'default.json'), 'utf8'));
    profile.customScripts = [{ id: created.script.id, phase: 'after' }];
    fs.writeFileSync(path.join(root, 'profiles', 'default.json'), JSON.stringify(profile, null, 2), 'utf8');

    assert.throws(() => deleteCustomScript(config, created.script.id), /still used by deployment profiles/);

    profile.customScripts = [];
    fs.writeFileSync(path.join(root, 'profiles', 'default.json'), JSON.stringify(profile, null, 2), 'utf8');
    const deleted = deleteCustomScript(config, created.script.id);
    assert.equal(deleted.script.id, created.script.id);
    assert.equal(fs.existsSync(path.join(root, 'Scripts', created.script.id)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generateCustomScriptId produces SC- prefixed ids', () => {
  const id = generateCustomScriptId([], { randomInt: () => 26 });
  assert.match(id, /^SC-/);
});

test('loadCustomScriptCatalog returns empty when no catalog file exists', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    fs.rmSync(path.join(root, 'scripts-catalog.json'), { force: true });
    const catalog = loadCustomScriptCatalog(configFor(root));
    assert.deepEqual(catalog.scripts, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
