import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { OperationRecord } from '../../contracts/src/index.js';
import type { OperationRepository } from '../../domain/src/ports.js';

const CURRENT_SCHEMA_VERSION = 2;

export interface DatabaseOptions {
  migrationFailpoint?: (version: number) => void;
}

interface OperationRow {
  id: string;
  label: string;
  resources_json: string;
  status: OperationRecord['status'];
  started_at: string;
  finished_at: string | null;
  error_code: string | null;
}

export class WinceptionDatabase implements OperationRepository {
  readonly #database: DatabaseSync;
  readonly path: string;

  constructor(databasePath: string, options: DatabaseOptions = {}) {
    this.path = resolve(databasePath);
    mkdirSync(dirname(this.path), { recursive: true });
    this.#database = new DatabaseSync(this.path);
    try {
      this.#database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      this.#migrate(options);
    }
    catch (error) {
      this.#database.close();
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }

  transaction<T>(action: () => T): T {
    this.#database.exec('BEGIN IMMEDIATE;');
    try {
      const result = action();
      this.#database.exec('COMMIT;');
      return result;
    }
    catch (error) {
      this.#database.exec('ROLLBACK;');
      throw error;
    }
  }

  setSetting(key: string, value: unknown): void {
    this.#database.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), new Date().toISOString());
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.#database.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) as T : undefined;
  }

  saveDocument(table: 'profiles' | 'software_packages' | 'custom_scripts' | 'os_images', id: string, document: unknown): void {
    this.#database.prepare(`
      INSERT INTO ${table} (id, document_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at
    `).run(id, JSON.stringify(document), new Date().toISOString());
  }

  listDocuments<T>(table: 'profiles' | 'software_packages' | 'custom_scripts' | 'os_images'): Array<{ id: string; document: T }> {
    const rows = this.#database.prepare(`SELECT id, document_json FROM ${table} ORDER BY id`).all() as Array<{ id: string; document_json: string }>;
    return rows.map((row) => ({ id: row.id, document: JSON.parse(row.document_json) as T }));
  }

  replaceDocuments(table: 'profiles' | 'software_packages' | 'custom_scripts' | 'os_images', documents: ReadonlyArray<{ id: string; document: unknown }>): void {
    this.transaction(() => {
      this.#replaceDocuments(table, documents);
    });
  }

  replaceProductState(input: {
    config: unknown;
    profiles: ReadonlyArray<{ id: string; document: unknown }>;
    softwarePackages: ReadonlyArray<{ id: string; document: unknown }>;
    customScripts: ReadonlyArray<{ id: string; document: unknown }>;
    osImages: ReadonlyArray<{ id: string; document: unknown }>;
  }): void {
    this.transaction(() => {
      this.setSetting('product.config', input.config);
      this.#replaceDocuments('profiles', input.profiles);
      this.#replaceDocuments('software_packages', input.softwarePackages);
      this.#replaceDocuments('custom_scripts', input.customScripts);
      this.#replaceDocuments('os_images', input.osImages);
      this.setSetting('product.updatedAt', new Date().toISOString());
    });
  }

  saveDeploymentRun(input: { id: string; state: string; summary: unknown; startedAt: string; finishedAt?: string | null }): void {
    this.#database.prepare(`
      INSERT INTO deployment_runs (id, state, summary_json, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET state = excluded.state, summary_json = excluded.summary_json,
        started_at = excluded.started_at, finished_at = excluded.finished_at
    `).run(input.id, input.state, JSON.stringify(input.summary), input.startedAt, input.finishedAt ?? null);
  }

  saveEvidence(input: { id: string; runId?: string | null; kind: string; relativePath: string; sha256: string; sizeBytes: number; retainedUntil?: string | null; createdAt: string }): void {
    this.#database.prepare(`
      INSERT INTO evidence_index (id, run_id, kind, relative_path, sha256, size_bytes, retained_until, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, kind = excluded.kind,
        relative_path = excluded.relative_path, sha256 = excluded.sha256, size_bytes = excluded.size_bytes,
        retained_until = excluded.retained_until, created_at = excluded.created_at
    `).run(input.id, input.runId ?? null, input.kind, input.relativePath, input.sha256, input.sizeBytes, input.retainedUntil ?? null, input.createdAt);
  }

  replaceEvidence(entries: ReadonlyArray<{ id: string; runId?: string | null; kind: string; relativePath: string; sha256: string; sizeBytes: number; retainedUntil?: string | null; createdAt: string }>): void {
    this.transaction(() => {
      this.#database.prepare('DELETE FROM evidence_index').run();
      for (const entry of entries) this.saveEvidence(entry);
    });
  }

  replaceEvidenceCatalog(input: {
    runs: ReadonlyArray<{ id: string; state: string; summary: unknown; startedAt: string; finishedAt?: string | null }>;
    entries: ReadonlyArray<{ id: string; runId?: string | null; kind: string; relativePath: string; sha256: string; sizeBytes: number; retainedUntil?: string | null; createdAt: string }>;
  }): void {
    this.transaction(() => {
      this.#database.prepare('DELETE FROM evidence_index').run();
      this.#database.prepare('DELETE FROM deployment_runs').run();
      for (const run of input.runs) this.saveDeploymentRun(run);
      for (const entry of input.entries) this.saveEvidence(entry);
    });
  }

  evidenceCount(): number {
    const row = this.#database.prepare('SELECT COUNT(*) AS count FROM evidence_index').get() as { count: number };
    return row.count;
  }

  setProtectedSecret(name: string, ciphertext: string): void {
    this.#database.prepare(`
      INSERT INTO protected_secrets (name, ciphertext, protection_scope, updated_at)
      VALUES (?, ?, 'LocalMachine', ?)
      ON CONFLICT(name) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at
    `).run(name, ciphertext, new Date().toISOString());
  }

  getProtectedSecret(name: string): string | undefined {
    const row = this.#database.prepare('SELECT ciphertext FROM protected_secrets WHERE name = ?').get(name) as { ciphertext: string } | undefined;
    return row?.ciphertext;
  }

  save(record: OperationRecord): void {
    this.#database.prepare(`
      INSERT INTO operations (id, label, resources_json, status, started_at, finished_at, error_code)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        resources_json = excluded.resources_json,
        status = excluded.status,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        error_code = excluded.error_code
    `).run(
      record.id,
      record.label,
      JSON.stringify(record.resources),
      record.status,
      record.startedAt,
      record.finishedAt ?? null,
      record.errorCode ?? null,
    );
  }

  list(limit = 100): OperationRecord[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const rows = this.#database.prepare(`
      SELECT id, label, resources_json, status, started_at, finished_at, error_code
      FROM operations
      ORDER BY started_at DESC
      LIMIT ?
    `).all(safeLimit) as unknown as OperationRow[];
    return rows.map(operationFromRow);
  }

  recoverInterruptedOperations(at = new Date()): number {
    const result = this.#database.prepare(`
      UPDATE operations
      SET status = 'failed', finished_at = ?, error_code = 'AGENT_RESTARTED'
      WHERE status = 'running'
    `).run(at.toISOString());
    return Number(result.changes);
  }

  schemaVersion(): number {
    const row = this.#database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
    return row.version ?? 0;
  }

  #migrate(options: DatabaseOptions): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const current = this.schemaVersion();
    if (current > CURRENT_SCHEMA_VERSION) throw new Error(`Unsupported database schema version ${current}.`);
    if (current < 1) {
      this.transaction(() => {
        this.#database.exec(`
          CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE profiles (
            id TEXT PRIMARY KEY,
            document_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE software_packages (
            id TEXT PRIMARY KEY,
            document_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE custom_scripts (
            id TEXT PRIMARY KEY,
            document_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE operations (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            resources_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed', 'aborted')),
            started_at TEXT NOT NULL,
            finished_at TEXT,
            error_code TEXT
          );
          CREATE TABLE protected_secrets (
            name TEXT PRIMARY KEY,
            ciphertext TEXT NOT NULL,
            protection_scope TEXT NOT NULL CHECK(protection_scope = 'LocalMachine'),
            updated_at TEXT NOT NULL
          );
          CREATE TABLE deployment_runs (
            id TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT
          );
          CREATE TABLE evidence_index (
            id TEXT PRIMARY KEY,
            run_id TEXT,
            kind TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
            retained_until TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES deployment_runs(id) ON DELETE SET NULL
          );
        `);
        options.migrationFailpoint?.(1);
        this.#database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(new Date().toISOString());
      });
    }
    if (current < 2) {
      this.transaction(() => {
        this.#database.exec(`
          CREATE TABLE os_images (
            id TEXT PRIMARY KEY,
            document_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        options.migrationFailpoint?.(2);
        this.#database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)').run(new Date().toISOString());
      });
    }
  }

  #replaceDocuments(table: 'profiles' | 'software_packages' | 'custom_scripts' | 'os_images', documents: ReadonlyArray<{ id: string; document: unknown }>): void {
    this.#database.prepare(`DELETE FROM ${table}`).run();
    for (const item of documents) this.saveDocument(table, item.id, item.document);
  }
}

function operationFromRow(row: OperationRow): OperationRecord {
  const record: OperationRecord = {
    id: row.id,
    label: row.label,
    resources: JSON.parse(row.resources_json) as OperationRecord['resources'],
    status: row.status,
    startedAt: row.started_at,
  };
  if (row.finished_at) record.finishedAt = row.finished_at;
  if (row.error_code) record.errorCode = row.error_code;
  return record;
}
