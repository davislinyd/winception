import fs from 'node:fs';
import { cachedImagePath, loadOsImageCatalog, osImageOptions, resolveOsImageState } from './catalog.js';
import { appendCacheLog, normalizeId, writeJson } from './shared.js';

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
