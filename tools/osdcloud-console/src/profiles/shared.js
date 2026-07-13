import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../atomicFile.js';
import { appRootForConfig, stateRootForConfig } from '../config.js';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const generatedProfileIdAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const generatedProfileIdLength = 8;
export const generatedProfileIdSpace = generatedProfileIdAlphabet.length ** generatedProfileIdLength;
export const defaultGeneratedProfileIdAttempts = 256;
export const generatedSoftwareIdPrefix = 'SW-';
export const generatedCustomScriptIdPrefix = 'SC-';
export const allowedSoftwareInstallerExtensions = new Set(['.msi', '.exe']);
export const allowedCustomScriptExtensions = new Set(['.ps1']);
export const defaultSoftwareUploadMaxBytes = 2 * 1024 * 1024 * 1024;
export const defaultRawInstallScriptMaxBytes = 256 * 1024;
export const defaultCustomScriptUploadMaxBytes = 1 * 1024 * 1024;
export const defaultInstallSequenceTimeoutSeconds = 900;

export const selectedProfileFileName = 'selected-profile.json';

export function inputError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicError = {
    message,
    code: 'invalid_input',
    action: 'Correct the input and try again.',
  };
  return error;
}

export function deploymentProfileDefaults(appRoot, stateRoot) {
  return {
    activeProfile: 'I20HRVF5',
    profilesRoot: path.join(stateRoot, 'config', 'deployment-profiles'),
    softwareCatalogPath: path.join(stateRoot, 'config', 'software-catalog.json'),
    softwareSourceRoot: path.join(stateRoot, 'Softwares'),
    appsRoot: 'C:\\OSDCloud\\Media\\OSDCloud\\Apps',
    installerScript: path.join(appRoot, 'Softwares', 'Install-Apps.ps1'),
    softwareUploadRoot: path.join(stateRoot, '.osdcloud-console', 'software-uploads'),
    softwareUploadMaxBytes: defaultSoftwareUploadMaxBytes,
    softwarePayloadStagingRoot: path.join(stateRoot, '.downloads', 'software-payloads'),
    customScriptsCatalogPath: path.join(stateRoot, 'config', 'scripts-catalog.json'),
    customScriptsSourceRoot: path.join(stateRoot, 'Scripts'),
    customScriptsAppsRoot: 'C:\\OSDCloud\\Media\\OSDCloud\\Scripts',
    customScriptUploadRoot: path.join(stateRoot, '.osdcloud-console', 'script-uploads'),
    customScriptUploadMaxBytes: defaultCustomScriptUploadMaxBytes,
  };
}

export function isSafeId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(String(value ?? ''));
}

export function isSafeDeploymentProfileId(value) {
  return isSafeId(value);
}

export function normalizeId(value, label) {
  const id = String(value ?? '').trim();
  if (!isSafeId(id)) {
    throw inputError(`Invalid ${label} id: ${value}`);
  }
  return id;
}

export function normalizeHumanCatalogId(value, label) {
  const id = String(value ?? '').trim();
  if (!id) {
    throw inputError(`${label} is required`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,15}$/u.test(id)) {
    throw inputError(`${label} must use lowercase letters, numbers, and hyphens only, max 16 characters`);
  }
  return id;
}

export function profileNameKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function cleanSoftwareInstallerFileName(value, label = 'software installer fileName') {
  const raw = String(value ?? '').trim();
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    throw inputError(`${label} must be a plain file name: ${value}`);
  }
  const fileName = path.basename(raw);
  const extension = path.extname(fileName).toLowerCase();
  if (!allowedSoftwareInstallerExtensions.has(extension)) {
    throw inputError(`${label} must end with .msi or .exe: ${fileName}`);
  }
  return fileName;
}

export function cleanCustomScriptFileName(value, label = 'custom script fileName') {
  const raw = String(value ?? '').trim();
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    throw inputError(`${label} must be a plain file name: ${value}`);
  }
  const fileName = path.basename(raw);
  const extension = path.extname(fileName).toLowerCase();
  if (!allowedCustomScriptExtensions.has(extension)) {
    throw inputError(`${label} must end with .ps1: ${fileName}`);
  }
  return fileName;
}

export function normalizePositiveInteger(value, label, options = {}) {
  if (value === undefined || value === null || value === '') {
    return options.optional ? null : undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < (options.min ?? 0)) {
    throw inputError(`Invalid ${label}: ${value}`);
  }
  return number;
}

export function normalizeExecutionSettings(value, label) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw inputError(`${label} must be an object`);
  }
  const defaultTimeoutSeconds = normalizePositiveInteger(
    value.defaultTimeoutSeconds,
    `${label}.defaultTimeoutSeconds`,
    { optional: true, min: 1 },
  );
  if (defaultTimeoutSeconds === null) {
    return null;
  }
  return { defaultTimeoutSeconds };
}

export function resolveExecutionSettings(value, label) {
  const normalized = normalizeExecutionSettings(value, label);
  return {
    defaultTimeoutSeconds: normalized?.defaultTimeoutSeconds ?? defaultInstallSequenceTimeoutSeconds,
  };
}

export function formatGeneratedProfileId(value, alphabet = generatedProfileIdAlphabet, idLength = generatedProfileIdLength) {
  const chars = Array.from({ length: idLength }, () => alphabet[0]);
  let remaining = value;
  for (let index = idLength - 1; index >= 0; index -= 1) {
    chars[index] = alphabet[remaining % alphabet.length];
    remaining = Math.floor(remaining / alphabet.length);
  }
  return chars.join('');
}

export function isMixedAlphanumericProfileId(id, alphabet = generatedProfileIdAlphabet, idLength = generatedProfileIdLength) {
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

export function generateSoftwareId(existingIds = [], options = {}) {
  const reserved = new Set(Array.from(existingIds ?? [], (id) => String(id).toLowerCase()));
  const nextRandomInt = options.randomInt ?? randomInt;
  const alphabet = options.alphabet ?? generatedProfileIdAlphabet;
  const idLength = options.idLength ?? generatedProfileIdLength;
  const idSpaceSize = options.idSpaceSize ?? alphabet.length ** idLength;
  const maxAttempts = options.maxAttempts ?? defaultGeneratedProfileIdAttempts;
  const prefix = options.prefix ?? generatedSoftwareIdPrefix;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const randomPart = formatGeneratedProfileId(nextRandomInt(idSpaceSize), alphabet, idLength);
    const id = `${prefix}${randomPart}`;
    if (isSafeId(id) && isMixedAlphanumericProfileId(randomPart, alphabet, idLength) && !reserved.has(id.toLowerCase())) {
      return id;
    }
  }

  for (let value = 0; value < idSpaceSize; value += 1) {
    const randomPart = formatGeneratedProfileId(value, alphabet, idLength);
    const id = `${prefix}${randomPart}`;
    if (isSafeId(id) && isMixedAlphanumericProfileId(randomPart, alphabet, idLength) && !reserved.has(id.toLowerCase())) {
      return id;
    }
  }

  throw new Error('No available software ids remain');
}

export function generateCustomScriptId(existingIds = [], options = {}) {
  return generateSoftwareId(existingIds, {
    ...options,
    prefix: options.prefix ?? generatedCustomScriptIdPrefix,
  });
}

export function normalizeProfileName(value, label = 'Deployment profile name') {
  const name = String(value ?? '').trim();
  if (!name) {
    throw new Error(`${label} is required`);
  }
  return name;
}

export function normalizeProfileDescription(value) {
  return String(value ?? '').trim();
}

export function normalizeLocaleTag(value, label, { optional = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    if (optional) return null;
    throw inputError(`${label} is required`);
  }
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/u.test(raw)) {
    throw inputError(`Invalid ${label} (expected BCP-47 tag like en-US or zh-TW): ${raw}`);
  }
  return raw;
}

export function normalizeWindowsTimeZoneId(value, label, { optional = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    if (optional) return null;
    throw inputError(`${label} is required`);
  }
  if (raw.length > 128) {
    throw inputError(`${label} is too long (max 128 chars): ${raw}`);
  }
  return raw;
}

export function resolveConfiguredPath(root, value) {
  if (!value) {
    return value;
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
}

export function assertInside(root, target, label) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const relative = path.relative(rootPath, targetPath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes root: ${target}`);
  }
  return targetPath;
}

export function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label} ${filePath}: ${error.message}`);
  }
}

export function writeJson(filePath, value) {
  writeJsonAtomic(filePath, value);
}

export function maybeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function arrayFrom(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

export function deploymentProfileOptions(config = {}, overrides = {}) {
  const appRoot = appRootForConfig(config);
  const stateRoot = stateRootForConfig(config);
  const defaults = deploymentProfileDefaults(appRoot, stateRoot);
  const section = {
    ...defaults,
    ...(config.deploymentProfiles ?? {}),
    ...overrides,
  };

  return {
    offlineMode: Boolean(config.offlineMode ?? section.offlineMode),
    activeProfile: section.activeProfile ?? defaults.activeProfile,
    profilesRoot: resolveConfiguredPath(stateRoot, section.profilesRoot),
    softwareCatalogPath: resolveConfiguredPath(stateRoot, section.softwareCatalogPath),
    softwareSourceRoot: resolveConfiguredPath(stateRoot, section.softwareSourceRoot),
    appsRoot: resolveConfiguredPath(stateRoot, section.appsRoot ?? section.liveAppsRoot),
    installerScript: resolveConfiguredPath(appRoot, section.installerScript),
    softwareUploadRoot: resolveConfiguredPath(stateRoot, section.softwareUploadRoot),
    softwareUploadMaxBytes: Number(section.softwareUploadMaxBytes) > 0
      ? Number(section.softwareUploadMaxBytes)
      : defaultSoftwareUploadMaxBytes,
    softwarePayloadStagingRoot: resolveConfiguredPath(stateRoot, section.softwarePayloadStagingRoot),
    customScriptsCatalogPath: resolveConfiguredPath(stateRoot, section.customScriptsCatalogPath),
    customScriptsSourceRoot: resolveConfiguredPath(stateRoot, section.customScriptsSourceRoot),
    customScriptsAppsRoot: resolveConfiguredPath(stateRoot, section.customScriptsAppsRoot),
    customScriptUploadRoot: resolveConfiguredPath(stateRoot, section.customScriptUploadRoot),
    customScriptUploadMaxBytes: Number(section.customScriptUploadMaxBytes) > 0
      ? Number(section.customScriptUploadMaxBytes)
      : defaultCustomScriptUploadMaxBytes,
  };
}

export function assertSafeAppsRoot(appsRoot) {
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

export function assertSafeCustomScriptsRoot(scriptsRoot) {
  const resolved = path.resolve(scriptsRoot);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    throw new Error(`Refusing to publish to filesystem root: ${resolved}`);
  }
  if (path.basename(resolved).toLowerCase() !== 'scripts') {
    throw new Error(`Refusing to publish outside a Scripts folder: ${resolved}`);
  }
  return resolved;
}
