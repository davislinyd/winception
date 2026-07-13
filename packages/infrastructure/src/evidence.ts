import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, parse, relative, resolve, sep } from 'node:path';
import type { WinceptionDatabase } from './database.js';
import { enforceRetention, type RetentionPolicy, type RetentionResult } from './retention.js';

const DEFAULT_LOG_POLICY: RetentionPolicy = { maxAgeMs: 30 * 86400000, maxFiles: 20_000, maxTotalBytes: 2 * 1024 ** 3 };
const DEFAULT_EVIDENCE_POLICY: RetentionPolicy = { maxAgeMs: 180 * 86400000, maxFiles: 100_000, maxTotalBytes: 50 * 1024 ** 3 };

interface EvidencePolicy { schemaVersion: 1; logs: RetentionPolicy; evidence: RetentionPolicy }
const DEFAULT_POLICY: EvidencePolicy = { schemaVersion: 1, logs: DEFAULT_LOG_POLICY, evidence: DEFAULT_EVIDENCE_POLICY };

export interface EvidenceMaintenanceResult {
  logs: RetentionResult | null;
  evidence: RetentionResult | null;
  indexed: number;
  runs: number;
}

export class EvidenceManager {
  readonly #database: WinceptionDatabase;
  readonly #protectedRoots: string[];
  readonly stateRoot: string;

  constructor(options: { database: WinceptionDatabase; stateRoot: string; protectedRoots?: string[] }) {
    this.#database = options.database;
    this.stateRoot = resolve(options.stateRoot);
    this.#protectedRoots = (options.protectedRoots ?? []).map((root) => resolve(root));
  }

  async maintain(statusRootValue: string): Promise<EvidenceMaintenanceResult> {
    const statusRoot = resolve(statusRootValue);
    assertEvidenceRoot(statusRoot, this.#protectedRoots);
    const storedPolicy = this.#database.getSetting<Partial<EvidencePolicy>>('retention.policy');
    const policy = validEvidencePolicy(storedPolicy) ? storedPolicy : DEFAULT_POLICY;
    if (!validEvidencePolicy(storedPolicy)) this.#database.setSetting('retention.policy', policy);
    const logsRoot = join(this.stateRoot, 'logs');
    const logs = existsSync(logsRoot) ? enforceRetention(logsRoot, policy.logs) : null;
    const protectedRuns = runningRunIds(statusRoot);
    const evidence = existsSync(statusRoot) ? enforceRetention(statusRoot, policy.evidence, Date.now(), {
      protect: (path) => isProtectedEvidence(path, protectedRuns),
    }) : null;
    const catalog = existsSync(statusRoot) ? await buildCatalog(statusRoot, policy.evidence.maxAgeMs) : { runs: [], entries: [] };
    this.#database.replaceEvidenceCatalog(catalog);
    this.#database.setSetting('retention.lastRun', {
      at: new Date().toISOString(), statusRoot, logs, evidence, indexed: catalog.entries.length, runs: catalog.runs.length,
    });
    return { logs, evidence, indexed: catalog.entries.length, runs: catalog.runs.length };
  }
}

function validEvidencePolicy(value: Partial<EvidencePolicy> | undefined): value is EvidencePolicy {
  return value?.schemaVersion === 1 && validRetention(value.logs) && validRetention(value.evidence);
}

function validRetention(value: RetentionPolicy | undefined): value is RetentionPolicy {
  return Boolean(value) && Number.isSafeInteger(value?.maxAgeMs) && Number(value?.maxAgeMs) >= 0
    && Number.isSafeInteger(value?.maxFiles) && Number(value?.maxFiles) >= 0
    && Number.isSafeInteger(value?.maxTotalBytes) && Number(value?.maxTotalBytes) >= 0;
}

function assertEvidenceRoot(root: string, protectedRoots: string[]): void {
  if (parse(root).root.toLowerCase() === root.toLowerCase()) throw new Error('Evidence retention cannot target a drive root.');
  if (protectedRoots.some((protectedRoot) => root.toLowerCase() === protectedRoot.toLowerCase() || isInside(protectedRoot, root))) {
    throw new Error('Evidence retention cannot target a protected application or operating-system root.');
  }
}

async function buildCatalog(root: string, maxAgeMs: number): Promise<{
  runs: Array<{ id: string; state: string; summary: unknown; startedAt: string; finishedAt?: string | null }>;
  entries: Array<{ id: string; runId?: string | null; kind: string; relativePath: string; sha256: string; sizeBytes: number; retainedUntil?: string | null; createdAt: string }>;
}> {
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .filter((path) => isInside(root, path) && !lstatSync(path).isSymbolicLink());
  const runs = new Map<string, { id: string; state: string; summary: unknown; startedAt: string; finishedAt?: string | null }>();
  const entries = [];
  for (const path of files) {
    const stats = lstatSync(path);
    const relativePath = relative(root, path);
    const runId = inferRunId(relativePath);
    if (runId && relativePath.toLowerCase().endsWith('.summary.json')) {
      const summary = readSummary(path);
      runs.set(runId, {
        id: runId,
        state: text(summary.status ?? summary.state, 'unknown'),
        summary,
        startedAt: dateText(summary.startedAt, stats.birthtime.toISOString()),
        finishedAt: nullableDate(summary.finishedAt),
      });
    }
    entries.push({
      id: createHash('sha256').update(relativePath.toLowerCase()).digest('hex'),
      ...(runId ? { runId } : {}),
      kind: evidenceKind(relativePath),
      relativePath,
      sha256: await hashFile(path),
      sizeBytes: stats.size,
      retainedUntil: new Date(stats.mtimeMs + maxAgeMs).toISOString(),
      createdAt: stats.birthtime.toISOString(),
    });
  }
  for (const entry of entries) {
    if (entry.runId && !runs.has(entry.runId)) {
      runs.set(entry.runId, { id: entry.runId, state: 'unknown', summary: {}, startedAt: entry.createdAt });
    }
  }
  return { runs: [...runs.values()], entries };
}

function runningRunIds(root: string): Set<string> {
  const result = new Set<string>();
  if (!existsSync(root)) return result;
  for (const name of readdirSync(root).filter((entry) => entry.toLowerCase().endsWith('.summary.json'))) {
    const summary = readSummary(join(root, name));
    const state = text(summary.status ?? summary.state, '').toLowerCase();
    if (state === 'running' || state === 'started' || state === 'active') result.add(name.slice(0, -'.summary.json'.length));
  }
  return result;
}

function isProtectedEvidence(path: string, runningRuns: Set<string>): boolean {
  const normalized = path.replaceAll('\\', '/');
  const name = basename(normalized).toLowerCase();
  if (name.startsWith('latest') || name === 'runs-index.json') return true;
  return [...runningRuns].some((runId) => name.startsWith(`${runId.toLowerCase()}.`) || normalized.toLowerCase().includes(`/screenshots/${runId.toLowerCase()}/`));
}

function inferRunId(path: string): string | null {
  const normalized = path.replaceAll('\\', '/');
  const screenshot = /(?:^|\/)screenshots\/([^/]+)\//iu.exec(normalized)?.[1];
  if (screenshot) return safeRunId(screenshot);
  const name = basename(normalized);
  const match = /^(.+?)(?:\.summary\.json|\.late\.jsonl|\.latest\.json|\.screenshots\.jsonl|\.jsonl)$/iu.exec(name)?.[1];
  return match ? safeRunId(match) : null;
}

function safeRunId(value: string): string | null { return /^[A-Za-z0-9_.-]{1,120}$/u.test(value) ? value : null; }
function evidenceKind(path: string): string {
  const lower = path.toLowerCase();
  if (lower.includes('screenshot') || /\.(?:png|jpe?g|webp)$/u.test(lower)) return 'screenshot';
  if (lower.endsWith('.jsonl')) return 'events';
  if (lower.endsWith('.summary.json')) return 'summary';
  if (lower.replaceAll('\\', '/').includes('/archive/')) return 'archive';
  return 'status';
}
function readSummary(path: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolveHash(hash.digest('hex')));
  });
}
function text(value: unknown, fallback: string): string { return typeof value === 'string' && value ? value : fallback; }
function dateText(value: unknown, fallback: string): string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback; }
function nullableDate(value: unknown): string | null { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null; }
function isInside(root: string, candidate: string): boolean { const value = relative(root, candidate); return value !== '..' && !value.startsWith(`..${sep}`); }
