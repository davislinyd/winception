import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  handleDriverPackCacheRequest,
  normalizeDriverPackCacheConfig,
  summarizeDriverPackCache,
  validateDriverPackCacheEntry,
} from '../src/driverPackCache.js';

function readManifest(root) {
  const manifestPath = path.join(root, 'driverpack-cache.jsonl');
  return fs.readFileSync(manifestPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function eventWithDriverPack(driverPack) {
  return {
    stage: 'windows-driverpack-cache-request',
    runId: 'run-one',
    clientId: 'client-one',
    computerName: 'DESKTOP-TEST',
    driverPacks: [driverPack],
  };
}

test('validates driver pack cache request filenames and hosts', () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'driverpack-cache-validate-'));
  const cacheConfig = normalizeDriverPackCacheConfig({
    driverPackCache: {
      enabled: true,
      root: cacheRoot,
      allowedHosts: ['downloads.dell.com'],
    },
  });

  try {
    const valid = validateDriverPackCacheEntry({
      fileName: 'PA14250-YWNJX_Win11_1.0_A06.exe',
      url: 'https://downloads.dell.com/FOLDER/PA14250-YWNJX_Win11_1.0_A06.exe',
    }, cacheConfig);
    assert.equal(valid.fileName, 'PA14250-YWNJX_Win11_1.0_A06.exe');

    assert.throws(() => validateDriverPackCacheEntry({
      fileName: '..\\evil.exe',
      url: 'https://downloads.dell.com/FOLDER/evil.exe',
    }, cacheConfig), /plain file name/);

    assert.throws(() => validateDriverPackCacheEntry({
      fileName: 'driver.iso',
      url: 'https://downloads.dell.com/FOLDER/driver.iso',
    }, cacheConfig), /extension/);

    assert.throws(() => validateDriverPackCacheEntry({
      fileName: 'driver.exe',
      url: 'https://example.com/driver.exe',
    }, cacheConfig), /host is not allowed/);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('records cache hits without downloading', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'driverpack-cache-hit-'));
  const fileName = 'PA14250-YWNJX_Win11_1.0_A06.exe';
  fs.writeFileSync(path.join(cacheRoot, fileName), 'cached');

  try {
    const result = await handleDriverPackCacheRequest(eventWithDriverPack({
      fileName,
      url: 'https://downloads.dell.com/FOLDER/PA14250-YWNJX_Win11_1.0_A06.exe',
    }), {
      driverPackCache: {
        enabled: true,
        root: cacheRoot,
        allowedHosts: ['downloads.dell.com'],
      },
    }, {
      fetchImpl: async () => {
        throw new Error('fetch should not be called');
      },
    });

    assert.equal(result.results[0].status, 'cache-hit');
    assert.equal(result.results[0].bytes, 6);
    assert.equal(readManifest(cacheRoot)[0].status, 'cache-hit');
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('downloads missing driver packs and writes manifest metadata', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'driverpack-cache-download-'));
  const fileName = 'PA14250-YWNJX_Win11_1.0_A06.exe';

  try {
    const result = await handleDriverPackCacheRequest(eventWithDriverPack({
      manufacturer: 'Dell',
      model: 'Dell Pro 14 Premium',
      product: ['0CE4'],
      name: 'Dell Pro 14 Premium Windows 11 Driver Pack',
      packageId: 'YWNJX',
      fileName,
      url: 'https://downloads.dell.com/FOLDER/PA14250-YWNJX_Win11_1.0_A06.exe',
    }), {
      driverPackCache: {
        enabled: true,
        root: cacheRoot,
        allowedHosts: ['downloads.dell.com'],
      },
    }, {
      fetchImpl: async () => new Response('driver-data'),
    });

    assert.equal(result.results[0].status, 'downloaded');
    assert.equal(fs.readFileSync(path.join(cacheRoot, fileName), 'utf8'), 'driver-data');
    const manifest = readManifest(cacheRoot)[0];
    assert.equal(manifest.status, 'downloaded');
    assert.equal(manifest.packageId, 'YWNJX');
    assert.equal(manifest.bytes, 11);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('summarizes cached driver packs by manufacturer and model', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'driverpack-cache-summary-'));
  const fileName = 'PA14250-YWNJX_Win11_1.0_A06.exe';

  try {
    await handleDriverPackCacheRequest(eventWithDriverPack({
      manufacturer: 'Dell',
      model: 'Dell Pro 14 Premium',
      product: '0CE4',
      name: 'Dell Pro 14 Premium Windows 11 Driver Pack',
      packageId: 'YWNJX',
      fileName,
      url: 'https://downloads.dell.com/FOLDER/PA14250-YWNJX_Win11_1.0_A06.exe',
    }), {
      driverPackCache: {
        enabled: true,
        root: cacheRoot,
        allowedHosts: ['downloads.dell.com'],
      },
    }, {
      fetchImpl: async () => new Response('driver-data'),
    });

    const summary = summarizeDriverPackCache({
      driverPackCache: {
        enabled: true,
        root: cacheRoot,
        allowedHosts: ['downloads.dell.com'],
      },
    });

    assert.equal(summary.enabled, true);
    assert.equal(summary.entries.length, 1);
    assert.equal(summary.entries[0].manufacturer, 'Dell');
    assert.equal(summary.entries[0].model, 'Dell Pro 14 Premium');
    assert.equal(summary.entries[0].exists, true);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('records rejected and failed driver pack cache requests without throwing', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'driverpack-cache-fail-'));

  try {
    const rejected = await handleDriverPackCacheRequest(eventWithDriverPack({
      fileName: 'driver.exe',
      url: 'https://example.com/driver.exe',
    }), {
      driverPackCache: {
        enabled: true,
        root: cacheRoot,
        allowedHosts: ['downloads.dell.com'],
      },
    });
    assert.equal(rejected.results[0].status, 'rejected');

    const failed = await handleDriverPackCacheRequest(eventWithDriverPack({
      fileName: 'driver.exe',
      url: 'https://downloads.dell.com/FOLDER/driver.exe',
    }), {
      driverPackCache: {
        enabled: true,
        root: cacheRoot,
        allowedHosts: ['downloads.dell.com'],
      },
    }, {
      fetchImpl: async () => new Response('not found', { status: 404 }),
    });
    assert.equal(failed.results[0].status, 'failed');

    const manifest = readManifest(cacheRoot);
    assert.deepEqual(manifest.map((record) => record.status), ['rejected', 'failed']);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});
