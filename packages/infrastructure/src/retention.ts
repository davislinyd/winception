import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

export interface RetentionPolicy {
  maxAgeMs: number;
  maxFiles: number;
  maxTotalBytes: number;
}

export interface RetentionResult {
  scanned: number;
  removed: number;
  removedBytes: number;
  remainingBytes: number;
  protectedFiles: number;
  quotaSatisfied: boolean;
}

interface Candidate { path: string; relativePath: string; size: number; mtimeMs: number; protected: boolean }

export function enforceRetention(rootPath: string, policy: RetentionPolicy, now = Date.now(), options: { protect?: (relativePath: string) => boolean } = {}): RetentionResult {
  validatePolicy(policy);
  const root = resolve(rootPath);
  const files = collectFiles(root, options.protect).sort((left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path));
  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let remainingFiles = files.length;
  let removed = 0;
  let removedBytes = 0;
  for (const file of files) {
    if (file.protected) continue;
    const expired = now - file.mtimeMs > policy.maxAgeMs;
    const overQuota = remainingFiles > policy.maxFiles || totalBytes > policy.maxTotalBytes;
    if (!expired && !overQuota) continue;
    rmSync(file.path, { force: true });
    totalBytes -= file.size;
    remainingFiles -= 1;
    removed += 1;
    removedBytes += file.size;
  }
  return {
    scanned: files.length,
    removed,
    removedBytes,
    remainingBytes: totalBytes,
    protectedFiles: files.filter((file) => file.protected).length,
    quotaSatisfied: remainingFiles <= policy.maxFiles && totalBytes <= policy.maxTotalBytes,
  };
}

function collectFiles(root: string, protect: ((relativePath: string) => boolean) | undefined): Candidate[] {
  const candidates: Candidate[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = resolve(entry.parentPath, entry.name);
    if (!isInside(root, path)) throw new Error('Retention candidate escaped the configured root.');
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile()) continue;
    const relativePath = relative(root, path);
    candidates.push({ path, relativePath, size: stats.size, mtimeMs: stats.mtimeMs, protected: protect?.(relativePath) === true });
  }
  return candidates;
}

function validatePolicy(policy: RetentionPolicy): void {
  if (!Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs < 0
    || !Number.isSafeInteger(policy.maxFiles) || policy.maxFiles < 0
    || !Number.isSafeInteger(policy.maxTotalBytes) || policy.maxTotalBytes < 0) {
    throw new Error('Retention policy is invalid.');
  }
}

function isInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== '..' && !value.startsWith(`..${sep}`);
}
