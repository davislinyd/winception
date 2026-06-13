import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { cachedImagePath, osImageOptions, upsertCatalogImage } from './catalog.js';
import { exportImageToWim, exportedImageMetadata, inspectLocalOsImage, inspectWimInfo, localSourcePath, resolveImportImage, suggestedImageMetadata, unmountIsoImage, validateImageIndex } from './inspect.js';
import { allowedImportExtensions, appendCacheLog, assertInside, cleanUploadFileName, normalizeId, normalizeNumber, sha256File } from './shared.js';

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

export function uploadRootPath(imageOptions) {
  return path.join(imageOptions.downloadStagingRoot, 'uploads');
}

export function normalizeUploadId(value) {
  return normalizeId(value, 'OS image upload');
}

export function resolveUploadDirectory(imageOptions, uploadId) {
  const root = uploadRootPath(imageOptions);
  return assertInside(root, path.join(root, normalizeUploadId(uploadId)), 'OS image upload directory');
}

export function resolveUploadedSourcePath(imageOptions, uploadId) {
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

export function createUploadTransform(progress, maxBytes) {
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

export function uploadSourceStream(input) {
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
