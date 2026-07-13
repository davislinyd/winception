import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WinceptionDatabase } from '../src/database.js';
import { EvidenceManager } from '../src/evidence.js';

test('evidence maintenance protects active runs, enforces quota and rebuilds the SQLite index', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-evidence-'));
  const stateRoot = join(root, 'state');
  const statusRoot = join(root, 'status');
  try {
    mkdirSync(join(stateRoot, 'logs'), { recursive: true });
    mkdirSync(statusRoot, { recursive: true });
    const activeSummary = join(statusRoot, 'active.summary.json');
    const completedSummary = join(statusRoot, 'done.summary.json');
    writeFileSync(activeSummary, JSON.stringify({ runId: 'active', status: 'running', startedAt: '2026-07-13T00:00:00.000Z' }));
    writeFileSync(completedSummary, JSON.stringify({ runId: 'done', status: 'completed', startedAt: '2026-07-12T00:00:00.000Z', finishedAt: '2026-07-12T01:00:00.000Z' }));
    writeFileSync(join(statusRoot, 'done.jsonl'), '{"stage":"complete"}\n');
    const oldLog = join(stateRoot, 'logs', 'old.log');
    writeFileSync(oldLog, 'old');
    const old = new Date(Date.now() - 10_000);
    for (const path of [activeSummary, completedSummary, join(statusRoot, 'done.jsonl'), oldLog]) utimesSync(path, old, old);

    const database = new WinceptionDatabase(join(stateRoot, 'state.db'));
    database.setSetting('retention.policy', {
      schemaVersion: 1,
      logs: { maxAgeMs: 1000, maxFiles: 10, maxTotalBytes: 1000 },
      evidence: { maxAgeMs: 1000, maxFiles: 10, maxTotalBytes: 1000 },
    });
    const result = await new EvidenceManager({ database, stateRoot }).maintain(statusRoot);
    assert.equal(existsSync(activeSummary), true);
    assert.equal(existsSync(completedSummary), false);
    assert.equal(existsSync(oldLog), false);
    assert.equal(result.indexed, 1);
    assert.equal(result.runs, 1);
    assert.equal(database.evidenceCount(), 1);
    database.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('evidence maintenance rejects protected and drive-root targets', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-evidence-'));
  try {
    const stateRoot = join(root, 'state');
    const protectedRoot = join(root, 'app');
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(join(protectedRoot, 'status'), { recursive: true });
    const database = new WinceptionDatabase(join(stateRoot, 'state.db'));
    const manager = new EvidenceManager({ database, stateRoot, protectedRoots: [protectedRoot] });
    await assert.rejects(manager.maintain(join(protectedRoot, 'status')), /protected/u);
    await assert.rejects(manager.maintain('C:\\'), /drive root/u);
    database.close();
  }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('evidence maintenance defaults missing policy and catalogs every supported evidence shape', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-evidence-'));
  const stateRoot = join(root, 'state');
  const statusRoot = join(root, 'status');
  try {
    const database = new WinceptionDatabase(join(stateRoot, 'state.db'));
    const manager = new EvidenceManager({ database, stateRoot });
    assert.deepEqual(await manager.maintain(statusRoot), { logs: null, evidence: null, indexed: 0, runs: 0 });
    assert.equal((database.getSetting<{ schemaVersion: number }>('retention.policy'))?.schemaVersion, 1);

    mkdirSync(join(stateRoot, 'logs'), { recursive: true });
    mkdirSync(join(statusRoot, 'screenshots', 'shot-run'), { recursive: true });
    mkdirSync(join(statusRoot, 'archive'), { recursive: true });
    writeFileSync(join(stateRoot, 'logs', 'current.log'), 'log');
    writeFileSync(join(statusRoot, 'started.summary.json'), JSON.stringify({ state: 'started', startedAt: 'invalid', finishedAt: 'invalid' }));
    writeFileSync(join(statusRoot, 'active.summary.json'), JSON.stringify({ status: 'active' }));
    writeFileSync(join(statusRoot, 'array.summary.json'), '[]');
    writeFileSync(join(statusRoot, 'broken.summary.json'), '{');
    writeFileSync(join(statusRoot, 'orphan.jsonl'), '{}\n');
    writeFileSync(join(statusRoot, 'bad name.jsonl'), '{}\n');
    writeFileSync(join(statusRoot, 'screenshots', 'shot-run', 'capture.png'), 'png');
    writeFileSync(join(statusRoot, 'archive', 'bundle.zip'), 'zip');
    writeFileSync(join(statusRoot, 'photo.jpg'), 'jpg');
    writeFileSync(join(statusRoot, 'plain.txt'), 'plain');
    writeFileSync(join(statusRoot, 'latest.snapshot.json'), '{}');
    writeFileSync(join(statusRoot, 'runs-index.json'), '{}');

    const result = await manager.maintain(statusRoot);
    assert.equal(result.logs?.removed, 0);
    assert.equal(result.evidence?.removed, 0);
    assert.equal(result.indexed, 12);
    assert.equal(result.runs, 6);
    assert.equal(database.evidenceCount(), 12);
    database.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
