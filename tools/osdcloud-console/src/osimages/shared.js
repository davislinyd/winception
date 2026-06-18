import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeAllowedHosts, osImageOptions } from './catalog.js';

export const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const selectedOsFileName = 'selected-os.json';
export const osImageCacheLogFileName = 'os-image-cache.jsonl';

export const defaultActiveImage = null;
export const defaultCacheRoot = 'C:\\OSDCloud\\Media\\OSDCloud\\OS';
export const defaultDownloadStagingRoot = 'C:\\OSDCloud\\Media\\OSDCloud\\OS\\.downloads';
export const defaultDownloadSourcesPath = 'config\\os-download-sources.json';
export const defaultUploadMaxBytes = 16 * 1024 * 1024 * 1024;
export const allowedExtensions = new Set(['.esd', '.wim']);
export const allowedImportExtensions = new Set(['.iso', '.esd', '.wim']);
export const defaultMicrosoftDownloadHosts = [
  'dl.delivery.mp.microsoft.com',
  'download.microsoft.com',
  'software.download.prss.microsoft.com',
];
export const requiredCustomSourceFields = [
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

export function powershellExe() {
  return process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
}

export function isSafeId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(String(value ?? ''));
}

export function normalizeId(value, label) {
  const id = String(value ?? '').trim();
  if (!isSafeId(id)) {
    throw new Error(`Invalid ${label} id: ${value}`);
  }
  return id;
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

export function readJson(filePath, label, fallback = null) {
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

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function arrayFrom(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

export function firstValue(source, names, fallback = undefined) {
  for (const name of names) {
    const value = source?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return fallback;
}

export function cleanFileName(value, label = 'OS image fileName') {
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

export function cleanImportFileName(value, label = 'OS import fileName') {
  const fileName = cleanFileName(value, label);
  if (fileName.toLowerCase() === selectedOsFileName) {
    throw new Error(`${label} cannot be ${selectedOsFileName}`);
  }
  return fileName;
}

export function cleanWimFileName(value, label = 'OS image WIM fileName') {
  const fileName = cleanImportFileName(value, label);
  if (path.extname(fileName).toLowerCase() !== '.wim') {
    throw new Error(`${label} must end with .wim: ${fileName}`);
  }
  return fileName;
}

export function cleanUploadFileName(value, label = 'OS upload fileName') {
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

export function normalizeNumber(value, label, options = {}) {
  if (value === undefined || value === null || value === '') {
    return options.optional ? null : undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < (options.min ?? 0)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return number;
}

export function normalizeLanguage(value) {
  const language = String(value ?? '').trim();
  return language ? language.toLowerCase() : 'zh-tw';
}

export function defaultLocale(language) {
  return normalizeLanguage(language).toLowerCase() === 'zh-tw' ? 'zh-TW' : String(language || '').trim();
}

export function defaultTimeZone() {
  return '';
}

export function defaultEditionId(edition) {
  const value = String(edition ?? '').trim().toLowerCase();
  if (value === 'pro' || value === 'professional') {
    return 'Professional';
  }
  return edition ? String(edition) : 'Professional';
}

export function stableCatalogId(row) {
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

export function normalizeHash(value) {
  const hash = String(value ?? '').trim();
  return hash ? hash.toUpperCase() : '';
}

export function normalizeUrl(value) {
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

export function urlHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function microsoftDownloadHosts(config = {}, options = {}) {
  return normalizeAllowedHosts(
    options.microsoftDownloadHosts
      ?? config.osImage?.microsoftDownloadHosts
      ?? defaultMicrosoftDownloadHosts,
  );
}

export function isMicrosoftDownloadUrl(url, config = {}, options = {}) {
  const normalized = normalizeUrl(url);
  return microsoftDownloadHosts(config, options).includes(urlHost(normalized));
}

export function assertMicrosoftDownloadUrl(url, config = {}, options = {}, label = 'OS image URL') {
  const normalized = normalizeUrl(url);
  const host = urlHost(normalized);
  if (!microsoftDownloadHosts(config, options).includes(host)) {
    throw new Error(`${label} host is not an allowed Microsoft download host: ${host || url}`);
  }
  return normalized;
}

export function fileNameFromUrl(url) {
  if (!url) {
    return '';
  }
  const parsed = new URL(url);
  const candidate = path.basename(decodeURIComponent(parsed.pathname));
  return candidate || '';
}

export function hasRequiredField(row, names) {
  return String(firstValue(row, names, '') ?? '').trim() !== '';
}
export function appendCacheLog(config, record, options = {}) {
  const imageOptions = osImageOptions(config, options);
  fs.mkdirSync(imageOptions.cacheRoot, { recursive: true });
  fs.appendFileSync(imageOptions.cacheLogPath, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...record,
  })}\n`, 'utf8');
}

export function hashFile(filePath, algorithm) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });
}

export const sha256File = (filePath) => hashFile(filePath, 'sha256');
export const sha1File = (filePath) => hashFile(filePath, 'sha1');
