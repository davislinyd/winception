import fs from 'node:fs';
import path from 'node:path';
import { loadCustomScriptCatalog } from './scripts.js';
import { arrayFrom, assertInside, defaultInstallSequenceTimeoutSeconds, deploymentProfileOptions, generateDeploymentProfileId, inputError, normalizeExecutionSettings, normalizeId, normalizeLocaleTag, normalizePositiveInteger, normalizeProfileDescription, normalizeProfileName, normalizeWindowsTimeZoneId, profileNameKey, readJson, resolveExecutionSettings, selectedProfileFileName, writeJson } from './shared.js';
import { loadSoftwareCatalog } from './software.js';

export function normalizeInstallSequence(value, catalog, scriptCatalog, label) {
  if (value === undefined || value === null) {
    return null;
  }
  const rows = arrayFrom(value, label);
  const seen = new Set();
  return rows.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const type = String(entry?.type ?? '').trim().toLowerCase();
    if (type !== 'software' && type !== 'script') {
      throw new Error(`${itemLabel}.type must be software or script`);
    }
    const id = normalizeId(entry?.id, `${itemLabel}.id`);
    const key = `${type}:${id}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate install sequence entry ${key} in ${label}`);
    }
    seen.add(key);
    if (type === 'software') {
      if (!catalog.byId.has(id)) {
        throw new Error(`${label} references unknown software: ${id}`);
      }
      const timeoutSeconds = normalizePositiveInteger(entry?.timeoutSeconds, `${itemLabel}.timeoutSeconds`, { optional: true, min: 1 });
      return timeoutSeconds === null ? { type, id } : { type, id, timeoutSeconds };
    }
    const catalogEntry = scriptCatalog?.byId?.get(id);
    if (scriptCatalog && !catalogEntry) {
      throw new Error(`${label} references unknown custom script: ${id}`);
    }
    const timeoutSeconds = normalizePositiveInteger(entry?.timeoutSeconds, `${itemLabel}.timeoutSeconds`, { optional: true, min: 1 });
    return timeoutSeconds === null ? { type, id } : { type, id, timeoutSeconds };
  });
}

export function softwareIdsFromInstallSequence(sequence = []) {
  return sequence
    .filter((entry) => entry.type === 'software')
    .map((entry) => entry.id);
}

export function scriptIdsFromInstallSequence(sequence = []) {
  return sequence
    .filter((entry) => entry.type === 'script')
    .map((entry) => entry.id);
}

export function installSequenceFromSoftwareIds(softwareIds = []) {
  return softwareIds.map((id) => ({ type: 'software', id }));
}

export function legacyInstallSequenceFromSelections(softwareIds = [], customScripts = []) {
  const beforeScripts = [];
  const afterScripts = [];
  for (const entry of arrayFrom(customScripts, 'deployment profile customScripts')) {
    const rawId = typeof entry === 'string' ? entry : entry?.id;
    const id = normalizeId(rawId, 'deployment profile customScripts id');
    const phase = String(entry?.phase ?? '').trim().toLowerCase();
    if (phase === 'before') {
      beforeScripts.push({ type: 'script', id });
    } else {
      afterScripts.push({ type: 'script', id });
    }
  }
  return [
    ...beforeScripts,
    ...installSequenceFromSoftwareIds(softwareIds),
    ...afterScripts,
  ];
}

export function replaceSoftwareIdsInInstallSequence(sequence = [], softwareIds = []) {
  const nextSequence = [];
  let softwareIndex = 0;
  for (const entry of sequence) {
    if (entry.type === 'software') {
      if (softwareIndex < softwareIds.length) {
        nextSequence.push({ type: 'software', id: softwareIds[softwareIndex] });
        softwareIndex += 1;
      }
      continue;
    }
    nextSequence.push({ ...entry });
  }
  while (softwareIndex < softwareIds.length) {
    nextSequence.push({ type: 'software', id: softwareIds[softwareIndex] });
    softwareIndex += 1;
  }
  return nextSequence;
}

export function validateProfileCustomScriptsRemoved(value, label) {
  if (value !== undefined) {
    throw inputError(`${label} is no longer supported; use installSequence only`);
  }
}

export function sortInstallSequenceBySoftwareDependencies(sequence = [], catalog, label) {
  const softwareEntries = sequence
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.type === 'software');
  const byId = new Map(softwareEntries.map(({ entry }) => [entry.id, entry]));
  const inDegree = new Map(softwareEntries.map(({ entry }) => [entry.id, 0]));
  const dependents = new Map(softwareEntries.map(({ entry }) => [entry.id, []]));

  for (const { entry } of softwareEntries) {
    const software = catalog.byId.get(entry.id);
    for (const dependencyId of software?.dependsOn ?? []) {
      if (!byId.has(dependencyId)) {
        throw new Error(`${label} selects ${entry.id} but is missing required software dependency: ${dependencyId}`);
      }
      inDegree.set(entry.id, inDegree.get(entry.id) + 1);
      dependents.get(dependencyId).push(entry.id);
    }
  }

  const originalIndex = new Map(softwareEntries.map(({ entry, index }) => [entry.id, index]));
  const ready = softwareEntries
    .filter(({ entry }) => inDegree.get(entry.id) === 0)
    .map(({ entry }) => entry.id)
    .sort((left, right) => originalIndex.get(left) - originalIndex.get(right));
  const sortedIds = [];
  while (ready.length) {
    const id = ready.shift();
    sortedIds.push(id);
    for (const dependentId of dependents.get(id)) {
      const nextDegree = inDegree.get(dependentId) - 1;
      inDegree.set(dependentId, nextDegree);
      if (nextDegree === 0) {
        ready.push(dependentId);
        ready.sort((left, right) => originalIndex.get(left) - originalIndex.get(right));
      }
    }
  }
  if (sortedIds.length !== softwareEntries.length) {
    throw new Error(`${label} contains a software dependency cycle`);
  }

  const sortedEntries = sortedIds.map((id) => ({ ...byId.get(id) }));
  let nextSoftwareIndex = 0;
  return sequence.map((entry) => entry.type === 'software'
    ? sortedEntries[nextSoftwareIndex++]
    : entry);
}

export function sameSoftwareSelection(left = [], right = []) {
  return left.length === right.length
    && left.every((id) => right.includes(id));
}

export function assertUniqueProfileName(profiles, name, options = {}) {
  const key = profileNameKey(name);
  const duplicate = profiles.find((profile) => profileNameKey(profile.name) === key && profile.id !== options.excludeId);
  if (duplicate) {
    throw inputError(`Duplicate deployment profile name: ${name}`, 409);
  }
}

export function inheritMissingInternationalSettings(profile, activeProfile) {
  if (!profile || !activeProfile || profile.id === activeProfile.id || !profile.osImageId || profile.osImageId !== activeProfile.osImageId) {
    return null;
  }
  const keys = ['displayLanguage', 'locale', 'inputLanguage', 'timeZone'];
  if (!keys.some((key) => !profile[key]) || keys.some((key) => !activeProfile[key])) {
    return null;
  }
  return Object.fromEntries(keys.map((key) => [key, profile[key] ?? activeProfile[key]]));
}

export function loadDeploymentProfiles(config = {}, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const catalog = options.catalog ?? loadSoftwareCatalog(config, options);
  const scriptCatalog = options.scriptCatalog ?? loadCustomScriptCatalog(config, options);
  const osImageCatalog = options.osImageCatalog ?? null;
  const defaultOsImageId = options.defaultOsImageId
    ?? config.osImage?.activeImage
    ?? null;
  if (!fs.existsSync(profileOptions.profilesRoot)) {
    throw new Error(`Deployment profile folder not found: ${profileOptions.profilesRoot}`);
  }

  const files = fs.readdirSync(profileOptions.profilesRoot)
    .filter((entry) => entry.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const seen = new Set();
  const seenNames = new Map();
  const profiles = files.map((fileName) => {
    const filePath = path.join(profileOptions.profilesRoot, fileName);
    const raw = readJson(filePath, 'deployment profile');
    const id = normalizeId(raw.id, 'profile');
    if (seen.has(id)) {
      throw new Error(`Duplicate deployment profile id: ${id}`);
    }
    seen.add(id);

    const explicitExecution = normalizeExecutionSettings(raw.execution, `deployment profile ${id} execution`);
    const execution = resolveExecutionSettings(raw.execution, `deployment profile ${id} execution`);
    const rawInstallSequence = normalizeInstallSequence(
      raw.installSequence,
      catalog,
      scriptCatalog,
      `deployment profile ${id} installSequence`,
    );
    const declaredSoftware = raw.software ?? raw.selectedSoftware ?? [];
    const normalizedDeclaredSoftware = normalizeSoftwareSelection(declaredSoftware, catalog, `deployment profile ${id} software`);
    const unnormalizedInstallSequence = rawInstallSequence
      ?? (raw.customScripts !== undefined
        ? normalizeInstallSequence(
          legacyInstallSequenceFromSelections(normalizedDeclaredSoftware, raw.customScripts),
          catalog,
          scriptCatalog,
          `deployment profile ${id} legacy installSequence`,
        )
        : installSequenceFromSoftwareIds(normalizedDeclaredSoftware));
    const installSequence = sortInstallSequenceBySoftwareDependencies(
      unnormalizedInstallSequence,
      catalog,
      `deployment profile ${id} installSequence`,
    );
    const selectedIds = softwareIdsFromInstallSequence(installSequence);
    if (rawInstallSequence !== null && (raw.software !== undefined || raw.selectedSoftware !== undefined)) {
      if (!sameSoftwareSelection(normalizedDeclaredSoftware, selectedIds)) {
        throw new Error(`Profile ${id} software must match installSequence`);
      }
    }

    const rawOsImageId = String(raw.osImage ?? raw.osImageId ?? '').trim();
    let osImageId;
    if (rawOsImageId) {
      osImageId = normalizeId(rawOsImageId, `deployment profile ${id} osImage`);
    } else if (defaultOsImageId) {
      osImageId = normalizeId(defaultOsImageId, `deployment profile ${id} osImage`);
    } else {
      osImageId = null;
    }
    if (osImageId && osImageCatalog && !osImageCatalog.byId?.has(osImageId)) {
      throw new Error(`Profile ${id} references unknown OS image: ${osImageId}`);
    }

    const displayLanguage = normalizeLocaleTag(raw.displayLanguage, `deployment profile ${id} displayLanguage`, { optional: true });
    const locale = normalizeLocaleTag(raw.locale, `deployment profile ${id} locale`, { optional: true });
    const inputLanguage = normalizeLocaleTag(raw.inputLanguage, `deployment profile ${id} inputLanguage`, { optional: true });
    const timeZone = normalizeWindowsTimeZoneId(raw.timeZone, `deployment profile ${id} timeZone`, { optional: true });

    const name = normalizeProfileName(raw.name ?? id, `deployment profile ${id} name`);
    const nameKey = profileNameKey(name);
    const existingNameProfile = seenNames.get(nameKey);
    if (existingNameProfile) {
      throw new Error(`Duplicate deployment profile name: ${name}`);
    }
    seenNames.set(nameKey, id);

    return {
      id,
      name,
      description: String(raw.description ?? ''),
      softwareIds: selectedIds,
      installSequence,
      execution,
      hasExplicitExecution: explicitExecution !== null,
      hasInstallSequence: rawInstallSequence !== null,
      osImageId,
      displayLanguage,
      locale,
      inputLanguage,
      timeZone,
      filePath,
    };
  });

  return profiles;
}

export function resolveDeploymentProfileState(config = {}, profileId = null, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const catalog = loadSoftwareCatalog(config, options);
  const scriptCatalog = loadCustomScriptCatalog(config, options);
  const profiles = loadDeploymentProfiles(config, { ...options, catalog, scriptCatalog });
  const selectedId = normalizeId(profileId ?? profileOptions.activeProfile, 'active profile');
  const activeProfile = profiles.find((profile) => profile.id === selectedId);
  if (!activeProfile) {
    throw new Error(`Active deployment profile not found: ${selectedId}`);
  }

  const selectedSoftware = activeProfile.softwareIds.map((id) => catalog.byId.get(id));
  const selectedScripts = scriptIdsFromInstallSequence(activeProfile.installSequence)
    .map((id) => scriptCatalog.byId.get(id))
    .filter(Boolean);
  const installSequence = (activeProfile.installSequence ?? []).map((entry) => {
    if (entry.type === 'software') {
      const software = catalog.byId.get(entry.id);
      return software
        ? {
          type: 'software',
          id: entry.id,
          software,
          ...(entry.timeoutSeconds === undefined ? {} : { timeoutSeconds: entry.timeoutSeconds }),
        }
        : null;
    }
    const script = scriptCatalog.byId.get(entry.id);
    return script
      ? {
        type: 'script',
        id: entry.id,
        script,
        ...(entry.timeoutSeconds === undefined ? {} : { timeoutSeconds: entry.timeoutSeconds }),
      }
      : null;
  }).filter(Boolean);
  return {
    options: profileOptions,
    catalog,
    scriptCatalog,
    profiles,
    activeProfile,
    selectedSoftware,
    selectedScripts,
    installSequence,
    osImageId: activeProfile.osImageId,
  };
}

export function normalizeSoftwareSelection(softwareIds, catalog, label) {
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

export function profileFilePath(profileOptions, profileId) {
  return assertInside(
    profileOptions.profilesRoot,
    path.join(profileOptions.profilesRoot, `${profileId}.json`),
    'Deployment profile path',
  );
}

export function reservedDeploymentProfileIds(profileOptions, profiles) {
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
  assertUniqueProfileName(state.profiles, name);

  if (!fs.existsSync(profileOptions.profilesRoot)) {
    throw new Error(`Deployment profile folder not found: ${profileOptions.profilesRoot}`);
  }

  const id = generateDeploymentProfileId(reservedDeploymentProfileIds(profileOptions, state.profiles), options);
  const filePath = profileFilePath(profileOptions, id);
  if (fs.existsSync(filePath)) {
    throw new Error(`Deployment profile file already exists: ${filePath}`);
  }

  const installSequence = sortInstallSequenceBySoftwareDependencies(
    (state.activeProfile.installSequence ?? []).map((entry) => ({ ...entry })),
    state.catalog,
    `deployment profile ${id} installSequence`,
  );
  const softwareIds = softwareIdsFromInstallSequence(installSequence);
  const rawOsImageId = String(input.osImageId ?? state.activeProfile.osImageId ?? '').trim();
  const osImageId = rawOsImageId ? normalizeId(rawOsImageId, `deployment profile ${id} osImage`) : null;
  const explicitExecution = Object.prototype.hasOwnProperty.call(input, 'execution')
    ? normalizeExecutionSettings(input.execution, `deployment profile ${id} execution`)
    : (state.activeProfile.hasExplicitExecution ? { ...state.activeProfile.execution } : null);
  const displayLanguage = normalizeLocaleTag(
    Object.prototype.hasOwnProperty.call(input, 'displayLanguage') ? input.displayLanguage : state.activeProfile.displayLanguage,
    `deployment profile ${id} displayLanguage`,
    { optional: true },
  );
  const locale = normalizeLocaleTag(
    Object.prototype.hasOwnProperty.call(input, 'locale') ? input.locale : state.activeProfile.locale,
    `deployment profile ${id} locale`,
    { optional: true },
  );
  const inputLanguage = normalizeLocaleTag(
    Object.prototype.hasOwnProperty.call(input, 'inputLanguage') ? input.inputLanguage : state.activeProfile.inputLanguage,
    `deployment profile ${id} inputLanguage`,
    { optional: true },
  );
  const timeZone = normalizeWindowsTimeZoneId(
    Object.prototype.hasOwnProperty.call(input, 'timeZone') ? input.timeZone : state.activeProfile.timeZone,
    `deployment profile ${id} timeZone`,
    { optional: true },
  );

  const raw = {
    id,
    name,
    software: softwareIds,
    installSequence,
  };
  if (osImageId) {
    raw.osImage = osImageId;
  }
  if (input.description !== undefined) {
    raw.description = normalizeProfileDescription(input.description);
  }
  if (explicitExecution) {
    raw.execution = explicitExecution;
  }
  if (locale) {
    raw.locale = locale;
  }
  if (displayLanguage) {
    raw.displayLanguage = displayLanguage;
  }
  if (inputLanguage) {
    raw.inputLanguage = inputLanguage;
  }
  if (timeZone) {
    raw.timeZone = timeZone;
  }
  writeJson(filePath, raw);

  return {
    profile: {
      id,
      name,
      description: raw.description ?? '',
      softwareIds,
      installSequence,
      execution: explicitExecution ?? { defaultTimeoutSeconds: defaultInstallSequenceTimeoutSeconds },
      hasExplicitExecution: explicitExecution !== null,
      hasInstallSequence: true,
      osImageId,
      displayLanguage,
      locale,
      inputLanguage,
      timeZone,
      filePath,
    },
    filePath,
  };
}

export function updateDeploymentProfile(config = {}, profileId, input = {}, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const catalog = loadSoftwareCatalog(config, options);
  const scriptCatalog = loadCustomScriptCatalog(config, options);
  const profiles = loadDeploymentProfiles(config, { ...options, catalog, scriptCatalog });
  const id = normalizeId(profileId, 'profile');
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new Error(`Deployment profile not found: ${id}`);
  }

  if (input.id !== undefined && normalizeId(input.id, 'profile') !== id) {
    throw new Error('Deployment profile id cannot be changed');
  }

  validateProfileCustomScriptsRemoved(input.customScripts, `deployment profile ${id} customScripts`);
  const selectedIds = input.softwareIds === undefined
    ? profile.softwareIds
    : normalizeSoftwareSelection(input.softwareIds, catalog, `deployment profile ${id} software`);
  const unnormalizedInstallSequence = input.installSequence === undefined
    ? (input.softwareIds === undefined
      ? profile.installSequence.map((entry) => ({ ...entry }))
      : replaceSoftwareIdsInInstallSequence(profile.installSequence, selectedIds))
    : normalizeInstallSequence(input.installSequence, catalog, scriptCatalog, `deployment profile ${id} installSequence`);
  const installSequence = sortInstallSequenceBySoftwareDependencies(
    unnormalizedInstallSequence,
    catalog,
    `deployment profile ${id} installSequence`,
  );
  const sequenceSoftwareIds = softwareIdsFromInstallSequence(installSequence);
  if (input.softwareIds !== undefined && !sameSoftwareSelection(selectedIds, sequenceSoftwareIds)) {
    throw new Error(`deployment profile ${id} softwareIds must match installSequence`);
  }
  const name = input.name === undefined
    ? profile.name
    : normalizeProfileName(input.name);
  assertUniqueProfileName(profiles, name, { excludeId: id });
  const rawOsImageId = input.osImageId === undefined
    ? profile.osImageId
    : String(input.osImageId ?? '').trim();
  const osImageId = rawOsImageId ? normalizeId(rawOsImageId, `deployment profile ${id} osImage`) : null;
  const hasExecution = Object.prototype.hasOwnProperty.call(input, 'execution');
  const rawExecution = hasExecution
    ? normalizeExecutionSettings(input.execution, `deployment profile ${id} execution`)
    : null;
  const execution = hasExecution
    ? resolveExecutionSettings(input.execution, `deployment profile ${id} execution`)
    : profile.execution;
  const hasDisplayLanguage = Object.prototype.hasOwnProperty.call(input, 'displayLanguage');
  const displayLanguage = hasDisplayLanguage
    ? normalizeLocaleTag(input.displayLanguage, `deployment profile ${id} displayLanguage`, { optional: true })
    : profile.displayLanguage ?? null;
  const hasLocale = Object.prototype.hasOwnProperty.call(input, 'locale');
  const locale = hasLocale
    ? normalizeLocaleTag(input.locale, `deployment profile ${id} locale`, { optional: true })
    : profile.locale ?? null;
  const hasInputLanguage = Object.prototype.hasOwnProperty.call(input, 'inputLanguage');
  const inputLanguage = hasInputLanguage
    ? normalizeLocaleTag(input.inputLanguage, `deployment profile ${id} inputLanguage`, { optional: true })
    : profile.inputLanguage ?? null;
  const hasTimeZone = Object.prototype.hasOwnProperty.call(input, 'timeZone');
  const timeZone = hasTimeZone
    ? normalizeWindowsTimeZoneId(input.timeZone, `deployment profile ${id} timeZone`, { optional: true })
    : profile.timeZone ?? null;
  if (osImageId && options.osImageCatalog && !options.osImageCatalog.byId?.has(osImageId)) {
    throw new Error(`Profile ${id} references unknown OS image: ${osImageId}`);
  }
  const filePath = assertInside(profileOptions.profilesRoot, profile.filePath, 'Deployment profile path');
  const raw = readJson(filePath, 'deployment profile');
  raw.id = id;
  raw.name = name;
  raw.software = sequenceSoftwareIds;
  delete raw.customScripts;
  raw.installSequence = installSequence;
  if (hasExecution) {
    if (rawExecution) {
      raw.execution = rawExecution;
    } else {
      delete raw.execution;
    }
  }
  if (osImageId) {
    raw.osImage = osImageId;
  } else {
    delete raw.osImage;
  }
  if (input.description !== undefined) {
    raw.description = normalizeProfileDescription(input.description);
  }
  if (locale) {
    raw.locale = locale;
  } else {
    delete raw.locale;
  }
  if (displayLanguage) {
    raw.displayLanguage = displayLanguage;
  } else {
    delete raw.displayLanguage;
  }
  if (inputLanguage) {
    raw.inputLanguage = inputLanguage;
  } else {
    delete raw.inputLanguage;
  }
  if (timeZone) {
    raw.timeZone = timeZone;
  } else {
    delete raw.timeZone;
  }
  writeJson(filePath, raw);

  return {
    profile: {
      ...profile,
      name,
      description: String(raw.description ?? ''),
      softwareIds: sequenceSoftwareIds,
      installSequence,
      execution,
      hasExplicitExecution: hasExecution ? rawExecution !== null : profile.hasExplicitExecution,
      hasInstallSequence: true,
      osImageId,
      displayLanguage,
      locale,
      inputLanguage,
      timeZone,
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

export function sameStringArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function pass(name, detail = '') {
  return { name, ok: true, detail };
}

export function fail(name, detail = '') {
  return { name, ok: false, detail };
}

export function evaluateDeploymentProfilePayload(config = {}, options = {}) {
  try {
    const state = resolveDeploymentProfileState(config, null, options);
    const appsRoot = state.options.appsRoot;
    if (!state.activeProfile.osImageId) {
      return fail('Deployment profile', 'no OS image selected; use Web OS Image Cache to export a WIM and publish selected-os.json before publishing the profile');
    }
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
    if (manifest.osImageId && manifest.osImageId !== state.activeProfile.osImageId) {
      return fail('Deployment profile', `manifest osImage=${manifest.osImageId} active=${state.activeProfile.osImageId}`);
    }
    for (const key of ['displayLanguage', 'locale', 'inputLanguage', 'timeZone']) {
      if (state.activeProfile[key] && manifest[key] !== state.activeProfile[key]) {
        return fail('Deployment profile', `manifest ${key}=${manifest[key] ?? ''} active=${state.activeProfile[key]}`);
      }
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

    const scriptsRoot = state.options.customScriptsAppsRoot;
    const expectedScriptIds = (state.selectedScripts ?? []).map((script) => script.id);
    if (scriptsRoot && expectedScriptIds.length > 0) {
      if (!fs.existsSync(scriptsRoot)) {
        return fail('Deployment profile', `Scripts root not found: ${scriptsRoot}`);
      }
      const liveScriptFolders = fs.readdirSync(scriptsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      const unexpectedScripts = liveScriptFolders.filter((id) => !expectedScriptIds.includes(id));
      const missingScripts = expectedScriptIds.filter((id) => !liveScriptFolders.includes(id));
      if (unexpectedScripts.length > 0) {
        return fail('Deployment profile', `unexpected live custom script folders: ${unexpectedScripts.join(', ')}`);
      }
      if (missingScripts.length > 0) {
        return fail('Deployment profile', `missing live custom script folders: ${missingScripts.join(', ')}`);
      }
      for (const scriptId of expectedScriptIds) {
        const runScript = path.join(scriptsRoot, scriptId, 'run.ps1');
        if (!fs.existsSync(runScript)) {
          return fail('Deployment profile', `missing live run.ps1 for ${scriptId}: ${runScript}`);
        }
      }
    }

    const selected = expectedIds.length ? expectedIds.join(', ') : 'none';
    return pass('Deployment profile', `${state.activeProfile.id} (${selected}) published to ${appsRoot}`);
  } catch (error) {
    return fail('Deployment profile', error.message);
  }
}
