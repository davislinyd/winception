import fs from 'node:fs';
import path from 'node:path';
import { resolveDeploymentProfileState } from './profiles.js';
import { retrySleepView } from './scripts.js';
import { assertSafeAppsRoot, assertSafeCustomScriptsRoot, defaultInstallSequenceTimeoutSeconds, selectedProfileFileName } from './shared.js';
import { ensureSelectedSoftwarePayloads } from './software.js';

export function retrySyncOnTransientWindowsError(operation, { attempts = 10, delayMs = 200 } = {}) {
  const transientCodes = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
  let attempt = 0;
  while (true) {
    try {
      return operation();
    } catch (error) {
      attempt += 1;
      if (attempt >= attempts || !transientCodes.has(error.code)) {
        throw error;
      }
      Atomics.wait(retrySleepView, 0, 0, delayMs * attempt);
    }
  }
}

export function removeAppsRootContents(appsRoot) {
  if (!fs.existsSync(appsRoot)) {
    fs.mkdirSync(appsRoot, { recursive: true });
    return 0;
  }

  let removed = 0;
  for (const entry of fs.readdirSync(appsRoot)) {
    fs.rmSync(path.join(appsRoot, entry), { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    removed += 1;
  }
  return removed;
}

export function profileManifest(state, osImageResult = null) {
  const international = resolveProfileInternationalSettings(state.activeProfile, osImageResult?.image);
  const selectedScripts = state.selectedScripts ?? [];
  const scriptById = new Map(selectedScripts.map((script) => [script.id, script]));
  const sequence = state.installSequence ?? [];
  const manifest = {
    profileId: state.activeProfile.id,
    profileName: state.activeProfile.name,
    publishedAt: new Date().toISOString(),
    selectedSoftware: state.selectedSoftware.map((software) => software.id),
    software: state.selectedSoftware.map((software) => ({
      id: software.id,
      name: software.name,
    })),
    execution: {
      defaultTimeoutSeconds: state.activeProfile.execution?.defaultTimeoutSeconds ?? defaultInstallSequenceTimeoutSeconds,
    },
    installSequence: sequence.map((entry) => ({
      type: entry.type,
      id: entry.id,
      ...(entry.timeoutSeconds === undefined ? {} : { timeoutSeconds: entry.timeoutSeconds }),
    })),
    osImageId: state.activeProfile.osImageId,
    ...(international.displayLanguage ? { displayLanguage: international.displayLanguage } : {}),
    ...(international.locale ? { locale: international.locale } : {}),
    ...(international.inputLanguage ? { inputLanguage: international.inputLanguage } : {}),
    ...(international.timeZone ? { timeZone: international.timeZone } : {}),
  };
  if (osImageResult?.image) {
    manifest.osImage = {
      id: osImageResult.image.id,
      fileName: osImageResult.image.fileName,
      imageIndex: osImageResult.image.imageIndex,
    };
  }
  return manifest;
}

export function resolveProfileInternationalSettings(profile, image = null) {
  const displayLanguage = String(profile.displayLanguage ?? image?.language ?? '').trim();
  const locale = String(profile.locale ?? image?.locale ?? image?.language ?? '').trim();
  const inputLanguage = String(profile.inputLanguage ?? image?.language ?? '').trim();
  const timeZone = String(profile.timeZone ?? image?.timeZone ?? '').trim();
  const imageLanguage = String(image?.language ?? '').trim();

  if (!image) {
    return { displayLanguage, locale, inputLanguage, timeZone };
  }

  if (!displayLanguage) {
    throw new Error('Deployment profile display language is unresolved. Select a display language or an OS image with language metadata.');
  }
  if (!locale) {
    throw new Error('Deployment profile regional format is unresolved. Select a regional format or an OS image with locale metadata.');
  }
  if (!inputLanguage) {
    throw new Error('Deployment profile input language is unresolved. Select an input language or an OS image with language metadata.');
  }
  if (!timeZone) {
    throw new Error('Deployment profile time zone is unresolved. Select an explicit Windows time zone before publishing.');
  }
  if (imageLanguage && displayLanguage.toLowerCase() !== imageLanguage.toLowerCase()) {
    throw new Error(`Display language ${displayLanguage} is not installed in the selected single-language WIM (${imageLanguage}). Select a matching OS image.`);
  }

  return { displayLanguage, locale, inputLanguage, timeZone };
}

export function removeScriptsRootContents(scriptsRoot) {
  if (!fs.existsSync(scriptsRoot)) {
    fs.mkdirSync(scriptsRoot, { recursive: true });
    return 0;
  }

  let removed = 0;
  for (const entry of fs.readdirSync(scriptsRoot)) {
    fs.rmSync(path.join(scriptsRoot, entry), { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    removed += 1;
  }
  return removed;
}

export async function publishDeploymentProfile(config = {}, profileId = null, options = {}) {
  const state = resolveDeploymentProfileState(config, profileId, options);
  const appsRoot = assertSafeAppsRoot(state.options.appsRoot);
  if (!state.activeProfile.osImageId) {
    throw new Error('No OS image selected for the active deployment profile. Use Web OS Image Cache to download/import, export a WIM, set it active, then publish the profile.');
  }
  if (!fs.existsSync(state.options.installerScript)) {
    throw new Error(`Install-Apps.ps1 source not found: ${state.options.installerScript}`);
  }

  let osImageResult = null;
  if (typeof options.publishOsImage === 'function') {
    osImageResult = await options.publishOsImage(
      config,
      state.activeProfile.osImageId,
      { ...options, validateDism: options.validateDism ?? false },
    );
  }

  resolveProfileInternationalSettings(state.activeProfile, osImageResult?.image);
  const softwarePayloads = await ensureSelectedSoftwarePayloads(state, options);

  const removed = removeAppsRootContents(appsRoot);
  retrySyncOnTransientWindowsError(() =>
    fs.copyFileSync(state.options.installerScript, path.join(appsRoot, 'Install-Apps.ps1')));

  const copied = [];
  for (const software of state.selectedSoftware) {
    const target = path.join(appsRoot, software.id);
    retrySyncOnTransientWindowsError(() => fs.cpSync(software.sourcePath, target, { recursive: true }));
    copied.push(software.id);
  }

  let scriptsPublished = null;
  const selectedScripts = state.selectedScripts ?? [];
  const configuredScriptsRoot = state.options.customScriptsAppsRoot;
  if (configuredScriptsRoot && (selectedScripts.length > 0 || fs.existsSync(configuredScriptsRoot))) {
    const scriptsRoot = assertSafeCustomScriptsRoot(configuredScriptsRoot);
    const scriptsRemoved = removeScriptsRootContents(scriptsRoot);
    const copiedScripts = [];
    for (const script of selectedScripts) {
      const target = path.join(scriptsRoot, script.id);
      retrySyncOnTransientWindowsError(() => fs.cpSync(script.sourcePath, target, { recursive: true }));
      copiedScripts.push({ id: script.id });
    }
    scriptsPublished = {
      scriptsRoot,
      copied: copiedScripts,
      removed: scriptsRemoved,
    };
  }

  const manifest = profileManifest(state, osImageResult);
  const manifestPath = path.join(appsRoot, selectedProfileFileName);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    profile: state.activeProfile,
    selectedSoftware: state.selectedSoftware,
    selectedScripts: state.selectedScripts ?? [],
    appsRoot,
    manifestPath,
    copied,
    removed,
    osImage: osImageResult,
    customScripts: scriptsPublished,
    softwarePayloads,
  };
}
