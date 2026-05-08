import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateRunSummary } from '../src/runSummary.js';

test('records deployment run start, WinPE end, Windows start, and final end', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-summary-test-'));
  try {
    let result = updateRunSummary(root, {
      receivedAt: '2026-05-09T01:00:00Z',
      runId: 'run-1',
      clientId: 'client-1',
      stage: 'winpe-start',
      message: 'started',
    });
    assert.equal(result.records[0].type, 'run-start');

    result = updateRunSummary(root, {
      receivedAt: '2026-05-09T01:10:00Z',
      runId: 'run-1',
      clientId: 'client-1',
      stage: 'rebooting',
      message: 'rebooting',
    });
    assert.equal(result.records[0].type, 'winpe-end');

    result = updateRunSummary(root, {
      receivedAt: '2026-05-09T01:12:00Z',
      runId: 'run-1',
      clientId: 'client-1',
      stage: 'windows-setupcomplete-start',
      message: 'setupcomplete',
    });
    assert.equal(result.records[0].type, 'windows-start');

    result = updateRunSummary(root, {
      receivedAt: '2026-05-09T01:15:00Z',
      runId: 'run-1',
      clientId: 'client-1',
      stage: 'windows-desktop-ready',
      message: 'desktop',
    });
    assert.equal(result.records[0].type, 'run-end');
    assert.equal(result.summary.status, 'completed');

    const summary = JSON.parse(fs.readFileSync(path.join(root, 'run-1.summary.json'), 'utf8'));
    assert.equal(summary.startedAt, '2026-05-09T01:00:00Z');
    assert.equal(summary.winpeEndedAt, '2026-05-09T01:10:00Z');
    assert.equal(summary.windowsStartedAt, '2026-05-09T01:12:00Z');
    assert.equal(summary.completedAt, '2026-05-09T01:15:00Z');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
