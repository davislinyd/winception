import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { writeJsonAtomic } from './atomicFile.js';

export type StagedFileKind = 'os-image' | 'software' | 'custom-script' | 'diagnostics';

export interface StagedFile {
  uploadToken: string;
  kind: StagedFileKind;
  fileName: string;
  path: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

interface Manifest extends Omit<StagedFile, 'path'> {
  schemaVersion: 1;
  payloadFile: 'payload';
}

const LIMITS: Readonly<Record<StagedFileKind, number>> = Object.freeze({
  'os-image': 32 * 1024 * 1024 * 1024,
  software: 8 * 1024 * 1024 * 1024,
  'custom-script': 16 * 1024 * 1024,
  diagnostics: 2 * 1024 * 1024 * 1024,
});

const EXTENSIONS: Readonly<Record<StagedFileKind, readonly string[]>> = Object.freeze({
  'os-image': ['.iso', '.esd', '.wim'],
  software: ['.exe', '.msi', '.msix', '.zip'],
  'custom-script': ['.ps1'],
  diagnostics: ['.zip'],
});

export class UploadStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  async stage(kind: StagedFileKind, fileName: string, stream: Readable, declaredSize?: number): Promise<StagedFile> {
    const safeName = validateFileName(kind, fileName);
    const limit = LIMITS[kind];
    if (declaredSize !== undefined && (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > limit)) {
      throw new Error('The upload size is invalid or exceeds the product limit.');
    }
    const token = randomUUID();
    const directory = join(this.root, token);
    const payloadPath = join(directory, 'payload');
    mkdirSync(directory, { recursive: false });
    const hash = createHash('sha256');
    let sizeBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
        if (sizeBytes > limit) {
          callback(new Error('The upload exceeds the product limit.'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(stream, meter, createWriteStream(payloadPath, { flags: 'wx' }));
      if (declaredSize !== undefined && sizeBytes !== declaredSize) throw new Error('The uploaded byte count does not match Content-Length.');
      const staged: StagedFile = {
        uploadToken: token,
        kind,
        fileName: safeName,
        path: payloadPath,
        sizeBytes,
        sha256: hash.digest('hex'),
        createdAt: new Date().toISOString(),
      };
      writeJsonAtomic(join(directory, 'manifest.json'), manifestFrom(staged));
      return staged;
    }
    catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async stageFile(kind: StagedFileKind, sourcePath: string, fileName = basename(sourcePath)): Promise<StagedFile> {
    const source = resolve(sourcePath);
    const stats = statSync(source);
    if (!stats.isFile()) throw new Error('The staged source is not a file.');
    return this.stage(kind, fileName, createReadStream(source), stats.size);
  }

  async resolve(uploadToken: string, expectedKind: StagedFileKind): Promise<StagedFile> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(uploadToken)) throw new Error('Upload token is invalid.');
    const directory = resolve(this.root, uploadToken);
    if (!isInside(this.root, directory)) throw new Error('Upload token escaped the staging root.');
    const manifestPath = join(directory, 'manifest.json');
    const payloadPath = join(directory, 'payload');
    if (!existsSync(manifestPath) || !existsSync(payloadPath)) throw new Error('Staged upload was not found.');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    if (manifest.schemaVersion !== 1 || manifest.uploadToken !== uploadToken || manifest.kind !== expectedKind || manifest.payloadFile !== 'payload') {
      throw new Error('Staged upload manifest is invalid.');
    }
    validateFileName(expectedKind, manifest.fileName);
    const stats = statSync(payloadPath);
    if (!stats.isFile() || stats.size !== manifest.sizeBytes || stats.size > LIMITS[expectedKind]) throw new Error('Staged upload size verification failed.');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(payloadPath)) hash.update(chunk as Buffer);
    const digest = hash.digest('hex');
    if (digest !== manifest.sha256) throw new Error('Staged upload hash verification failed.');
    return { ...manifest, path: payloadPath };
  }

  consume(uploadToken: string): void {
    const directory = resolve(this.root, uploadToken);
    if (!isInside(this.root, directory)) throw new Error('Upload token escaped the staging root.');
    rmSync(directory, { recursive: true, force: true });
  }

  prune(maxAgeMs = 24 * 60 * 60 * 1000): number {
    let removed = 0;
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(this.root, entry.name, 'manifest.json');
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
        if (Date.now() - Date.parse(manifest.createdAt) <= maxAgeMs) continue;
      }
      catch {
        // Invalid staging entries are removed rather than trusted.
      }
      rmSync(join(this.root, entry.name), { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }
}

function validateFileName(kind: StagedFileKind, fileName: string): string {
  const safe = basename(String(fileName ?? '').trim());
  if (!safe || safe !== fileName || [...safe].some((character) => character.charCodeAt(0) < 32) || safe.length > 255) throw new Error('Upload filename is invalid.');
  if (!EXTENSIONS[kind].includes(extname(safe).toLowerCase())) throw new Error(`Upload extension is not allowed for ${kind}.`);
  return safe;
}

function manifestFrom(file: StagedFile): Manifest {
  return {
    schemaVersion: 1,
    payloadFile: 'payload',
    uploadToken: file.uploadToken,
    kind: file.kind,
    fileName: file.fileName,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    createdAt: file.createdAt,
  };
}

function isInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== '' && value !== '..' && !value.startsWith(`..${sep}`);
}
