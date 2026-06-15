import fs from 'node:fs';
import path from 'node:path';

export const winpeEndStages = new Set(['osdcloud-finished', 'rebooting']);
export const windowsStartStages = new Set(['windows-setupcomplete-start', 'windows-logon-start']);
export const runEndStages = new Set(['windows-desktop-ready']);
export const failureStages = new Set([
  'image-missing',
  'osdcloud-error',
  'reporter-error',
  'windows-setupcomplete-error',
  'windows-desktop-timeout',
]);
export const staleThresholdMs = 15 * 60 * 1000;
export const terminalStatuses = new Set(['completed', 'failed', 'stale']);


function safeReadJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
  }
  return fallback;
}

function appendRecord(statusRoot, record) {
  const pathName = path.join(statusRoot, 'deployment-runs.jsonl');
  fs.appendFileSync(pathName, `${JSON.stringify(record)}\n`, 'utf8');
}

function parseDate(value) {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function sortTimestamp(value) {
  return parseDate(value) ?? 0;
}

function compareRuns(a, b) {
  const timeDelta = sortTimestamp(b.startedAt) - sortTimestamp(a.startedAt);
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return String(a.runId ?? '').localeCompare(String(b.runId ?? ''), undefined, { numeric: true });
}

function uniqueWarnings(values) {
  return [...new Set((values ?? []).filter(Boolean).map(String))];
}

function sanitizeRunId(value) {
  return String(value ?? 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120) || 'unknown';
}

export function compactRunSummary(summary, now = new Date()) {
  const nowDate = asDate(now);
  const run = {
    runId: summary.runId ?? 'unknown',
    clientId: summary.clientId ?? null,
    status: summary.status ?? 'running',
    startedAt: summary.startedAt ?? null,
    startedTimestamp: summary.startedTimestamp ?? null,
    startStage: summary.startStage ?? null,
    eventCount: Number(summary.eventCount ?? 0),
    latestStage: summary.latestStage ?? null,
    latestMessage: summary.latestMessage ?? null,
    latestPercent: Number.isFinite(summary.latestPercent) ? summary.latestPercent : null,
    elapsedSeconds: Number.isFinite(summary.elapsedSeconds) ? summary.elapsedSeconds : null,
    lastReceivedAt: summary.lastReceivedAt ?? summary.startedAt ?? null,
    winpeEndedAt: summary.winpeEndedAt ?? null,
    windowsStartedAt: summary.windowsStartedAt ?? null,
    completedAt: summary.completedAt ?? null,
    failedAt: summary.failedAt ?? null,
    warnings: uniqueWarnings(summary.warnings),
  };

  const lastSeen = parseDate(run.lastReceivedAt);
  const ageMs = lastSeen === null ? null : nowDate.getTime() - lastSeen;
  const isBooting = run.latestStage === 'pxe-booting';
  const threshold = isBooting ? 5 * 60 * 1000 : staleThresholdMs;

  if (!terminalStatuses.has(run.status) && ageMs !== null && ageMs > threshold) {
    run.previousStatus = run.status;
    run.status = 'stale';
    if (isBooting) {
      run.staleReason = 'WinPE boot completed but client did not check in. boot.wim may be uncustomized.';
    } else {
      run.staleReason = `no status events for ${Math.floor(ageMs / 60000)} minutes`;
    }
  }

  return run;
}

function readSummaryFiles(statusRoot, now = new Date()) {
  if (!fs.existsSync(statusRoot)) {
    return [];
  }

  return fs.readdirSync(statusRoot)
    .filter((entry) => entry.endsWith('.summary.json') && entry !== 'latest-summary.json')
    .flatMap((entry) => {
      const summary = safeReadJson(path.join(statusRoot, entry), null);
      return summary ? [compactRunSummary(summary, now)] : [];
    });
}

function countRuns(runs) {
  return runs.reduce((counts, run) => {
    const status = run.status ?? 'unknown';
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {
    running: 0,
    'awaiting-windows': 0,
    'windows-running': 0,
    stale: 0,
    failed: 0,
    completed: 0,
  });
}

export function buildRunsIndex(statusRoot, now = new Date()) {
  const nowDate = asDate(now);
  const runs = readSummaryFiles(statusRoot, nowDate).sort(compareRuns);
  return {
    updatedAt: nowDate.toISOString(),
    total: runs.length,
    counts: countRuns(runs),
    runs,
  };
}

export function writeRunsIndex(statusRoot, now = new Date()) {
  const index = buildRunsIndex(statusRoot, now);
  fs.mkdirSync(statusRoot, { recursive: true });
  fs.writeFileSync(path.join(statusRoot, 'runs-index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return index;
}

export function updateRunSummary(statusRoot, event) {
  const rawRunId = event.runId;
  const runId = sanitizeRunId(rawRunId);
  const summaryPath = path.join(statusRoot, `${runId}.summary.json`);
  const existing = safeReadJson(summaryPath, null);
  const now = event.receivedAt || new Date().toISOString();
  const records = [];

  const summary = existing ?? {
    runId,
    clientId: event.clientId ?? null,
    startedAt: now,
    startedTimestamp: event.timestamp ?? null,
    startStage: event.stage ?? null,
    eventCount: 0,
    status: 'running',
  };

  if (!existing) {
    records.push({
      type: 'run-start',
      runId,
      clientId: event.clientId ?? null,
      receivedAt: now,
      stage: event.stage ?? null,
      message: event.message ?? null,
    });
  }

  const warnings = uniqueWarnings([
    ...(summary.warnings ?? []),
    ...(Array.isArray(event.warnings) ? event.warnings : []),
    rawRunId ? null : 'missing-run-id',
    rawRunId && runId !== String(rawRunId) ? 'run-id-sanitized' : null,
  ]);

  summary.clientId = summary.clientId || event.clientId || null;
  summary.eventCount = Number(summary.eventCount ?? 0) + 1;
  summary.lastReceivedAt = now;
  summary.latestStage = event.stage ?? null;
  summary.latestMessage = event.message ?? null;
  summary.latestPercent = Number.isFinite(event.percent) ? event.percent : null;
  summary.elapsedSeconds = Number.isFinite(event.elapsedSeconds) ? event.elapsedSeconds : summary.elapsedSeconds;
  if (warnings.length > 0) {
    summary.warnings = warnings;
  }

  if (winpeEndStages.has(event.stage) && !summary.winpeEndedAt) {
    summary.winpeEndedAt = now;
    summary.winpeEndStage = event.stage;
    if (summary.status !== 'completed' && summary.status !== 'failed') {
      summary.status = 'awaiting-windows';
    }
    records.push({
      type: 'winpe-end',
      runId,
      clientId: summary.clientId,
      receivedAt: now,
      stage: event.stage,
      message: event.message ?? null,
    });
  }

  if (windowsStartStages.has(event.stage) && !summary.windowsStartedAt) {
    summary.windowsStartedAt = now;
    if (summary.status !== 'completed' && summary.status !== 'failed') {
      summary.status = 'windows-running';
    }
    records.push({
      type: 'windows-start',
      runId,
      clientId: summary.clientId,
      receivedAt: now,
      stage: event.stage,
      message: event.message ?? null,
    });
  }

  if (runEndStages.has(event.stage) && !summary.completedAt) {
    summary.status = 'completed';
    summary.completedAt = now;
    summary.completedStage = event.stage;
    records.push({
      type: 'run-end',
      runId,
      clientId: summary.clientId,
      receivedAt: now,
      stage: event.stage,
      message: event.message ?? null,
    });
  } else if (failureStages.has(event.stage) && !summary.failedAt) {
    summary.status = 'failed';
    summary.failedAt = now;
    summary.failedStage = event.stage;
    records.push({
      type: 'run-failed',
      runId,
      clientId: summary.clientId,
      receivedAt: now,
      stage: event.stage,
      message: event.message ?? null,
    });
  } else if (winpeEndStages.has(event.stage) && summary.status !== 'completed' && summary.status !== 'failed') {
    summary.status = 'awaiting-windows';
  } else if (windowsStartStages.has(event.stage) && summary.status !== 'completed' && summary.status !== 'failed') {
    summary.status = 'windows-running';
  } else if (summary.status !== 'completed' && summary.status !== 'failed' && summary.status !== 'awaiting-windows' && summary.status !== 'windows-running') {
    summary.status = 'running';
  }

  fs.mkdirSync(statusRoot, { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(statusRoot, 'latest-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  for (const record of records) {
    appendRecord(statusRoot, record);
  }
  const runsIndex = writeRunsIndex(statusRoot, new Date(now));

  return { summary, records, runsIndex };
}
