import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WinceptionDatabase } from '../src/database.js';
import { writeJsonAtomic } from '../src/atomicFile.js';

function withTempDirectory(action: (root: string) => void): void {
  const root = mkdtempSync(join(process.cwd(), '.tmp-v2-'));
  try { action(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('SQLite migrations and repositories are transactional', () => withTempDirectory((root) => {
  const database = new WinceptionDatabase(join(root, 'state', 'winception.db'));
  assert.equal(database.schemaVersion(), 2);
  database.setSetting('network', { mode: 'shared-lan' });
  database.saveDocument('profiles', 'minimal', { name: 'Minimal' });
  database.save({
    id: 'op-1', label: 'Preflight', resources: ['runtime'], status: 'succeeded',
    startedAt: '2026-07-13T00:00:00.000Z', finishedAt: '2026-07-13T00:00:01.000Z',
  });
  assert.deepEqual(database.getSetting('network'), { mode: 'shared-lan' });
  assert.equal(database.listDocuments<{ name: string }>('profiles')[0]?.document.name, 'Minimal');
  assert.equal(database.list()[0]?.status, 'succeeded');
  assert.throws(() => database.transaction(() => {
    database.setSetting('rollback', true);
    throw new Error('rollback');
  }), /rollback/u);
  assert.equal(database.getSetting('rollback'), undefined);
  database.close();
}));

test('startup recovery marks orphaned running operations as failed', () => withTempDirectory((root) => {
  const database = new WinceptionDatabase(join(root, 'state.db'));
  database.save({ id: 'orphan', label: 'Interrupted', resources: ['runtime'], status: 'running', startedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(database.recoverInterruptedOperations(new Date('2026-01-02T00:00:00.000Z')), 1);
  assert.deepEqual(database.list(1)[0], {
    id: 'orphan', label: 'Interrupted', resources: ['runtime'], status: 'failed',
    startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-02T00:00:00.000Z', errorCode: 'AGENT_RESTARTED',
  });
  database.close();
}));

test('atomic JSON writer restores the prior file when replacement fails', () => withTempDirectory((root) => {
  const target = join(root, 'config.json');
  writeFileSync(target, '{"version":1}\n', 'utf8');
  assert.throws(() => writeJsonAtomic(target, { version: 2 }, {
    failpoint: (stage) => { if (stage === 'after-backup') throw new Error('simulated failure'); },
  }), /simulated failure/u);
  assert.equal(readFileSync(target, 'utf8'), '{"version":1}\n');
  assert.throws(() => writeJsonAtomic(target, { version: 3 }, {
    failpoint: (stage) => { if (stage === 'after-temp-write') throw new Error('simulated disk full'); },
  }), /simulated disk full/u);
  assert.equal(readFileSync(target, 'utf8'), '{"version":1}\n');
  writeJsonAtomic(target, { version: 2 });
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { version: 2 });
}));

test('interrupted migration rolls back and a later startup can migrate cleanly', () => withTempDirectory((root) => {
  const path = join(root, 'interrupted.db');
  assert.throws(() => new WinceptionDatabase(path, { migrationFailpoint: () => { throw new Error('simulated migration interruption'); } }), /migration interruption/u);
  const recovered = new WinceptionDatabase(path);
  assert.equal(recovered.schemaVersion(), 2);
  recovered.close();
}));

test('corrupt SQLite state fails closed without overwriting the source file', () => withTempDirectory((root) => {
  const path = join(root, 'corrupt.db');
  writeFileSync(path, 'not-a-sqlite-database', 'utf8');
  assert.throws(() => new WinceptionDatabase(path));
  assert.equal(readFileSync(path, 'utf8'), 'not-a-sqlite-database');
}));
