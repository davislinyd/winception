import fs from 'node:fs';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..');
const generatedProfileIdAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const generatedProfileIdLength = 8;
const generatedProfileIdSpace = generatedProfileIdAlphabet.length ** generatedProfileIdLength;
const defaultGeneratedProfileIdAttempts = 256;

export const selectedProfileFileName = 'selected-profile.json';

function deploymentProfileDefaults(root) {
  return {
    activeProfile: 'I20HRVF5',
    profilesRoot: path.join(root, 'config', 'deployment-profiles'),
    softwareCatalogPath: path.join(root, 'config', 'software-catalog.json'),
    softwareSourceRoot: path.join(root, 'Softwares'),
    appsRoot: 'C:\\OSDCloud\\Win11-iPXE-Lab\\Media\\OSDCloud\\Apps',
    installerScript: path.join(root, 'Softwares', 'Install-Apps.ps1'),
  };
}

function isSafeId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(String(value ?? ''));
}

export function isSafeDeploymentProfileId(value) {
  return isSafeId(value);
}

function normalizeId(value, label) {
  const id = String(value ?? '').trim();
  if (!isSafeId(id)) {
    throw new Error(`Invalid ${label} id: ${value}`);
  }
  return id;
}

function formatGeneratedProfileId(value, alphabet = generatedProfileIdAlphabet, idLength = generatedProfileIdLength) {
  const chars = Array.from({ length: idLength }, () => alphabet[0]);
  let remaining = value;
  for (let index = idLength - 1; index >= 0; index -= 1) {
    chars[index] = alphabet[remaining % alphabet.length];
    remaining = Math.floor(remaining / alphabet.length);
  }
  return chars.join('');
}

function isMixedAlphanumericProfileId(id, alphabet = generatedProfileIdAlphabet, idLength = generatedProfileIdLength) {
  return id.length === idLength
    && [...id].every((char) => alphabet.includes(char))
    && /[A-Z]/u.test(id)
    && /\d/u.test(id);
}

export function generateDeploymentProfileId(existingIds = [], options = {}) {
  const reserved = new Set(Array.from(existingIds ?? [], (id) => String(id)));
  const nextRandomInt = options.randomInt ?? randomInt;
  const alphabet = options.alphabet ?? generatedProfileIdAlphabet;
  const idLength = options.idLength ?? generatedProfileIdLength;
  const idSpaceSize = options.idSpaceSize ?? alphabet.length ** idLength;
  const maxAttempts = options.maxAttempts ?? defaultGeneratedProfileIdAttempts;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const id = formatGeneratedProfileId(nextRandomInt(idSpaceSize), alphabet, idLength);
    if (isMixedAlphanumericProfileId(id, alphabet, idLength) && !reserved.has(id)) {
      return id;
    }
  }

  for (let value = 0; value < idSpaceSize; value += 1) {
    const id = formatGeneratedProfileId(value, alphabet, idLength);
    if (isMixedAlphanumericProfileId(id, alphabet, idLength) && !reserved.has(id)) {
      return id;
    }
  }

  throw new Error('No available deployment profile ids remain');
}

function normalizeProfileName(value, label = 'Deployment profile name') {
  const name = String(value ?? '').trim();
  if (!name) {
    throw new Error(`${label} is required`);
  }
  return name;
}

function resolveConfiguredPath(root, value) {
  if (!value) {
    return value;
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
}

function assertInside(root, target, label) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const relative = path.relative(rootPath, targetPath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes root: ${target}`);
  }
  return targetPath;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label} ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function arrayFrom(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

export function deploymentProfileOptions(config = {}, overrides = {}) {
  const root = path.resolve(config.paths?.repoRoot ?? repoRoot);
  const defaults = deploymentProfileDefaults(root);
  const section = {
    ...defaults,
    ...(config.deploymentProfiles ?? {}),
    ...overrides,
  };

  return {
    activeProfile: section.activeProfile ?? defaults.activeProfile,
    profilesRoot: resolveConfiguredPath(root, section.profilesRoot),
    softwareCatalogPath: resolveConfiguredPath(root, section.softwareCatalogPath),
    softwareSourceRoot: resolveConfiguredPath(root, section.softwareSourceRoot),
    appsRoot: resolveConfiguredPath(root, section.appsRoot ?? section.liveAppsRoot),
    installerScript: resolveConfiguredPath(root, section.installerScript),
  };
}

export function loadSoftwareCatalog(config = {}, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const raw = readJson(profileOptions.softwareCatalogPath, 'software catalog');
  const softwareRows = arrayFrom(raw.software, 'software catalog software');
  const seen = new Set();
  const software = softwareRows.map((row) => {
    const id = normalizeId(row.id, 'software');
    if (seen.has(id)) {
      throw new Error(`Duplicate software id: ${id}`);
    }
    seen.add(id);

    const source = String(row.source ?? id).trim();
    if (!source || path.isAbsolute(source)) {
      throw new Error(`Invalid source for software ${id}: ${source}`);
    }

    const sourcePath = assertInside(
      profileOptions.softwareSourceRoot,
      path.resolve(profileOptions.softwareSourceRoot, source),
      `Software ${id} source`,
    );
    const installScript = path.join(sourcePath, 'install.ps1');
    if (options.validateSources !== false) {
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
        throw new Error(`Software source folder not found for ${id}: ${sourcePath}`);
      }
      if (!fs.existsSync(installScript)) {
        throw new Error(`Software install.ps1 not found for ${id}: ${installScript}`);
      }
    }

    return {
      id,
      name: String(row.name ?? id),
      source,
      sourcePath,
      installScript,
    };
  });

  return {
    path: profileOptions.softwareCatalogPath,
    software,
    byId: new Map(software.map((item) => [item.id, item])),
  };
}

export function loadDeploymentProfiles(config = {}, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const catalog = options.catalog ?? loadSoftwareCatalog(config, options);
  if (!fs.existsSync(profileOptions.profilesRoot)) {
    throw new Error(`Deployment profile folder not found: ${profileOptions.profilesRoot}`);
  }

  const files = fs.readdirSync(profileOptions.profilesRoot)
    .filter((entry) => entry.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const seen = new Set();
  const profiles = files.map((fileName) => {
    const filePath = path.join(profileOptions.profilesRoot, fileName);
    const raw = readJson(filePath, 'deployment profile');
    const id = normalizeId(raw.id, 'profile');
    if (seen.has(id)) {
      throw new Error(`Duplicate deployment profile id: ${id}`);
    }
    seen.add(id);

    const selectedIds = arrayFrom(raw.software ?? raw.selectedSoftware ?? [], `deployment profile ${id} software`)
      .map((softwareId) => normalizeId(softwareId, `deployment profile ${id} software`));
    const selectedSeen = new Set();
    for (const softwareId of selectedIds) {
      if (selectedSeen.has(softwareId)) {
        throw new Error(`Duplicate software id ${softwareId} in profile ${id}`);
      }
      selectedSeen.add(softwareId);
      if (!catalog.byId.has(softwareId)) {
        throw new Error(`Profile ${id} references unknown software: ${softwareId}`);
      }
    }

    return {
      id,
      name: String(raw.name ?? id),
      description: String(raw.description ?? ''),
      softwareIds: selectedIds,
      filePath,
    };
  });

  return profiles;
}

export function resolveDeploymentProfileState(config = {}, profileId = null, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const catalog = loadSoftwareCatalog(config, options);
  const profiles = loadDeploymentProfiles(config, { ...options, catalog });
  const selectedId = normalizeId(profileId ?? profileOptions.activeProfile, 'active profile');
  const activeProfile = profiles.find((profile) => profile.id === selectedId);
  if (!activeProfile) {
    throw new Error(`Active deployment profile not found: ${selectedId}`);
  }

  const selectedSoftware = activeProfile.softwareIds.map((id) => catalog.byId.get(id));
  return {
    options: profileOptions,
    catalog,
    profiles,
    activeProfile,
    selectedSoftware,
  };
}

function normalizeSoftwareSelection(softwareIds, catalog, label) {
  const selectedIds = arrayFrom(softwareIds, label)
    .map((softwareId) => normalizeId(softwareId, label));
  const seen = new Set();
  for (const softwareId of selectedIds) {
    if (seen.has(softwareId)) {
      throw new Error(`Duplicate software id ${softwareId} in ${label}`);
    }
    seen.add(softwareId);
    if (!catalog.byId.has(softwareId)) {
      throw new Error(`${label} references unknown software: ${softwareId}`);
    }
  }
  return selectedIds;
}

function profileFilePath(profileOptions, profileId) {
  return assertInside(
    profileOptions.profilesRoot,
    path.join(profileOptions.profilesRoot, `${profileId}.json`),
    'Deployment profile path',
  );
}

function reservedDeploymentProfileIds(profileOptions, profiles) {
  const reserved = new Set(profiles.map((profile) => profile.id));
  if (fs.existsSync(profileOptions.profilesRoot)) {
    for (const fileName of fs.readdirSync(profileOptions.profilesRoot)) {
      if (fileName.toLowerCase().endsWith('.json')) {
        reserved.add(path.basename(fileName, '.json'));
      }
    }
  }
  return reserved;
}

export function createDeploymentProfile(config = {}, input = {}, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const name = normalizeProfileName(input.name);

  const state = resolveDeploymentProfileState(config, null, options);

  if (!fs.existsSync(profileOptions.profilesRoot)) {
    throw new Error(`Deployment profile folder not found: ${profileOptions.profilesRoot}`);
  }

  const id = generateDeploymentProfileId(reservedDeploymentProfileIds(profileOptions, state.profiles), options);
  const filePath = profileFilePath(profileOptions, id);
  if (fs.existsSync(filePath)) {
    throw new Error(`Deployment profile file already exists: ${filePath}`);
  }

  const softwareIds = [...state.activeProfile.softwareIds];
  const raw = {
    id,
    name,
    software: softwareIds,
  };
  writeJson(filePath, raw);

  return {
    profile: {
      id,
      name,
      description: '',
      softwareIds,
      filePath,
    },
    filePath,
  };
}

export function updateDeploymentProfile(config = {}, profileId, input = {}, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const catalog = loadSoftwareCatalog(config, options);
  const profiles = loadDeploymentProfiles(config, { ...options, catalog });
  const id = normalizeId(profileId, 'profile');
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new Error(`Deployment profile not found: ${id}`);
  }

  if (input.id !== undefined && normalizeId(input.id, 'profile') !== id) {
    throw new Error('Deployment profile id cannot be changed');
  }

  const selectedIds = input.softwareIds === undefined
    ? profile.softwareIds
    : normalizeSoftwareSelection(input.softwareIds, catalog, `deployment profile ${id} software`);
  const name = input.name === undefined
    ? profile.name
    : normalizeProfileName(input.name);
  const filePath = assertInside(profileOptions.profilesRoot, profile.filePath, 'Deployment profile path');
  const raw = readJson(filePath, 'deployment profile');
  raw.id = id;
  raw.name = name;
  raw.software = selectedIds;
  writeJson(filePath, raw);

  return {
    profile: {
      ...profile,
      name,
      softwareIds: selectedIds,
    },
    filePath,
  };
}

export function updateDeploymentProfileSoftware(config = {}, profileId, softwareIds, options = {}) {
  return updateDeploymentProfile(config, profileId, { softwareIds }, options);
}

export function deleteDeploymentProfile(config = {}, profileId, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const id = normalizeId(profileId, 'profile');
  const activeProfileId = normalizeId(profileOptions.activeProfile, 'active profile');
  if (id === activeProfileId) {
    throw new Error(`Cannot delete active deployment profile: ${id}`);
  }

  const catalog = loadSoftwareCatalog(config, options);
  const profiles = loadDeploymentProfiles(config, { ...options, catalog });
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new Error(`Deployment profile not found: ${id}`);
  }

  const filePath = assertInside(profileOptions.profilesRoot, profile.filePath, 'Deployment profile path');
  fs.rmSync(filePath, { force: true });
  return {
    profile,
    filePath,
  };
}

function assertSafeAppsRoot(appsRoot) {
  const resolved = path.resolve(appsRoot);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    throw new Error(`Refusing to publish to filesystem root: ${resolved}`);
  }
  if (path.basename(resolved).toLowerCase() !== 'apps') {
    throw new Error(`Refusing to publish outside an Apps folder: ${resolved}`);
  }
  return resolved;
}

function removeAppsRootContents(appsRoot) {
  if (!fs.existsSync(appsRoot)) {
    fs.mkdirSync(appsRoot, { recursive: true });
    return 0;
  }

  let removed = 0;
  for (const entry of fs.readdirSync(appsRoot)) {
    fs.rmSync(path.join(appsRoot, entry), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function profileManifest(state) {
  return {
    profileId: state.activeProfile.id,
    profileName: state.activeProfile.name,
    publishedAt: new Date().toISOString(),
    selectedSoftware: state.selectedSoftware.map((software) => software.id),
    software: state.selectedSoftware.map((software) => ({
      id: software.id,
      name: software.name,
    })),
  };
}

export function publishDeploymentProfile(config = {}, profileId = null, options = {}) {
  const state = resolveDeploymentProfileState(config, profileId, options);
  const appsRoot = assertSafeAppsRoot(state.options.appsRoot);
  if (!fs.existsSync(state.options.installerScript)) {
    throw new Error(`Install-Apps.ps1 source not found: ${state.options.installerScript}`);
  }

  const removed = removeAppsRootContents(appsRoot);
  fs.copyFileSync(state.options.installerScript, path.join(appsRoot, 'Install-Apps.ps1'));

  const copied = [];
  for (const software of state.selectedSoftware) {
    const target = path.join(appsRoot, software.id);
    fs.cpSync(software.sourcePath, target, { recursive: true });
    copied.push(software.id);
  }

  const manifest = profileManifest(state);
  const manifestPath = path.join(appsRoot, selectedProfileFileName);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    profile: state.activeProfile,
    selectedSoftware: state.selectedSoftware,
    appsRoot,
    manifestPath,
    copied,
    removed,
  };
}

function sameStringArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pass(name, detail = '') {
  return { name, ok: true, detail };
}

function fail(name, detail = '') {
  return { name, ok: false, detail };
}

export function evaluateDeploymentProfilePayload(config = {}, options = {}) {
  try {
    const state = resolveDeploymentProfileState(config, null, options);
    const appsRoot = state.options.appsRoot;
    if (!fs.existsSync(appsRoot)) {
      return fail('Deployment profile', `Apps root not found: ${appsRoot}`);
    }

    const manifestPath = path.join(appsRoot, selectedProfileFileName);
    if (!fs.existsSync(manifestPath)) {
      return fail('Deployment profile', `selected profile manifest not found: ${manifestPath}`);
    }

    const manifest = readJson(manifestPath, 'selected profile manifest');
    if (manifest.profileId !== state.activeProfile.id) {
      return fail('Deployment profile', `published=${manifest.profileId ?? ''} active=${state.activeProfile.id}`);
    }

    const expectedIds = state.selectedSoftware.map((software) => software.id);
    const manifestIds = Array.isArray(manifest.selectedSoftware) ? manifest.selectedSoftware.map(String) : [];
    if (!sameStringArray(manifestIds, expectedIds)) {
      return fail('Deployment profile', `manifest software=${manifestIds.join(',') || 'none'} expected=${expectedIds.join(',') || 'none'}`);
    }

    const liveFolders = fs.readdirSync(appsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const unexpected = liveFolders.filter((id) => !expectedIds.includes(id));
    const missing = expectedIds.filter((id) => !liveFolders.includes(id));
    if (unexpected.length > 0) {
      return fail('Deployment profile', `unexpected live app folders: ${unexpected.join(', ')}`);
    }
    if (missing.length > 0) {
      return fail('Deployment profile', `missing live app folders: ${missing.join(', ')}`);
    }

    for (const softwareId of expectedIds) {
      const script = path.join(appsRoot, softwareId, 'install.ps1');
      if (!fs.existsSync(script)) {
        return fail('Deployment profile', `missing live installer script for ${softwareId}: ${script}`);
      }
    }

    const selected = expectedIds.length ? expectedIds.join(', ') : 'none';
    return pass('Deployment profile', `${state.activeProfile.id} (${selected}) published to ${appsRoot}`);
  } catch (error) {
    return fail('Deployment profile', error.message);
  }
}

export function formatSoftwareList(software) {
  return software.length ? software.map((item) => item.id).join(', ') : 'none';
}
