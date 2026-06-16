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
  };
  if (state.activeProfile.locale) {
    manifest.locale = state.activeProfile.locale;
  }
  if (state.activeProfile.timeZone) {
    manifest.timeZone = state.activeProfile.timeZone;
  }
  if (osImageResult?.image) {
    manifest.osImage = {
      id: osImageResult.image.id,
      fileName: osImageResult.image.fileName,
      imageIndex: osImageResult.image.imageIndex,
    };
  }
  return manifest;
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

  const softwarePayloads = await ensureSelectedSoftwarePayloads(state, options);

  let osImageResult = null;
  if (typeof options.publishOsImage === 'function') {
    osImageResult = await options.publishOsImage(
      config,
      state.activeProfile.osImageId,
      { ...options, validateDism: options.validateDism ?? false },
    );
  }

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
