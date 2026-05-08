import fs from 'node:fs';
import path from 'node:path';

const winpeEndStages = new Set(['osdcloud-finished', 'rebooting']);
const windowsStartStages = new Set(['windows-setupcomplete-start', 'windows-logon-start']);
const runEndStages = new Set(['windows-desktop-ready']);
const failureStages = new Set([
  'image-missing',
  'osdcloud-error',
  'reporter-error',
  'windows-setupcomplete-error',
  'windows-desktop-timeout',
]);

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

export function updateRunSummary(statusRoot, event) {
  const runId = String(event.runId || 'unknown');
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

  summary.clientId = summary.clientId || event.clientId || null;
  summary.eventCount = Number(summary.eventCount ?? 0) + 1;
  summary.lastReceivedAt = now;
  summary.latestStage = event.stage ?? null;
  summary.latestMessage = event.message ?? null;
  summary.latestPercent = Number.isFinite(event.percent) ? event.percent : null;
  summary.elapsedSeconds = Number.isFinite(event.elapsedSeconds) ? event.elapsedSeconds : summary.elapsedSeconds;

  if (winpeEndStages.has(event.stage) && !summary.winpeEndedAt) {
    summary.winpeEndedAt = now;
    summary.winpeEndStage = event.stage;
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
  } else if (summary.status !== 'completed' && summary.status !== 'failed') {
    summary.status = 'running';
  }

  fs.mkdirSync(statusRoot, { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(statusRoot, 'latest-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  for (const record of records) {
    appendRecord(statusRoot, record);
  }

  return { summary, records };
}
