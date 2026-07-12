import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createDeploymentProfile, deleteDeploymentProfile, evaluateDeploymentProfilePayload, loadDeploymentProfiles, resolveDeploymentProfileState, sortInstallSequenceBySoftwareDependencies, updateDeploymentProfile, updateDeploymentProfileSoftware } from '../src/profiles/profiles.js';
import { materializeSoftwareTestPayload, publishDeploymentProfile } from '../src/profiles/publish.js';
import { createCustomScript, deleteCustomScript, loadCustomScriptCatalog, readCustomScriptContent, uploadCustomScript } from '../src/profiles/scripts.js';
import { deploymentProfileOptions, generateDeploymentProfileId } from '../src/profiles/shared.js';
import { createSoftwarePackage, deleteSoftwarePackage, loadSoftwareCatalog, openSoftwareInstallScript, readSoftwareInstallScript, uploadSoftwareInstaller } from '../src/profiles/software.js';

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

function installSequenceFromSoftware(softwareIds = []) {
  return softwareIds.map((id) => ({ type: 'software', id }));
}

function installSequenceEntry(type, id, extra = {}) {
  return { type, id, ...extra };
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
  fs.writeFileSync(path.join(root, 'Show-DeploymentProgress.ps1'), "Write-Host 'progress viewer'\n", 'utf8');
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
    installSequence: installSequenceFromSoftware(['one']),
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
        installSequence: installSequenceFromSoftware(['two', 'one']),
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

test('software dependencies require prerequisites, reject cycles, and sort only software slots', () => {
  const root = makeRoot();
  try {
    const catalog = [
      catalogSoftware('one', 'One App'),
      { ...catalogSoftware('two', 'Two App'), dependsOn: ['one'] },
    ];
    writeBaseFiles(root, {
      catalog,
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['two', 'one'],
        installSequence: installSequenceFromSoftware(['two', 'one']),
        osImage: 'TEST-OS',
      },
    });
    const state = resolveDeploymentProfileState(configFor(root));
    assert.deepEqual(state.activeProfile.softwareIds, ['one', 'two']);

    const sorted = sortInstallSequenceBySoftwareDependencies([
      { type: 'software', id: 'two' },
      { type: 'script', id: 'SC-MIDDLE1' },
      { type: 'software', id: 'one' },
    ], state.catalog, 'test installSequence');
    assert.deepEqual(sorted, [
      { type: 'software', id: 'one' },
      { type: 'script', id: 'SC-MIDDLE1' },
      { type: 'software', id: 'two' },
    ]);

    writeJson(path.join(root, 'profiles', 'default.json'), {
      id: 'default', name: 'Default', software: ['two'], installSequence: installSequenceFromSoftware(['two']), osImage: 'TEST-OS',
    });
    assert.throws(() => loadDeploymentProfiles(configFor(root)), /missing required software dependency: one/);

    writeJson(path.join(root, 'software-catalog.json'), {
      software: [
        { ...catalogSoftware('one', 'One App'), dependsOn: ['two'] },
        { ...catalogSoftware('two', 'Two App'), dependsOn: ['one'] },
      ],
    });
    assert.throws(() => loadSoftwareCatalog(configFor(root)), /dependency cycle/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loads independent profile display language, regional format, input language, and time zone', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['one'],
        osImage: 'TEST-OS',
        displayLanguage: 'en-US',
        locale: 'en-US',
        inputLanguage: 'ja-JP',
        timeZone: 'Taipei Standard Time',
      },
    });

    const profile = resolveDeploymentProfileState(configFor(root)).activeProfile;
    assert.equal(profile.displayLanguage, 'en-US');
    assert.equal(profile.locale, 'en-US');
    assert.equal(profile.inputLanguage, 'ja-JP');
    assert.equal(profile.timeZone, 'Taipei Standard Time');
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
        installSequence: [{ type: 'software', id: 'missing' }],
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
        installSequence: [],
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
      softwareId: 'tool-app',
      name: 'Tool App',
      scriptMode: 'template',
      installerType: 'msi',
      silentArgs: '/qn /norestart REBOOT=ReallySuppress',
      successExitCodes: '0,1641,3010',
      verifyPath: 'C:\\Program Files\\Tool\\tool.exe',
    });

    assert.equal(created.software.id, 'tool-app');
    assert.equal(created.software.installerFileName, 'ToolSetup.msi');
    assert.equal(created.sha256.length, 64);
    assert.equal(fs.existsSync(path.join(root, 'Softwares', 'tool-app', 'ToolSetup.msi')), true);
    const installScript = fs.readFileSync(path.join(root, 'Softwares', 'tool-app', 'install.ps1'), 'utf8');
    assert.match(installScript, /\$ErrorActionPreference = 'Stop'/);
    assert.match(installScript, /msiexec\.exe/);
    assert.match(installScript, /C:\\Program Files\\Tool\\tool\.exe/);
    assert.match(installScript, /verification file was not found/);
    assert.equal(fs.existsSync(path.join(root, '.osdcloud-console', 'software-uploads', 'upload-tool')), false);

    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'software-catalog.json'), 'utf8'));
    assert.deepEqual(catalog.software.map((software) => software.id), ['one', 'two', 'tool-app']);
    const catalogEntry = catalog.software.find((software) => software.id === 'tool-app');
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
      softwareId: 'exit-code-app',
      name: 'Exit Code Only App',
      scriptMode: 'template',
      installerType: 'msi',
      silentArgs: '/qn /norestart REBOOT=ReallySuppress',
      successExitCodes: '0,1641,3010',
    });

    assert.equal(created.software.id, 'exit-code-app');
    const installScript = fs.readFileSync(path.join(root, 'Softwares', 'exit-code-app', 'install.ps1'), 'utf8');
    assert.match(installScript, /Installer not found/);
    assert.match(installScript, /msiexec\.exe/);
    assert.match(installScript, /\$successExitCodes = @\(0, 1641, 3010\)/);
    assert.match(installScript, /WINCEPTION_REBOOT_PENDING/);
    assert.match(installScript, /WINCEPTION_REBOOT_RECOMMENDED/);
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
      softwareId: 'raw-tool',
      name: 'Raw Tool',
      scriptMode: 'raw',
      installerType: 'exe',
      rawScript: "$ErrorActionPreference = 'Stop'\nWrite-Host 'raw install'\n",
      dependsOn: ['one'],
      network: { requirement: 'client-internet', probeHost: 'download.vendor.example' },
    });

    assert.equal(
      fs.readFileSync(path.join(root, 'Softwares', 'raw-tool', 'install.ps1'), 'utf8'),
      "$ErrorActionPreference = 'Stop'\nWrite-Host 'raw install'\n",
    );
    const catalog = loadSoftwareCatalog(config);
    assert.deepEqual(catalog.byId.get('raw-tool').dependsOn, ['one']);
    assert.deepEqual(catalog.byId.get('raw-tool').network, { requirement: 'client-internet', probeHost: 'download.vendor.example' });
    const rawCatalogRow = JSON.parse(fs.readFileSync(path.join(root, 'software-catalog.json'), 'utf8')).software.find((software) => software.id === 'raw-tool');
    assert.equal(Object.hasOwn(rawCatalogRow, 'silentArgs'), false);
    assert.equal(Object.hasOwn(rawCatalogRow, 'successExitCodes'), false);
    assert.equal(Object.hasOwn(rawCatalogRow, 'verifyPath'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software package onboarding rejects unsafe inputs and invalid human ids', async () => {
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
      softwareId: 'one',
      name: 'Explicit One',
      scriptMode: 'template',
      installerType: 'msi',
      verifyPath: 'C:\\Program Files\\One\\one.exe',
    }), /Duplicate software id or source/);
    assert.equal(fs.existsSync(path.join(root, 'Softwares', 'one')), true);
    assert.equal(fs.existsSync(path.join(root, '.osdcloud-console', 'software-uploads', 'upload-explicit')), true);

    await assert.rejects(() => createSoftwarePackage(config, {
      uploadId: 'upload-explicit',
      name: 'Missing ID',
      scriptMode: 'template',
      installerType: 'msi',
    }), /Software id is required/);
    await assert.rejects(() => createSoftwarePackage(config, {
      uploadId: 'upload-explicit',
      softwareId: 'Bad_ID',
      name: 'Bad ID',
      scriptMode: 'template',
      installerType: 'msi',
    }), /lowercase letters, numbers, and hyphens only/);
    await assert.rejects(() => createSoftwarePackage(config, {
      uploadId: 'upload-explicit',
      softwareId: 'abcdefghijklmnopq',
      name: 'Too Long',
      scriptMode: 'template',
      installerType: 'msi',
    }), /max 16 characters/);

    await assert.rejects(() => createSoftwarePackage(config, {
      uploadId: 'bad\\upload',
      softwareId: 'bad-upload',
      name: 'Bad ID',
      scriptMode: 'raw',
      installerType: 'msi',
      rawScript: 'Write-Host bad',
    }), /Invalid software upload id/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('raw install script syntax errors do not create a software folder or catalog row', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);
    await uploadSoftwareInstaller(config, {
      fileName: 'broken.exe',
      buffer: Buffer.from('exe bytes'),
    }, { uploadId: 'upload-broken-raw' });

    await assert.rejects(() => createSoftwarePackage(config, {
      uploadId: 'upload-broken-raw',
      softwareId: 'broken-raw',
      name: 'Broken Raw',
      scriptMode: 'raw',
      installerType: 'exe',
      rawScript: 'function {',
    }), /Raw install\.ps1 syntax error/);
    assert.equal(fs.existsSync(path.join(root, 'Softwares', 'broken-raw')), false);
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'software-catalog.json'), 'utf8'));
    assert.equal(catalog.software.some((software) => software.id === 'broken-raw'), false);
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
      installSequence: installSequenceFromSoftware(['one']),
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

test('creates and updates independent profile international settings', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const created = createDeploymentProfile(configFor(root), {
      name: 'English Taipei',
      displayLanguage: 'en-US',
      locale: 'en-US',
      inputLanguage: 'en-US',
      timeZone: 'Taipei Standard Time',
    }, { randomInt: () => 26 });

    assert.equal(created.profile.displayLanguage, 'en-US');
    assert.equal(created.profile.locale, 'en-US');
    assert.equal(created.profile.inputLanguage, 'en-US');
    assert.equal(created.profile.timeZone, 'Taipei Standard Time');

    const updated = updateDeploymentProfile(configFor(root), created.profile.id, {
      displayLanguage: 'zh-TW',
      locale: 'ja-JP',
      inputLanguage: 'ko-KR',
      timeZone: 'Tokyo Standard Time',
    });
    assert.equal(updated.profile.displayLanguage, 'zh-TW');
    assert.equal(updated.profile.locale, 'ja-JP');
    assert.equal(updated.profile.inputLanguage, 'ko-KR');
    assert.equal(updated.profile.timeZone, 'Tokyo Standard Time');

    const raw = JSON.parse(fs.readFileSync(created.filePath, 'utf8'));
    assert.equal(raw.displayLanguage, 'zh-TW');
    assert.equal(raw.locale, 'ja-JP');
    assert.equal(raw.inputLanguage, 'ko-KR');
    assert.equal(raw.timeZone, 'Tokyo Standard Time');
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

test('deployment profile names must be unique after trim and casefold', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);

    assert.throws(
      () => createDeploymentProfile(configFor(root), { name: ' default ' }),
      /Duplicate deployment profile name/,
    );

    writeJson(path.join(root, 'profiles', 'second.json'), {
      id: 'second',
      name: 'Field Tech',
      software: [],
      osImage: 'TEST-OS',
    });
    writeJson(path.join(root, 'profiles', 'third.json'), {
      id: 'third',
      name: ' field tech ',
      software: [],
      osImage: 'TEST-OS',
    });
    assert.throws(
      () => loadDeploymentProfiles(configFor(root)),
      /Duplicate deployment profile name: field tech/,
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
        installSequence: installSequenceFromSoftware(['one']),
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
      installSequence: installSequenceFromSoftware(['two', 'one']),
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
        installSequence: installSequenceFromSoftware(['one']),
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
      installSequence: installSequenceFromSoftware(['two']),
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
    writeJson(path.join(root, 'profiles', 'field.json'), {
      id: 'field',
      name: 'Field Tech',
      software: [],
      osImage: 'TEST-OS',
    });

    assert.throws(
      () => updateDeploymentProfile(configFor(root), 'default', { id: 'renamed', name: 'Renamed' }),
      /id cannot be changed/,
    );
    assert.throws(
      () => updateDeploymentProfile(configFor(root), 'default', { name: '   ' }),
      /name is required/,
    );
    assert.throws(
      () => updateDeploymentProfile(configFor(root), 'default', { name: ' field tech ' }),
      /Duplicate deployment profile name/,
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
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'Show-DeploymentProgress.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'selected-profile.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'one', 'install.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'two', 'install.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'stale')), false);
    assert.deepEqual(result.copied, ['two', 'one']);
    assert.deepEqual(result.supportFiles, ['Install-Apps.ps1', 'Show-DeploymentProgress.ps1']);
    assert.deepEqual(result.softwarePayloads.map((payload) => `${payload.id}:${payload.status}`), ['two:reused', 'one:reused']);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Apps', 'selected-profile.json'), 'utf8'));
    assert.equal(manifest.profileId, 'default');
    assert.deepEqual(manifest.selectedSoftware, ['two', 'one']);
    assert.deepEqual(manifest.software.map((software) => software.id), ['two', 'one']);
    assert.equal(manifest.execution.defaultTimeoutSeconds, 900);
    assert.equal(evaluateDeploymentProfilePayload(configFor(root)).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software test payload is isolated and matches the regular publish manifest', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['two', 'one'],
        installSequence: installSequenceFromSoftware(['two', 'one']),
        osImage: 'TEST-OS',
      },
    });
    const liveAppsRoot = path.join(root, 'Live', 'Apps');
    fs.mkdirSync(liveAppsRoot, { recursive: true });
    fs.writeFileSync(path.join(liveAppsRoot, 'keep.txt'), 'live payload remains untouched by test materialization', 'utf8');
    const config = configFor(root, {
      appsRoot: liveAppsRoot,
      customScriptsAppsRoot: path.join(root, 'Live', 'Scripts'),
    });

    const testRoot = path.join(root, 'State', 'software-test-runs', 'test-001');
    const testPayload = await materializeSoftwareTestPayload(config, 'default', testRoot);

    assert.equal(testPayload.appsRoot, path.join(testRoot, 'Apps'));
    assert.equal(fs.readFileSync(path.join(liveAppsRoot, 'keep.txt'), 'utf8'), 'live payload remains untouched by test materialization');
    assert.equal(fs.existsSync(path.join(liveAppsRoot, 'Install-Apps.ps1')), false);
    assert.equal(fs.existsSync(path.join(testRoot, 'Apps', 'Install-Apps.ps1')), true);
    assert.equal(fs.existsSync(path.join(testRoot, 'Apps', 'one', 'install.ps1')), true);
    assert.equal(fs.existsSync(path.join(testRoot, 'Apps', 'two', 'install.ps1')), true);

    const published = await publishDeploymentProfile(config, 'default');
    const testManifest = JSON.parse(fs.readFileSync(testPayload.manifestPath, 'utf8'));
    const publishedManifest = JSON.parse(fs.readFileSync(published.manifestPath, 'utf8'));
    delete testManifest.publishedAt;
    delete publishedManifest.publishedAt;
    assert.deepEqual(testManifest, publishedManifest);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('profile publish resolves independent international settings from profile and OS image', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: [],
        osImage: 'TEST-OS',
        displayLanguage: 'en-US',
        locale: 'en-US',
        inputLanguage: 'ja-JP',
        timeZone: 'Taipei Standard Time',
      },
    });

    await publishDeploymentProfile(configFor(root), null, {
      publishOsImage: async () => ({
        image: { id: 'TEST-OS', language: 'en-us', locale: 'en-US', timeZone: '' },
      }),
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Apps', 'selected-profile.json'), 'utf8'));
    assert.equal(manifest.displayLanguage, 'en-US');
    assert.equal(manifest.locale, 'en-US');
    assert.equal(manifest.inputLanguage, 'ja-JP');
    assert.equal(manifest.timeZone, 'Taipei Standard Time');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legacy profile inherits OS image language and locale during publish', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: { id: 'default', name: 'Legacy', software: [], osImage: 'TEST-OS' },
    });
    await publishDeploymentProfile(configFor(root), null, {
      publishOsImage: async () => ({
        image: { id: 'TEST-OS', language: 'en-us', locale: 'en-US', timeZone: 'UTC' },
      }),
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Apps', 'selected-profile.json'), 'utf8'));
    assert.equal(manifest.displayLanguage, 'en-us');
    assert.equal(manifest.locale, 'en-US');
    assert.equal(manifest.inputLanguage, 'en-us');
    assert.equal(manifest.timeZone, 'UTC');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('profile publish blocks missing time zone and display language mismatch before Apps changes', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Invalid',
        software: [],
        osImage: 'TEST-OS',
        displayLanguage: 'zh-TW',
        locale: 'en-US',
      },
    });
    fs.mkdirSync(path.join(root, 'Apps', 'keep'), { recursive: true });

    await assert.rejects(
      publishDeploymentProfile(configFor(root), null, {
        publishOsImage: async () => ({ image: { id: 'TEST-OS', language: 'en-us', locale: 'en-US', timeZone: '' } }),
      }),
      /time zone is unresolved/,
    );
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'keep')), true);

    await assert.rejects(
      publishDeploymentProfile(configFor(root), null, {
        publishOsImage: async () => ({ image: { id: 'TEST-OS', language: 'en-us', locale: 'en-US', timeZone: 'UTC' } }),
      }),
      /Display language zh-TW is not installed.*en-us/,
    );
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'keep')), true);
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
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'Show-DeploymentProgress.ps1')), true);
    assert.equal(fs.existsSync(path.join(root, 'Apps', 'one')), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Apps', 'selected-profile.json'), 'utf8'));
    assert.deepEqual(manifest.selectedSoftware, []);
    assert.equal(manifest.execution.defaultTimeoutSeconds, 900);
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
    const summary = JSON.parse(fs.readFileSync(path.join(root, 'logs', 'install-sequence-summary.json'), 'utf8'));
    assert.equal(summary.total, 2);
    assert.equal(summary.succeeded, 2);
    assert.equal(summary.failedStep, null);
    const progress = JSON.parse(fs.readFileSync(path.join(root, 'logs', 'deployment-progress.json'), 'utf8'));
    assert.equal(progress.status, 'succeeded');
    assert.equal(progress.totalSteps, 2);
    assert.deepEqual(progress.completedSteps.map((step) => step.name), ['Two App', 'One App']);
    assert.equal(progress.currentStep, null);
    assert.equal(progress.failure, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script checkpoints exit 1641 and resumes at the next step', () => {
  if (process.platform !== 'win32') {
    return;
  }
  const root = makeRoot('osdcloud-installer-reboot-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    const logRoot = path.join(root, 'logs');
    const marker = path.join(root, 'resumed.marker');
    fs.mkdirSync(path.join(appsRoot, 'first'), { recursive: true });
    fs.mkdirSync(path.join(appsRoot, 'second'), { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    fs.writeFileSync(path.join(appsRoot, 'first', 'install.ps1'), "Write-Output 'WINCEPTION_REBOOT_PENDING'\n", 'utf8');
    fs.writeFileSync(path.join(appsRoot, 'second', 'install.ps1'), "Set-Content -LiteralPath $env:RESUME_MARKER -Value 'done'\n", 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'reboot',
      software: [{ id: 'first', name: 'First App' }, { id: 'second', name: 'Second App' }],
      installSequence: [{ type: 'software', id: 'first', name: 'First App' }, { type: 'software', id: 'second', name: 'Second App' }],
    });
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(appsRoot, 'Install-Apps.ps1')];
    const env = { ...process.env, OSDCloudLogDir: logRoot, RESUME_MARKER: marker };
    const firstRun = spawnSync('powershell.exe', args, { encoding: 'utf8', env });
    assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
    const paused = JSON.parse(fs.readFileSync(path.join(logRoot, 'deployment-progress.json'), 'utf8'));
    assert.equal(paused.status, 'reboot_pending');
    assert.equal(paused.resumeFromStep, 2);
    assert.equal(fs.existsSync(marker), false);

    const resumedRun = spawnSync('powershell.exe', args, { encoding: 'utf8', env });
    assert.equal(resumedRun.status, 0, resumedRun.stderr || resumedRun.stdout);
    const completed = JSON.parse(fs.readFileSync(path.join(logRoot, 'deployment-progress.json'), 'utf8'));
    assert.equal(completed.status, 'succeeded');
    assert.equal(fs.readFileSync(marker, 'utf8').trim(), 'done');
    assert.deepEqual(completed.completedSteps.map((step) => step.name), ['First App', 'Second App']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script waits for required client Internet and fails without running the step', () => {
  if (process.platform !== 'win32') {
    return;
  }
  const root = makeRoot('osdcloud-installer-network-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    const logRoot = path.join(root, 'logs');
    const marker = path.join(root, 'network.marker');
    fs.mkdirSync(path.join(appsRoot, 'online'), { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    fs.writeFileSync(path.join(appsRoot, 'online', 'install.ps1'), "Set-Content -LiteralPath $env:NETWORK_MARKER -Value 'should-not-run'\n", 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'network',
      execution: { defaultTimeoutSeconds: 1 },
      software: [{ id: 'online', name: 'Online App', network: { requirement: 'client-internet', probeHost: 'not-found.invalid' } }],
      installSequence: [{ type: 'software', id: 'online', name: 'Online App' }],
    });
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(appsRoot, 'Install-Apps.ps1'),
    ], {
      encoding: 'utf8',
      env: { ...process.env, OSDCloudLogDir: logRoot, NETWORK_MARKER: marker },
    });
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(marker), false);
    const progress = JSON.parse(fs.readFileSync(path.join(logRoot, 'deployment-progress.json'), 'utf8'));
    assert.equal(progress.status, 'failed');
    assert.equal(progress.failure.category, 'network_unavailable');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script records a successful empty sequence', () => {
  if (process.platform !== 'win32') {
    return;
  }
  const root = makeRoot('osdcloud-installer-empty-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    const logRoot = path.join(root, 'logs');
    fs.mkdirSync(appsRoot, { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'minimal',
      selectedSoftware: [],
      installSequence: [],
    });

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(appsRoot, 'Install-Apps.ps1'),
    ], {
      encoding: 'utf8',
      env: { ...process.env, OSDCloudLogDir: logRoot },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const progress = JSON.parse(fs.readFileSync(path.join(logRoot, 'deployment-progress.json'), 'utf8'));
    assert.equal(progress.status, 'succeeded');
    assert.equal(progress.totalSteps, 0);
    assert.deepEqual(progress.completedSteps, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script publishes a safe live heartbeat for a running custom script', async () => {
  if (process.platform !== 'win32') {
    return;
  }

  const root = makeRoot('osdcloud-installer-heartbeat-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    const scriptsRoot = path.join(root, 'Scripts');
    const logRoot = path.join(root, 'logs');
    const progressPath = path.join(logRoot, 'deployment-progress.json');
    fs.mkdirSync(appsRoot, { recursive: true });
    fs.mkdirSync(path.join(scriptsRoot, 'SC-SLOW001'), { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    fs.writeFileSync(path.join(scriptsRoot, 'SC-SLOW001', 'run.ps1'), "Start-Sleep -Seconds 6\n", 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'heartbeat',
      installSequence: [{ type: 'script', id: 'SC-SLOW001', name: 'Slow custom script' }],
    });

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(appsRoot, 'Install-Apps.ps1'),
    ], {
      env: { ...process.env, OSDCloudLogDir: logRoot },
      stdio: 'ignore',
    });
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 4000;
      const timer = setInterval(() => {
        if (fs.existsSync(progressPath)) {
          try {
            const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
            if (progress.currentStep?.status === 'running') {
              clearInterval(timer);
              resolve();
              return;
            }
          } catch {
            // Atomic replacement may briefly make the file unavailable to this test reader.
          }
        }
        if (Date.now() >= deadline) {
          clearInterval(timer);
          reject(new Error('Timed out waiting for installer progress heartbeat'));
        }
      }, 100);
    });
    const first = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const second = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code));
    });

    assert.equal(exitCode, 0);
    assert.equal(first.currentStep.type, 'script');
    assert.equal(first.currentStep.name, 'Slow custom script');
    assert.equal(first.currentStep.status, 'running');
    assert.equal(second.currentStep.status, 'running');
    assert.ok(second.currentStep.elapsedSeconds >= 2, JSON.stringify(second.currentStep));
    assert.notEqual(second.currentStep.lastHeartbeatAt, first.currentStep.lastHeartbeatAt);
    assert.equal(Object.hasOwn(second.currentStep, 'stdoutTailText'), false);
    assert.equal(Object.hasOwn(second.currentStep, 'stderrTailText'), false);
    assert.equal(Object.hasOwn(second.currentStep, 'script'), false);
    const completed = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.completedSteps[0].durationSeconds >= 6, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deployment progress viewer headless output exposes safe state only', () => {
  if (process.platform !== 'win32') {
    return;
  }
  const root = makeRoot('osdcloud-progress-viewer-test-');
  try {
    const progressPath = path.join(root, 'deployment-progress.json');
    writeJson(progressPath, {
      schemaVersion: 1,
      status: 'failed',
      totalSteps: 2,
      completedSteps: [{ index: 1, type: 'software', id: 'one', name: 'One App', status: 'succeeded' }],
      currentStep: null,
      startedAt: '2026-06-18T01:00:00Z',
      finishedAt: '2026-06-18T02:02:03Z',
      failure: {
        step: { index: 2, type: 'script', id: 'SC-FAIL001', name: 'Apply policy' },
        category: 'timed_out',
        logPath: 'C:\\Windows\\Temp\\osdcloud-logs\\step.log',
        rawException: 'must-not-render',
      },
    });
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('Softwares', 'Show-DeploymentProgress.ps1'),
      '-Headless',
      '-ProgressPath',
      progressPath,
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const view = JSON.parse(result.stdout);
    assert.equal(view.status, 'failed');
    assert.equal(view.failureName, 'Apply policy');
    assert.equal(view.failureCategory, 'timed_out');
    assert.equal(view.elapsedLabel, 'Elapsed: 01:02:03');
    assert.match(view.failureLogPath, /osdcloud-logs/u);
    assert.doesNotMatch(result.stdout, /must-not-render/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deployment progress viewer explains active application and custom script work', () => {
  if (process.platform !== 'win32') {
    return;
  }
  const root = makeRoot('osdcloud-progress-viewer-running-test-');
  try {
    const progressPath = path.join(root, 'deployment-progress.json');
    writeJson(progressPath, {
      schemaVersion: 1,
      status: 'running',
      totalSteps: 4,
      completedSteps: [{ index: 1, type: 'software', id: 'chrome', name: 'Google Chrome Enterprise 64-bit', status: 'succeeded', durationSeconds: 3 }],
      currentStep: { index: 2, type: 'script', id: 'SC-TEST001', name: 'Add text file to desktop', status: 'running', elapsedSeconds: 125, slow: true },
      elapsedSeconds: 128,
    });
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('Softwares', 'Show-DeploymentProgress.ps1'),
      '-Headless',
      '-ProgressPath',
      progressPath,
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const view = JSON.parse(result.stdout);
    assert.equal(view.stepLabel, 'Step 2 of 4');
    assert.equal(view.currentType, 'RUNNING CUSTOM SCRIPT');
    assert.equal(view.currentName, 'Add text file to desktop');
    assert.match(view.activityMessage, /longer than expected/u);
    assert.match(view.history[0], /Completed in 00:00:03/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deployment progress viewer exposes the safe finalizer waiting phase with elapsed time', () => {
  if (process.platform !== 'win32') {
    return;
  }
  const root = makeRoot('osdcloud-progress-viewer-finalizer-test-');
  try {
    const progressPath = path.join(root, 'deployment-progress.json');
    writeJson(progressPath, {
      schemaVersion: 2,
      status: 'pending',
      phase: 'awaiting-user-session',
      phaseElapsedSeconds: 125,
      totalSteps: 4,
      completedSteps: [],
      currentStep: null,
      rawException: 'must-not-render',
    });
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('Softwares', 'Show-DeploymentProgress.ps1'),
      '-Headless',
      '-ProgressPath',
      progressPath,
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const view = JSON.parse(result.stdout);
    assert.equal(view.stepLabel, 'Waiting for target user sign-in');
    assert.equal(view.elapsedLabel, 'Elapsed: 00:02:05');
    assert.match(view.activityMessage, /target user desktop/u);
    assert.doesNotMatch(result.stdout, /must-not-render/u);
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
      installSequence: [
        { type: 'software', id: 'one' },
        { type: 'script', id: 'SC-MIDDLE1' },
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
    const summary = JSON.parse(fs.readFileSync(path.join(root, 'logs', 'install-sequence-summary.json'), 'utf8'));
    assert.equal(summary.total, 3);
    assert.equal(summary.succeeded, 3);
    assert.equal(summary.failedStep, null);
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
    const summary = JSON.parse(fs.readFileSync(path.join(root, 'logs', 'install-sequence-summary.json'), 'utf8'));
    assert.equal(summary.total, 1);
    assert.equal(summary.failedStep.stepType, 'software');
    assert.equal(summary.failedStep.stepId, 'missing');
    assert.equal(summary.failedStep.status, 'missing');
    const progress = JSON.parse(fs.readFileSync(path.join(root, 'logs', 'deployment-progress.json'), 'utf8'));
    assert.equal(progress.status, 'failed');
    assert.equal(progress.failure.category, 'missing');
    assert.equal(progress.failure.step.name, 'Missing App');
    assert.equal(Object.prototype.hasOwnProperty.call(progress.failure, 'reason'), false);
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
      installSequence: [
        { type: 'script', id: 'SC-BEFORE01' },
        { type: 'script', id: 'SC-AFTER001' },
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
    assert.equal(summary.timedOut, 0);
    assert.deepEqual(summary.scripts.map((script) => script.status), ['succeeded', 'succeeded']);
    assert.deepEqual(summary.scripts.map((script) => script.sequenceIndex), [1, 2]);
    const logFiles = fs.readdirSync(path.join(logRoot, 'install-sequence'));
    assert.equal(logFiles.length, 2);
    assert.ok(logFiles.some((name) => /^001-script-SC-BEFORE01-/u.test(name)));
    assert.ok(logFiles.some((name) => /^002-script-SC-AFTER001-/u.test(name)));
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
    fs.writeFileSync(path.join(scriptsRoot, 'SC-BAD0000', 'run.ps1'), "Write-Host 'bad script ran'\nthrow 'bad script failed'\n", 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'default',
      selectedSoftware: [],
      installSequence: [
        { type: 'script', id: 'SC-GOOD000' },
        { type: 'script', id: 'SC-BAD0000' },
        { type: 'script', id: 'SC-MISS000' },
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
    assert.equal(summary.total, 2);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.missing, 0);
    assert.equal(summary.timedOut, 0);
    assert.deepEqual(summary.scripts.map((script) => script.status), ['succeeded', 'failed']);
    assert.deepEqual(summary.scripts.map((script) => script.sequenceIndex), [1, 2]);
    const bad = summary.scripts.find((script) => script.id === 'SC-BAD0000');
    assert.equal(bad.exitCode, 1);
    assert.match(bad.error, /Step exited with code 1/);
    const sequenceSummary = JSON.parse(fs.readFileSync(path.join(logRoot, 'install-sequence-summary.json'), 'utf8'));
    assert.equal(sequenceSummary.failedStep.stepId, 'SC-BAD0000');
    assert.equal(sequenceSummary.total, 2);
    const logFiles = fs.readdirSync(path.join(logRoot, 'install-sequence'));
    assert.equal(logFiles.length, 2);
    const badLog = fs.readFileSync(path.join(logRoot, 'install-sequence', logFiles.find((name) => /^002-script-SC-BAD0000-/u.test(name))), 'utf8');
    assert.match(badLog, /bad script ran/);
    assert.match(badLog, /Reason: Step exited with code 1/);
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
      scriptId: 'firewall',
      name: 'Firewall Tweaks',
    });
    assert.equal(created.script.id, 'firewall');
    assert.equal(created.script.fileName, 'firewall.ps1');
    const runScriptPath = path.join(root, 'Scripts', 'firewall', 'run.ps1');
    assert.equal(fs.existsSync(runScriptPath), true);
    assert.equal(fs.readFileSync(runScriptPath, 'utf8'), "Write-Host 'firewall rule'\n");

    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'scripts-catalog.json'), 'utf8'));
    assert.deepEqual(catalog.scripts.map((script) => script.id), ['firewall']);

    const content = readCustomScriptContent(config, 'firewall');
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

test('profile installSequence must reference a known script', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['one'],
        installSequence: [
          { type: 'software', id: 'one' },
          { type: 'script', id: 'SC-NOPE0001' },
        ],
      },
    });

    assert.throws(() => loadDeploymentProfiles(configFor(root)), /unknown custom script/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script allows steps to exchange state through install-sequence-state.json', () => {
  if (process.platform !== 'win32') {
    return;
  }

  const root = makeRoot('osdcloud-install-state-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    const scriptsRoot = path.join(root, 'Scripts');
    const marker = path.join(root, 'state.marker');
    fs.mkdirSync(path.join(appsRoot, 'one'), { recursive: true });
    fs.mkdirSync(path.join(scriptsRoot, 'SC-STATE001'), { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    fs.writeFileSync(path.join(scriptsRoot, 'SC-STATE001', 'run.ps1'), [
      "$state = Get-Content -LiteralPath $env:OSDCloudInstallStatePath -Raw | ConvertFrom-Json",
      "$state | Add-Member -NotePropertyName token -NotePropertyValue 'ready' -Force",
      "[System.IO.File]::WriteAllText($env:OSDCloudInstallStatePath, ($state | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))",
      "Write-Host 'state written'",
      '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(appsRoot, 'one', 'install.ps1'), [
      "$state = Get-Content -LiteralPath $env:OSDCloudInstallStatePath -Raw | ConvertFrom-Json",
      "if ($state.token -ne 'ready') { throw 'shared state missing token' }",
      "Set-Content -LiteralPath $env:STATE_MARKER -Value $state.token",
      '',
    ].join('\n'), 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'default',
      selectedSoftware: ['one'],
      installSequence: [
        { type: 'script', id: 'SC-STATE001' },
        { type: 'software', id: 'one' },
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
      env: { ...process.env, OSDCloudLogDir: path.join(root, 'logs'), STATE_MARKER: marker },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(marker, 'utf8').trim(), 'ready');
    const state = JSON.parse(fs.readFileSync(path.join(root, 'logs', 'install-sequence-state.json'), 'utf8'));
    assert.equal(state.token, 'ready');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script stops immediately when a step times out', () => {
  if (process.platform !== 'win32') {
    return;
  }

  const root = makeRoot('osdcloud-install-timeout-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    const scriptsRoot = path.join(root, 'Scripts');
    const marker = path.join(root, 'timeout.marker');
    fs.mkdirSync(path.join(appsRoot, 'one'), { recursive: true });
    fs.mkdirSync(path.join(scriptsRoot, 'SC-SLOW001'), { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    fs.writeFileSync(path.join(scriptsRoot, 'SC-SLOW001', 'run.ps1'), "Start-Sleep -Seconds 3\nWrite-Host 'slow done'\n", 'utf8');
    fs.writeFileSync(path.join(appsRoot, 'one', 'install.ps1'), "Set-Content -LiteralPath $env:TIMEOUT_MARKER -Value 'should-not-run'\n", 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'default',
      selectedSoftware: ['one'],
      execution: { defaultTimeoutSeconds: 10 },
      installSequence: [
        { type: 'script', id: 'SC-SLOW001', timeoutSeconds: 1 },
        { type: 'software', id: 'one' },
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
      env: { ...process.env, OSDCloudLogDir: path.join(root, 'logs'), TIMEOUT_MARKER: marker },
    });

    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(marker), false);
    const stepLogs = fs.readdirSync(path.join(root, 'logs', 'install-sequence'));
    assert.equal(stepLogs.length, 1);
    const stepLog = fs.readFileSync(path.join(root, 'logs', 'install-sequence', stepLogs[0]), 'utf8');
    assert.doesNotMatch(stepLog, /Warning: process still running after timeout termination request\./u);
    const summary = JSON.parse(fs.readFileSync(path.join(root, 'logs', 'install-sequence-summary.json'), 'utf8'));
    assert.equal(summary.total, 1);
    assert.equal(summary.timedOut, 1);
    assert.equal(summary.failedStep.stepId, 'SC-SLOW001');
    assert.equal(summary.failedStep.status, 'timed_out');
    assert.equal(summary.failedStep.timeoutSeconds, 1);
    const progress = JSON.parse(fs.readFileSync(path.join(root, 'logs', 'deployment-progress.json'), 'utf8'));
    assert.equal(progress.status, 'failed');
    assert.equal(progress.failure.category, 'timed_out');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer script fails fast when a step leaves invalid shared state JSON', () => {
  if (process.platform !== 'win32') {
    return;
  }

  const root = makeRoot('osdcloud-install-bad-state-test-');
  try {
    const appsRoot = path.join(root, 'Apps');
    const scriptsRoot = path.join(root, 'Scripts');
    const marker = path.join(root, 'bad-state.marker');
    fs.mkdirSync(path.join(appsRoot, 'one'), { recursive: true });
    fs.mkdirSync(path.join(scriptsRoot, 'SC-BADJSON'), { recursive: true });
    fs.copyFileSync(path.resolve('Softwares', 'Install-Apps.ps1'), path.join(appsRoot, 'Install-Apps.ps1'));
    fs.writeFileSync(path.join(scriptsRoot, 'SC-BADJSON', 'run.ps1'), "[System.IO.File]::WriteAllText($env:OSDCloudInstallStatePath, '{bad json', [System.Text.UTF8Encoding]::new($false))\n", 'utf8');
    fs.writeFileSync(path.join(appsRoot, 'one', 'install.ps1'), "Set-Content -LiteralPath $env:BAD_STATE_MARKER -Value 'should-not-run'\n", 'utf8');
    writeJson(path.join(appsRoot, 'selected-profile.json'), {
      profileId: 'default',
      selectedSoftware: ['one'],
      installSequence: [
        { type: 'script', id: 'SC-BADJSON' },
        { type: 'software', id: 'one' },
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
      env: { ...process.env, OSDCloudLogDir: path.join(root, 'logs'), BAD_STATE_MARKER: marker },
    });

    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(marker), false);
    const summary = JSON.parse(fs.readFileSync(path.join(root, 'logs', 'install-sequence-summary.json'), 'utf8'));
    assert.equal(summary.total, 1);
    assert.equal(summary.failedStep.stepId, 'SC-BADJSON');
    assert.equal(summary.failedStep.status, 'failed');
    assert.match(summary.failedStep.reason, /invalid JSON/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid execution default timeout in deployment profile', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['one'],
        execution: { defaultTimeoutSeconds: 0 },
        installSequence: installSequenceFromSoftware(['one']),
        osImage: 'TEST-OS',
      },
    });

    assert.throws(() => loadDeploymentProfiles(configFor(root)), /defaultTimeoutSeconds/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid installSequence timeout override in deployment profile', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['one'],
        installSequence: [installSequenceEntry('software', 'one', { timeoutSeconds: 0 })],
        osImage: 'TEST-OS',
      },
    });

    assert.throws(() => loadDeploymentProfiles(configFor(root)), /timeoutSeconds/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loads execution defaults and per-step timeouts from deployment profiles', () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root, {
      defaultProfile: {
        id: 'default',
        name: 'Default',
        software: ['one', 'two'],
        execution: { defaultTimeoutSeconds: 1200 },
        installSequence: [
          installSequenceEntry('software', 'one', { timeoutSeconds: 45 }),
          installSequenceEntry('software', 'two'),
        ],
        osImage: 'TEST-OS',
      },
    });

    const state = resolveDeploymentProfileState(configFor(root));
    assert.equal(state.activeProfile.execution.defaultTimeoutSeconds, 1200);
    assert.deepEqual(state.activeProfile.installSequence, [
      { type: 'software', id: 'one', timeoutSeconds: 45 },
      { type: 'software', id: 'two' },
    ]);
    assert.deepEqual(state.installSequence.map((entry) => ({
      type: entry.type,
      id: entry.id,
      timeoutSeconds: entry.timeoutSeconds ?? null,
    })), [
      { type: 'software', id: 'one', timeoutSeconds: 45 },
      { type: 'software', id: 'two', timeoutSeconds: null },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legacy profile phase metadata is tolerated on read and normalized on save', () => {
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
      installSequence: [
        { type: 'software', id: 'one' },
        { type: 'script', id: 'SC-AAAAAAA0', phase: 'after' },
      ],
      osImage: 'TEST-OS',
    });

    const loaded = loadDeploymentProfiles(configFor(root));
    assert.deepEqual(loaded[0].installSequence, [
      { type: 'software', id: 'one' },
      { type: 'script', id: 'SC-AAAAAAA0' },
    ]);

    updateDeploymentProfile(configFor(root), 'default', {
      name: 'Default',
      installSequence: loaded[0].installSequence,
      softwareIds: ['one'],
    });
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'default.json'), 'utf8'));
    assert.equal(Object.prototype.hasOwnProperty.call(saved, 'customScripts'), false);
    assert.deepEqual(saved.installSequence, [
      { type: 'software', id: 'one' },
      { type: 'script', id: 'SC-AAAAAAA0' },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDeploymentProfileState exposes selected custom scripts from install sequence', async () => {
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
      scriptId: 'firewall',
      name: 'Firewall',
    });

    const profile = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'default.json'), 'utf8'));
    profile.installSequence = [
      { type: 'software', id: 'one' },
      { type: 'script', id: created.script.id },
    ];
    fs.writeFileSync(path.join(root, 'profiles', 'default.json'), JSON.stringify(profile, null, 2), 'utf8');

    const state = resolveDeploymentProfileState(config);
    assert.equal(state.selectedScripts.length, 1);
    assert.equal(state.selectedScripts[0].id, created.script.id);
    assert.equal(state.selectedScripts[0].name, 'Firewall');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publishDeploymentProfile copies scripts and writes installSequence-only manifest', async () => {
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
      scriptId: 'before-script',
      name: 'Before Script',
    });

    await uploadCustomScript(config, {
      fileName: 'after.ps1',
      buffer: Buffer.from("Write-Host 'after'\n"),
    }, { uploadId: 'upload-after' });
    const afterScript = await createCustomScript(config, {
      uploadId: 'upload-after',
      scriptId: 'after-script',
      name: 'After Script',
    });

    const profile = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'default.json'), 'utf8'));
    profile.execution = { defaultTimeoutSeconds: 600 };
    profile.installSequence = [
      { type: 'script', id: beforeScript.script.id, timeoutSeconds: 90 },
      { type: 'software', id: 'one' },
      { type: 'script', id: afterScript.script.id },
    ];
    fs.writeFileSync(path.join(root, 'profiles', 'default.json'), JSON.stringify(profile, null, 2), 'utf8');

    const result = await publishDeploymentProfile(config);
    assert.equal(result.customScripts.copied.length, 2);
    const publishedScriptsRoot = path.join(root, 'Media', 'Scripts');
    assert.equal(fs.existsSync(path.join(publishedScriptsRoot, beforeScript.script.id, 'run.ps1')), true);
    assert.equal(fs.existsSync(path.join(publishedScriptsRoot, afterScript.script.id, 'run.ps1')), true);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Apps', 'selected-profile.json'), 'utf8'));
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'customScripts'), false);
    assert.equal(manifest.execution.defaultTimeoutSeconds, 600);
    assert.deepEqual(manifest.installSequence, [
      { type: 'script', id: beforeScript.script.id, name: 'Before Script', timeoutSeconds: 90 },
      { type: 'software', id: 'one', name: 'One App' },
      { type: 'script', id: afterScript.script.id, name: 'After Script' },
    ]);
    assert.deepEqual(manifest.scripts, [
      { id: beforeScript.script.id, name: 'Before Script' },
      { id: afterScript.script.id, name: 'After Script' },
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
      scriptId: 'firewall',
      name: 'Firewall',
    });

    const profile = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'default.json'), 'utf8'));
    profile.installSequence = [
      { type: 'software', id: 'one' },
      { type: 'script', id: created.script.id },
    ];
    fs.writeFileSync(path.join(root, 'profiles', 'default.json'), JSON.stringify(profile, null, 2), 'utf8');

    assert.throws(() => deleteCustomScript(config, created.script.id), /still used by deployment profiles/);

    profile.installSequence = [{ type: 'software', id: 'one' }];
    fs.writeFileSync(path.join(root, 'profiles', 'default.json'), JSON.stringify(profile, null, 2), 'utf8');
    const deleted = deleteCustomScript(config, created.script.id);
    assert.equal(deleted.script.id, created.script.id);
    assert.equal(fs.existsSync(path.join(root, 'Scripts', created.script.id)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createCustomScript rejects missing invalid and duplicate human ids', async () => {
  const root = makeRoot();
  try {
    writeBaseFiles(root);
    const config = configFor(root);

    await uploadCustomScript(config, {
      fileName: 'firewall.ps1',
      buffer: Buffer.from("Write-Host 'firewall'\n"),
    }, { uploadId: 'upload-fw' });

    await assert.rejects(() => createCustomScript(config, {
      uploadId: 'upload-fw',
      name: 'Missing ID',
    }), /Custom script id is required/);
    await assert.rejects(() => createCustomScript(config, {
      uploadId: 'upload-fw',
      scriptId: 'Bad_ID',
      name: 'Bad ID',
    }), /lowercase letters, numbers, and hyphens only/);
    await assert.rejects(() => createCustomScript(config, {
      uploadId: 'upload-fw',
      scriptId: 'abcdefghijklmnopq',
      name: 'Too Long',
    }), /max 16 characters/);
    const created = await createCustomScript(config, {
      uploadId: 'upload-fw',
      scriptId: 'firewall',
      name: 'Firewall',
    });
    assert.equal(created.script.id, 'firewall');

    await uploadCustomScript(config, {
      fileName: 'other.ps1',
      buffer: Buffer.from("Write-Host 'other'\n"),
    }, { uploadId: 'upload-other' });
    await assert.rejects(() => createCustomScript(config, {
      uploadId: 'upload-other',
      scriptId: 'firewall',
      name: 'Duplicate',
    }), /Duplicate custom script id or source/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test('publishDeploymentProfile fails in offline mode when software payload is missing', async () => {
  const root = makeRoot();
  try {
    writeInstallerScript(root);
    const softwareRoot = path.join(root, 'Softwares', 'one');
    fs.mkdirSync(softwareRoot, { recursive: true });
    fs.writeFileSync(path.join(softwareRoot, 'install.ps1'), "Write-Host 'installed'\n", 'utf8');

    writeJson(path.join(root, 'software-catalog.json'), {
      software: [catalogSoftware('one', 'One App')],
    });
    writeJson(path.join(root, 'profiles', 'default.json'), {
      id: 'default',
      name: 'Default',
      software: ['one'],
      osImage: 'TEST-OS',
    });

    const config = configFor(root);
    config.offlineMode = true;

    await assert.rejects(
      () => publishDeploymentProfile(config),
      /Offline Mode is active/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
