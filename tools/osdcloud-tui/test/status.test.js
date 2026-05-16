import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deleteStatusRun,
  formatDeploymentStatus,
  formatFleetClientRows,
  formatFleetRunDetail,
  formatStatusEventLine,
  resolveDeploymentSummary,
} from '../src/status.js';

function statusConfig(statusRoot) {
  return {
    http: { statusRoot },
    paths: {
      statusLatest: path.join(statusRoot, 'latest.json'),
      statusEvents: path.join(statusRoot, 'progress.jsonl'),
    },
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function expectedLocalOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
}

function expectedLocalTimestamp(value) {
  const date = new Date(value);
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
    expectedLocalOffset(date),
  ].join(' ');
}

function expectedLocalClock(value) {
  const date = new Date(value);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

test('formats missing deployment status with visible placeholder', () => {
  const lines = formatDeploymentStatus(null);
  assert.match(lines.join('\n'), /No deployment status yet/);
});

test('formats deployment status without terminal formatting tags', () => {
  const lines = formatDeploymentStatus({
    runId: '20260509-012719-9VDYLD4',
    clientId: '9VDYLD4',
    stage: 'apply-image',
    percent: 2,
    elapsedSeconds: 221,
    receivedAt: '2026-05-08T17:31:06.272Z',
    message: 'HKLM\\{bf1a281b-ad7b-4476-ac95-f47682990ce7}\\Windows status update',
  });

  assert.equal(lines[0], 'Status   : running');
  assert.equal(lines[1], 'Run      : 20260509-012719-9VDYLD4');
  assert.equal(lines[2], 'Client   : 9VDYLD4');
  assert.match(lines[3], /Stage    : apply-image/);
  assert.match(lines.join('\n'), /Status   : running/);
  assert.match(lines.join('\n'), /HKLM\\\{bf1a281b/);
});

test('formats deployment summary start and end records', () => {
  const lines = formatDeploymentStatus({
    runId: 'run-1',
    clientId: 'client-1',
    stage: 'windows-desktop-ready',
    percent: 100,
    message: 'Desktop ready.',
  }, {
    status: 'completed',
    startedAt: '2026-05-09T01:00:00Z',
    winpeEndedAt: '2026-05-09T01:10:00Z',
    completedAt: '2026-05-09T01:15:00Z',
  });

  assert.match(lines.join('\n'), /Status   : completed/);
  assert.ok(lines.join('\n').includes(`Started  : ${expectedLocalTimestamp('2026-05-09T01:00:00Z')}`));
  assert.ok(lines.join('\n').includes(`Finished : ${expectedLocalTimestamp('2026-05-09T01:15:00Z')}`));
});

test('does not display WinPE reboot handoff as active running', () => {
  const latest = {
    runId: 'run-rebooting',
    clientId: 'client-1',
    stage: 'rebooting',
    receivedAt: '2026-05-09T01:00:00Z',
    message: 'WinPE is rebooting in 10 seconds.',
  };

  const summary = resolveDeploymentSummary(
    { http: { statusRoot: os.tmpdir() } },
    latest,
    null,
    new Date('2026-05-09T01:01:00Z'),
  );

  assert.equal(summary.status, 'awaiting-windows');
  assert.match(formatDeploymentStatus(latest, summary).join('\n'), /Status   : awaiting-windows/);
});

test('marks old unfinished status as stale previous run', () => {
  const latest = {
    runId: 'run-stale',
    clientId: 'client-1',
    stage: 'rebooting',
    receivedAt: '2026-05-09T01:00:00Z',
    message: 'WinPE is rebooting in 10 seconds.',
  };

  const summary = resolveDeploymentSummary(
    { http: { statusRoot: os.tmpdir() } },
    latest,
    null,
    new Date('2026-05-09T01:30:00Z'),
  );

  assert.equal(summary.status, 'stale');
  assert.equal(summary.previousStatus, 'awaiting-windows');
  assert.match(formatDeploymentStatus(latest, summary).join('\n'), /stale \(awaiting-windows; previous run\)/);
});

test('derives completed status from legacy per-run events', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-status-derive-'));
  try {
    const events = [
      { receivedAt: '2026-05-09T01:00:00Z', runId: 'run-derived', clientId: 'client-1', stage: 'winpe-start', message: 'start' },
      { receivedAt: '2026-05-09T01:10:00Z', runId: 'run-derived', clientId: 'client-1', stage: 'rebooting', message: 'reboot' },
      { receivedAt: '2026-05-09T01:15:00Z', runId: 'run-derived', clientId: 'client-1', stage: 'windows-desktop-ready', message: 'ready' },
    ];
    fs.writeFileSync(path.join(root, 'run-derived.jsonl'), events.map((event) => JSON.stringify(event)).join('\n'));

    const summary = resolveDeploymentSummary(
      { http: { statusRoot: root } },
      events.at(-1),
      null,
      new Date('2026-05-09T01:20:00Z'),
    );

    assert.equal(summary.status, 'completed');
    assert.equal(summary.winpeEndedAt, '2026-05-09T01:10:00Z');
    assert.equal(summary.completedAt, '2026-05-09T01:15:00Z');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('formats fleet client rows for empty, long, and many clients', () => {
  assert.deepEqual(formatFleetClientRows([], 80), ['No deployment clients yet.']);

  const longRows = formatFleetClientRows([{
    runId: 'run-with-a-very-long-identifier-that-must-fit',
    clientId: 'client-with-a-very-long-name',
    status: 'windows-running',
    latestStage: 'apply-image-with-a-very-long-stage-name',
    latestPercent: 42,
    lastReceivedAt: '2026-05-09T01:00:00Z',
    elapsedSeconds: 125,
  }], 72);
  assert.equal(longRows.length, 1);
  assert.ok(longRows[0].length <= 72);
  assert.match(longRows[0], /windows-running/);
  assert.match(longRows[0], new RegExp(expectedLocalClock('2026-05-09T01:00:00Z')));

  const many = Array.from({ length: 40 }, (_, index) => ({
    runId: `run-${index}`,
    clientId: `client-${index}`,
    status: index % 2 === 0 ? 'running' : 'completed',
    latestStage: 'apply-image',
    latestPercent: index,
    lastReceivedAt: `2026-05-09T01:${String(index).padStart(2, '0')}:00Z`,
    elapsedSeconds: index * 10,
  }));
  const rows = formatFleetClientRows(many, 90);
  assert.equal(rows.length, 40);
  assert.ok(rows.every((row) => row.length <= 90));
});

test('formats selected fleet run detail and screenshot metadata', () => {
  const lines = formatFleetRunDetail({
    runId: 'run-1',
    clientId: 'client-1',
    status: 'completed',
    latestStage: 'windows-desktop-ready',
    latestPercent: 100,
    elapsedSeconds: 900,
    startedAt: '2026-05-09T01:00:00Z',
    winpeEndedAt: '2026-05-09T01:10:00Z',
    windowsStartedAt: '2026-05-09T01:12:00Z',
    completedAt: '2026-05-09T01:15:00Z',
    lastReceivedAt: '2026-05-09T01:15:00Z',
    latestMessage: 'desktop ready',
    warnings: ['run-id-sanitized'],
  }, {
    stage: 'winpe-start',
    timestamp: '2026-05-09T01:01:00Z',
    filePath: 'C:\\status\\screenshots\\run-1\\shot.png',
  });

  const text = lines.join('\n');
  assert.match(text, /Status   : completed/);
  assert.ok(text.includes(`Windows  : ${expectedLocalTimestamp('2026-05-09T01:12:00Z')}`));
  assert.match(text, /Warnings : run-id-sanitized/);
  assert.ok(text.includes(`Latest Shot: winpe-start ${expectedLocalTimestamp('2026-05-09T01:01:00Z')}`));
});

test('formats long status events into compact host-console lines', () => {
  const line = JSON.stringify({
    receivedAt: '2026-05-09T18:35:42.036Z',
    clientId: '9VDYLD4',
    stage: 'apply-image',
    percent: 42,
    message: 'x'.repeat(1000),
    largePayload: 'y'.repeat(3000),
  });

  const formatted = formatStatusEventLine(line, 120);

  assert.ok(formatted.length <= 120);
  assert.ok(formatted.includes(expectedLocalTimestamp('2026-05-09T18:35:42.036Z')));
  assert.match(formatted, /9VDYLD4/);
  assert.match(formatted, /apply-image/);
  assert.match(formatted, /42%/);
});

test('deletes a single status run and rebuilds the fleet index', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-status-delete-'));
  try {
    const config = statusConfig(root);
    fs.mkdirSync(path.join(root, 'screenshots', 'run-a'), { recursive: true });
    fs.writeFileSync(path.join(root, 'run-a.summary.json'), JSON.stringify({ runId: 'run-a', clientId: 'client-a', status: 'completed' }));
    fs.writeFileSync(path.join(root, 'run-a.jsonl'), `${JSON.stringify({ runId: 'run-a', stage: 'winpe-start' })}\n`);
    fs.writeFileSync(path.join(root, 'run-a.latest.json'), JSON.stringify({ runId: 'run-a', stage: 'windows-desktop-ready' }));
    fs.writeFileSync(path.join(root, 'run-a.screenshots.jsonl'), `${JSON.stringify({ runId: 'run-a', filePath: 'shot.png' })}\n`);
    fs.writeFileSync(path.join(root, 'screenshots', 'run-a', 'shot.png'), 'png');
    fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ runId: 'run-a' }));
    fs.writeFileSync(path.join(root, 'latest-summary.json'), JSON.stringify({ runId: 'run-a' }));
    fs.writeFileSync(path.join(root, 'latest-screenshot.json'), JSON.stringify({ runId: 'run-a' }));

    fs.writeFileSync(path.join(root, 'run-b.summary.json'), JSON.stringify({ runId: 'run-b', clientId: 'client-a', status: 'completed' }));
    fs.writeFileSync(path.join(root, 'run-b.jsonl'), `${JSON.stringify({ runId: 'run-b', stage: 'winpe-start' })}\n`);

    const result = deleteStatusRun(config, 'run-a');

    assert.equal(result.runId, 'run-a');
    assert.equal(fs.existsSync(path.join(root, 'run-a.summary.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'run-a.jsonl')), false);
    assert.equal(fs.existsSync(path.join(root, 'run-a.latest.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'run-a.screenshots.jsonl')), false);
    assert.equal(fs.existsSync(path.join(root, 'screenshots', 'run-a')), false);
    assert.equal(fs.existsSync(path.join(root, 'latest.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'latest-summary.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'latest-screenshot.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'run-b.summary.json')), true);

    const index = JSON.parse(fs.readFileSync(path.join(root, 'runs-index.json'), 'utf8'));
    assert.equal(index.total, 1);
    assert.equal(index.runs[0].runId, 'run-b');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('delete status run rejects missing and invalid run ids', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-status-delete-invalid-'));
  try {
    const config = statusConfig(root);
    fs.writeFileSync(path.join(root, 'run-a.summary.json'), JSON.stringify({ runId: 'run-a', status: 'completed' }));

    assert.throws(() => deleteStatusRun(config, 'missing'), /Deployment run not found: missing/);
    assert.throws(() => deleteStatusRun(config, '..\\run-a'), /Invalid run ID/);
    assert.equal(fs.existsSync(path.join(root, 'run-a.summary.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
