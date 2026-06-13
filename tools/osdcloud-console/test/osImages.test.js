import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateOsImageCache, loadOsImageCatalog, osImageOptions, publishSelectedOsImage, resolveOsImageState, scanCachedOsImages } from '../src/osimages/catalog.js';
import { downloadOsImageFromCatalogItem, listOsDownloadCatalog } from '../src/osimages/download.js';
import { inspectLocalOsImage } from '../src/osimages/inspect.js';
import { deleteCachedOsImage } from '../src/osimages/maintenance.js';
import { importLocalOsImage, importUploadedOsImage, uploadOsImageFile } from '../src/osimages/transfer.js';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeConfig(root) {
  const cacheRoot = path.join(root, 'OS');
  const catalogPath = path.join(root, 'os-image-catalog.json');
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(path.join(cacheRoot, 'install.wim'), 'install image', 'utf8');
  writeJson(catalogPath, {
    images: [{
      id: 'SMOKE-WIN11-PRO',
      name: 'Smoke Windows 11 Pro',
      version: 'Windows 11 Smoke',
      language: 'en-us',
      locale: 'en-US',
      timeZone: 'UTC',
      edition: 'Pro',
      editionId: 'Professional',
      activation: 'Retail',
      imageIndex: 1,
      fileName: 'install.wim',
      size: 'install image'.length,
      sourceFileName: 'install.esd',
      sourceImageIndex: 6,
      sourceType: 'exported-wim',
    }],
  });

  return {
    paths: {
      repoRoot: root,
      imageNamePattern: 'install.wim',
    },
    smb: {
      share: '\\\\10.10.10.1\\OSDCloudiPXE',
      imagePath: '\\\\10.10.10.1\\OSDCloudiPXE\\OSDCloud\\OS\\install.wim',
    },
    osImage: {
      activeImage: 'SMOKE-WIN11-PRO',
      catalogPath,
      cacheRoot,
      downloadStagingRoot: path.join(cacheRoot, '.downloads'),
      validateDismOnPreflight: false,
      validateDismOnPublish: false,
    },
  };
}

test('resolves mutable OS image metadata paths from state root', () => {
  const appRoot = path.join(os.tmpdir(), 'osdcloud-images-app-root');
  const stateRoot = path.join(os.tmpdir(), 'osdcloud-images-state-root');
  const options = osImageOptions({
    paths: {
      appRoot,
      stateRoot,
    },
    osImage: {
      catalogPath: 'config\\os-image-catalog.json',
      downloadSourcesPath: 'config\\os-download-sources.json',
      downloadStagingRoot: '.downloads\\os-images',
    },
  });

  assert.equal(options.catalogPath, path.resolve(stateRoot, 'config\\os-image-catalog.json'));
  assert.equal(options.downloadSourcesPath, path.resolve(stateRoot, 'config\\os-download-sources.json'));
  assert.equal(options.downloadStagingRoot, path.resolve(stateRoot, '.downloads\\os-images'));
  assert.equal(options.appRoot, path.resolve(appRoot));
  assert.equal(options.stateRoot, path.resolve(stateRoot));
});

test('OS image catalog loads and cached files are scanned', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-osimages-load-'));
  try {
    const config = makeConfig(root);
    const catalog = loadOsImageCatalog(config);
    assert.equal(catalog.images[0].id, 'SMOKE-WIN11-PRO');
    assert.equal(catalog.images[0].imageIndex, 1);

    const scanned = scanCachedOsImages(config);
    assert.equal(scanned[0].fileName, 'install.wim');

    const state = resolveOsImageState(config);
    assert.equal(state.activeImage.cached, true);
    assert.equal(state.activeImage.sizeMatches, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('selected-os manifest publish updates config and passes preflight', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-osimages-publish-'));
  try {
    const config = makeConfig(root);
    const result = await publishSelectedOsImage(config, 'SMOKE-WIN11-PRO');
    assert.equal(result.image.id, 'SMOKE-WIN11-PRO');
    assert.equal(config.osImage.activeImage, 'SMOKE-WIN11-PRO');
    assert.equal(config.paths.imageNamePattern, 'install.wim');
    assert.equal(config.smb.imagePath, '\\\\10.10.10.1\\OSDCloudiPXE\\OSDCloud\\OS\\install.wim');

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    assert.equal(manifest.imagePath, 'Z:\\OSDCloud\\OS\\install.wim');
    assert.equal(manifest.imageIndex, 1);
    assert.equal(manifest.sourceFileName, 'install.esd');
    assert.equal(manifest.sourceImageIndex, 6);
    assert.equal(manifest.language, 'en-us');

    const check = await evaluateOsImageCache(config);
    assert.equal(check.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS image preflight reports missing cache and stale manifest', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-osimages-pref-'));
  try {
    const config = makeConfig(root);
    await publishSelectedOsImage(config, 'SMOKE-WIN11-PRO');
    writeJson(path.join(config.osImage.cacheRoot, 'selected-os.json'), {
      id: 'STALE',
      fileName: 'other.wim',
      imageIndex: 1,
    });
    let check = await evaluateOsImageCache(config);
    assert.equal(check.ok, false);
    assert.match(check.detail, /stale/);

    writeJson(path.join(config.osImage.cacheRoot, 'selected-os.json'), {
      id: 'SMOKE-WIN11-PRO',
      fileName: 'install.wim',
      imageIndex: 1,
    });
    fs.rmSync(path.join(config.osImage.cacheRoot, 'install.wim'), { force: true });
    check = await evaluateOsImageCache(config);
    assert.equal(check.ok, false);
    assert.match(check.detail, /cached file missing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS image download uses staging and does not overwrite cached files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-osimages-download-'));
  try {
    const config = makeConfig(root);
    let fetchCalled = false;
    const cacheHit = await downloadOsImageFromCatalogItem(config, {
      id: 'SMOKE-WIN11-PRO',
      name: 'Smoke Windows 11 Pro',
      version: 'Windows 11 Smoke',
      language: 'en-us',
      edition: 'Pro',
      imageIndex: 6,
      fileName: 'install.esd',
      url: 'https://dl.delivery.mp.microsoft.com/install.esd',
    }, {
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error('should not fetch existing cache');
      },
      validateImage: false,
    });
    assert.equal(cacheHit.status, 'cache-hit');
    assert.equal(fetchCalled, false);
    assert.equal(fs.readFileSync(path.join(config.osImage.cacheRoot, 'install.wim'), 'utf8'), 'install image');

    const body = Buffer.from('downloaded source image');
    const progressEvents = [];
    const downloaded = await downloadOsImageFromCatalogItem(config, {
      id: 'SMOKE-DOWNLOAD-PRO',
      name: 'Smoke Download Pro',
      version: 'Windows 11 Smoke',
      language: 'en-us',
      edition: 'Pro',
      imageIndex: 6,
      fileName: 'download.esd',
      size: body.length,
      url: 'https://dl.delivery.mp.microsoft.com/download.esd',
    }, {
      fetchImpl: async () => ({
        ok: true,
        url: 'https://download.microsoft.com/download.esd',
        headers: { get: () => String(body.length) },
        arrayBuffer: async () => body,
      }),
      exportImageToWim: async (source, destination) => {
        fs.writeFileSync(destination, `${fs.readFileSync(source, 'utf8')} exported`, 'utf8');
      },
      onProgress: (progress) => progressEvents.push(progress),
      validateImage: false,
    });
    assert.equal(downloaded.status, 'downloaded');
    assert.equal(downloaded.image.fileName, 'download.wim');
    assert.equal(downloaded.image.imageIndex, 1);
    assert.equal(downloaded.image.sourceImageIndex, 6);
    assert.equal(fs.readFileSync(path.join(config.osImage.cacheRoot, 'download.wim'), 'utf8'), 'downloaded source image exported');
    assert.deepEqual(fs.readdirSync(config.osImage.downloadStagingRoot), []);
    const sourcesDir = path.join(config.osImage.cacheRoot, 'sources');
    assert.equal(fs.existsSync(sourcesDir), true);
    assert.equal(fs.existsSync(path.join(sourcesDir, 'download.esd')), true);
    assert.equal(fs.readFileSync(path.join(sourcesDir, 'download.esd'), 'utf8'), 'downloaded source image');
    assert.match(fs.readFileSync(path.join(config.osImage.cacheRoot, 'os-image-cache.jsonl'), 'utf8'), /SMOKE-DOWNLOAD-PRO/);
    assert.deepEqual(progressEvents.map((event) => event.phase), [
      'downloading-source',
      'download-complete',
      'verifying-source',
      'exporting-wim',
      'verifying-wim',
      'caching',
    ]);
    assert.equal(progressEvents.find((event) => event.phase === 'exporting-wim').message, 'Exporting deployable WIM with DISM. This can take several minutes.');

    await assert.rejects(() => downloadOsImageFromCatalogItem(config, {
      id: 'BAD-HOST',
      name: 'Bad Host',
      version: 'Windows 11',
      language: 'en-us',
      edition: 'Pro',
      imageIndex: 6,
      fileName: 'bad.esd',
      url: 'https://example.test/bad.esd',
    }, { validateImage: false }), /allowed Microsoft download host/);

    await assert.rejects(() => downloadOsImageFromCatalogItem(config, {
      id: 'BAD-REDIRECT',
      name: 'Bad Redirect',
      version: 'Windows 11',
      language: 'en-us',
      edition: 'Pro',
      imageIndex: 6,
      fileName: 'redirect.esd',
      url: 'https://dl.delivery.mp.microsoft.com/redirect.esd',
    }, {
      fetchImpl: async () => ({
        ok: true,
        url: 'https://example.test/redirect.esd',
        headers: { get: () => '1' },
        arrayBuffer: async () => Buffer.from('x'),
      }),
      validateImage: false,
    }), /redirect URL host is not an allowed Microsoft download host/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS image delete removes non-active cache entries safely', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-osimages-delete-'));
  try {
    const config = makeConfig(root);
    fs.writeFileSync(path.join(config.osImage.cacheRoot, 'download.wim'), 'download image', 'utf8');
    fs.writeFileSync(path.join(config.osImage.cacheRoot, 'shared.wim'), 'shared image', 'utf8');
    writeJson(config.osImage.catalogPath, {
      images: [
        {
          id: 'SMOKE-WIN11-PRO',
          name: 'Smoke Windows 11 Pro',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 1,
          fileName: 'install.wim',
          size: 'install image'.length,
        },
        {
          id: 'SMOKE-DOWNLOAD-PRO',
          name: 'Smoke Download Pro',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 1,
          fileName: 'download.wim',
          size: 'download image'.length,
        },
        {
          id: 'SHARED-ONE',
          name: 'Shared one',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 1,
          fileName: 'shared.wim',
          size: 'shared image'.length,
        },
        {
          id: 'SHARED-TWO',
          name: 'Shared two',
          version: 'Windows 11 Smoke',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 1,
          fileName: 'shared.wim',
          size: 'shared image'.length,
        },
      ],
    });

    const shared = deleteCachedOsImage(config, 'SHARED-ONE');
    assert.equal(shared.status, 'deleted');
    assert.equal(shared.fileDeleted, false);
    assert.equal(fs.existsSync(path.join(config.osImage.cacheRoot, 'shared.wim')), true);
    assert.equal(loadOsImageCatalog(config).images.some((image) => image.id === 'SHARED-ONE'), false);

    const deleted = deleteCachedOsImage(config, 'SMOKE-DOWNLOAD-PRO');
    assert.equal(deleted.status, 'deleted');
    assert.equal(deleted.fileDeleted, true);
    assert.equal(fs.existsSync(path.join(config.osImage.cacheRoot, 'download.wim')), false);
    assert.equal(loadOsImageCatalog(config).images.some((image) => image.id === 'SMOKE-DOWNLOAD-PRO'), false);
    assert.equal(fs.existsSync(path.join(config.osImage.cacheRoot, 'install.wim')), true);
    assert.match(fs.readFileSync(path.join(config.osImage.cacheRoot, 'os-image-cache.jsonl'), 'utf8'), /"status":"deleted"/);

    await publishSelectedOsImage(config, 'SMOKE-WIN11-PRO');
    assert.throws(() => deleteCachedOsImage(config, 'SMOKE-WIN11-PRO'), /Cannot delete selected OS image/);
    assert.throws(
      () => deleteCachedOsImage(config, 'SHARED-TWO', {
        referencedByProfiles: [{ id: 'demo', name: 'Demo' }],
      }),
      /referenced by deployment profile Demo/,
    );
    assert.throws(() => deleteCachedOsImage(config, 'MISSING'), /OS image not found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS download catalog deduplicates repeated OSD module rows', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-osimages-catalog-'));
  try {
    const rows = await listOsDownloadCatalog({ paths: { repoRoot: root } }, {
      catalogRows: [
        {
          id: 'DUPLICATE-WIN11-PRO',
          name: 'Duplicate Windows 11 Pro',
          version: 'Windows 11',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 6,
          fileName: 'duplicate.esd',
          url: 'https://dl.delivery.mp.microsoft.com/duplicate.esd',
        },
        {
          id: 'DUPLICATE-WIN11-PRO',
          name: 'Duplicate Windows 11 Pro',
          version: 'Windows 11',
          language: 'en-us',
          edition: 'Pro',
          imageIndex: 6,
          fileName: 'duplicate.esd',
          url: 'https://dl.delivery.mp.microsoft.com/duplicate.esd',
        },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'DUPLICATE-WIN11-PRO');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS download catalog filters by OS family, edition, language, and release', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-osimages-catalog-filter-'));
  try {
    const config = { paths: { repoRoot: root } };
    const rows = await listOsDownloadCatalog(config, {
      filters: {
        osFamily: ['win11'],
        edition: ['Pro'],
        language: ['en-us', 'zh-tw'],
        releaseId: ['25H2'],
      },
      catalogRows: [
        {
          id: 'WIN10-ENUS-22H2',
          name: 'Windows 10 Pro en-US',
          version: 'Windows 10 22H2 x64 en-us Retail 19045.3803',
          releaseId: '22H2',
          build: '19045.3803',
          language: 'en-us',
          edition: 'Pro',
          activation: 'Retail',
          imageIndex: 6,
          fileName: 'win10-en-us.esd',
          url: 'https://dl.delivery.mp.microsoft.com/win10-en-us.esd',
        },
        {
          id: 'WIN11-HOME-ENUS-25H2',
          name: 'Windows 11 Home en-US',
          version: 'Windows 11 25H2 x64 en-us Retail 26200.1',
          releaseId: '25H2',
          build: '26200.1',
          language: 'en-us',
          edition: 'Home',
          activation: 'Retail',
          imageIndex: 1,
          fileName: 'win11-home-en-us.esd',
          url: 'https://dl.delivery.mp.microsoft.com/win11-home-en-us.esd',
        },
        {
          id: 'WIN11-ENUS-25H2',
          name: 'Windows 11 Pro en-US',
          version: 'Windows 11 25H2 x64 en-us Retail 26200.1',
          releaseId: '25H2',
          build: '26200.1',
          language: 'en-us',
          edition: 'Pro',
          activation: 'Retail',
          imageIndex: 6,
          fileName: 'win11-en-us.esd',
          url: 'https://dl.delivery.mp.microsoft.com/win11-en-us.esd',
        },
        {
          id: 'WIN11-ZHTW-25H2-VOLUME',
          name: 'Windows 11 Pro zh-TW Volume',
          version: 'Windows 11 25H2 x64 zh-tw Volume 26200.1',
          releaseId: '25H2',
          build: '26200.1',
          language: 'zh-tw',
          edition: 'Pro',
          activation: 'Volume',
          imageIndex: 6,
          fileName: 'win11-zh-tw.esd',
          url: 'https://download.microsoft.com/win11-zh-tw.esd',
        },
      ],
    });
    assert.deepEqual(rows.map((row) => row.id), ['WIN11-ENUS-25H2']);
    assert.equal(rows[0].osFamily, 'win11');
    assert.equal(rows[0].activation, 'Retail');

    const volumeRows = await listOsDownloadCatalog(config, {
      filters: {
        osFamily: ['win11'],
        edition: ['Pro'],
        activation: ['Volume'],
      },
      catalogRows: [{
        id: 'WIN11-ZHTW-25H2-VOLUME',
        name: 'Windows 11 Pro zh-TW Volume',
        version: 'Windows 11 25H2 x64 zh-tw Volume 26200.1',
        releaseId: '25H2',
        build: '26200.1',
        language: 'zh-tw',
        edition: 'Pro',
        activation: 'Volume',
        imageIndex: 6,
        fileName: 'win11-zh-tw.esd',
        url: 'https://download.microsoft.com/win11-zh-tw.esd',
      }],
    });
    assert.equal(volumeRows.length, 0);

    const customRows = await listOsDownloadCatalog(config, {
      filters: { osFamily: ['win11'], activation: ['Retail'], sourceType: ['custom'] },
      catalogRows: [{
        id: 'CUSTOM-WIN11-JAJP',
        name: 'Custom Windows 11 ja-JP',
        version: 'Windows 11 26H1 x64 ja-jp Retail 26300.1',
        releaseId: '26H1',
        build: '26300.1',
        language: 'ja-jp',
        edition: 'Pro',
        activation: 'Retail',
        imageIndex: 6,
        fileName: 'custom-ja-jp.wim',
        sourceType: 'custom',
        url: 'https://dl.delivery.mp.microsoft.com/custom-ja-jp.wim',
      }],
    });
    assert.equal(customRows.length, 0);

    const nonMicrosoftRows = await listOsDownloadCatalog(config, {
      catalogRows: [{
        id: 'NON-MICROSOFT-WIN11',
        name: 'Non Microsoft Windows 11',
        version: 'Windows 11 25H2 x64 en-us Retail 26200.1',
        releaseId: '25H2',
        build: '26200.1',
        language: 'en-us',
        edition: 'Pro',
        activation: 'Retail',
        imageIndex: 6,
        fileName: 'non-ms.esd',
        url: 'https://example.test/non-ms.esd',
      }],
    });
    assert.equal(nonMicrosoftRows.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OS download catalog ignores configured custom download sources', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-osimages-custom-'));
  try {
    const config = makeConfig(root);
    config.osImage.downloadSourcesPath = path.join(root, 'os-download-sources.json');
    writeJson(config.osImage.downloadSourcesPath, {
      allowedHosts: ['downloads.example.test'],
      images: [
        {
          id: 'CUSTOM-WIN11-PRO',
          name: 'Custom Windows 11 Pro',
          version: 'Windows 11 Custom',
          releaseId: '25H1',
          build: '26200.1',
          language: 'en-us',
          edition: 'Pro',
          activation: 'Retail',
          imageIndex: 6,
          fileName: 'custom.esd',
          sha256: 'A'.repeat(64),
          url: 'https://downloads.example.test/custom.esd',
        },
        {
          id: 'CUSTOM-WIN11-PRO',
          name: 'Duplicate Custom Windows 11 Pro',
          version: 'Windows 11 Custom',
          releaseId: '25H1',
          build: '26200.1',
          language: 'en-us',
          edition: 'Pro',
          activation: 'Retail',
          imageIndex: 6,
          fileName: 'custom.esd',
          sha256: 'A'.repeat(64),
          url: 'https://downloads.example.test/custom.esd',
        },
      ],
    });

    const rows = await listOsDownloadCatalog(config, {
      catalogRows: [{
        id: 'OFFICIAL-WIN11-PRO',
        name: 'Official Windows 11 Pro',
        version: 'Windows 11',
        language: 'en-us',
        edition: 'Pro',
        imageIndex: 6,
        fileName: 'official.esd',
        url: 'https://dl.delivery.mp.microsoft.com/official.esd',
      }],
    });
    assert.deepEqual(rows.map((image) => image.id), ['OFFICIAL-WIN11-PRO']);
    assert.deepEqual(rows.map((image) => image.sourceType), ['official']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('local ESD/WIM inspect and import export a single-index WIM without changing active image', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-osimages-import-'));
  try {
    const config = makeConfig(root);
    const sourcePath = path.join(root, 'Win11_25H1_en-us.wim');
    fs.writeFileSync(sourcePath, 'imported image bytes', 'utf8');
    const inspectWimInfo = async () => [{
      imageIndex: 6,
      name: 'Windows 11 Pro',
      description: 'Windows 11 Pro',
      architecture: 'x64',
    }];

    const inspected = await inspectLocalOsImage(sourcePath, { inspectWimInfo });
    assert.equal(inspected.sourceType, 'wim');
    assert.equal(inspected.indexes[0].imageIndex, 6);
    assert.equal(inspected.indexes[0].suggested.language, 'en-us');
    assert.equal(inspected.indexes[0].suggested.releaseId, '25H1');

    const imported = await importLocalOsImage(config, {
      sourcePath,
      imageIndex: 6,
      metadata: {
        id: 'IMPORTED-WIN11-25H1-ENUS',
        name: 'Imported Windows 11 25H1 en-US',
        version: 'Windows 11 25H1 x64',
        releaseId: '25H1',
        language: 'en-us',
        locale: 'en-US',
        timeZone: 'Pacific Standard Time',
        edition: 'Pro',
        editionId: 'Professional',
        activation: 'Retail',
        fileName: 'imported-25h1-en-us.wim',
      },
    }, {
      inspectWimInfo,
      exportImageToWim: async (source, destination) => {
        fs.writeFileSync(destination, `${fs.readFileSync(source, 'utf8')} exported`, 'utf8');
      },
      validateImage: false,
    });
    assert.equal(imported.status, 'imported');
    assert.equal(config.osImage.activeImage, 'SMOKE-WIN11-PRO');
    assert.equal(imported.image.imageIndex, 1);
    assert.equal(imported.image.sourceImageIndex, 6);
    assert.equal(fs.readFileSync(path.join(config.osImage.cacheRoot, 'imported-25h1-en-us.wim'), 'utf8'), 'imported image bytes exported');
    assert.equal(resolveOsImageState(config, 'IMPORTED-WIN11-25H1-ENUS').activeImage.cached, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('browser OS image upload inspects and imports through staging cleanup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-osimages-upload-'));
  try {
    const config = makeConfig(root);
    const inspectWimInfo = async () => [{
      imageIndex: 6,
      name: 'Windows 11 Pro',
      description: 'Windows 11 Pro',
      architecture: 'x64',
    }];
    const uploaded = await uploadOsImageFile(config, {
      fileName: 'Win11_26H1_en-us.wim',
      size: Buffer.byteLength('uploaded image bytes'),
      buffer: Buffer.from('uploaded image bytes'),
    }, {
      inspectWimInfo,
      uploadId: 'upload-test',
      validateImage: false,
    });
    assert.equal(uploaded.uploadId, 'upload-test');
    assert.equal(uploaded.indexes[0].suggested.releaseId, '26H1');
    assert.equal(fs.existsSync(path.join(config.osImage.downloadStagingRoot, 'uploads', 'upload-test', 'Win11_26H1_en-us.wim')), true);

    const imported = await importUploadedOsImage(config, {
      uploadId: 'upload-test',
      imageIndex: 6,
      metadata: {
        id: 'UPLOADED-WIN11-26H1-ENUS',
        name: 'Uploaded Windows 11 26H1 en-US',
        version: 'Windows 11 26H1 x64',
        releaseId: '26H1',
        language: 'en-us',
        edition: 'Pro',
        fileName: 'uploaded-26h1-en-us.wim',
      },
    }, {
      inspectWimInfo,
      exportImageToWim: async (source, destination) => {
        fs.writeFileSync(destination, `${fs.readFileSync(source, 'utf8')} exported`, 'utf8');
      },
      validateImage: false,
    });
    assert.equal(imported.status, 'imported');
    assert.equal(fs.readFileSync(path.join(config.osImage.cacheRoot, 'uploaded-26h1-en-us.wim'), 'utf8'), 'uploaded image bytes exported');
    assert.equal(fs.existsSync(path.join(config.osImage.downloadStagingRoot, 'uploads', 'upload-test')), false);

    await assert.rejects(() => uploadOsImageFile(config, {
      fileName: '..\\bad.iso',
      buffer: Buffer.from('bad'),
    }), /plain file name/);
    await assert.rejects(() => uploadOsImageFile(config, {
      fileName: 'bad.txt',
      buffer: Buffer.from('bad'),
    }), /\.iso, \.esd, or \.wim/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('local ISO import unmounts on failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-osimages-iso-'));
  try {
    const config = makeConfig(root);
    const sourcePath = path.join(root, 'Win11.iso');
    fs.writeFileSync(sourcePath, 'iso placeholder', 'utf8');
    const mountRoot = path.join(root, 'mount');
    fs.mkdirSync(path.join(mountRoot, 'sources'), { recursive: true });
    fs.writeFileSync(path.join(mountRoot, 'sources', 'install.esd'), 'iso install image', 'utf8');
    let unmounted = false;
    await assert.rejects(() => importLocalOsImage(config, {
      sourcePath,
      imageIndex: 9,
      metadata: { fileName: 'from-iso.esd' },
    }, {
      mountIsoImage: async () => ({ mountPath: mountRoot, imagePath: sourcePath }),
      unmountIsoImage: async () => { unmounted = true; },
      inspectWimInfo: async () => [{ imageIndex: 6, name: 'Windows 11 Pro', architecture: 'x64' }],
      validateImage: false,
    }), /Image index 9 not found/);
    assert.equal(unmounted, true);
    assert.equal(fs.existsSync(path.join(config.osImage.cacheRoot, 'from-iso.esd')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
