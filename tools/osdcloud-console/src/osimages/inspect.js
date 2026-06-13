import fs from 'node:fs';
import path from 'node:path';
import { collectProcessOutput } from '../processOutput.js';
import { spawn } from 'node:child_process';
import { normalizeOsImage } from './catalog.js';
import { runPowerShellJson } from './download.js';
import { allowedImportExtensions, cleanWimFileName, defaultEditionId, defaultLocale, defaultTimeZone, normalizeLanguage, normalizeNumber } from './shared.js';

export async function validateImageIndex(filePath, imageIndex, options = {}) {
  if (options.validateImage === false) {
    return { ok: true, skipped: true };
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`OS image not found: ${filePath}`);
  }
  const index = normalizeNumber(imageIndex, 'OS image index', { min: 1 });
  const args = ['/English', '/Get-WimInfo', `/WimFile:${filePath}`, `/Index:${index}`];
  const child = spawn(options.dismPath ?? 'dism.exe', args, { windowsHide: true });
  const result = await collectProcessOutput(child);
  if (result.code === 0) {
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  }
  const error = new Error(result.stderr.trim() || result.stdout.trim() || `DISM Get-WimInfo exited with code ${result.code}`);
  error.stdout = result.stdout;
  error.stderr = result.stderr;
  error.code = result.code;
  throw error;
}

export function parseDismWimInfo(stdout = '') {
  const rows = [];
  let current = null;
  for (const rawLine of String(stdout).split(/\r?\n/u)) {
    const line = rawLine.trim();
    let match = /^Index\s*:\s*(\d+)/iu.exec(line);
    if (match) {
      current = {
        imageIndex: Number(match[1]),
        name: '',
        description: '',
        architecture: 'x64',
      };
      rows.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    match = /^Name\s*:\s*(.+)$/iu.exec(line);
    if (match) {
      current.name = match[1].trim();
      continue;
    }
    match = /^Description\s*:\s*(.+)$/iu.exec(line);
    if (match) {
      current.description = match[1].trim();
      continue;
    }
    match = /^Architecture\s*:\s*(.+)$/iu.exec(line);
    if (match) {
      current.architecture = match[1].trim() || 'x64';
    }
  }
  return rows;
}

export async function inspectWimInfo(filePath, options = {}) {
  if (typeof options.inspectWimInfo === 'function') {
    return options.inspectWimInfo(filePath);
  }
  const child = spawn(options.dismPath ?? 'dism.exe', ['/English', '/Get-WimInfo', `/WimFile:${filePath}`], { windowsHide: true });
  const result = await collectProcessOutput(child);
  if (result.code === 0) {
    return parseDismWimInfo(result.stdout);
  }
  throw new Error(result.stderr.trim() || result.stdout.trim() || `DISM Get-WimInfo exited with code ${result.code}`);
}

export function localSourcePath(sourcePath) {
  const raw = String(sourcePath ?? '').trim();
  const resolved = path.resolve(raw);
  if (!path.isAbsolute(raw) || resolved.startsWith('\\\\')) {
    throw new Error(`OS image import sourcePath must be a local absolute path: ${sourcePath}`);
  }
  const extension = path.extname(resolved).toLowerCase();
  if (!allowedImportExtensions.has(extension)) {
    throw new Error(`OS image import sourcePath must end with .iso, .esd, or .wim: ${sourcePath}`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`OS image import source not found: ${resolved}`);
  }
  return resolved;
}

export function powershellString(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

export async function mountIsoImage(sourcePath, options = {}) {
  if (typeof options.mountIsoImage === 'function') {
    return options.mountIsoImage(sourcePath);
  }
  const result = await runPowerShellJson(`
$imagePath = ${powershellString(sourcePath)}
$mount = Mount-DiskImage -ImagePath $imagePath -StorageType ISO -PassThru
$volume = @($mount | Get-Volume | Select-Object -First 1)
if (-not $volume) { throw "Mounted ISO did not expose a volume: $imagePath" }
$mountPath = if ($volume.DriveLetter) { "$($volume.DriveLetter):\\" } else { $volume.Path }
[pscustomobject]@{ mountPath = $mountPath; imagePath = $imagePath } | ConvertTo-Json -Compress
`, { cwd: options.cwd });
  return Array.isArray(result) ? result[0] : result;
}

export async function unmountIsoImage(mount, options = {}) {
  if (!mount) {
    return;
  }
  if (typeof options.unmountIsoImage === 'function') {
    await options.unmountIsoImage(mount);
    return;
  }
await runPowerShellJson(`
Dismount-DiskImage -ImagePath ${powershellString(mount.imagePath)}
'[]'
`, { cwd: options.cwd });
}

export function findIsoInstallImage(mountPath) {
  for (const fileName of ['install.esd', 'install.wim']) {
    const candidate = path.join(mountPath, 'sources', fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Mounted ISO does not contain sources\\install.esd or sources\\install.wim: ${mountPath}`);
}

export function inferReleaseId(sourcePath) {
  return /(2[1-9]H[12])/iu.exec(path.basename(sourcePath))?.[1]?.toUpperCase() ?? '';
}

export function inferBuild(sourcePath) {
  return /(\d{5}\.\d+)/u.exec(path.basename(sourcePath))?.[1] ?? '';
}

export function inferLanguage(sourcePath) {
  return /[_-]([a-z]{2}-[a-z]{2})(?:[_.-]|$)/iu.exec(path.basename(sourcePath))?.[1]?.toLowerCase() ?? 'zh-tw';
}

export function inferEdition(name) {
  const text = String(name ?? '').toLowerCase();
  if (text.includes('enterprise')) {
    return 'Enterprise';
  }
  if (text.includes('education')) {
    return 'Education';
  }
  return 'Pro';
}

export function suggestedFileName(sourcePath, imageFilePath, imageIndex, metadata = {}) {
  if (metadata.fileName) {
    return cleanWimFileName(path.basename(metadata.fileName, path.extname(metadata.fileName)) + '.wim');
  }
  const base = path.basename(sourcePath, path.extname(sourcePath))
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96) || 'imported-os';
  return cleanWimFileName(`${base}-index${imageIndex}.wim`);
}

export function suggestedImageMetadata(sourcePath, imageFilePath, row, metadata = {}) {
  const language = normalizeLanguage(metadata.language ?? inferLanguage(sourcePath));
  const releaseId = String(metadata.releaseId ?? inferReleaseId(sourcePath)).trim();
  const build = String(metadata.build ?? inferBuild(sourcePath)).trim();
  const edition = String(metadata.edition ?? inferEdition(row.name)).trim() || 'Pro';
  const fileName = suggestedFileName(sourcePath, imageFilePath, row.imageIndex, metadata);
  return normalizeOsImage({
    name: metadata.name ?? row.name ?? `${edition} ${language}`,
    version: metadata.version ?? `Windows ${releaseId || build || 'Imported'} ${row.architecture ?? 'x64'}`.trim(),
    releaseId,
    build,
    architecture: metadata.architecture ?? row.architecture ?? 'x64',
    language,
    locale: metadata.locale ?? defaultLocale(language),
    timeZone: metadata.timeZone ?? defaultTimeZone(language),
    edition,
    editionId: metadata.editionId ?? defaultEditionId(edition),
    activation: metadata.activation ?? 'Retail',
    imageIndex: row.imageIndex,
    fileName,
    id: metadata.id,
    sourceFileName: metadata.sourceFileName,
    sourceContainerType: metadata.sourceContainerType,
    sourceImageIndex: metadata.sourceImageIndex,
    sourceSize: metadata.sourceSize,
    sourceSha256: metadata.sourceSha256,
    sourceType: metadata.sourceType ?? 'exported-wim',
  });
}

export function exportedImageMetadata(image, sourcePath, sourceSize, sourceSha256, sourceType) {
  const sourceImageIndex = image.imageIndex;
  const sourceFileName = path.basename(sourcePath);
  const fileName = cleanWimFileName(path.basename(image.fileName, path.extname(image.fileName)) + '.wim');
  return normalizeOsImage({
    ...image,
    imageIndex: 1,
    fileName,
    size: null,
    sha256: '',
    sha1: '',
    sourceType: 'exported-wim',
    sourceFileName,
    sourceContainerType: sourceType,
    sourceImageIndex,
    sourceSize,
    sourceSha256,
  });
}

export async function exportImageToWim(sourcePath, destinationPath, sourceIndex, options = {}) {
  if (typeof options.exportImageToWim === 'function') {
    return options.exportImageToWim(sourcePath, destinationPath, sourceIndex, options);
  }
  const index = normalizeNumber(sourceIndex, 'OS image export source index', { min: 1 });
  const args = [
    '/English',
    '/Export-Image',
    `/SourceImageFile:${sourcePath}`,
    `/SourceIndex:${index}`,
    `/DestinationImageFile:${destinationPath}`,
    '/Compress:Max',
    '/CheckIntegrity',
  ];
  const child = spawn(options.dismPath ?? 'dism.exe', args, { windowsHide: true });
  const result = await collectProcessOutput(child);
  if (result.code === 0) {
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  }
  const error = new Error(result.stderr.trim() || result.stdout.trim() || `DISM Export-Image exited with code ${result.code}`);
  error.stdout = result.stdout;
  error.stderr = result.stderr;
  error.code = result.code;
  throw error;
}

export async function resolveImportImage(sourcePath, options = {}) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension !== '.iso') {
    return {
      type: extension.slice(1),
      imagePath: sourcePath,
      mount: null,
    };
  }
  const mount = await mountIsoImage(sourcePath, options);
  return {
    type: 'iso',
    imagePath: findIsoInstallImage(mount.mountPath),
    mount,
  };
}

export async function inspectLocalOsImage(sourcePath, options = {}) {
  const source = localSourcePath(sourcePath);
  const resolved = await resolveImportImage(source, options);
  try {
    const rows = await inspectWimInfo(resolved.imagePath, options);
    const indexes = rows.map((row) => {
      const imageIndex = normalizeNumber(row.imageIndex ?? row.index ?? row.Index, 'OS import image index', { min: 1 });
      const normalizedRow = {
        imageIndex,
        name: String(row.name ?? row.Name ?? ''),
        description: String(row.description ?? row.Description ?? ''),
        architecture: String(row.architecture ?? row.Architecture ?? 'x64') || 'x64',
      };
      return {
        ...normalizedRow,
        suggested: suggestedImageMetadata(source, resolved.imagePath, normalizedRow),
      };
    });
    if (!indexes.length) {
      throw new Error(`No importable image indexes found in ${resolved.imagePath}`);
    }
    return {
      sourcePath: source,
      sourceType: resolved.type,
      imagePath: resolved.imagePath,
      indexes,
    };
  } finally {
    await unmountIsoImage(resolved.mount, options);
  }
}
