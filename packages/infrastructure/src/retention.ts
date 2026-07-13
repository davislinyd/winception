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
}

interface Candidate { path: string; size: number; mtimeMs: number }

export function enforceRetention(rootPath: string, policy: RetentionPolicy, now = Date.now()): RetentionResult {
  validatePolicy(policy);
  const root = resolve(rootPath);
  const files = collectFiles(root).sort((left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path));
  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let remainingFiles = files.length;
  let removed = 0;
  let removedBytes = 0;
  for (const file of files) {
    const expired = now - file.mtimeMs > policy.maxAgeMs;
    const overQuota = remainingFiles > policy.maxFiles || totalBytes > policy.maxTotalBytes;
    if (!expired && !overQuota) continue;
    rmSync(file.path, { force: true });
    totalBytes -= file.size;
    remainingFiles -= 1;
    removed += 1;
    removedBytes += file.size;
  }
  return { scanned: files.length, removed, removedBytes, remainingBytes: totalBytes };
}

function collectFiles(root: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = resolve(entry.parentPath, entry.name);
    if (!isInside(root, path)) throw new Error('Retention candidate escaped the configured root.');
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile()) continue;
    candidates.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
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
