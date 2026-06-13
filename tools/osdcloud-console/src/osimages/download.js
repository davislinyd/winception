import fs from 'node:fs';
import path from 'node:path';
import { appRootForConfig } from '../config.js';
import { collectProcessOutput, preparePowerShellArgs } from '../processOutput.js';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { cachedImagePath, catalogFilters, matchesCatalogFilters, normalizeOsImage, osImageOptions, upsertCatalogImage } from './catalog.js';
import { exportImageToWim, exportedImageMetadata, findEditionIndex, inferEdition, inspectWimInfo, validateImageIndex } from './inspect.js';
import { appendCacheLog, assertInside, assertMicrosoftDownloadUrl, isMicrosoftDownloadUrl, microsoftDownloadHosts, normalizeId, powershellExe, sha1File, sha256File } from './shared.js';

export async function runPowerShellJson(script, options = {}) {
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

export function createProgressTransform(progress) {
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

export async function downloadToFile(url, destination, options = {}) {
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

  const sourcesDir = path.join(imageOptions.cacheRoot, 'sources');
  const sourceArchivePath = assertInside(sourcesDir, path.join(sourcesDir, sourceImage.fileName), 'OS image source path');
  const sourceAlreadyCached = fs.existsSync(sourceArchivePath) && fs.statSync(sourceArchivePath).size > 0;
  const jobId = `${sourceImage.id}-${Date.now()}`.replace(/[^A-Za-z0-9._-]/gu, '_');
  const sourceStagingPath = assertInside(imageOptions.downloadStagingRoot, path.join(imageOptions.downloadStagingRoot, `${jobId}.source`), 'OS image download staging path');
  const exportStagingPath = assertInside(imageOptions.downloadStagingRoot, path.join(imageOptions.downloadStagingRoot, `${jobId}.wim`), 'OS image export staging path');
  const sourceFilePath = sourceAlreadyCached ? sourceArchivePath : sourceStagingPath;

  try {
    fs.mkdirSync(sourcesDir, { recursive: true });
    if (sourceAlreadyCached) {
      const cachedStat = fs.statSync(sourceArchivePath);
      options.onProgress?.({
        status: 'downloading',
        phase: 'source-cached',
        message: `Using cached source (${sourceImage.fileName})`,
        bytes: cachedStat.size,
        totalBytes: sourceImage.size || cachedStat.size,
        fileName: sourceImage.fileName,
      });
    } else {
      await downloadToFile(sourceImage.url, sourceStagingPath, {
        config,
        fetchImpl: options.fetchImpl,
        fileName: sourceImage.fileName,
        microsoftDownloadHosts: options.microsoftDownloadHosts,
        onProgress: options.onProgress,
      });
      const downloadStat = fs.statSync(sourceStagingPath);
      options.onProgress?.({
        status: 'downloading',
        phase: 'download-complete',
        message: 'Download complete; preparing image...',
        bytes: downloadStat.size,
        totalBytes: sourceImage.size || downloadStat.size,
        fileName: sourceImage.fileName,
      });
    }
    const stat = fs.statSync(sourceFilePath);
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
      sourceSha256 = await sha256File(sourceFilePath);
      if (sourceSha256 !== sourceImage.sha256) {
        throw new Error(`OS image SHA256 mismatch: ${sourceSha256} expected ${sourceImage.sha256}`);
      }
    } else if (sourceImage.sha1) {
      const actual = await sha1File(sourceFilePath);
      if (actual !== sourceImage.sha1) {
        throw new Error(`OS image SHA1 mismatch: ${actual} expected ${sourceImage.sha1}`);
      }
    }

    // ESD index layout varies: inspect indexes to find the actual edition rather than
    // trusting the catalog-supplied index (some ESDs include Setup/PE images that
    // shift OS edition indexes relative to what the OSD module expects)
    let resolvedImageIndex = sourceImage.imageIndex;
    if (options.validateImage !== false) {
      options.onProgress?.({
        status: 'downloading',
        phase: 'inspecting-source',
        message: 'Inspecting source image with DISM...',
        bytes: stat.size,
        totalBytes: sourceImage.size || stat.size,
        fileName: sourceImage.fileName,
      });
      const wimRows = await inspectWimInfo(sourceFilePath, options);
      const found = findEditionIndex(wimRows, sourceImage.edition);
      if (found !== null) {
        resolvedImageIndex = found;
      } else {
        await validateImageIndex(sourceFilePath, resolvedImageIndex, options);
      }
    }

    options.onProgress?.({
      status: 'downloading',
      phase: 'exporting-wim',
      message: 'Exporting deployable WIM with DISM. This can take several minutes.',
      bytes: stat.size,
      totalBytes: sourceImage.size || stat.size,
      fileName: image.fileName,
    });
    let lastDismPercent = -1;
    await exportImageToWim(sourceFilePath, exportStagingPath, resolvedImageIndex, {
      ...options,
      onStdout: (text) => {
        const match = /(\d+\.?\d*)%/u.exec(text);
        if (!match) return;
        const percent = parseFloat(match[1]);
        if (percent - lastDismPercent < 5) return;
        lastDismPercent = percent;
        options.onProgress?.({
          status: 'downloading',
          phase: 'exporting-wim',
          message: `Exporting deployable WIM with DISM (${percent.toFixed(0)}%)`,
          bytes: stat.size,
          totalBytes: sourceImage.size || stat.size,
          fileName: image.fileName,
          dismPercent: percent,
        });
      },
    });
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
      const exportedRows = await inspectWimInfo(exportStagingPath, options);
      const exportedEdition = exportedRows[0] ? inferEdition(exportedRows[0].name) : null;
      if (exportedEdition && exportedEdition.toLowerCase() !== (sourceImage.edition ?? '').toLowerCase()) {
        throw new Error(
          `Exported WIM edition mismatch: got "${exportedRows[0].name}" (${exportedEdition}), ` +
          `expected ${sourceImage.edition} (resolved source index ${resolvedImageIndex})`,
        );
      }
    }
    const finalImage = {
      ...image,
      size: exportStat.size,
      sha256: await sha256File(exportStagingPath),
      sourceSize: stat.size,
      sourceSha256: sourceSha256 || sourceImage.sha256,
      sourceImageIndex: resolvedImageIndex,
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

    if (!sourceAlreadyCached) {
      if (fs.existsSync(sourceArchivePath)) {
        fs.rmSync(sourceArchivePath, { force: true });
      }
      fs.renameSync(sourceStagingPath, sourceArchivePath);
    }

    upsertCatalogImage(config, finalImage, options);
    appendCacheLog(config, { status: 'downloaded', imageId: finalImage.id, fileName: finalImage.fileName, bytes: finalImage.size }, options);
    return { status: 'downloaded', image: finalImage, filePath: destination, bytes: finalImage.size };
  } catch (error) {
    appendCacheLog(config, { status: 'failed', imageId: sourceImage.id, fileName: sourceImage.fileName, reason: error.message }, options);
    throw error;
  } finally {
    if (!sourceAlreadyCached && fs.existsSync(sourceStagingPath)) {
      fs.rmSync(sourceStagingPath, { force: true });
    }
    if (fs.existsSync(exportStagingPath)) {
      fs.rmSync(exportStagingPath, { force: true });
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
