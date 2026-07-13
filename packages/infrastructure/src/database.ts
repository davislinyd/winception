import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { OperationRecord } from '../../contracts/src/index.js';
import type { OperationRepository } from '../../domain/src/ports.js';

const CURRENT_SCHEMA_VERSION = 1;

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

  saveDocument(table: 'profiles' | 'software_packages' | 'custom_scripts', id: string, document: unknown): void {
    this.#database.prepare(`
      INSERT INTO ${table} (id, document_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at
    `).run(id, JSON.stringify(document), new Date().toISOString());
  }

  listDocuments<T>(table: 'profiles' | 'software_packages' | 'custom_scripts'): Array<{ id: string; document: T }> {
    const rows = this.#database.prepare(`SELECT id, document_json FROM ${table} ORDER BY id`).all() as Array<{ id: string; document_json: string }>;
    return rows.map((row) => ({ id: row.id, document: JSON.parse(row.document_json) as T }));
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
