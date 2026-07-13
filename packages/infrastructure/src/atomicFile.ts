import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  fsyncSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

export type AtomicWriteFailpoint = 'after-temp-write' | 'after-backup';

export interface AtomicWriteOptions {
  failpoint?: (stage: AtomicWriteFailpoint) => void;
}

export function writeFileAtomic(targetPath: string, content: string | Uint8Array, options: AtomicWriteOptions = {}): void {
  const target = resolve(targetPath);
  const directory = dirname(target);
  mkdirSync(directory, { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const backup = `${target}.bak`;
  let movedOriginal = false;

  try {
    writeFileAndFlush(temporary, content);
    options.failpoint?.('after-temp-write');
    if (existsSync(target)) {
      rmSync(backup, { force: true });
      renameSync(target, backup);
      movedOriginal = true;
    }
    options.failpoint?.('after-backup');
    renameSync(temporary, target);
    if (movedOriginal) rmSync(backup, { force: true });
  }
  catch (error) {
    rmSync(temporary, { force: true });
    if (movedOriginal && !existsSync(target) && existsSync(backup)) renameSync(backup, target);
    throw error;
  }
}

export function writeJsonAtomic(targetPath: string, value: unknown, options: AtomicWriteOptions = {}): void {
  writeFileAtomic(targetPath, `${JSON.stringify(value, null, 2)}\n`, options);
}

export function readJsonWithBackup<T>(targetPath: string): T {
  const target = resolve(targetPath);
  try {
    return JSON.parse(readFileSync(target, 'utf8')) as T;
  }
  catch (primaryError) {
    try {
      return JSON.parse(readFileSync(`${target}.bak`, 'utf8')) as T;
    }
    catch {
      throw primaryError;
    }
  }
}

function writeFileAndFlush(path: string, content: string | Uint8Array): void {
  const descriptor = openSync(path, 'wx');
  try {
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
  }
  finally {
    closeSync(descriptor);
  }
}
