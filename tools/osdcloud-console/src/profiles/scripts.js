import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { loadDeploymentProfiles } from './profiles.js';
import { allowedCustomScriptExtensions, arrayFrom, assertInside, cleanCustomScriptFileName, deploymentProfileOptions, generateCustomScriptId, inputError, maybeString, normalizeId, normalizePositiveInteger, normalizeProfileName, readJson, writeJson } from './shared.js';
import { createUploadTransform, loadSoftwareCatalog, sha256File, uploadSourceStream } from './software.js';

export function loadCustomScriptCatalog(config = {}, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  if (!profileOptions.customScriptsCatalogPath || !fs.existsSync(profileOptions.customScriptsCatalogPath)) {
    return {
      path: profileOptions.customScriptsCatalogPath,
      scripts: [],
      byId: new Map(),
    };
  }
  const raw = readJson(profileOptions.customScriptsCatalogPath, 'custom scripts catalog');
  const rows = arrayFrom(raw.scripts ?? [], 'custom scripts catalog scripts');
  const seen = new Set();
  const scripts = rows.map((row) => {
    const id = normalizeId(row.id, 'custom script');
    if (seen.has(id)) {
      throw new Error(`Duplicate custom script id: ${id}`);
    }
    seen.add(id);

    const source = String(row.source ?? id).trim();
    if (!source || path.isAbsolute(source)) {
      throw new Error(`Invalid source for custom script ${id}: ${source}`);
    }

    const sourcePath = assertInside(
      profileOptions.customScriptsSourceRoot,
      path.resolve(profileOptions.customScriptsSourceRoot, source),
      `Custom script ${id} source`,
    );
    const scriptFile = path.join(sourcePath, 'run.ps1');
    if (options.validateSources !== false) {
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
        throw new Error(`Custom script source folder not found for ${id}: ${sourcePath}`);
      }
      if (!fs.existsSync(scriptFile)) {
        throw new Error(`Custom script run.ps1 not found for ${id}: ${scriptFile}`);
      }
    }

    return {
      id,
      name: String(row.name ?? id),
      source,
      sourcePath,
      scriptFile,
      fileName: maybeString(row.fileName) ?? 'run.ps1',
      bytes: typeof row.bytes === 'number' ? row.bytes : null,
      sha256: maybeString(row.sha256),
    };
  });

  return {
    path: profileOptions.customScriptsCatalogPath,
    scripts,
    byId: new Map(scripts.map((item) => [item.id, item])),
  };
}

export function customScriptUploadDirectory(profileOptions, uploadId) {
  const root = profileOptions.customScriptUploadRoot;
  return assertInside(root, path.join(root, normalizeId(uploadId, 'custom script upload')), 'Custom script upload directory');
}

export function resolveUploadedCustomScript(profileOptions, uploadId) {
  const uploadDir = customScriptUploadDirectory(profileOptions, uploadId);
  if (!fs.existsSync(uploadDir) || !fs.statSync(uploadDir).isDirectory()) {
    throw inputError(`Custom script upload not found: ${uploadId}`, 404);
  }
  const files = fs.readdirSync(uploadDir)
    .filter((name) => allowedCustomScriptExtensions.has(path.extname(name).toLowerCase()))
    .map((name) => assertInside(uploadDir, path.join(uploadDir, name), 'Custom script upload file'));
  if (files.length !== 1) {
    throw inputError(`Custom script upload ${uploadId} must contain exactly one .ps1 file`);
  }
  return {
    uploadDir,
    filePath: files[0],
    fileName: path.basename(files[0]),
  };
}

export function reservedCustomScriptIds(profileOptions, scriptRows) {
  const reserved = new Set();
  for (const row of scriptRows) {
    const id = normalizeId(row.id, 'custom script');
    reserved.add(id);
    const source = String(row.source ?? id).trim();
    if (source && !path.isAbsolute(source)) {
      reserved.add(source);
    }
  }
  if (fs.existsSync(profileOptions.customScriptsSourceRoot)) {
    for (const entry of fs.readdirSync(profileOptions.customScriptsSourceRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        reserved.add(entry.name);
      }
    }
  }
  return reserved;
}

export async function uploadCustomScript(config = {}, input = {}, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const fileName = cleanCustomScriptFileName(input.fileName ?? input.name);
  const declaredSize = normalizePositiveInteger(input.size ?? input.totalBytes, 'custom script upload size', { optional: true, min: 1 });
  const maxBytes = Number(options.uploadMaxBytes ?? profileOptions.customScriptUploadMaxBytes);
  if (declaredSize && declaredSize > maxBytes) {
    throw inputError(`Custom script upload exceeds maximum size: ${maxBytes} bytes`);
  }

  const uploadId = normalizeId(options.uploadId ?? input.uploadId ?? `script-${randomUUID()}`, 'custom script upload');
  const uploadDir = customScriptUploadDirectory(profileOptions, uploadId);
  const targetPath = assertInside(uploadDir, path.join(uploadDir, fileName), 'Custom script upload path');
  fs.mkdirSync(uploadDir, { recursive: true });

  try {
    const progress = {
      bytes: 0,
      totalBytes: declaredSize,
      fileName,
      uploadId,
      startedAt: new Date().toISOString(),
      onProgress: options.onProgress,
    };
    await pipeline(
      uploadSourceStream(input),
      createUploadTransform(progress, maxBytes),
      fs.createWriteStream(targetPath, { flags: 'wx' }),
    );
    const stat = fs.statSync(targetPath);
    if (stat.size <= 0) {
      throw inputError('Custom script upload produced an empty file');
    }
    if (declaredSize && stat.size !== declaredSize) {
      throw inputError(`Custom script upload size mismatch: ${stat.size} expected ${declaredSize}`);
    }

    return {
      uploadId,
      fileName,
      bytes: stat.size,
      sha256: await sha256File(targetPath),
      uploadRoot: profileOptions.customScriptUploadRoot,
      uploadedAt: new Date().toISOString(),
    };
  } catch (error) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
    throw error;
  }
}

export function readCustomScriptCatalogFile(profileOptions) {
  if (!fs.existsSync(profileOptions.customScriptsCatalogPath)) {
    return { scripts: [] };
  }
  const raw = readJson(profileOptions.customScriptsCatalogPath, 'custom scripts catalog');
  if (!raw || typeof raw !== 'object') {
    return { scripts: [] };
  }
  if (!Array.isArray(raw.scripts)) {
    raw.scripts = [];
  }
  return raw;
}

export async function createCustomScript(config = {}, input = {}, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  if (input.id !== undefined || input.scriptId !== undefined) {
    throw inputError('Custom script id is generated by the server');
  }
  if (input.defaultPhase !== undefined || input.phase !== undefined) {
    throw inputError('Custom script phase/defaultPhase is no longer supported');
  }
  const name = normalizeProfileName(input.name, 'Custom script name');
  const uploadId = normalizeId(input.uploadId, 'custom script upload');
  const uploaded = resolveUploadedCustomScript(profileOptions, uploadId);

  const catalogRaw = readCustomScriptCatalogFile(profileOptions);
  const scriptRows = arrayFrom(catalogRaw.scripts, 'custom scripts catalog scripts');
  const seenIds = new Set();
  const seenSources = new Set();
  for (const row of scriptRows) {
    const existingId = normalizeId(row.id, 'custom script');
    const existingIdKey = existingId.toLowerCase();
    if (seenIds.has(existingIdKey)) {
      throw inputError(`Duplicate custom script id: ${existingId}`, 409);
    }
    seenIds.add(existingIdKey);
    const existingSource = String(row.source ?? existingId).trim();
    const existingSourceKey = existingSource.toLowerCase();
    if (seenSources.has(existingSourceKey)) {
      throw inputError(`Duplicate custom script source: ${existingSource}`, 409);
    }
    seenSources.add(existingSourceKey);
  }
  const id = generateCustomScriptId(reservedCustomScriptIds(profileOptions, scriptRows), options);
  const source = id;
  const sourcePath = assertInside(
    profileOptions.customScriptsSourceRoot,
    path.join(profileOptions.customScriptsSourceRoot, source),
    `Custom script ${id} source`,
  );
  if (fs.existsSync(sourcePath)) {
    throw inputError(`Custom script source folder already exists for ${id}: ${sourcePath}`, 409);
  }

  const scriptTargetPath = assertInside(sourcePath, path.join(sourcePath, 'run.ps1'), 'Custom script run.ps1 target');
  let sourceCreated = false;

  try {
    fs.mkdirSync(sourcePath, { recursive: true });
    sourceCreated = true;
    fs.copyFileSync(uploaded.filePath, scriptTargetPath, fs.constants.COPYFILE_EXCL);
    const stat = fs.statSync(scriptTargetPath);
    const sha256 = await sha256File(scriptTargetPath);
    catalogRaw.scripts = [
      ...scriptRows,
      {
        id,
        name,
        source,
        fileName: uploaded.fileName,
        bytes: stat.size,
        sha256,
      },
    ];
    writeJson(profileOptions.customScriptsCatalogPath, catalogRaw);
    let uploadRemoved = false;
    try {
      fs.rmSync(uploaded.uploadDir, { recursive: true, force: true });
      uploadRemoved = true;
    } catch {}

    return {
      script: {
        id,
        name,
        source,
        fileName: uploaded.fileName,
        sourcePath,
        scriptFile: scriptTargetPath,
      },
      catalogPath: profileOptions.customScriptsCatalogPath,
      bytes: stat.size,
      sha256,
      uploadRemoved,
    };
  } catch (error) {
    if (sourceCreated) {
      fs.rmSync(sourcePath, { recursive: true, force: true });
    }
    throw error;
  }
}

export function readCustomScriptContent(config = {}, scriptId, options = {}) {
  const catalog = loadCustomScriptCatalog(config, options);
  const id = normalizeId(scriptId, 'custom script');
  const script = catalog.byId.get(id);
  if (!script) {
    throw inputError(`Custom script not found: ${id}`, 404);
  }
  if (!fs.existsSync(script.scriptFile) || !fs.statSync(script.scriptFile).isFile()) {
    throw inputError(`Custom script run.ps1 not found: ${script.scriptFile}`, 404);
  }
  return {
    scriptId: script.id,
    filePath: script.scriptFile,
    content: fs.readFileSync(script.scriptFile, 'utf8'),
  };
}

export function deleteCustomScript(config = {}, scriptId, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const id = normalizeId(scriptId, 'custom script');
  const catalogRaw = readCustomScriptCatalogFile(profileOptions);
  const scriptRows = arrayFrom(catalogRaw.scripts, 'custom scripts catalog scripts');
  const rowIndex = scriptRows.findIndex((row) => normalizeId(row.id, 'custom script') === id);
  if (rowIndex < 0) {
    throw inputError(`Custom script not found: ${id}`, 404);
  }

  const catalog = loadCustomScriptCatalog(config, options);
  const softwareCatalog = loadSoftwareCatalog(config, options);
  const profiles = loadDeploymentProfiles(config, { ...options, catalog: softwareCatalog, scriptCatalog: catalog });
  const usedByProfiles = profiles
    .filter((profile) => profile.installSequence.some((entry) => entry.type === 'script' && entry.id === id))
    .map((profile) => ({ id: profile.id, name: profile.name }));
  if (usedByProfiles.length) {
    const names = usedByProfiles.map((profile) => profile.name || profile.id).join(', ');
    const error = inputError(`Custom script ${id} is still used by deployment profiles: ${names}`, 409);
    error.profiles = usedByProfiles;
    throw error;
  }

  const row = scriptRows[rowIndex];
  const script = catalog.byId.get(id);
  const source = String(row.source ?? id).trim();
  const sourceUsers = scriptRows.filter((candidate, index) => index !== rowIndex && String(candidate.source ?? candidate.id).trim() === source);
  if (sourceUsers.length) {
    throw inputError(`Custom script source ${source} is shared by another catalog entry`, 409);
  }

  catalogRaw.scripts = scriptRows.filter((_row, index) => index !== rowIndex);
  writeJson(profileOptions.customScriptsCatalogPath, catalogRaw);
  if (script?.sourcePath && fs.existsSync(script.sourcePath)) {
    fs.rmSync(script.sourcePath, { recursive: true, force: true });
  }

  return {
    script,
    catalogPath: profileOptions.customScriptsCatalogPath,
    sourceRemoved: Boolean(script?.sourcePath),
    usedByProfiles,
  };
}

export const retrySleepView = new Int32Array(new SharedArrayBuffer(4));
