import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const driverPackCacheStage = 'windows-driverpack-cache-request';

const defaultAllowedHosts = ['downloads.dell.com'];
const allowedExtensions = new Set(['.exe', '.cab', '.zip', '.msi']);

function toLowerStringArray(value, fallback) {
  const source = Array.isArray(value) && value.length > 0 ? value : fallback;
  return source
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeDriverPackCacheConfig(config = {}) {
  const cacheConfig = config.driverPackCache || {};
  const enabled = cacheConfig.enabled === true;
  const root = cacheConfig.root ? path.resolve(cacheConfig.root) : null;
  const allowedHosts = new Set(toLowerStringArray(cacheConfig.allowedHosts, defaultAllowedHosts));

  return {
    enabled,
    root,
    allowedHosts,
    manifestPath: root ? path.join(root, 'driverpack-cache.jsonl') : null,
  };
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function firstMetadataValue(entry, names) {
  for (const name of names) {
    const value = entry?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return undefined;
}

function copyMetadata(entry) {
  return {
    manufacturer: firstMetadataValue(entry, ['manufacturer', 'Manufacturer']),
    model: firstMetadataValue(entry, ['model', 'Model']),
    product: firstMetadataValue(entry, ['product', 'Product']),
    name: firstMetadataValue(entry, ['name', 'Name']),
    packageId: firstMetadataValue(entry, ['packageId', 'PackageID', 'PackageId']),
  };
}

export function validateDriverPackCacheEntry(entry, cacheConfig) {
  if (!cacheConfig.enabled) {
    throw new Error('driver pack cache is disabled');
  }

  if (!cacheConfig.root) {
    throw new Error('driver pack cache root is not configured');
  }

  const fileName = String(firstMetadataValue(entry, ['fileName', 'FileName']) || '').trim();
  if (!fileName) {
    throw new Error('driver pack fileName is required');
  }

  if (
    fileName !== path.basename(fileName)
    || fileName.includes('/')
    || fileName.includes('\\')
    || fileName.includes('..')
  ) {
    throw new Error(`driver pack fileName is not a plain file name: ${fileName}`);
  }

  const extension = path.extname(fileName).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    throw new Error(`driver pack extension is not allowed: ${extension || '<none>'}`);
  }

  const urlText = String(firstMetadataValue(entry, ['url', 'Url', 'URL']) || '').trim();
  if (!urlText) {
    throw new Error('driver pack url is required');
  }

  let url;
  try {
    url = new URL(urlText);
  } catch {
    throw new Error(`driver pack url is invalid: ${urlText}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`driver pack url protocol is not allowed: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  if (!cacheConfig.allowedHosts.has(host)) {
    throw new Error(`driver pack url host is not allowed: ${host}`);
  }

  const destination = path.resolve(cacheConfig.root, fileName);
  if (!isPathInside(cacheConfig.root, destination)) {
    throw new Error('driver pack destination escapes cache root');
  }

  return {
    fileName,
    url: url.toString(),
    destination,
    metadata: copyMetadata(entry),
  };
}

function manifestRecord(event, validated, status, extra = {}) {
  const source = validated || {};
  const metadata = source.metadata || copyMetadata(extra.entry || {});

  return {
    timestamp: new Date().toISOString(),
    status,
    runId: event?.runId,
    clientId: event?.clientId,
    computerName: event?.computerName,
    manufacturer: metadata.manufacturer,
    model: metadata.model,
    product: metadata.product,
    name: metadata.name,
    packageId: metadata.packageId,
    fileName: source.fileName || firstMetadataValue(extra.entry, ['fileName', 'FileName']),
    url: source.url || firstMetadataValue(extra.entry, ['url', 'Url', 'URL']),
    bytes: extra.bytes,
    reason: extra.reason,
  };
}

function appendManifest(cacheConfig, record) {
  fs.mkdirSync(cacheConfig.root, { recursive: true });
  fs.appendFileSync(cacheConfig.manifestPath, `${JSON.stringify(record)}\n`, 'utf8');
}

async function downloadDriverPack(url, destination, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available for driver pack download');
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const tempPath = `${destination}.${process.pid}.${Date.now()}.download`;
  try {
    const response = await fetchImpl(url);
    if (!response || response.ok !== true) {
      const status = response?.status ? `HTTP ${response.status}` : 'no response';
      throw new Error(`driver pack download failed: ${status}`);
    }

    if (response.body) {
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempPath, { flags: 'wx' }));
    } else {
      const body = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(tempPath, body, { flag: 'wx' });
    }

    const tempStat = fs.statSync(tempPath);
    if (tempStat.size <= 0) {
      throw new Error('driver pack download produced an empty file');
    }

    if (fs.existsSync(destination)) {
      fs.rmSync(tempPath, { force: true });
      return {
        status: 'cache-hit',
        bytes: fs.statSync(destination).size,
      };
    }

    fs.renameSync(tempPath, destination);
    return {
      status: 'downloaded',
      bytes: tempStat.size,
    };
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
  }
}

export async function handleDriverPackCacheRequest(event, config = {}, options = {}) {
  if (!event || event.stage !== driverPackCacheStage) {
    return null;
  }

  const cacheConfig = normalizeDriverPackCacheConfig(config);
  const log = options.log || (() => {});

  if (!cacheConfig.enabled) {
    log('Driver pack cache request ignored because cache is disabled.');
    return { status: 'disabled', results: [] };
  }

  if (!cacheConfig.root) {
    log('Driver pack cache request ignored because cache root is not configured.');
    return { status: 'misconfigured', results: [] };
  }

  const driverPacks = Array.isArray(event.driverPacks) ? event.driverPacks : [];
  if (driverPacks.length === 0) {
    log('Driver pack cache request contained no driverPacks entries.');
    return { status: 'empty', results: [] };
  }

  fs.mkdirSync(cacheConfig.root, { recursive: true });

  const results = [];
  for (const entry of driverPacks) {
    let validated;
    try {
      validated = validateDriverPackCacheEntry(entry, cacheConfig);

      if (fs.existsSync(validated.destination)) {
        const stat = fs.statSync(validated.destination);
        if (stat.size > 0) {
          const record = manifestRecord(event, validated, 'cache-hit', { bytes: stat.size });
          appendManifest(cacheConfig, record);
          results.push(record);
          log(`Driver pack cache hit: ${validated.fileName}`);
          continue;
        }
      }

      const downloadResult = await downloadDriverPack(validated.url, validated.destination, {
        fetchImpl: options.fetchImpl,
      });
      const record = manifestRecord(event, validated, downloadResult.status, {
        bytes: downloadResult.bytes,
      });
      appendManifest(cacheConfig, record);
      results.push(record);
      log(`Driver pack cache ${downloadResult.status}: ${validated.fileName}`);
    } catch (error) {
      const status = validated ? 'failed' : 'rejected';
      const record = manifestRecord(event, validated, status, {
        entry,
        reason: error instanceof Error ? error.message : String(error),
      });
      appendManifest(cacheConfig, record);
      results.push(record);
      log(`Driver pack cache ${status}: ${record.fileName || '<unknown>'}: ${record.reason}`);
    }
  }

  return {
    status: 'processed',
    results,
  };
}
