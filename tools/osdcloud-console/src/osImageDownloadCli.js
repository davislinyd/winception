import { loadOsImageCatalog, publishSelectedOsImage } from './osimages/catalog.js';
import { downloadOsImageFromCatalogItem, listOsDownloadCatalog } from './osimages/download.js';
import { loadConfig } from './config.js';

function parseArgs(argv) {
  const args = {
    configPath: undefined,
    imageId: undefined,
    dryRun: false,
    validateImage: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') {
      args.configPath = argv[++index];
    } else if (arg === '--image-id') {
      args.imageId = argv[++index];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--skip-dism-validation') {
      args.validateImage = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.imageId) {
    throw new Error('Missing required --image-id');
  }
  return args;
}

function sameText(left, right) {
  return String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase();
}

function pickOfficialCatalogItem(requested, rows) {
  const exactFile = rows.find((row) => sameText(row.fileName, requested.fileName));
  if (exactFile) {
    return exactFile;
  }
  const releaseLanguageEdition = rows.find((row) => (
    sameText(row.releaseId, requested.releaseId)
    && sameText(row.language, requested.language)
    && sameText(row.edition, requested.edition)
    && sameText(row.activation, requested.activation)
    && Number(row.imageIndex) === Number(requested.imageIndex)
  ));
  if (releaseLanguageEdition) {
    return releaseLanguageEdition;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.configPath);
  const requested = loadOsImageCatalog(config).images.find((image) => image.id === args.imageId);
  if (!requested) {
    throw new Error(`OS image not found in config catalog: ${args.imageId}`);
  }

  let catalogItem = requested.url ? requested : null;
  if (!catalogItem) {
    const rows = await listOsDownloadCatalog(config, {
      filters: {
        osFamily: ['win11'],
        edition: [requested.edition],
        language: [requested.language],
        releaseId: requested.releaseId ? [requested.releaseId] : [],
      },
    });
    catalogItem = pickOfficialCatalogItem(requested, rows);
    if (!catalogItem) {
      throw new Error(
        `Official OSD catalog item not found for ${requested.id}. ` +
        'Open the Web console OS Image Cache, download/import the source image, export a WIM, or add a direct URL to config/os-image-catalog.json.',
      );
    }
  }

  const finalItem = {
    ...catalogItem,
    id: requested.id,
    name: requested.name || catalogItem.name,
    fileName: requested.fileName || catalogItem.fileName,
    imageIndex: requested.imageIndex || catalogItem.imageIndex,
    language: requested.language || catalogItem.language,
    edition: requested.edition || catalogItem.edition,
    editionId: requested.editionId || catalogItem.editionId,
    activation: requested.activation || catalogItem.activation,
    releaseId: requested.releaseId || catalogItem.releaseId,
    size: requested.size || catalogItem.size,
    sha256: requested.sha256 || catalogItem.sha256,
    sha1: requested.sha1 || catalogItem.sha1,
  };

  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify({
      status: 'dry-run',
      image: finalItem,
    }, null, 2)}\n`);
    return;
  }

  const downloaded = await downloadOsImageFromCatalogItem(config, finalItem, {
    validateImage: args.validateImage,
  });
  await publishSelectedOsImage(config, requested.id, {
    validateImage: args.validateImage,
  });
  process.stdout.write(`${JSON.stringify({
    status: downloaded.status,
    imageId: requested.id,
    filePath: downloaded.filePath,
    bytes: downloaded.bytes,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
