import fs from 'node:fs';
import path from 'node:path';
import { collectProcessOutput, preparePowerShellArgs } from '../processOutput.js';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadDeploymentProfiles } from './profiles.js';
import { allowedSoftwareInstallerExtensions, arrayFrom, assertInside, cleanSoftwareInstallerFileName, defaultRawInstallScriptMaxBytes, deploymentProfileOptions, inputError, maybeString, normalizeHumanCatalogId, normalizeId, normalizePositiveInteger, normalizeProfileName, readJson, writeJson } from './shared.js';

export function inferInstallerFile(sourcePath, preferredFileName = null) {
  const preferred = maybeString(preferredFileName);
  if (preferred) {
    return preferred;
  }
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return null;
  }
  const installers = fs.readdirSync(sourcePath)
    .filter((entry) => allowedSoftwareInstallerExtensions.has(path.extname(entry).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return installers[0] ?? null;
}

export function installerTypeFromFile(fileName) {
  const extension = path.extname(String(fileName ?? '')).toLowerCase();
  return extension ? extension.replace(/^\./u, '') : null;
}

export function parseSuccessExitCodesFromScript(script) {
  const assignment = /\$successExitCodes\s*=\s*@\(([^)]*)\)/iu.exec(script)
    ?? /@\(([^)]*)\)\s+-notcontains\s+\$process\.ExitCode/iu.exec(script);
  if (!assignment) {
    return null;
  }
  const values = assignment[1].split(/[,\s]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Number(entry));
  return values.every((entry) => Number.isInteger(entry)) ? values : null;
}

export function parseSoftwareInstallDetails(installScript) {
  if (!fs.existsSync(installScript)) {
    return {};
  }
  const script = fs.readFileSync(installScript, 'utf8');
  const installerFileName = /Join-Path\s+\$PSScriptRoot\s+'([^']+\.(?:msi|exe))'/iu.exec(script)?.[1] ?? null;
  const silentArgs = /\$silentArgs\s*=\s*'([^']*)'/iu.exec(script)?.[1] ?? null;
  const verifyPath = /\$verifyPath\s*=\s*\[Environment\]::ExpandEnvironmentVariables\('([^']*)'\)/iu.exec(script)?.[1] ?? null;
  const successExitCodes = parseSuccessExitCodesFromScript(script);
  const hasInstalledFileCheck = /\$installedExe\b/iu.test(script) && /Test-Path\s+-LiteralPath\s+\$installedExe/iu.test(script);
  const hasGeneratedExitOnly = /no installed-file verification configured/iu.test(script);
  const isGeneratedTemplate = /\$silentArgs\s*=/iu.test(script) && /\$successExitCodes\s*=/iu.test(script);

  let verificationMode = 'custom install.ps1';
  if (verifyPath) {
    verificationMode = 'installed file';
  } else if (hasGeneratedExitOnly) {
    verificationMode = 'installer exit code only';
  } else if (hasInstalledFileCheck) {
    verificationMode = 'custom installed-file check';
  }

  return {
    scriptMode: isGeneratedTemplate ? 'template' : 'custom install.ps1',
    installerFileName,
    installerType: installerTypeFromFile(installerFileName),
    silentArgs,
    successExitCodes,
    verifyPath,
    verificationMode,
  };
}

export function softwareInstallMetadata(row, sourcePath, installScript) {
  const parsed = parseSoftwareInstallDetails(installScript);
  const installerFileName = maybeString(row.installerFileName) ?? parsed.installerFileName ?? inferInstallerFile(sourcePath);
  const installerPath = installerFileName ? path.join(sourcePath, installerFileName) : null;
  const installerBytes = row.installerBytes ?? (installerPath && fs.existsSync(installerPath) ? fs.statSync(installerPath).size : null);
  const verifyPath = maybeString(row.verifyPath) ?? parsed.verifyPath ?? null;
  const verificationMode = maybeString(row.verificationMode)
    ?? (verifyPath ? 'installed file' : parsed.verificationMode)
    ?? 'custom install.ps1';

  return {
    scriptMode: maybeString(row.scriptMode) ?? parsed.scriptMode ?? 'custom install.ps1',
    installerType: maybeString(row.installerType) ?? parsed.installerType ?? installerTypeFromFile(installerFileName),
    installerFileName,
    silentArgs: row.silentArgs !== undefined ? String(row.silentArgs) : parsed.silentArgs,
    successExitCodes: Array.isArray(row.successExitCodes) ? row.successExitCodes : parsed.successExitCodes,
    verifyPath,
    verificationMode,
    installerBytes,
    installerSha256: maybeString(row.installerSha256 ?? row.sha256),
    downloadUrl: maybeString(row.downloadUrl),
    dependsOn: Array.isArray(row.dependsOn) ? row.dependsOn : [],
    network: row.network ?? { requirement: 'offline' },
  };
}

export function normalizeSoftwareDependencies(value, label, softwareId = null) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  const seen = new Set();
  return arrayFrom(value, label).map((entry) => {
    const id = normalizeId(entry, label);
    if (softwareId && id === softwareId) {
      throw inputError(`${label} cannot reference itself: ${id}`);
    }
    if (seen.has(id)) {
      throw inputError(`Duplicate ${label}: ${id}`);
    }
    seen.add(id);
    return id;
  });
}

export function normalizeSoftwareNetwork(value, label) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : { requirement: value };
  const requirement = String(source.requirement ?? source.mode ?? 'offline').trim().toLowerCase();
  if (requirement === 'offline') {
    return { requirement: 'offline' };
  }
  if (requirement !== 'client-internet') {
    throw inputError(`${label}.requirement must be offline or client-internet`);
  }
  const probeHost = String(source.probeHost ?? '').trim().toLowerCase();
  if (!probeHost) {
    throw inputError(`${label}.probeHost is required when client Internet is required`);
  }
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(probeHost)) {
    throw inputError(`${label}.probeHost must be a DNS hostname without a scheme, port, or path`);
  }
  return { requirement: 'client-internet', probeHost };
}

export function assertSoftwareDependencyGraph(software) {
  const byId = new Map(software.map((item) => [item.id, item]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, trail = []) => {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new Error(`Software dependency cycle: ${[...trail, id].join(' -> ')}`);
    }
    visiting.add(id);
    const item = byId.get(id);
    for (const dependencyId of item.dependsOn) {
      if (!byId.has(dependencyId)) {
        throw new Error(`Software ${id} depends on unknown software: ${dependencyId}`);
      }
      visit(dependencyId, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const item of software) {
    visit(item.id);
  }
}

export function resolveSoftwareInstallScript(config = {}, softwareId, options = {}) {
  const catalog = loadSoftwareCatalog(config, options);
  const id = normalizeId(softwareId, 'software');
  const software = catalog.byId.get(id);
  if (!software) {
    throw inputError(`Software not found: ${id}`, 404);
  }
  const scriptPath = assertInside(software.sourcePath, software.installScript, 'Software install.ps1 path');
  if (path.basename(scriptPath).toLowerCase() !== 'install.ps1') {
    throw inputError(`Software script must be install.ps1: ${scriptPath}`);
  }
  if (!fs.existsSync(scriptPath) || !fs.statSync(scriptPath).isFile()) {
    throw inputError(`Software install.ps1 not found: ${scriptPath}`, 404);
  }
  return { software, scriptPath };
}

export function readSoftwareInstallScript(config = {}, softwareId, options = {}) {
  const { software, scriptPath } = resolveSoftwareInstallScript(config, softwareId, options);
  return {
    softwareId: software.id,
    filePath: scriptPath,
    content: fs.readFileSync(scriptPath, 'utf8'),
  };
}

export function isPowerShellCommand(command) {
  const name = path.basename(String(command)).toLowerCase();
  return ['powershell.exe', 'powershell', 'pwsh.exe', 'pwsh'].includes(name);
}

export async function spawnAndWait(command, args, options = {}) {
  const child = spawn(command, isPowerShellCommand(command) ? preparePowerShellArgs(args) : args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
    ...options,
  });
  const result = await collectProcessOutput(child);
  if (result.code === 0) {
    return { stdout: result.stdout, stderr: result.stderr };
  }
  const detail = (result.stderr || result.stdout || '').trim();
  throw new Error(detail ? `${command} exited ${result.code}: ${detail}` : `${command} exited ${result.code}`);
}

export async function launchWindowsOpenWith(scriptPath) {
  const script = `
$ErrorActionPreference = 'Stop'
$target = ${psSingleQuote(scriptPath)}
$rundll = Join-Path $env:SystemRoot 'System32\\rundll32.exe'
if (-not (Test-Path -LiteralPath $rundll -PathType Leaf)) {
  $rundll = 'rundll32.exe'
}
Start-Process -FilePath $rundll -ArgumentList @('shell32.dll,OpenAs_RunDLL', $target) -WindowStyle Normal
`;
  await spawnAndWait('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
}

export async function launchDefaultOpen(scriptPath) {
  if (process.platform === 'win32') {
    const script = `
$ErrorActionPreference = 'Stop'
$target = ${psSingleQuote(scriptPath)}
Start-Process -FilePath $target -WindowStyle Normal
`;
    await spawnAndWait('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
    return;
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  await spawnAndWait(opener, [scriptPath], {
    detached: true,
    stdio: 'ignore',
  });
}

export async function openSoftwareInstallScript(config = {}, softwareId, options = {}) {
  const { software, scriptPath } = resolveSoftwareInstallScript(config, softwareId, options);
  let method = 'open-with';
  try {
    if (options.openScript) {
      await options.openScript(scriptPath, 'open-with');
    } else if (process.platform === 'win32') {
      await launchWindowsOpenWith(scriptPath);
    } else {
      await launchDefaultOpen(scriptPath);
      method = 'default-open';
    }
  } catch (openWithError) {
    method = 'default-open';
    try {
      if (options.openDefaultScript) {
        await options.openDefaultScript(scriptPath, openWithError);
      } else {
        await launchDefaultOpen(scriptPath);
      }
    } catch (defaultOpenError) {
      throw new Error(
        `Unable to open install.ps1. Open With failed: ${openWithError.message}; default open failed: ${defaultOpenError.message}`,
      );
    }
  }
  return {
    softwareId: software.id,
    filePath: scriptPath,
    opened: true,
    method,
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

    const metadata = softwareInstallMetadata(row, sourcePath, installScript);
    return {
      id,
      name: String(row.name ?? id),
      source,
      sourcePath,
      installScript,
      ...metadata,
      dependsOn: normalizeSoftwareDependencies(row.dependsOn, `software ${id} dependsOn`, id),
      network: normalizeSoftwareNetwork(row.network, `software ${id} network`),
    };
  });

  assertSoftwareDependencyGraph(software);

  return {
    path: profileOptions.softwareCatalogPath,
    software,
    byId: new Map(software.map((item) => [item.id, item])),
  };
}

export function uploadSourceStream(input) {
  if (input.stream) {
    return input.stream;
  }
  if (input.buffer || input.bytes) {
    return Readable.from([input.buffer ?? input.bytes]);
  }
  throw inputError('Software installer upload requires a readable stream or buffer');
}

export function createUploadTransform(progress, maxBytes) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      progress.bytes += chunk.length;
      if (progress.bytes > maxBytes) {
        callback(inputError(`Software installer upload exceeds maximum size: ${maxBytes} bytes`));
        return;
      }
      progress.onProgress?.({
        status: 'uploading',
        bytes: progress.bytes,
        totalBytes: progress.totalBytes,
        fileName: progress.fileName,
        uploadId: progress.uploadId,
        startedAt: progress.startedAt,
      });
      callback(null, chunk);
    },
  });
}

export function hashFile(filePath, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });
}

export const sha256File = (filePath) => hashFile(filePath, 'sha256');

export function formatSoftwarePayloadIssue(result) {
  if (result.reason === 'size-mismatch') {
    return `size ${result.actualLength} expected ${result.expectedLength}`;
  }
  if (result.reason === 'hash-mismatch') {
    return `sha256 ${result.actualSha256} expected ${result.expectedSha256}`;
  }
  return result.reason;
}

export function softwarePayloadTarget(software) {
  const installerFileName = cleanSoftwareInstallerFileName(software.installerFileName, `software ${software.id} installerFileName`);
  const installerPath = assertInside(
    software.sourcePath,
    path.join(software.sourcePath, installerFileName),
    `Software ${software.id} installer path`,
  );
  return { installerFileName, installerPath };
}

export async function inspectSoftwarePayload(software, installerPath) {
  if (!fs.existsSync(installerPath)) {
    return { ok: false, reason: 'missing', filePath: installerPath };
  }
  const stat = fs.statSync(installerPath);
  if (!stat.isFile()) {
    return { ok: false, reason: 'not-file', filePath: installerPath };
  }
  if (software.installerBytes && stat.size !== software.installerBytes) {
    return {
      ok: false,
      reason: 'size-mismatch',
      filePath: installerPath,
      actualLength: stat.size,
      expectedLength: software.installerBytes,
    };
  }
  if (software.installerSha256) {
    const actualSha256 = await sha256File(installerPath);
    if (actualSha256 !== software.installerSha256) {
      return {
        ok: false,
        reason: 'hash-mismatch',
        filePath: installerPath,
        actualSha256,
        expectedSha256: software.installerSha256,
      };
    }
  }
  return { ok: true, reason: 'matches', filePath: installerPath, length: stat.size };
}

export function softwareDownloadUrl(software) {
  const text = maybeString(software.downloadUrl);
  if (!text) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`Invalid downloadUrl for software ${software.id}: ${text}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Invalid downloadUrl protocol for software ${software.id}: ${parsed.protocol}`);
  }
  return parsed.toString();
}

export async function downloadSoftwarePayload(software, targetPath, options = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('Software payload download requires fetch support');
  }
  const url = softwareDownloadUrl(software);
  if (!url) {
    throw new Error(`Software ${software.id} has no downloadUrl`);
  }
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Download failed for software ${software.id}: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error(`Download failed for software ${software.id}: empty response body`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(targetPath));
  return { filePath: targetPath };
}

export async function ensureSoftwarePayload(software, profileOptions, options = {}) {
  if (!software.installerFileName) {
    throw new Error(`Selected software ${software.id} has no installerFileName in software catalog`);
  }
  const { installerFileName, installerPath } = softwarePayloadTarget(software);
  const existing = await inspectSoftwarePayload(software, installerPath);
  if (existing.ok) {
    return { id: software.id, status: 'reused', filePath: installerPath, bytes: existing.length };
  }

  if (profileOptions.offlineMode || options.offlineMode) {
    throw new Error(
      `Offline Mode is active. Stored software payload for ${software.id} (${software.source}\\${installerFileName}) is invalid or missing: ${formatSoftwarePayloadIssue(existing)}`,
    );
  }

  const downloadUrl = softwareDownloadUrl(software);
  if (!downloadUrl) {
    throw new Error(
      `Selected software payload ${formatSoftwarePayloadIssue(existing)} for ${software.id} (${software.source}\\${installerFileName}) and no downloadUrl is configured`,
    );
  }

  const stagingRoot = assertInside(
    profileOptions.softwarePayloadStagingRoot,
    path.join(profileOptions.softwarePayloadStagingRoot, software.id),
    `Software ${software.id} payload staging path`,
  );
  const stagingPath = assertInside(
    stagingRoot,
    path.join(stagingRoot, installerFileName),
    `Software ${software.id} staged payload`,
  );
  fs.rmSync(stagingPath, { force: true });
  const downloader = options.downloadSoftwarePayload ?? downloadSoftwarePayload;
  const downloaded = await downloader(software, stagingPath, { fetch: options.fetch });
  const downloadedPath = downloaded?.filePath ?? stagingPath;
  const validation = await inspectSoftwarePayload(software, downloadedPath);
  if (!validation.ok) {
    throw new Error(
      `Downloaded software payload failed validation for ${software.id} (${software.source}\\${installerFileName}): ${formatSoftwarePayloadIssue(validation)}`,
    );
  }

  fs.mkdirSync(software.sourcePath, { recursive: true });
  fs.copyFileSync(downloadedPath, installerPath);
  const finalValidation = await inspectSoftwarePayload(software, installerPath);
  if (!finalValidation.ok) {
    throw new Error(
      `Stored software payload failed validation for ${software.id} (${software.source}\\${installerFileName}): ${formatSoftwarePayloadIssue(finalValidation)}`,
    );
  }
  return { id: software.id, status: 'downloaded', filePath: installerPath, bytes: finalValidation.length };
}

export async function ensureSelectedSoftwarePayloads(state, options = {}) {
  const payloads = [];
  for (const software of state.selectedSoftware) {
    const result = await ensureSoftwarePayload(software, state.options, options);
    payloads.push(result);
  }
  return payloads;
}

export function softwareUploadDirectory(profileOptions, uploadId) {
  const root = profileOptions.softwareUploadRoot;
  return assertInside(root, path.join(root, normalizeId(uploadId, 'software upload')), 'Software upload directory');
}

export function resolveUploadedSoftwareInstaller(profileOptions, uploadId) {
  const uploadDir = softwareUploadDirectory(profileOptions, uploadId);
  if (!fs.existsSync(uploadDir) || !fs.statSync(uploadDir).isDirectory()) {
    throw inputError(`Software installer upload not found: ${uploadId}`, 404);
  }
  const files = fs.readdirSync(uploadDir)
    .filter((name) => allowedSoftwareInstallerExtensions.has(path.extname(name).toLowerCase()))
    .map((name) => assertInside(uploadDir, path.join(uploadDir, name), 'Software upload file'));
  if (files.length !== 1) {
    throw inputError(`Software installer upload ${uploadId} must contain exactly one MSI/EXE file`);
  }
  return {
    uploadDir,
    filePath: files[0],
    fileName: path.basename(files[0]),
  };
}

export function reservedSoftwarePackageIds(profileOptions, softwareRows) {
  const reserved = new Set();
  for (const row of softwareRows) {
    const id = normalizeId(row.id, 'software');
    reserved.add(id);
    const source = String(row.source ?? id).trim();
    if (source && !path.isAbsolute(source)) {
      reserved.add(source);
    }
  }
  if (fs.existsSync(profileOptions.softwareSourceRoot)) {
    for (const entry of fs.readdirSync(profileOptions.softwareSourceRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        reserved.add(entry.name);
      }
    }
  }
  return reserved;
}

export async function uploadSoftwareInstaller(config = {}, input = {}, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const fileName = cleanSoftwareInstallerFileName(input.fileName ?? input.name);
  const declaredSize = normalizePositiveInteger(input.size ?? input.totalBytes, 'software installer upload size', { optional: true, min: 1 });
  const maxBytes = Number(options.uploadMaxBytes ?? profileOptions.softwareUploadMaxBytes);
  if (declaredSize && declaredSize > maxBytes) {
    throw inputError(`Software installer upload exceeds maximum size: ${maxBytes} bytes`);
  }

  const uploadId = normalizeId(options.uploadId ?? input.uploadId ?? `software-${randomUUID()}`, 'software upload');
  const uploadDir = softwareUploadDirectory(profileOptions, uploadId);
  const targetPath = assertInside(uploadDir, path.join(uploadDir, fileName), 'Software upload path');
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
      throw inputError('Software installer upload produced an empty file');
    }
    if (declaredSize && stat.size !== declaredSize) {
      throw inputError(`Software installer upload size mismatch: ${stat.size} expected ${declaredSize}`);
    }

    return {
      uploadId,
      fileName,
      bytes: stat.size,
      sha256: await sha256File(targetPath),
      uploadRoot: profileOptions.softwareUploadRoot,
      uploadedAt: new Date().toISOString(),
    };
  } catch (error) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
    throw error;
  }
}

export function normalizeInstallerType(value, fileName) {
  const inferred = path.extname(fileName).toLowerCase().replace(/^\./u, '');
  const type = String(value || inferred).trim().toLowerCase();
  if (type !== 'msi' && type !== 'exe') {
    throw inputError(`Software installer type must be msi or exe: ${value}`);
  }
  if (type !== inferred) {
    throw inputError(`Software installer type ${type} does not match file extension .${inferred}`);
  }
  return type;
}

export function defaultSilentArgs(installerType) {
  return installerType === 'msi'
    ? '/qn /norestart REBOOT=ReallySuppress'
    : '/quiet /norestart';
}

export function normalizeSuccessExitCodes(value, installerType) {
  const source = value === undefined || value === null || value === ''
    ? (installerType === 'msi' ? [0, 1641, 3010] : [0])
    : (Array.isArray(value) ? value : String(value).split(/[,\s]+/u).filter(Boolean));
  const codes = source.map((entry) => normalizePositiveInteger(entry, 'software installer success exit code', { min: 0 }));
  if (!codes.length) {
    throw inputError('At least one success exit code is required');
  }
  return [...new Set(codes)];
}

export function psSingleQuote(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

export function psArray(values) {
  return `@(${values.map((value) => String(Number(value))).join(', ')})`;
}

export function renderTemplateInstallScript(input) {
  const installerType = input.installerType;
  const softwareName = String(input.name ?? input.id);
  const silentArgs = String(input.silentArgs ?? defaultSilentArgs(installerType)).trim();
  const verifyPath = String(input.verifyPath ?? '').trim();
  const successExitCodes = normalizeSuccessExitCodes(input.successExitCodes, installerType);
  const logFileName = `${input.id}-${installerType}.log`;
  const installerRun = installerType === 'msi'
    ? `$argumentList = '/i "' + $installerPath + '" ' + $silentArgs + ' /L*v "' + $logPath + '"'
$process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $argumentList -Wait -PassThru -WindowStyle Hidden`
    : `$process = Start-Process -FilePath $installerPath -ArgumentList $silentArgs -Wait -PassThru -WindowStyle Hidden`;
  const verificationBlock = verifyPath
    ? `$verifyPath = [Environment]::ExpandEnvironmentVariables(${psSingleQuote(verifyPath)})
if (-not (Test-Path -LiteralPath $verifyPath -PathType Leaf)) {
    throw (${psSingleQuote(softwareName)} + ' install completed but verification file was not found: ' + $verifyPath)
}

Write-Host (${psSingleQuote(softwareName)} + ' installed: ' + $verifyPath)`
    : `Write-Host (${psSingleQuote(softwareName)} + ' installed; no installed-file verification configured')`;

  return `$ErrorActionPreference = 'Stop'

$LogDir = 'C:\\Windows\\Temp\\osdcloud-logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

$installerPath = Join-Path $PSScriptRoot ${psSingleQuote(input.installerFileName)}
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw ('Installer not found: ' + $installerPath)
}

$logPath = Join-Path $LogDir ${psSingleQuote(logFileName)}
$silentArgs = ${psSingleQuote(silentArgs)}
${installerRun}

$successExitCodes = ${psArray(successExitCodes)}
if ($successExitCodes -notcontains $process.ExitCode) {
    throw (${psSingleQuote(softwareName)} + ' installer failed with exit code ' + $process.ExitCode + '. See ' + $logPath)
}

${verificationBlock}

if ($process.ExitCode -eq 1641) {
    Write-Output 'WINCEPTION_REBOOT_PENDING'
}
if ($process.ExitCode -eq 3010) {
    Write-Output 'WINCEPTION_REBOOT_RECOMMENDED'
}
`;
}

export function normalizeRawInstallScript(value) {
  const script = String(value ?? '');
  if (!script.trim()) {
    throw inputError('Raw install.ps1 script is required');
  }
  if (Buffer.byteLength(script, 'utf8') > defaultRawInstallScriptMaxBytes) {
    throw inputError(`Raw install.ps1 script is too large: ${defaultRawInstallScriptMaxBytes} bytes max`);
  }
  return script.endsWith('\n') ? script : `${script}\n`;
}

export async function validateRawInstallScriptSyntax(script, options = {}) {
  if (options.validateRawInstallScriptSyntax) {
    return options.validateRawInstallScriptSyntax(script);
  }
  if (process.platform !== 'win32') {
    return;
  }
  const encodedScript = Buffer.from(script, 'utf8').toString('base64');
  const parserScript = `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedScript}'))
$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) {
  $errors | Select-Object -First 1 @{ Name = 'message'; Expression = { $_.Message } }, @{ Name = 'line'; Expression = { $_.Extent.StartLineNumber } } | ConvertTo-Json -Compress
  exit 1
}`;
  try {
    await spawnAndWait('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', parserScript]);
  } catch (error) {
    throw inputError(`Raw install.ps1 syntax error: ${error.message.replace(/^powershell\.exe exited \d+:\s*/u, '')}`);
  }
}

export function renderSoftwareInstallScript(input) {
  const mode = String(input.scriptMode ?? input.mode ?? 'template').trim().toLowerCase();
  if (mode === 'raw') {
    return normalizeRawInstallScript(input.rawScript ?? input.installScript);
  }
  if (mode !== 'template') {
    throw inputError(`Software install script mode must be template or raw: ${input.scriptMode ?? input.mode}`);
  }
  return renderTemplateInstallScript(input);
}

export async function createSoftwarePackage(config = {}, input = {}, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const id = normalizeHumanCatalogId(input.softwareId ?? input.id, 'Software id');
  const name = normalizeProfileName(input.name, 'Software name');
  const uploadId = normalizeId(input.uploadId, 'software upload');
  const uploaded = resolveUploadedSoftwareInstaller(profileOptions, uploadId);
  const installerFileName = cleanSoftwareInstallerFileName(uploaded.fileName);
  const installerType = normalizeInstallerType(input.installerType, installerFileName);
  const scriptMode = String(input.scriptMode ?? input.mode ?? 'template').trim().toLowerCase();

  const catalogRaw = readJson(profileOptions.softwareCatalogPath, 'software catalog');
  const softwareRows = arrayFrom(catalogRaw.software, 'software catalog software');
  const seenIds = new Set();
  const seenSources = new Set();
  for (const row of softwareRows) {
    const existingId = normalizeId(row.id, 'software');
    const existingIdKey = existingId.toLowerCase();
    if (seenIds.has(existingIdKey)) {
      throw inputError(`Duplicate software id: ${existingId}`, 409);
    }
    seenIds.add(existingIdKey);
    const existingSource = String(row.source ?? existingId).trim();
    const existingSourceKey = existingSource.toLowerCase();
    if (seenSources.has(existingSourceKey)) {
      throw inputError(`Duplicate software source: ${existingSource}`, 409);
    }
    seenSources.add(existingSourceKey);
  }
  const reservedIds = new Set(Array.from(reservedSoftwarePackageIds(profileOptions, softwareRows), (value) => String(value).toLowerCase()));
  if (reservedIds.has(id.toLowerCase())) {
    throw inputError(`Duplicate software id or source: ${id}`, 409);
  }
  const source = id;
  const sourcePath = assertInside(
    profileOptions.softwareSourceRoot,
    path.join(profileOptions.softwareSourceRoot, source),
    `Software ${id} source`,
  );
  if (fs.existsSync(sourcePath)) {
    throw inputError(`Software source folder already exists for ${id}: ${sourcePath}`, 409);
  }

  const installScript = renderSoftwareInstallScript({
    ...input,
    id,
    name,
    installerFileName,
    installerType,
  });
  if (scriptMode === 'raw') {
    await validateRawInstallScriptSyntax(installScript, options);
  }
  const existingCatalog = loadSoftwareCatalog(config, { ...options, validateSources: options.validateSources });
  const dependsOn = normalizeSoftwareDependencies(input.dependsOn, `software ${id} dependsOn`, id);
  for (const dependencyId of dependsOn) {
    if (!existingCatalog.byId.has(dependencyId)) {
      throw inputError(`software ${id} depends on unknown software: ${dependencyId}`);
    }
  }
  const network = normalizeSoftwareNetwork(input.network, `software ${id} network`);
  const installerTargetPath = assertInside(sourcePath, path.join(sourcePath, installerFileName), 'Software installer target');
  const installScriptPath = assertInside(sourcePath, path.join(sourcePath, 'install.ps1'), 'Software install.ps1 target');
  let sourceCreated = false;

  try {
    fs.mkdirSync(sourcePath, { recursive: true });
    sourceCreated = true;
    fs.copyFileSync(uploaded.filePath, installerTargetPath, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(installScriptPath, installScript, 'utf8');
    const stat = fs.statSync(installerTargetPath);
    const sha256 = await sha256File(installerTargetPath);
    catalogRaw.software = [
      ...softwareRows,
      {
        id,
        name,
        source,
        scriptMode,
        installerType,
        installerFileName,
        ...(scriptMode === 'template' ? {
          silentArgs: String(input.silentArgs ?? defaultSilentArgs(installerType)).trim(),
          successExitCodes: normalizeSuccessExitCodes(input.successExitCodes, installerType),
          verifyPath: String(input.verifyPath ?? '').trim(),
          verificationMode: String(input.verifyPath ?? '').trim() ? 'installed file' : 'installer exit code only',
        } : {
          verificationMode: 'custom install.ps1',
        }),
        dependsOn,
        network,
        installerBytes: stat.size,
        installerSha256: sha256,
      },
    ];
    writeJson(profileOptions.softwareCatalogPath, catalogRaw);
    let uploadRemoved = false;
    try {
      fs.rmSync(uploaded.uploadDir, { recursive: true, force: true });
      uploadRemoved = true;
    } catch {}

    return {
      software: {
        id,
        name,
        source,
        installerFileName,
        installerType,
        sourcePath,
        installScript: installScriptPath,
      },
      catalogPath: profileOptions.softwareCatalogPath,
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

export function deleteSoftwarePackage(config = {}, softwareId, options = {}) {
  const profileOptions = deploymentProfileOptions(config, options);
  const id = normalizeId(softwareId, 'software');
  const catalogRaw = readJson(profileOptions.softwareCatalogPath, 'software catalog');
  const softwareRows = arrayFrom(catalogRaw.software, 'software catalog software');
  const rowIndex = softwareRows.findIndex((row) => normalizeId(row.id, 'software') === id);
  if (rowIndex < 0) {
    throw inputError(`Software not found: ${id}`, 404);
  }

  const catalog = loadSoftwareCatalog(config, options);
  const profiles = loadDeploymentProfiles(config, { ...options, catalog });
  const requiredBySoftware = catalog.software
    .filter((candidate) => candidate.id !== id && candidate.dependsOn.includes(id))
    .map((candidate) => candidate.id);
  if (requiredBySoftware.length) {
    throw inputError(`Software ${id} is required by catalog software: ${requiredBySoftware.join(', ')}`, 409);
  }
  const usedByProfiles = profiles
    .filter((profile) => profile.softwareIds.includes(id))
    .map((profile) => ({ id: profile.id, name: profile.name }));
  if (usedByProfiles.length) {
    const names = usedByProfiles.map((profile) => profile.name || profile.id).join(', ');
    const error = inputError(`Software ${id} is still used by deployment profiles: ${names}`, 409);
    error.profiles = usedByProfiles;
    throw error;
  }

  const row = softwareRows[rowIndex];
  const software = catalog.byId.get(id);
  const source = String(row.source ?? id).trim();
  const sourceUsers = softwareRows.filter((candidate, index) => index !== rowIndex && String(candidate.source ?? candidate.id).trim() === source);
  if (sourceUsers.length) {
    throw inputError(`Software source ${source} is shared by another catalog entry`, 409);
  }

  catalogRaw.software = softwareRows.filter((_row, index) => index !== rowIndex);
  writeJson(profileOptions.softwareCatalogPath, catalogRaw);
  if (software?.sourcePath && fs.existsSync(software.sourcePath)) {
    fs.rmSync(software.sourcePath, { recursive: true, force: true });
  }

  return {
    software,
    catalogPath: profileOptions.softwareCatalogPath,
    sourceRemoved: Boolean(software?.sourcePath),
    usedByProfiles,
  };
}

export function formatSoftwareList(software) {
  return software.length ? software.map((item) => item.id).join(', ') : 'none';
}
