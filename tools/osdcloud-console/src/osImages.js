import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { appRootForConfig, stateRootForConfig } from './config.js';
import { collectProcessOutput, preparePowerShellArgs } from './processOutput.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const selectedOsFileName = 'selected-os.json';
export const osImageCacheLogFileName = 'os-image-cache.jsonl';

const defaultActiveImage = null;
const defaultCacheRoot = 'C:\\OSDCloud\\Media\\OSDCloud\\OS';
const defaultDownloadStagingRoot = 'C:\\OSDCloud\\Media\\OSDCloud\\OS\\.downloads';
const defaultDownloadSourcesPath = 'config\\os-download-sources.json';
const defaultUploadMaxBytes = 16 * 1024 * 1024 * 1024;
const allowedExtensions = new Set(['.esd', '.wim']);
const allowedImportExtensions = new Set(['.iso', '.esd', '.wim']);
const defaultMicrosoftDownloadHosts = [
  'dl.delivery.mp.microsoft.com',
  'download.microsoft.com',
  'software.download.prss.microsoft.com',
];
const requiredCustomSourceFields = [
  ['id', 'Id', 'ID'],
  ['version', 'Version', 'osVersion', 'OSVersion'],
  ['releaseId', 'ReleaseId', 'ReleaseID', 'releaseID'],
  ['build', 'Build'],
  ['language', 'Language', 'osLanguage', 'OSLanguage'],
  ['edition', 'Edition', 'osEdition', 'OSEdition'],
  ['activation', 'Activation', 'osActivation', 'OSActivation'],
  ['imageIndex', 'ImageIndex', 'index', 'Index'],
  ['fileName', 'FileName'],
  ['url', 'Url', 'URL', 'downloadUrl', 'DownloadUrl'],
  ['sha256', 'SHA256'],
];

function powershellExe() {
  return process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
}

function isSafeId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(String(value ?? ''));
}

function normalizeId(value, label) {
  const id = String(value ?? '').trim();
  if (!isSafeId(id)) {
    throw new Error(`Invalid ${label} id: ${value}`);
  }
  return id;
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

function readJson(filePath, label, fallback = null) {
  if (!fs.existsSync(filePath)) {
    if (fallback !== null) {
      return fallback;
    }
    throw new Error(`${label} not found: ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label} ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function arrayFrom(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function firstValue(source, names, fallback = undefined) {
  for (const name of names) {
    const value = source?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return fallback;
}

function cleanFileName(value, label = 'OS image fileName') {
  const raw = String(value ?? '').trim();
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    throw new Error(`${label} must be a plain file name: ${value}`);
  }
  const fileName = path.basename(raw);
  const extension = path.extname(fileName).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    throw new Error(`${label} must end with .esd or .wim: ${fileName}`);
  }
  return fileName;
}

function cleanImportFileName(value, label = 'OS import fileName') {
  const fileName = cleanFileName(value, label);
  if (fileName.toLowerCase() === selectedOsFileName) {
    throw new Error(`${label} cannot be ${selectedOsFileName}`);
  }
  return fileName;
}

function cleanWimFileName(value, label = 'OS image WIM fileName') {
  const fileName = cleanImportFileName(value, label);
  if (path.extname(fileName).toLowerCase() !== '.wim') {
    throw new Error(`${label} must end with .wim: ${fileName}`);
  }
  return fileName;
}

function cleanUploadFileName(value, label = 'OS upload fileName') {
  const raw = String(value ?? '').trim();
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    throw new Error(`${label} must be a plain file name: ${value}`);
  }
  const fileName = path.basename(raw);
  const extension = path.extname(fileName).toLowerCase();
  if (!allowedImportExtensions.has(extension)) {
    throw new Error(`${label} must end with .iso, .esd, or .wim: ${fileName}`);
  }
  if (fileName.toLowerCase() === selectedOsFileName) {
    throw new Error(`${label} cannot be ${selectedOsFileName}`);
  }
  return fileName;
}

function normalizeNumber(value, label, options = {}) {
  if (value === undefined || value === null || value === '') {
    return options.optional ? null : undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < (options.min ?? 0)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return number;
}

function normalizeLanguage(value) {
  const language = String(value ?? '').trim();
  return language ? language.toLowerCase() : 'zh-tw';
}

function defaultLocale(language) {
  return normalizeLanguage(language).toLowerCase() === 'zh-tw' ? 'zh-TW' : String(language || '').trim();
}

function defaultTimeZone(language) {
  return normalizeLanguage(language).toLowerCase() === 'zh-tw' ? 'Taipei Standard Time' : '';
}

function defaultEditionId(edition) {
  const value = String(edition ?? '').trim().toLowerCase();
  if (value === 'pro' || value === 'professional') {
    return 'Professional';
  }
  return edition ? String(edition) : 'Professional';
}

function stableCatalogId(row) {
  const seed = [
    firstValue(row, ['version', 'Version', 'osVersion', 'OSVersion', 'Name'], 'windows'),
    firstValue(row, ['language', 'Language', 'osLanguage', 'OSLanguage'], 'lang'),
    firstValue(row, ['edition', 'Edition', 'osEdition', 'OSEdition'], 'edition'),
    firstValue(row, ['activation', 'Activation', 'osActivation', 'OSActivation'], 'Retail'),
    firstValue(row, ['imageIndex', 'ImageIndex', 'index', 'Index'], 'index'),
    firstValue(row, ['fileName', 'FileName'], ''),
  ].join('-');
  return seed
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64) || 'WINDOWS-IMAGE';
}

function normalizeHash(value) {
  const hash = String(value ?? '').trim();
  return hash ? hash.toUpperCase() : '';
}

function normalizeUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`OS image URL is invalid: ${text}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`OS image URL protocol is not allowed: ${url.protocol}`);
  }
  return url.toString();
}

function urlHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function microsoftDownloadHosts(config = {}, options = {}) {
  return normalizeAllowedHosts(
    options.microsoftDownloadHosts
      ?? config.osImage?.microsoftDownloadHosts
      ?? defaultMicrosoftDownloadHosts,
  );
}

function isMicrosoftDownloadUrl(url, config = {}, options = {}) {
  const normalized = normalizeUrl(url);
  return microsoftDownloadHosts(config, options).includes(urlHost(normalized));
}

function assertMicrosoftDownloadUrl(url, config = {}, options = {}, label = 'OS image URL') {
  const normalized = normalizeUrl(url);
  const host = urlHost(normalized);
  if (!microsoftDownloadHosts(config, options).includes(host)) {
    throw new Error(`${label} host is not an allowed Microsoft download host: ${host || url}`);
  }
  return normalized;
}

function fileNameFromUrl(url) {
  if (!url) {
    return '';
  }
  const parsed = new URL(url);
  const candidate = path.basename(decodeURIComponent(parsed.pathname));
  return candidate || '';
}

function hasRequiredField(row, names) {
  return String(firstValue(row, names, '') ?? '').trim() !== '';
}

function inferOsFamily(row = {}) {
  const explicit = String(firstValue(row, ['osFamily', 'OSFamily'], '')).trim().toLowerCase();
  if (explicit === 'win10' || explicit === 'windows10' || explicit === 'windows 10') {
    return 'win10';
  }
  if (explicit === 'win11' || explicit === 'windows11' || explicit === 'windows 11') {
    return 'win11';
  }

  const haystack = [
    firstValue(row, ['name', 'Name', 'displayName', 'DisplayName'], ''),
    firstValue(row, ['version', 'Version', 'osVersion', 'OSVersion', 'release', 'Release'], ''),
    firstValue(row, ['fileName', 'FileName'], ''),
  ].join(' ').toLowerCase();
  if (/\bwindows\s*11\b/u.test(haystack) || /\bwin\s*11\b/u.test(haystack)) {
    return 'win11';
  }
  if (/\bwindows\s*10\b/u.test(haystack) || /\bwin\s*10\b/u.test(haystack)) {
    return 'win10';
  }

  const buildText = String(firstValue(row, ['build', 'Build'], '')).trim();
  const build = Number.parseInt(buildText.split('.')[0], 10);
  if (Number.isFinite(build)) {
    if (build >= 22000) {
      return 'win11';
    }
    if (build >= 10240 && build < 22000) {
      return 'win10';
    }
  }
  return '';
}

function filterSet(options, name, normalizer = (value) => String(value).trim()) {
  const raw = options.filters?.[name] ?? options[name] ?? [];
  const values = Array.isArray(raw) ? raw : String(raw).split(',');
  return new Set(values
    .map((value) => normalizer(value))
    .filter(Boolean));
}

function catalogFilters(options = {}) {
  const activation = filterSet(options, 'activation', (value) => String(value).trim().toLowerCase());
  const retailOnlyActivation = activation.size === 0 || activation.has('retail')
    ? new Set(['retail'])
    : new Set(['__retail_only_no_match__']);
  return {
    osFamily: filterSet(options, 'osFamily', (value) => String(value).trim().toLowerCase()),
    language: filterSet(options, 'language', (value) => normalizeLanguage(value)),
    releaseId: filterSet(options, 'releaseId', (value) => String(value).trim().toUpperCase()),
    edition: filterSet(options, 'edition', (value) => String(value).trim().toLowerCase()),
    activation: retailOnlyActivation,
    sourceType: filterSet(options, 'sourceType', (value) => String(value).trim().toLowerCase()),
  };
}

function matchesFilter(set, value, normalizer = (input) => String(input).trim()) {
  return set.size === 0 || set.has(normalizer(value));
}

function matchesCatalogFilters(image, filters) {
  return matchesFilter(filters.osFamily, image.osFamily, (value) => String(value ?? '').trim().toLowerCase())
    && matchesFilter(filters.language, image.language, (value) => normalizeLanguage(value))
    && matchesFilter(filters.releaseId, image.releaseId, (value) => String(value ?? '').trim().toUpperCase())
    && matchesFilter(filters.edition, image.edition, (value) => String(value ?? '').trim().toLowerCase())
    && matchesFilter(filters.activation, image.activation, (value) => String(value ?? '').trim().toLowerCase())
    && matchesFilter(filters.sourceType, image.sourceType, (value) => String(value ?? '').trim().toLowerCase());
}

export function osImageOptions(config = {}, overrides = {}) {
  const appRoot = appRootForConfig(config);
  const stateRoot = stateRootForConfig(config);
  const section = {
    activeImage: defaultActiveImage,
    catalogPath: path.join(stateRoot, 'config', 'os-image-catalog.json'),
    downloadSourcesPath: path.join(stateRoot, defaultDownloadSourcesPath),
    cacheRoot: defaultCacheRoot,
    downloadStagingRoot: defaultDownloadStagingRoot,
    uploadMaxBytes: defaultUploadMaxBytes,
    validateDismOnPreflight: true,
    validateDismOnPublish: true,
    ...(config.osImage ?? {}),
    ...overrides,
  };

  const cacheRoot = resolveConfiguredPath(stateRoot, section.cacheRoot);
  const downloadStagingRoot = resolveConfiguredPath(stateRoot, section.downloadStagingRoot);
  return {
    activeImage: section.activeImage ?? defaultActiveImage,
    catalogPath: resolveConfiguredPath(stateRoot, section.catalogPath),
    downloadSourcesPath: resolveConfiguredPath(stateRoot, section.downloadSourcesPath),
    cacheRoot,
    downloadStagingRoot,
    selectedOsPath: path.join(cacheRoot, selectedOsFileName),
    cacheLogPath: path.join(cacheRoot, osImageCacheLogFileName),
    uploadMaxBytes: Number(section.uploadMaxBytes) > 0 ? Number(section.uploadMaxBytes) : defaultUploadMaxBytes,
    validateDismOnPreflight: section.validateDismOnPreflight !== false,
    validateDismOnPublish: section.validateDismOnPublish !== false,
    appRoot,
    stateRoot,
  };
}

export function normalizeOsImage(row = {}) {
  const url = normalizeUrl(firstValue(row, ['url', 'Url', 'URL', 'downloadUrl', 'DownloadUrl'], ''));
  const fileName = cleanFileName(firstValue(row, ['fileName', 'FileName'], '') || fileNameFromUrl(url));
  const language = normalizeLanguage(firstValue(row, ['language', 'Language', 'osLanguage', 'OSLanguage'], 'zh-tw'));
  const edition = String(firstValue(row, ['edition', 'Edition', 'osEdition', 'OSEdition'], 'Pro')).trim() || 'Pro';
  const id = normalizeId(firstValue(row, ['id', 'Id', 'ID'], '') || stableCatalogId({ ...row, fileName, language, edition }), 'OS image');
  const imageIndex = normalizeNumber(firstValue(row, ['imageIndex', 'ImageIndex', 'index', 'Index'], 6), `OS image ${id} imageIndex`, { min: 1 });
  const size = normalizeNumber(firstValue(row, ['size', 'Size', 'bytes', 'Bytes', 'length', 'Length'], null), `OS image ${id} size`, { optional: true, min: 1 });

  return {
    id,
    name: String(firstValue(row, ['name', 'Name', 'displayName', 'DisplayName'], `${edition} ${language}`)),
    version: String(firstValue(row, ['version', 'Version', 'osVersion', 'OSVersion', 'release', 'Release', 'Name'], '')).trim(),
    releaseId: String(firstValue(row, ['releaseId', 'ReleaseId', 'ReleaseID', 'releaseID'], '')).trim(),
    build: String(firstValue(row, ['build', 'Build'], '')).trim(),
    architecture: String(firstValue(row, ['architecture', 'Architecture', 'arch', 'Arch'], 'x64')).trim() || 'x64',
    language,
    locale: String(firstValue(row, ['locale', 'Locale'], defaultLocale(language))).trim() || defaultLocale(language),
    timeZone: String(firstValue(row, ['timeZone', 'TimeZone'], defaultTimeZone(language))).trim() || defaultTimeZone(language),
    edition,
    editionId: String(firstValue(row, ['editionId', 'EditionId', 'editionID', 'EditionID', 'osEditionId', 'OSEditionId'], defaultEditionId(edition))).trim() || defaultEditionId(edition),
    activation: String(firstValue(row, ['activation', 'Activation', 'osActivation', 'OSActivation'], 'Retail')).trim() || 'Retail',
    imageIndex,
    fileName,
    osFamily: inferOsFamily({ ...row, fileName }),
    size,
    sha256: normalizeHash(firstValue(row, ['sha256', 'SHA256'], '')),
    sha1: normalizeHash(firstValue(row, ['sha1', 'SHA1'], '')),
    url,
    sourceType: String(firstValue(row, ['sourceType', 'SourceType'], 'catalog')).trim().toLowerCase() || 'catalog',
    sourceFileName: String(firstValue(row, ['sourceFileName', 'SourceFileName'], '')).trim(),
    sourceContainerType: String(firstValue(row, ['sourceContainerType', 'SourceContainerType'], '')).trim(),
    sourceImageIndex: normalizeNumber(firstValue(row, ['sourceImageIndex', 'SourceImageIndex'], null), `OS image ${id} sourceImageIndex`, { optional: true, min: 1 }),
    sourceSize: normalizeNumber(firstValue(row, ['sourceSize', 'SourceSize'], null), `OS image ${id} sourceSize`, { optional: true, min: 1 }),
    sourceSha256: normalizeHash(firstValue(row, ['sourceSha256', 'SourceSha256'], '')),
  };
}

function normalizeAllowedHosts(value) {
  return arrayFrom(value ?? [], 'OS download source allowedHosts')
    .map((host) => String(host ?? '').trim().toLowerCase())
    .filter(Boolean);
}

export function loadCustomOsDownloadSources(config = {}, options = {}) {
  const imageOptions = osImageOptions(config, options);
  const raw = options.customDownloadSources
    ?? readJson(imageOptions.downloadSourcesPath, 'OS download sources', { allowedHosts: [], images: [] });
  const allowedHosts = normalizeAllowedHosts(options.allowedHosts ?? raw.allowedHosts ?? raw.allowlist ?? []);
  const rows = arrayFrom(options.customCatalogRows ?? raw.images ?? raw.sources ?? [], 'OS download sources images');
  const byId = new Map();

  for (const row of rows) {
    for (const names of requiredCustomSourceFields) {
      if (!hasRequiredField(row, names)) {
        throw new Error(`Custom OS source is missing required field: ${names[0]}`);
      }
    }
    const image = {
      ...normalizeOsImage({
        ...row,
        sourceType: 'custom',
      }),
      sourceType: 'custom',
    };
    if (!image.sha256) {
      throw new Error(`Custom OS source ${image.id} must include sha256`);
    }
    const host = urlHost(image.url);
    if (!host || !allowedHosts.includes(host)) {
      throw new Error(`Custom OS source ${image.id} host is not allowed: ${host || image.url}`);
    }
    if (path.extname(new URL(image.url).pathname).toLowerCase() !== path.extname(image.fileName).toLowerCase()) {
      throw new Error(`Custom OS source ${image.id} URL extension does not match fileName`);
    }
    if (!allowedExtensions.has(path.extname(image.fileName).toLowerCase())) {
      throw new Error(`Custom OS source ${image.id} fileName must end with .esd or .wim`);
    }
    if (!byId.has(image.id)) {
      byId.set(image.id, image);
    }
  }

  return {
    path: imageOptions.downloadSourcesPath,
    allowedHosts,
    images: [...byId.values()],
  };
}

export function loadOsImageCatalog(config = {}, options = {}) {
  const imageOptions = osImageOptions(config, options);
  const raw = readJson(imageOptions.catalogPath, 'OS image catalog', { images: [] });
  const rows = Array.isArray(raw) ? raw : arrayFrom(raw.images ?? [], 'OS image catalog images');
  const seen = new Set();
  const images = rows.map((row) => {
    const image = normalizeOsImage(row);
    if (seen.has(image.id)) {
      throw new Error(`Duplicate OS image id: ${image.id}`);
    }
    seen.add(image.id);
    return image;
  });
  return {
    path: imageOptions.catalogPath,
    images,
    raw: Array.isArray(raw) ? { images } : { ...raw, images },
  };
}

function cachedImagePath(options, image) {
  return assertInside(options.cacheRoot, path.join(options.cacheRoot, image.fileName), `OS image ${image.id}`);
}

function annotateCachedImage(options, image) {
  const filePath = cachedImagePath(options, image);
  const exists = fs.existsSync(filePath);
  const stat = exists ? fs.statSync(filePath) : null;
  const sizeMatches = image.size ? stat?.size === image.size : true;
  return {
    ...image,
    filePath,
    cached: Boolean(exists && stat?.isFile() && stat.size > 0),
    exists,
    bytes: stat?.size ?? 0,
    sizeMatches,
  };
}

export function resolveOsImageState(config = {}, imageId = null, options = {}) {
  const imageOptions = osImageOptions(config, options);
  const catalog = loadOsImageCatalog(config, options);
  const rawSelectedId = imageId ?? imageOptions.activeImage;
  const selectedId = rawSelectedId ? normalizeId(rawSelectedId, 'active OS image') : null;
  const images = catalog.images.map((image) => annotateCachedImage(imageOptions, image));
  const activeImage = selectedId ? images.find((image) => image.id === selectedId) ?? null : null;
  const selectedOs = fs.existsSync(imageOptions.selectedOsPath)
    ? readJson(imageOptions.selectedOsPath, 'selected OS manifest')
    : null;
  const cachedFiles = scanCachedOsImages(config, options);
  return {
    options: imageOptions,
    catalogPath: catalog.path,
    downloadSourcesPath: imageOptions.downloadSourcesPath,
    cacheRoot: imageOptions.cacheRoot,
    downloadStagingRoot: imageOptions.downloadStagingRoot,
    selectedOsPath: imageOptions.selectedOsPath,
    cacheLogPath: imageOptions.cacheLogPath,
    activeImage,
    activeImageId: selectedId,
    images,
    cachedFiles,
    selectedOs,
  };
}

export function scanCachedOsImages(config = {}, options = {}) {
  const imageOptions = osImageOptions(config, options);
  if (!fs.existsSync(imageOptions.cacheRoot)) {
    return [];
  }
  return fs.readdirSync(imageOptions.cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const filePath = path.join(imageOptions.cacheRoot, entry.name);
      const stat = fs.statSync(filePath);
      return {
        fileName: entry.name,
        filePath,
        bytes: stat.size,
        lastWriteTime: stat.mtime.toISOString(),
      };
    })
    .sort((left, right) => left.fileName.localeCompare(right.fileName, undefined, { numeric: true }));
}

function selectedOsManifest(image, filePath) {
  return {
    id: image.id,
    name: image.name,
    version: image.version,
    releaseId: image.releaseId,
    build: image.build,
    architecture: image.architecture,
    language: image.language,
    locale: image.locale,
    timeZone: image.timeZone,
    edition: image.edition,
    editionId: image.editionId,
    activation: image.activation,
    imageIndex: image.imageIndex,
    fileName: image.fileName,
    imagePath: `Z:\\OSDCloud\\OS\\${image.fileName}`,
    size: image.size ?? null,
    sha256: image.sha256 || null,
    sourceFileName: image.sourceFileName || null,
    sourceContainerType: image.sourceContainerType || null,
    sourceImageIndex: image.sourceImageIndex ?? null,
    sourceSize: image.sourceSize ?? null,
    sourceSha256: image.sourceSha256 || null,
    publishedAt: new Date().toISOString(),
    cacheFilePath: filePath,
  };
}

export async function publishSelectedOsImage(config = {}, imageId = null, options = {}) {
  const state = resolveOsImageState(config, imageId, options);
  if (!state.activeImageId) {
    throw new Error('No active OS image selected. Use Web OS Image Cache to download or import a source image, export a deployable WIM, then publish it.');
  }
  if (!state.activeImage) {
    throw new Error(`Active OS image not found: ${state.activeImageId}`);
  }
  if (!state.activeImage.cached) {
    throw new Error(`Active OS image is not cached: ${state.activeImage.filePath}`);
  }
  if (!state.activeImage.sizeMatches) {
    throw new Error(`Active OS image size mismatch: ${state.activeImage.filePath}`);
  }

  if (options.validateDism ?? state.options.validateDismOnPublish) {
    await validateImageIndex(state.activeImage.filePath, state.activeImage.imageIndex);
  }

  const manifest = selectedOsManifest(state.activeImage, state.activeImage.filePath);
  writeJson(state.selectedOsPath, manifest);

  config.osImage ??= {};
  config.osImage.activeImage = state.activeImage.id;
  config.osImage.catalogPath ??= 'config\\os-image-catalog.json';
  config.osImage.cacheRoot ??= defaultCacheRoot;
  config.osImage.downloadStagingRoot ??= defaultDownloadStagingRoot;
  config.paths ??= {};
  config.paths.imageNamePattern = state.activeImage.fileName;
  config.smb ??= {};
  if (config.smb.share) {
    config.smb.imagePath = `${config.smb.share}\\OSDCloud\\OS\\${state.activeImage.fileName}`;
  }

  return {
    image: state.activeImage,
    manifest,
    manifestPath: state.selectedOsPath,
  };
}

function pass(name, detail = '') {
  return { name, ok: true, detail };
}

function fail(name, detail = '') {
  return { name, ok: false, detail };
}

export async function evaluateOsImageCache(config = {}, options = {}) {
  try {
    const state = resolveOsImageState(config, null, options);
    const image = state.activeImage;
    if (!image) {
      return fail('OS image', state.activeImageId
        ? `active image not found: ${state.activeImageId}`
        : 'no active OS image selected; use Web OS Image Cache to download/import, export a WIM, and publish selected-os.json');
    }
    if (!image.cached) {
      return fail('OS image', `cached file missing: ${image.filePath}`);
    }
    if (!image.sizeMatches) {
      return fail('OS image', `size=${image.bytes} expected=${image.size}`);
    }
    if (!state.selectedOs) {
      return fail('OS image', `selected manifest not found: ${state.selectedOsPath}`);
    }
    const manifestImageIndex = Number(state.selectedOs.imageIndex ?? state.selectedOs.osImageIndex);
    if (
      state.selectedOs.id !== image.id
      || state.selectedOs.fileName !== image.fileName
      || manifestImageIndex !== image.imageIndex
    ) {
      return fail('OS image', `selected manifest stale: ${state.selectedOsPath}`);
    }
    if (config.paths?.imageNamePattern && config.paths.imageNamePattern !== image.fileName) {
      return fail('OS image', `paths.imageNamePattern=${config.paths.imageNamePattern} active=${image.fileName}`);
    }
    const smbImagePath = String(config.smb?.imagePath ?? '');
    if (smbImagePath.startsWith('\\\\') && !smbImagePath.endsWith(`\\OSDCloud\\OS\\${image.fileName}`)) {
      return fail('OS image', `smb.imagePath does not match active image: ${config.smb.imagePath}`);
    }

    if (options.validateDism ?? state.options.validateDismOnPreflight) {
      await validateImageIndex(image.filePath, image.imageIndex);
    }

    const version = image.version ? `${image.version} ` : '';
    return pass('OS image', `${image.id} ${version}${image.language} ${image.edition} index=${image.imageIndex} cached at ${image.filePath}`);
  } catch (error) {
    return fail('OS image', error.message);
  }
}

export function formatOsImageLabel(image) {
  if (!image) {
    return '-';
  }
  const version = image.version || image.releaseId || image.build || 'Windows';
  return `${version} ${image.language} ${image.edition} index ${image.imageIndex}`;
}

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

function parseDismWimInfo(stdout = '') {
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

async function inspectWimInfo(filePath, options = {}) {
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

function localSourcePath(sourcePath) {
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

function powershellString(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

async function mountIsoImage(sourcePath, options = {}) {
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

async function unmountIsoImage(mount, options = {}) {
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

function findIsoInstallImage(mountPath) {
  for (const fileName of ['install.esd', 'install.wim']) {
    const candidate = path.join(mountPath, 'sources', fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Mounted ISO does not contain sources\\install.esd or sources\\install.wim: ${mountPath}`);
}

function inferReleaseId(sourcePath) {
  return /(2[1-9]H[12])/iu.exec(path.basename(sourcePath))?.[1]?.toUpperCase() ?? '';
}

function inferBuild(sourcePath) {
  return /(\d{5}\.\d+)/u.exec(path.basename(sourcePath))?.[1] ?? '';
}

function inferLanguage(sourcePath) {
  return /[_-]([a-z]{2}-[a-z]{2})(?:[_.-]|$)/iu.exec(path.basename(sourcePath))?.[1]?.toLowerCase() ?? 'zh-tw';
}

function inferEdition(name) {
  const text = String(name ?? '').toLowerCase();
  if (text.includes('enterprise')) {
    return 'Enterprise';
  }
  if (text.includes('education')) {
    return 'Education';
  }
  return 'Pro';
}

function suggestedFileName(sourcePath, imageFilePath, imageIndex, metadata = {}) {
  if (metadata.fileName) {
    return cleanWimFileName(path.basename(metadata.fileName, path.extname(metadata.fileName)) + '.wim');
  }
  const base = path.basename(sourcePath, path.extname(sourcePath))
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96) || 'imported-os';
  return cleanWimFileName(`${base}-index${imageIndex}.wim`);
}

function suggestedImageMetadata(sourcePath, imageFilePath, row, metadata = {}) {
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

function exportedImageMetadata(image, sourcePath, sourceSize, sourceSha256, sourceType) {
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

async function exportImageToWim(sourcePath, destinationPath, sourceIndex, options = {}) {
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

async function resolveImportImage(sourcePath, options = {}) {
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

export async function importLocalOsImage(config = {}, input = {}, options = {}) {
  const source = localSourcePath(input.sourcePath);
  const requestedIndex = normalizeNumber(input.imageIndex ?? input.index, 'OS import selected imageIndex', { min: 1 });
  const metadata = input.metadata ?? {};
  const imageOptions = osImageOptions(config, options);
  fs.mkdirSync(imageOptions.cacheRoot, { recursive: true });
  fs.mkdirSync(imageOptions.downloadStagingRoot, { recursive: true });

  const resolved = await resolveImportImage(source, options);
  let stagingPath = null;
  try {
    const rows = await inspectWimInfo(resolved.imagePath, options);
    const selectedRow = rows.map((row) => ({
      imageIndex: Number(row.imageIndex ?? row.index ?? row.Index),
      name: String(row.name ?? row.Name ?? ''),
      description: String(row.description ?? row.Description ?? ''),
      architecture: String(row.architecture ?? row.Architecture ?? 'x64') || 'x64',
    })).find((row) => row.imageIndex === requestedIndex);
    if (!selectedRow) {
      throw new Error(`Image index ${requestedIndex} not found in ${resolved.imagePath}`);
    }

    const sourceStat = fs.statSync(resolved.imagePath);
    const sourceSha256 = await sha256File(resolved.imagePath);
    const sourceImage = suggestedImageMetadata(source, resolved.imagePath, selectedRow, {
      ...metadata,
      imageIndex: requestedIndex,
    });
    const image = exportedImageMetadata(sourceImage, resolved.imagePath, sourceStat.size, sourceSha256, resolved.type);
    const destination = cachedImagePath(imageOptions, image);
    if (fs.existsSync(destination)) {
      const existing = await sha256File(destination);
      const existingStat = fs.statSync(destination);
      const cached = {
        ...image,
        size: existingStat.size,
        sha256: existing,
      };
      upsertCatalogImage(config, cached, options);
      appendCacheLog(config, { status: 'import-cache-hit', imageId: cached.id, fileName: cached.fileName, bytes: cached.size, sourcePath: source }, options);
      return { status: 'cache-hit', image: cached, filePath: destination, bytes: cached.size };
    }

    const jobId = `${image.id}-${Date.now()}`.replace(/[^A-Za-z0-9._-]/gu, '_');
    stagingPath = assertInside(imageOptions.downloadStagingRoot, path.join(imageOptions.downloadStagingRoot, `${jobId}.wim`), 'OS image import staging path');
    if (options.validateImage !== false) {
      await validateImageIndex(resolved.imagePath, requestedIndex, options);
    }
    await exportImageToWim(resolved.imagePath, stagingPath, requestedIndex, options);
    const stat = fs.statSync(stagingPath);
    if (stat.size <= 0) {
      throw new Error('OS image import produced an empty file');
    }
    if (options.validateImage !== false) {
      await validateImageIndex(stagingPath, 1, options);
    }
    const finalImage = {
      ...image,
      size: stat.size,
      sha256: await sha256File(stagingPath),
      sourceType: 'exported-wim',
    };
    fs.renameSync(stagingPath, destination);
    stagingPath = null;
    upsertCatalogImage(config, finalImage, options);
    appendCacheLog(config, { status: 'imported', imageId: finalImage.id, fileName: finalImage.fileName, bytes: finalImage.size, sourcePath: source }, options);
    return { status: 'imported', image: finalImage, filePath: destination, bytes: finalImage.size };
  } catch (error) {
    appendCacheLog(config, { status: 'import-failed', sourcePath: source, imageIndex: requestedIndex, reason: error.message }, options);
    throw error;
  } finally {
    if (stagingPath && fs.existsSync(stagingPath)) {
      fs.rmSync(stagingPath, { force: true });
    }
    await unmountIsoImage(resolved.mount, options);
  }
}

function uploadRootPath(imageOptions) {
  return path.join(imageOptions.downloadStagingRoot, 'uploads');
}

function normalizeUploadId(value) {
  return normalizeId(value, 'OS image upload');
}

function resolveUploadDirectory(imageOptions, uploadId) {
  const root = uploadRootPath(imageOptions);
  return assertInside(root, path.join(root, normalizeUploadId(uploadId)), 'OS image upload directory');
}

function resolveUploadedSourcePath(imageOptions, uploadId) {
  const uploadDir = resolveUploadDirectory(imageOptions, uploadId);
  if (!fs.existsSync(uploadDir) || !fs.statSync(uploadDir).isDirectory()) {
    throw new Error(`OS image upload not found: ${uploadId}`);
  }
  const files = fs.readdirSync(uploadDir)
    .filter((name) => allowedImportExtensions.has(path.extname(name).toLowerCase()))
    .map((name) => assertInside(uploadDir, path.join(uploadDir, name), 'OS image upload file'));
  if (files.length !== 1) {
    throw new Error(`OS image upload ${uploadId} must contain exactly one ISO/ESD/WIM file`);
  }
  return files[0];
}

function createUploadTransform(progress, maxBytes) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      progress.bytes += chunk.length;
      if (progress.bytes > maxBytes) {
        callback(new Error(`OS image upload exceeds maximum size: ${maxBytes} bytes`));
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

function uploadSourceStream(input) {
  if (input.stream) {
    return input.stream;
  }
  if (input.buffer || input.bytes) {
    return Readable.from([input.buffer ?? input.bytes]);
  }
  throw new Error('OS image upload requires a readable stream or buffer');
}

export async function uploadOsImageFile(config = {}, input = {}, options = {}) {
  const imageOptions = osImageOptions(config, options);
  const fileName = cleanUploadFileName(input.fileName ?? input.name);
  const declaredSize = normalizeNumber(input.size ?? input.totalBytes, 'OS image upload size', { optional: true, min: 1 });
  const maxBytes = Number(options.uploadMaxBytes ?? imageOptions.uploadMaxBytes);
  if (declaredSize && declaredSize > maxBytes) {
    throw new Error(`OS image upload exceeds maximum size: ${maxBytes} bytes`);
  }

  const uploadId = normalizeUploadId(options.uploadId ?? `upload-${randomUUID()}`);
  const uploadRoot = uploadRootPath(imageOptions);
  const uploadDir = resolveUploadDirectory(imageOptions, uploadId);
  const targetPath = assertInside(uploadDir, path.join(uploadDir, fileName), 'OS image upload path');
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
      throw new Error('OS image upload produced an empty file');
    }
    if (declaredSize && stat.size !== declaredSize) {
      throw new Error(`OS image upload size mismatch: ${stat.size} expected ${declaredSize}`);
    }
    const inspected = await inspectLocalOsImage(targetPath, options);
    appendCacheLog(config, { status: 'uploaded', uploadId, fileName, bytes: stat.size }, options);
    return {
      ...inspected,
      uploadId,
      originalFileName: fileName,
      bytes: stat.size,
      uploadRoot,
    };
  } catch (error) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
    appendCacheLog(config, { status: 'upload-failed', uploadId, fileName, reason: error.message }, options);
    throw error;
  }
}

export async function importUploadedOsImage(config = {}, input = {}, options = {}) {
  const imageOptions = osImageOptions(config, options);
  const uploadId = normalizeUploadId(input.uploadId);
  const sourcePath = resolveUploadedSourcePath(imageOptions, uploadId);
  const uploadDir = resolveUploadDirectory(imageOptions, uploadId);
  try {
    return await importLocalOsImage(config, {
      sourcePath,
      imageIndex: input.imageIndex ?? input.index,
      metadata: input.metadata,
    }, options);
  } finally {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
}

async function runPowerShellJson(script, options = {}) {
  const child = spawn(powershellExe(), preparePowerShellArgs([
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]), {
    windowsHide: true,
    cwd: options.cwd,
  });
  const result = await collectProcessOutput(child);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `PowerShell exited with code ${result.code}`);
  }
  try {
    return JSON.parse(result.stdout || '[]');
  } catch (error) {
    throw new Error(`Unable to parse OS download catalog JSON: ${error.message}`);
  }
}

export async function listOsDownloadCatalog(config = {}, options = {}) {
  const byId = new Map();
  const filters = catalogFilters(options);
  const addOfficialImage = (row) => {
    const image = {
      ...normalizeOsImage({
        ...row,
        sourceType: 'official',
      }),
      sourceType: 'official',
    };
    if (!isMicrosoftDownloadUrl(image.url, config, options)) {
      return;
    }
    if (!byId.has(image.id)) {
      byId.set(image.id, image);
    }
  };
  if (options.catalogRows) {
    for (const row of options.catalogRows) {
      if (String(row.sourceType ?? 'official').trim().toLowerCase() !== 'official') {
        continue;
      }
      addOfficialImage(row);
    }
  } else {
    const script = `
Import-Module OSD -Force
$operatingSystems = @(Get-OSDCloudOperatingSystems)
$indexRows = @()
try {
  $indexRows = @(Get-OSDCloudOperatingSystemsIndexes)
}
catch {
  $indexRows = @()
}
$rows = foreach ($os in $operatingSystems) {
  $matches = @($indexRows | Where-Object {
    ($_.OSName -eq $os.OSName -or $_.Name -eq $os.Name -or -not $_.PSObject.Properties['OSName']) -and
    ($_.OSLanguage -eq $os.OSLanguage -or $_.Language -eq $os.Language -or -not $_.PSObject.Properties['OSLanguage'])
  })
  if ($matches.Count -eq 0) {
    $matches = @([pscustomobject]@{ ImageIndex = 6; OSEdition = 'Pro'; OSEditionId = 'Professional' })
  }
  foreach ($index in $matches) {
    $url = $os.Url
    if (-not $url) { $url = $os.DownloadUrl }
    if (-not $url) { $url = $os.Uri }
    $fileName = $os.FileName
    if (-not $fileName -and $url) {
      try { $fileName = Split-Path ([uri]$url).AbsolutePath -Leaf } catch {}
    }
    [pscustomobject]@{
      id = $null
      name = $os.Name
      version = if ($os.OSName) { $os.OSName } elseif ($os.Name) { $os.Name } else { $os.Version }
      releaseId = $os.ReleaseId
      build = $os.Build
      architecture = if ($os.Architecture) { $os.Architecture } else { 'x64' }
      language = if ($os.OSLanguage) { $os.OSLanguage } elseif ($os.Language) { $os.Language } else { 'zh-tw' }
      edition = if ($index.OSEdition) { $index.OSEdition } elseif ($index.Edition) { $index.Edition } else { 'Pro' }
      editionId = if ($index.OSEditionId) { $index.OSEditionId } elseif ($index.EditionId) { $index.EditionId } else { 'Professional' }
      activation = if ($os.OSActivation) { $os.OSActivation } elseif ($os.Activation) { $os.Activation } else { 'Retail' }
      imageIndex = if ($index.ImageIndex) { $index.ImageIndex } elseif ($index.Index) { $index.Index } else { 6 }
      fileName = $fileName
      size = $os.Size
      sha1 = $os.SHA1
      sha256 = $os.SHA256
      url = $url
    }
  }
}
@($rows | Where-Object { $_.url -and $_.fileName }) | ConvertTo-Json -Depth 6 -Compress
`;
    const rows = await runPowerShellJson(script, { cwd: appRootForConfig(config) });
    const values = Array.isArray(rows) ? rows : [rows];
    for (const row of values) {
      addOfficialImage(row);
    }
  }

  return [...byId.values()].filter((image) => matchesCatalogFilters(image, filters));
}

function upsertCatalogImage(config, image, options = {}) {
  const imageOptions = osImageOptions(config, options);
  const catalog = loadOsImageCatalog(config, options);
  const next = catalog.images.filter((candidate) => candidate.id !== image.id);
  next.push(image);
  next.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  writeJson(imageOptions.catalogPath, {
    ...catalog.raw,
    images: next,
  });
  return imageOptions.catalogPath;
}

export function deleteCachedOsImage(config = {}, imageId, options = {}) {
  const id = normalizeId(imageId, 'OS image');
  const imageOptions = osImageOptions(config, options);
  const state = resolveOsImageState(config, null, options);
  if (state.selectedOs?.id === id) {
    throw new Error(`Cannot delete selected OS image: ${id}`);
  }

  const profileReferences = Array.isArray(options.referencedByProfiles)
    ? options.referencedByProfiles
    : [];
  if (profileReferences.length > 0) {
    const names = profileReferences.map((profile) => profile.name ?? profile.id ?? profile).join(', ');
    throw new Error(`Cannot delete OS image ${id}: referenced by deployment profile ${names}`);
  }

  const catalog = loadOsImageCatalog(config, options);
  const image = catalog.images.find((candidate) => candidate.id === id);
  if (!image) {
    throw new Error(`OS image not found: ${id}`);
  }

  const next = catalog.images.filter((candidate) => candidate.id !== id);
  const filePath = cachedImagePath(imageOptions, image);
  const fileName = image.fileName.toLowerCase();
  const fileStillReferenced = next.some((candidate) => candidate.fileName.toLowerCase() === fileName);
  let bytes = 0;
  let fileDeleted = false;
  if (!fileStillReferenced && fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      bytes = stat.size;
      fs.rmSync(filePath, { force: true });
      fileDeleted = true;
    }
  }

  writeJson(imageOptions.catalogPath, {
    ...catalog.raw,
    images: next,
  });
  appendCacheLog(config, {
    status: 'deleted',
    imageId: image.id,
    fileName: image.fileName,
    fileDeleted,
    bytes,
  }, options);

  return {
    status: 'deleted',
    image,
    catalogPath: imageOptions.catalogPath,
    filePath,
    fileDeleted,
    bytes,
  };
}

function appendCacheLog(config, record, options = {}) {
  const imageOptions = osImageOptions(config, options);
  fs.mkdirSync(imageOptions.cacheRoot, { recursive: true });
  fs.appendFileSync(imageOptions.cacheLogPath, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...record,
  })}\n`, 'utf8');
}

function createProgressTransform(progress) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      progress.bytes += chunk.length;
      progress.onProgress?.({
        status: 'downloading',
        phase: 'downloading-source',
        message: 'Downloading source image...',
        bytes: progress.bytes,
        totalBytes: progress.totalBytes,
        fileName: progress.fileName,
        startedAt: progress.startedAt,
      });
      callback(null, chunk);
    },
  });
}

async function downloadToFile(url, destination, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available for OS image download');
  }
  const requestUrl = assertMicrosoftDownloadUrl(url, options.config, options, 'OS image download URL');
  const response = await fetchImpl(requestUrl);
  if (!response || response.ok !== true) {
    const status = response?.status ? `HTTP ${response.status}` : 'no response';
    throw new Error(`OS image download failed: ${status}`);
  }
  if (response.url) {
    assertMicrosoftDownloadUrl(response.url, options.config, options, 'OS image download redirect URL');
  }

  const totalBytes = Number(response.headers?.get?.('content-length') ?? 0) || null;
  const progress = {
    bytes: 0,
    totalBytes,
    fileName: options.fileName ?? path.basename(destination),
    startedAt: new Date().toISOString(),
    onProgress: options.onProgress,
  };

  if (response.body) {
    await pipeline(
      Readable.fromWeb(response.body),
      createProgressTransform(progress),
      fs.createWriteStream(destination, { flags: 'wx' }),
    );
  } else {
    const body = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destination, body, { flag: 'wx' });
    progress.bytes = body.length;
    progress.onProgress?.({
      status: 'downloading',
      phase: 'downloading-source',
      message: 'Downloading source image...',
      bytes: progress.bytes,
      totalBytes,
      fileName: progress.fileName,
      startedAt: progress.startedAt,
    });
  }
}

function hashFile(filePath, algorithm) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });
}

const sha256File = (filePath) => hashFile(filePath, 'sha256');
const sha1File = (filePath) => hashFile(filePath, 'sha1');

export async function downloadOsImageFromCatalogItem(config = {}, catalogItem, options = {}) {
  const imageOptions = osImageOptions(config, options);
  const sourceImage = normalizeOsImage(catalogItem);
  if (!sourceImage.url) {
    throw new Error(`OS image catalog item has no URL: ${sourceImage.id}`);
  }
  assertMicrosoftDownloadUrl(sourceImage.url, config, options, `OS image catalog item ${sourceImage.id} URL`);
  fs.mkdirSync(imageOptions.cacheRoot, { recursive: true });
  fs.mkdirSync(imageOptions.downloadStagingRoot, { recursive: true });

  const image = exportedImageMetadata(
    sourceImage,
    sourceImage.fileName,
    sourceImage.size,
    sourceImage.sha256,
    path.extname(sourceImage.fileName).replace('.', '') || 'download',
  );
  const destination = cachedImagePath(imageOptions, image);
  if (fs.existsSync(destination) && fs.statSync(destination).size > 0) {
    const existingStat = fs.statSync(destination);
    const cached = {
      ...image,
      size: existingStat.size,
      sha256: await sha256File(destination),
    };
    options.onProgress?.({
      status: 'cache-hit',
      phase: 'cache-hit',
      message: `Cached ${cached.fileName}.`,
      bytes: cached.size,
      totalBytes: cached.size,
      fileName: cached.fileName,
      imageId: cached.id,
    });
    upsertCatalogImage(config, cached, options);
    appendCacheLog(config, { status: 'cache-hit', imageId: cached.id, fileName: cached.fileName, bytes: cached.size }, options);
    return { status: 'cache-hit', image: cached, filePath: destination, bytes: cached.size };
  }

  const jobId = `${sourceImage.id}-${Date.now()}`.replace(/[^A-Za-z0-9._-]/gu, '_');
  const sourceStagingPath = assertInside(imageOptions.downloadStagingRoot, path.join(imageOptions.downloadStagingRoot, `${jobId}.source`), 'OS image download staging path');
  const exportStagingPath = assertInside(imageOptions.downloadStagingRoot, path.join(imageOptions.downloadStagingRoot, `${jobId}.wim`), 'OS image export staging path');

  try {
    await downloadToFile(sourceImage.url, sourceStagingPath, {
      config,
      fetchImpl: options.fetchImpl,
      fileName: sourceImage.fileName,
      microsoftDownloadHosts: options.microsoftDownloadHosts,
      onProgress: options.onProgress,
    });
    const stat = fs.statSync(sourceStagingPath);
    options.onProgress?.({
      status: 'downloading',
      phase: 'download-complete',
      message: 'Download complete; preparing image...',
      bytes: stat.size,
      totalBytes: sourceImage.size || stat.size,
      fileName: sourceImage.fileName,
    });
    options.onProgress?.({
      status: 'downloading',
      phase: 'verifying-source',
      message: 'Verifying source image...',
      bytes: stat.size,
      totalBytes: sourceImage.size || stat.size,
      fileName: sourceImage.fileName,
    });
    if (stat.size <= 0) {
      throw new Error('OS image download produced an empty file');
    }
    if (sourceImage.size && stat.size !== sourceImage.size) {
      throw new Error(`OS image download size mismatch: ${stat.size} expected ${sourceImage.size}`);
    }
    let sourceSha256 = '';
    if (sourceImage.sha256) {
      sourceSha256 = await sha256File(sourceStagingPath);
      if (sourceSha256 !== sourceImage.sha256) {
        throw new Error(`OS image SHA256 mismatch: ${sourceSha256} expected ${sourceImage.sha256}`);
      }
    } else if (sourceImage.sha1) {
      const actual = await sha1File(sourceStagingPath);
      if (actual !== sourceImage.sha1) {
        throw new Error(`OS image SHA1 mismatch: ${actual} expected ${sourceImage.sha1}`);
      }
    }
    if (options.validateImage !== false) {
      options.onProgress?.({
        status: 'downloading',
        phase: 'inspecting-source',
        message: 'Inspecting source image with DISM...',
        bytes: stat.size,
        totalBytes: sourceImage.size || stat.size,
        fileName: sourceImage.fileName,
      });
      await validateImageIndex(sourceStagingPath, sourceImage.imageIndex, options);
    }

    options.onProgress?.({
      status: 'downloading',
      phase: 'exporting-wim',
      message: 'Exporting deployable WIM with DISM. This can take several minutes.',
      bytes: stat.size,
      totalBytes: sourceImage.size || stat.size,
      fileName: image.fileName,
    });
    await exportImageToWim(sourceStagingPath, exportStagingPath, sourceImage.imageIndex, options);
    const exportStat = fs.statSync(exportStagingPath);
    options.onProgress?.({
      status: 'downloading',
      phase: 'verifying-wim',
      message: 'Verifying exported deployable WIM...',
      bytes: exportStat.size,
      totalBytes: exportStat.size,
      fileName: image.fileName,
    });
    if (exportStat.size <= 0) {
      throw new Error('OS image export produced an empty WIM');
    }
    if (options.validateImage !== false) {
      await validateImageIndex(exportStagingPath, 1, options);
    }
    const finalImage = {
      ...image,
      size: exportStat.size,
      sha256: await sha256File(exportStagingPath),
      sourceSize: stat.size,
      sourceSha256: sourceSha256 || sourceImage.sha256,
    };
    options.onProgress?.({
      status: 'downloading',
      phase: 'caching',
      message: 'Caching deployable WIM...',
      bytes: finalImage.size,
      totalBytes: finalImage.size,
      fileName: finalImage.fileName,
      imageId: finalImage.id,
    });
    fs.renameSync(exportStagingPath, destination);
    upsertCatalogImage(config, finalImage, options);
    appendCacheLog(config, { status: 'downloaded', imageId: finalImage.id, fileName: finalImage.fileName, bytes: finalImage.size }, options);
    return { status: 'downloaded', image: finalImage, filePath: destination, bytes: finalImage.size };
  } catch (error) {
    appendCacheLog(config, { status: 'failed', imageId: sourceImage.id, fileName: sourceImage.fileName, reason: error.message }, options);
    throw error;
  } finally {
    for (const stagingPath of [sourceStagingPath, exportStagingPath]) {
      if (fs.existsSync(stagingPath)) {
        fs.rmSync(stagingPath, { force: true });
      }
    }
  }
}

export async function downloadOsImageFromCatalog(config = {}, catalogId, options = {}) {
  const id = normalizeId(catalogId, 'OS download catalog');
  const catalog = await listOsDownloadCatalog(config, options);
  const item = catalog.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`OS download catalog item not found: ${id}`);
  }
  return downloadOsImageFromCatalogItem(config, item, options);
}
