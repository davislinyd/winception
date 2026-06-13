import fs from 'node:fs';
import path from 'node:path';
import { appRootForConfig, stateRootForConfig } from '../config.js';
import { validateImageIndex } from './inspect.js';
import { allowedExtensions, arrayFrom, assertInside, cleanFileName, defaultActiveImage, defaultCacheRoot, defaultDownloadSourcesPath, defaultDownloadStagingRoot, defaultEditionId, defaultLocale, defaultTimeZone, defaultUploadMaxBytes, fileNameFromUrl, firstValue, hasRequiredField, normalizeHash, normalizeId, normalizeLanguage, normalizeNumber, normalizeUrl, osImageCacheLogFileName, readJson, requiredCustomSourceFields, resolveConfiguredPath, selectedOsFileName, stableCatalogId, urlHost, writeJson } from './shared.js';

export function inferOsFamily(row = {}) {
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

export function filterSet(options, name, normalizer = (value) => String(value).trim()) {
  const raw = options.filters?.[name] ?? options[name] ?? [];
  const values = Array.isArray(raw) ? raw : String(raw).split(',');
  return new Set(values
    .map((value) => normalizer(value))
    .filter(Boolean));
}

export function catalogFilters(options = {}) {
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

export function matchesFilter(set, value, normalizer = (input) => String(input).trim()) {
  return set.size === 0 || set.has(normalizer(value));
}

export function matchesCatalogFilters(image, filters) {
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

export function normalizeAllowedHosts(value) {
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

export function cachedImagePath(options, image) {
  return assertInside(options.cacheRoot, path.join(options.cacheRoot, image.fileName), `OS image ${image.id}`);
}

export function annotateCachedImage(options, image) {
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

export function selectedOsManifest(image, filePath) {
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

export function pass(name, detail = '') {
  return { name, ok: true, detail };
}

export function fail(name, detail = '') {
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

export function upsertCatalogImage(config, image, options = {}) {
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
