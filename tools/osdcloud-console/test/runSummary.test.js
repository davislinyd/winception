import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRunsIndex, updateRunSummary } from '../src/runSummary.js';

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

test('keeps completed display at 100 when finalizer events arrive later', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-summary-terminal-'));
  try {
    updateRunSummary(root, {
      receivedAt: '2026-05-09T01:15:00Z',
      runId: 'run-terminal',
      clientId: 'client-terminal',
      stage: 'windows-desktop-ready',
      message: 'desktop ready',
      percent: 100,
      elapsedSeconds: 900,
    });
    const result = updateRunSummary(root, {
      receivedAt: '2026-05-09T01:15:05Z',
      runId: 'run-terminal',
      clientId: 'client-terminal',
      stage: 'windows-setupcomplete-finished',
      message: 'setupcomplete finished',
      percent: 96,
      elapsedSeconds: 905,
    });

    assert.equal(result.summary.status, 'completed');
    assert.equal(result.summary.latestStage, 'windows-desktop-ready');
    assert.equal(result.summary.latestMessage, 'desktop ready');
    assert.equal(result.summary.latestPercent, 100);
    assert.equal(result.summary.elapsedSeconds, 900);
    assert.equal(result.summary.lastReceivedAt, '2026-05-09T01:15:05Z');
    assert.equal(result.summary.eventCount, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tracks interleaved runs without overwriting summaries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-summary-fleet-'));
  try {
    updateRunSummary(root, {
      receivedAt: '2026-05-09T01:00:00Z',
      runId: 'run-a',
      clientId: 'client-a',
      stage: 'winpe-start',
      percent: 1,
    });
    updateRunSummary(root, {
      receivedAt: '2026-05-09T01:01:00Z',
      runId: 'run-b',
      clientId: 'client-b',
      stage: 'winpe-start',
      percent: 1,
    });
    updateRunSummary(root, {
      receivedAt: '2026-05-09T01:02:00Z',
      runId: 'run-a',
      clientId: 'client-a',
      stage: 'apply-image',
      percent: 25,
    });
    updateRunSummary(root, {
      receivedAt: '2026-05-09T01:03:00Z',
      runId: 'run-b',
      clientId: 'client-b',
      stage: 'windows-desktop-ready',
      percent: 100,
    });

    const runA = JSON.parse(fs.readFileSync(path.join(root, 'run-a.summary.json'), 'utf8'));
    const runB = JSON.parse(fs.readFileSync(path.join(root, 'run-b.summary.json'), 'utf8'));
    assert.equal(runA.latestStage, 'apply-image');
    assert.equal(runA.status, 'running');
    assert.equal(runB.latestStage, 'windows-desktop-ready');
    assert.equal(runB.status, 'completed');

    const index = JSON.parse(fs.readFileSync(path.join(root, 'runs-index.json'), 'utf8'));
    assert.equal(index.total, 2);
    assert.equal(index.counts.running, 1);
    assert.equal(index.counts.completed, 1);
    assert.deepEqual(index.runs.map((run) => run.runId), ['run-b', 'run-a']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('marks stale per run without changing active runs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-summary-stale-'));
  try {
    updateRunSummary(root, {
      receivedAt: '2026-05-09T01:00:00Z',
      runId: 'old-run',
      clientId: 'client-old',
      stage: 'rebooting',
    });
    updateRunSummary(root, {
      receivedAt: '2026-05-09T01:29:00Z',
      runId: 'fresh-run',
      clientId: 'client-fresh',
      stage: 'apply-image',
    });

    const index = buildRunsIndex(root, new Date('2026-05-09T01:30:01Z'));
    const oldRun = index.runs.find((run) => run.runId === 'old-run');
    const freshRun = index.runs.find((run) => run.runId === 'fresh-run');
    assert.equal(oldRun.status, 'stale');
    assert.equal(oldRun.previousStatus, 'awaiting-windows');
    assert.equal(freshRun.status, 'running');
    assert.equal(index.counts.stale, 1);
    assert.equal(index.counts.running, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stores missing run id events in unknown bucket with warning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-summary-unknown-'));
  try {
    updateRunSummary(root, {
      receivedAt: '2026-05-09T01:00:00Z',
      clientId: 'legacy-client',
      stage: 'winpe-start',
    });

    const summary = JSON.parse(fs.readFileSync(path.join(root, 'unknown.summary.json'), 'utf8'));
    assert.equal(summary.runId, 'unknown');
    assert.deepEqual(summary.warnings, ['missing-run-id']);

    const index = buildRunsIndex(root, new Date('2026-05-09T01:01:00Z'));
    assert.equal(index.total, 1);
    assert.equal(index.runs[0].runId, 'unknown');
    assert.deepEqual(index.runs[0].warnings, ['missing-run-id']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('marks booting run stale after 5 minutes with customization warning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-summary-booting-'));
  try {
    updateRunSummary(root, {
      receivedAt: '2026-05-09T01:00:00Z',
      runId: 'booting-test',
      clientId: 'client-boot',
      stage: 'pxe-booting',
    });

    // 1. Check at 4 minutes: should still be running
    let index = buildRunsIndex(root, new Date('2026-05-09T01:04:00Z'));
    let run = index.runs.find((r) => r.runId === 'booting-test');
    assert.equal(run.status, 'running');

    // 2. Check at 6 minutes: should be stale with custom reason
    index = buildRunsIndex(root, new Date('2026-05-09T01:06:00Z'));
    run = index.runs.find((r) => r.runId === 'booting-test');
    assert.equal(run.status, 'stale');
    assert.match(run.staleReason, /boot\.wim may be uncustomized/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

