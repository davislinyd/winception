import fs from 'node:fs';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..');
const generatedProfileIdAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const generatedProfileIdLength = 8;
const generatedProfileIdSpace = generatedProfileIdAlphabet.length ** generatedProfileIdLength;
const defaultGeneratedProfileIdAttempts = 256;
const generatedSoftwareIdPrefix = 'SW-';
const allowedSoftwareInstallerExtensions = new Set(['.msi', '.exe']);
const defaultSoftwareUploadMaxBytes = 2 * 1024 * 1024 * 1024;
const defaultRawInstallScriptMaxBytes = 256 * 1024;

export const selectedProfileFileName = 'selected-profile.json';

function inputError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function deploymentProfileDefaults(root) {
  return {
    activeProfile: 'I20HRVF5',
    profilesRoot: path.join(root, 'config', 'deployment-profiles'),
    softwareCatalogPath: path.join(root, 'config', 'software-catalog.json'),
    softwareSourceRoot: path.join(root, 'Softwares'),
    appsRoot: 'C:\\OSDCloud\\Win11-iPXE-Lab\\Media\\OSDCloud\\Apps',
    installerScript: path.join(root, 'Softwares', 'Install-Apps.ps1'),
    softwareUploadRoot: path.join(root, '.osdcloud-tui', 'software-uploads'),
    softwareUploadMaxBytes: defaultSoftwareUploadMaxBytes,
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
    throw inputError(`Invalid ${label} id: ${value}`);
  }
  return id;
}

function cleanSoftwareInstallerFileName(value, label = 'software installer fileName') {
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

function normalizePositiveInteger(value, label, options = {}) {
  if (value === undefined || value === null || value === '') {
    return options.optional ? null : undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < (options.min ?? 0)) {
    throw inputError(`Invalid ${label}: ${value}`);
  }
  return number;
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

function normalizeProfileName(value, label = 'Deployment profile name') {
  const name = String(value ?? '').trim();
  if (!name) {
    throw new Error(`${label} is required`);
  }
  return name;
}

function normalizeProfileDescription(value) {
  return String(value ?? '').trim();
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

function maybeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function arrayFrom(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function inferInstallerFile(sourcePath, preferredFileName = null) {
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

function installerTypeFromFile(fileName) {
  const extension = path.extname(String(fileName ?? '')).toLowerCase();
  return extension ? extension.replace(/^\./u, '') : null;
}

function parseSuccessExitCodesFromScript(script) {
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

function parseSoftwareInstallDetails(installScript) {
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

function softwareInstallMetadata(row, sourcePath, installScript) {
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
  };
}

function resolveSoftwareInstallScript(config = {}, softwareId, options = {}) {
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

function spawnAndWait(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = (stderr || stdout || '').trim();
      reject(new Error(detail ? `${command} exited ${code}: ${detail}` : `${command} exited ${code}`));
    });
  });
}

async function launchWindowsOpenWith(scriptPath) {
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

async function launchDefaultOpen(scriptPath) {
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
    softwareUploadRoot: resolveConfiguredPath(root, section.softwareUploadRoot),
    softwareUploadMaxBytes: Number(section.softwareUploadMaxBytes) > 0
      ? Number(section.softwareUploadMaxBytes)
      : defaultSoftwareUploadMaxBytes,
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
    };
  });

  return {
    path: profileOptions.softwareCatalogPath,
    software,
    byId: new Map(software.map((item) => [item.id, item])),
  };
}

function uploadSourceStream(input) {
  if (input.stream) {
    return input.stream;
  }
  if (input.buffer || input.bytes) {
    return Readable.from([input.buffer ?? input.bytes]);
  }
  throw inputError('Software installer upload requires a readable stream or buffer');
}

function createUploadTransform(progress, maxBytes) {
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

function hashFile(filePath, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });
}

const sha256File = (filePath) => hashFile(filePath, 'sha256');

function softwareUploadDirectory(profileOptions, uploadId) {
  const root = profileOptions.softwareUploadRoot;
  return assertInside(root, path.join(root, normalizeId(uploadId, 'software upload')), 'Software upload directory');
}

function resolveUploadedSoftwareInstaller(profileOptions, uploadId) {
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

function reservedSoftwarePackageIds(profileOptions, softwareRows) {
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

function normalizeInstallerType(value, fileName) {
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

function defaultSilentArgs(installerType) {
  return installerType === 'msi'
    ? '/qn /norestart REBOOT=ReallySuppress'
    : '/quiet /norestart';
}

function normalizeSuccessExitCodes(value, installerType) {
  const source = value === undefined || value === null || value === ''
    ? (installerType === 'msi' ? [0, 1641, 3010] : [0])
    : (Array.isArray(value) ? value : String(value).split(/[,\s]+/u).filter(Boolean));
  const codes = source.map((entry) => normalizePositiveInteger(entry, 'software installer success exit code', { min: 0 }));
  if (!codes.length) {
    throw inputError('At least one success exit code is required');
  }
  return [...new Set(codes)];
}

function psSingleQuote(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

function psArray(values) {
  return `@(${values.map((value) => String(Number(value))).join(', ')})`;
}

function renderTemplateInstallScript(input) {
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
`;
}

function normalizeRawInstallScript(value) {
  const script = String(value ?? '');
  if (!script.trim()) {
    throw inputError('Raw install.ps1 script is required');
  }
  if (Buffer.byteLength(script, 'utf8') > defaultRawInstallScriptMaxBytes) {
    throw inputError(`Raw install.ps1 script is too large: ${defaultRawInstallScriptMaxBytes} bytes max`);
  }
  return script.endsWith('\n') ? script : `${script}\n`;
}

function renderSoftwareInstallScript(input) {
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
  if (input.id !== undefined || input.softwareId !== undefined) {
    throw inputError('Software id is generated by the server');
  }
  const name = normalizeProfileName(input.name, 'Software name');
  const uploadId = normalizeId(input.uploadId, 'software upload');
  const uploaded = resolveUploadedSoftwareInstaller(profileOptions, uploadId);
  const installerFileName = cleanSoftwareInstallerFileName(uploaded.fileName);
  const installerType = normalizeInstallerType(input.installerType, installerFileName);

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
  const id = generateSoftwareId(reservedSoftwarePackageIds(profileOptions, softwareRows), options);
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
        scriptMode: String(input.scriptMode ?? input.mode ?? 'template').trim().toLowerCase(),
        installerType,
        installerFileName,
        silentArgs: String(input.silentArgs ?? defaultSilentArgs(installerType)).trim(),
        successExitCodes: normalizeSuccessExitCodes(input.successExitCodes, installerType),
        verifyPath: String(input.verifyPath ?? '').trim(),
        verificationMode: String(input.verifyPath ?? '').trim() ? 'installed file' : 'installer exit code only',
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
  if (input.description !== undefined) {
    raw.description = normalizeProfileDescription(input.description);
  }
  writeJson(filePath, raw);

  return {
    profile: {
      id,
      name,
      description: raw.description ?? '',
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
  if (input.description !== undefined) {
    raw.description = normalizeProfileDescription(input.description);
  }
  writeJson(filePath, raw);

  return {
    profile: {
      ...profile,
      name,
      description: String(raw.description ?? ''),
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

const retrySleepView = new Int32Array(new SharedArrayBuffer(4));

function retrySyncOnTransientWindowsError(operation, { attempts = 10, delayMs = 200 } = {}) {
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

function removeAppsRootContents(appsRoot) {
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
  retrySyncOnTransientWindowsError(() =>
    fs.copyFileSync(state.options.installerScript, path.join(appsRoot, 'Install-Apps.ps1')));

  const copied = [];
  for (const software of state.selectedSoftware) {
    const target = path.join(appsRoot, software.id);
    retrySyncOnTransientWindowsError(() => fs.cpSync(software.sourcePath, target, { recursive: true }));
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
