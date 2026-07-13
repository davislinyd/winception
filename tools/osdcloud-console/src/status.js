import fs from 'node:fs';
import path from 'node:path';
import { tailFile } from './logger.js';
import { buildRunsIndex, failureStages, runEndStages, staleThresholdMs, terminalStatuses, windowsStartStages, winpeEndStages, writeRunsIndex } from './runSummary.js';
import { formatLocalClock, formatLocalTimestamp, parseTimestamp } from './timeFormat.js';

function statusError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicError = {
    message,
    code: 'status_request_failed',
    action: 'Refresh the page and try again.',
  };
  return error;
}

export function readLatestStatus(config) {
  const filePath = config.paths.statusLatest;
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function readLatestSummary(config) {
  const filePath = path.join(config.http.statusRoot, 'latest-summary.json');
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function readLatestScreenshot(config) {
  const filePath = path.join(config.http.statusRoot, 'latest-screenshot.json');
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseStatusEventLines(lines) {
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

export function readStatusEvents(config, maxLines = 80) {
  return parseStatusEventLines(tailFile(config.paths.statusEvents, maxLines));
}

export function readRunStatusEvents(config, runIdValue, maxLines = 2000) {
  const runId = String(runIdValue ?? '').trim();
  if (!runId) {
    return [];
  }
  if (!/^[A-Za-z0-9_.-]{1,120}$/u.test(runId)) {
    throw statusError(`Invalid run ID: ${runId}`, 400);
  }

  return parseStatusEventLines(tailFile(path.join(config.http.statusRoot, `${runId}.jsonl`), maxLines));
}

export function readFleetStatus(config, now = new Date()) {
  const indexPath = path.join(config.http.statusRoot, 'runs-index.json');
  const snapshot = readJsonFile(indexPath);
  if (snapshot && Array.isArray(snapshot.runs) && snapshot.counts) {
    return snapshot;
  }
  return buildRunsIndex(config.http.statusRoot, now);
}

function normalizeRunIdForDelete(value) {
  const runId = String(value ?? '').trim();
  if (!runId) {
    throw statusError('Run ID is required.', 400);
  }
  if (!/^[A-Za-z0-9_.-]{1,120}$/u.test(runId)) {
    throw statusError(`Invalid run ID: ${runId}`, 400);
  }
  return runId;
}

function safeStatusPath(statusRoot, ...parts) {
  const root = path.resolve(statusRoot);
  const candidate = path.resolve(root, ...parts);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error('Resolved status path is outside the status root.');
  }
  return candidate;
}

function removePathIfExists(targetPath, options = {}) {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }
  fs.rmSync(targetPath, { force: true, ...options });
  return 1;
}

function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
  }
  return null;
}

function removeLatestIfMatches(filePath, runId) {
  const value = readJsonFile(filePath);
  if (value?.runId !== runId) {
    return 0;
  }
  return removePathIfExists(filePath);
}

function movePathIfExists(source, destination) {
  if (!fs.existsSync(source)) {
    return 0;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.rmSync(destination, { force: true, recursive: true });
  fs.renameSync(source, destination);
  return 1;
}

// Per-run artifacts share the runId prefix; latest-* pointers reference whichever
// run last reported and are cleared (not moved) when a run leaves the active list.
const ARCHIVE_DIR = 'archive';
const RUN_FILE_SUFFIXES = ['.summary.json', '.jsonl', '.late.jsonl', '.latest.json', '.screenshots.jsonl'];
const LATEST_POINTER_FILES = ['latest-summary.json', 'latest-screenshot.json', 'latest.json'];

// Move a run's summary/event/screenshot artifacts between the active status root
// and its archive subfolder. Returns how many artifacts actually moved so callers
// can detect a missing run.
function relocateStatusRun(statusRoot, runId, { fromArchive }) {
  const activePath = (...parts) => safeStatusPath(statusRoot, ...parts);
  const archivePath = (...parts) => safeStatusPath(statusRoot, ARCHIVE_DIR, ...parts);
  let moved = 0;
  for (const suffix of RUN_FILE_SUFFIXES) {
    const name = `${runId}${suffix}`;
    const source = fromArchive ? archivePath(name) : activePath(name);
    const destination = fromArchive ? activePath(name) : archivePath(name);
    moved += movePathIfExists(source, destination);
  }
  const activeShots = activePath('screenshots', runId);
  const archiveShots = archivePath('screenshots', runId);
  moved += movePathIfExists(fromArchive ? archiveShots : activeShots, fromArchive ? activeShots : archiveShots);
  return moved;
}

// Run one mutation per id, isolating per-run failures (e.g. a missing run) so a
// batch deletes/archives every valid id and reports the rest. The runs index is
// rewritten once by the caller after the loop.
function runBatch(runIds, operate) {
  const ids = Array.isArray(runIds) ? runIds : [runIds];
  if (ids.length === 0) {
    throw statusError('At least one run ID is required.', 400);
  }
  return ids.map((id) => {
    try {
      return { ...operate(id), ok: true };
    } catch (error) {
      return { runId: String(id ?? '').trim(), ok: false, error: error.message };
    }
  });
}

export function deleteStatusRun(config, runIdValue, options = {}) {
  const runId = normalizeRunIdForDelete(runIdValue);
  const statusRoot = config.http.statusRoot;
  const paths = RUN_FILE_SUFFIXES.map((suffix) => safeStatusPath(statusRoot, `${runId}${suffix}`));

  let removed = 0;
  for (const filePath of paths) {
    removed += removePathIfExists(filePath);
  }
  removed += removePathIfExists(safeStatusPath(statusRoot, 'screenshots', runId), { recursive: true });

  if (removed === 0) {
    throw statusError(`Deployment run not found: ${runId}`, 404);
  }

  for (const pointer of LATEST_POINTER_FILES) {
    removed += removeLatestIfMatches(safeStatusPath(statusRoot, pointer), runId);
  }
  if (options.rewriteIndex === false) {
    return { runId, removed };
  }
  const runsIndex = writeRunsIndex(statusRoot);

  return { runId, removed, runsIndex };
}

// Archive moves a run out of the active fleet into statusRoot/archive so it stops
// showing in Activity but its evidence is preserved and can be restored later.
export function archiveStatusRun(config, runIdValue, options = {}) {
  const runId = normalizeRunIdForDelete(runIdValue);
  const statusRoot = config.http.statusRoot;
  const moved = relocateStatusRun(statusRoot, runId, { fromArchive: false });
  if (moved === 0) {
    throw statusError(`Deployment run not found: ${runId}`, 404);
  }
  let cleared = 0;
  for (const pointer of LATEST_POINTER_FILES) {
    cleared += removeLatestIfMatches(safeStatusPath(statusRoot, pointer), runId);
  }
  if (options.rewriteIndex === false) {
    return { runId, moved, cleared };
  }
  const runsIndex = writeRunsIndex(statusRoot);
  return { runId, moved, cleared, runsIndex };
}

// Restore moves an archived run back into the active status root.
export function restoreStatusRun(config, runIdValue, options = {}) {
  const runId = normalizeRunIdForDelete(runIdValue);
  const statusRoot = config.http.statusRoot;
  const moved = relocateStatusRun(statusRoot, runId, { fromArchive: true });
  if (moved === 0) {
    throw statusError(`Archived run not found: ${runId}`, 404);
  }
  if (options.rewriteIndex === false) {
    return { runId, moved };
  }
  const runsIndex = writeRunsIndex(statusRoot);
  return { runId, moved, runsIndex };
}

// Permanently delete a run that lives in the archive subfolder.
export function deleteArchivedRun(config, runIdValue) {
  const runId = normalizeRunIdForDelete(runIdValue);
  const statusRoot = config.http.statusRoot;
  const paths = RUN_FILE_SUFFIXES.map((suffix) => safeStatusPath(statusRoot, ARCHIVE_DIR, `${runId}${suffix}`));
  let removed = 0;
  for (const filePath of paths) {
    removed += removePathIfExists(filePath);
  }
  removed += removePathIfExists(safeStatusPath(statusRoot, ARCHIVE_DIR, 'screenshots', runId), { recursive: true });
  if (removed === 0) {
    throw statusError(`Archived run not found: ${runId}`, 404);
  }
  return { runId, removed };
}

export function deleteStatusRuns(config, runIds) {
  const results = runBatch(runIds, (id) => deleteStatusRun(config, id, { rewriteIndex: false }));
  const runsIndex = writeRunsIndex(config.http.statusRoot);
  return { results, runsIndex };
}

export function archiveStatusRuns(config, runIds) {
  const results = runBatch(runIds, (id) => archiveStatusRun(config, id, { rewriteIndex: false }));
  const runsIndex = writeRunsIndex(config.http.statusRoot);
  return { results, runsIndex };
}

export function restoreStatusRuns(config, runIds) {
  const results = runBatch(runIds, (id) => restoreStatusRun(config, id, { rewriteIndex: false }));
  const runsIndex = writeRunsIndex(config.http.statusRoot);
  return { results, runsIndex };
}

export function deleteArchivedRuns(config, runIds) {
  const results = runBatch(runIds, (id) => deleteArchivedRun(config, id));
  return { results };
}

// Build a fleet-style index for archived runs (read on demand by the console).
export function readArchivedFleet(config, now = new Date()) {
  const archiveRoot = path.join(config.http.statusRoot, ARCHIVE_DIR);
  return buildRunsIndex(archiveRoot, now);
}

export function readScreenshotMetadata(config, maxLines = 5) {
  const latest = readLatestScreenshot(config);
  if (!latest?.runId) {
    return [];
  }

  const filePath = path.join(config.http.statusRoot, `${latest.runId}.screenshots.jsonl`);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return tailFile(filePath, maxLines).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

export function readRunLatestScreenshot(config, runId) {
  if (!runId) {
    return null;
  }

  const filePath = path.join(config.http.statusRoot, `${runId}.screenshots.jsonl`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const entries = tailFile(filePath, 1).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  return entries.at(-1) ?? null;
}

export function readRecentScreenshotMetadata(config, maxLines = 5) {
  const statusRoot = config.http.statusRoot;
  if (!fs.existsSync(statusRoot)) {
    return [];
  }

  return fs.readdirSync(statusRoot)
    .filter((entry) => entry.endsWith('.screenshots.jsonl'))
    .flatMap((entry) => tailFile(path.join(statusRoot, entry), maxLines).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    }))
    .sort((a, b) => (parseDate(b.receivedAt ?? b.timestamp) ?? 0) - (parseDate(a.receivedAt ?? a.timestamp) ?? 0))
    .slice(0, maxLines);
}

function parseDate(value) {
  return parseTimestamp(value);
}

function readRunEvents(config, runId) {
  const filePath = path.join(config.http.statusRoot, `${runId}.jsonl`);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return tailFile(filePath, 2000).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function deriveSummaryFromEvents(config, latest) {
  if (!latest?.runId) {
    return null;
  }

  const events = readRunEvents(config, latest.runId);
  const first = events[0] ?? latest;
  const last = events.at(-1) ?? latest;
  const winpeEnd = events.findLast?.((event) => winpeEndStages.has(event.stage)) ?? [...events].reverse().find((event) => winpeEndStages.has(event.stage));
  const windowsStart = events.findLast?.((event) => windowsStartStages.has(event.stage)) ?? [...events].reverse().find((event) => windowsStartStages.has(event.stage));
  const completed = events.findLast?.((event) => runEndStages.has(event.stage)) ?? [...events].reverse().find((event) => runEndStages.has(event.stage));
  const failed = events.findLast?.((event) => failureStages.has(event.stage)) ?? [...events].reverse().find((event) => failureStages.has(event.stage));

  return {
    runId: latest.runId,
    clientId: latest.clientId ?? first.clientId ?? null,
    startedAt: first.receivedAt ?? first.timestamp ?? latest.receivedAt ?? null,
    startedTimestamp: first.timestamp ?? null,
    eventCount: events.length || 1,
    latestStage: last.stage ?? latest.stage ?? null,
    latestMessage: last.message ?? latest.message ?? null,
    latestPercent: Number.isFinite(last.percent) ? last.percent : null,
    elapsedSeconds: Number.isFinite(last.elapsedSeconds) ? last.elapsedSeconds : latest.elapsedSeconds,
    lastReceivedAt: last.receivedAt ?? latest.receivedAt ?? null,
    winpeEndedAt: winpeEnd?.receivedAt ?? null,
    windowsStartedAt: windowsStart?.receivedAt ?? null,
    completedAt: completed?.receivedAt ?? null,
    failedAt: failed?.receivedAt ?? null,
    status: completed ? 'completed' : failed ? 'failed' : null,
    derived: true,
  };
}

export function resolveDeploymentSummary(config, latest, summary = null, now = new Date()) {
  if (!latest) {
    return null;
  }

  const derived = summary ?? deriveSummaryFromEvents(config, latest) ?? {};
  const resolved = {
    runId: latest.runId ?? derived.runId,
    clientId: latest.clientId ?? derived.clientId,
    startedAt: derived.startedAt ?? latest.receivedAt ?? latest.timestamp ?? null,
    startedTimestamp: derived.startedTimestamp ?? latest.timestamp ?? null,
    eventCount: derived.eventCount ?? 1,
    latestStage: latest.stage ?? derived.latestStage ?? null,
    latestMessage: latest.message ?? derived.latestMessage ?? null,
    latestPercent: Number.isFinite(latest.percent) ? latest.percent : derived.latestPercent ?? null,
    elapsedSeconds: Number.isFinite(latest.elapsedSeconds) ? latest.elapsedSeconds : derived.elapsedSeconds,
    lastReceivedAt: latest.receivedAt ?? derived.lastReceivedAt ?? null,
    winpeEndedAt: derived.winpeEndedAt ?? (winpeEndStages.has(latest.stage) ? latest.receivedAt : null),
    windowsStartedAt: derived.windowsStartedAt ?? (windowsStartStages.has(latest.stage) ? latest.receivedAt : null),
    completedAt: derived.completedAt ?? (runEndStages.has(latest.stage) ? latest.receivedAt : null),
    failedAt: derived.failedAt ?? (failureStages.has(latest.stage) ? latest.receivedAt : null),
    status: derived.status ?? null,
    derived: Boolean(derived.derived || !summary),
  };

  if (runEndStages.has(latest.stage) || resolved.completedAt) {
    resolved.status = 'completed';
  } else if (failureStages.has(latest.stage) || resolved.failedAt) {
    resolved.status = 'failed';
  } else if (windowsStartStages.has(latest.stage) || resolved.windowsStartedAt) {
    resolved.status = 'windows-running';
  } else if (winpeEndStages.has(latest.stage) || resolved.winpeEndedAt) {
    resolved.status = 'awaiting-windows';
  } else if (!resolved.status) {
    resolved.status = 'running';
  }

  const lastSeen = parseDate(resolved.lastReceivedAt);
  const ageMs = lastSeen === null ? null : now.getTime() - lastSeen;
  if (!terminalStatuses.has(resolved.status) && ageMs !== null && ageMs > staleThresholdMs) {
    resolved.previousStatus = resolved.status;
    resolved.status = 'stale';
    resolved.staleReason = `no status events for ${Math.floor(ageMs / 60000)} minutes`;
  }

  return resolved;
}

function compact(value, maxLength = 120) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function clip(value, width) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= width) {
    return text.padEnd(width, ' ');
  }
  if (width <= 1) {
    return text.slice(0, width);
  }
  if (width <= 3) {
    return text.slice(0, width);
  }
  return `${text.slice(0, Math.max(0, width - 3))}...`.padEnd(width, ' ');
}

function formatClock(value) {
  return formatLocalClock(value);
}

function formatTimestamp(value) {
  return formatLocalTimestamp(value) || String(value ?? '');
}

function formatElapsed(seconds) {
  if (!Number.isFinite(seconds)) {
    return '';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m${String(remainder).padStart(2, '0')}s`;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : '';
}

function formatScreenshotLine(screenshot) {
  if (!screenshot) {
    return null;
  }

  const stage = screenshot.stage ?? '';
  const timestamp = formatTimestamp(screenshot.timestamp ?? screenshot.receivedAt);
  return `${stage} ${timestamp}`.trim();
}

export function formatScreenshotMetadata(screenshot) {
  if (!screenshot) {
    return '';
  }

  const stage = screenshot.stage ?? '';
  const timestamp = formatTimestamp(screenshot.timestamp ?? screenshot.receivedAt);
  const filePath = screenshot.filePath ?? '';
  return `${stage} ${timestamp}${filePath ? ` ${filePath}` : ''}`.trim();
}

export function formatStatusEventLine(line, maxLength = 180) {
  try {
    const event = JSON.parse(line);
    const percent = Number.isFinite(event.percent) ? ` ${event.percent}%` : '';
    const message = compact(event.message, 80);
    return compact([
      formatTimestamp(event.receivedAt ?? event.timestamp),
      event.clientId ?? '',
      event.stage ?? '',
      percent.trim(),
      message,
    ].filter(Boolean).join(' '), maxLength);
  } catch {
    return compact(line, maxLength);
  }
}

export function formatFleetCounts(counts = {}) {
  return [
    `running=${counts.running ?? 0}`,
    `awaiting=${counts['awaiting-windows'] ?? 0}`,
    `windows=${counts['windows-running'] ?? 0}`,
    `stale=${counts.stale ?? 0}`,
    `failed=${counts.failed ?? 0}`,
    `completed=${counts.completed ?? 0}`,
  ].join(' ');
}

export function formatFleetClientRows(runs, width = 80) {
  if (!runs?.length) {
    return ['No deployment clients yet.'];
  }

  const safeWidth = Math.max(40, Number(width) || 80);
  const separators = 6;
  const available = Math.max(7, safeWidth - separators);
  const statusWidth = available >= 55 ? 15 : Math.max(8, Math.floor(available * 0.24));
  const percentWidth = available >= 45 ? 4 : 3;
  const seenWidth = available >= 55 ? 8 : Math.max(4, Math.floor(available * 0.14));
  const elapsedWidth = available >= 55 ? 8 : Math.max(4, Math.floor(available * 0.14));
  const remaining = Math.max(3, available - statusWidth - percentWidth - seenWidth - elapsedWidth);
  const widths = [
    statusWidth,
    Math.max(1, Math.floor(remaining * 0.25)),
    Math.max(1, Math.floor(remaining * 0.32)),
    Math.max(1, Math.floor(remaining * 0.43)),
    percentWidth,
    seenWidth,
    elapsedWidth,
  ];

  while (widths.reduce((sum, value) => sum + value, 0) > available) {
    let index = widths.indexOf(Math.max(...widths));
    if (widths[index] <= 1) {
      break;
    }
    widths[index] -= 1;
  }
  while (widths.reduce((sum, value) => sum + value, 0) < available) {
    widths[3] += 1;
  }

  const [, clientWidth, runWidth, stageWidth, finalPercentWidth, finalSeenWidth, finalElapsedWidth] = widths;

  return runs.map((run) => [
    clip(run.status, statusWidth),
    clip(run.clientId ?? '', clientWidth),
    clip(run.runId ?? '', runWidth),
    clip(run.latestStage ?? '', stageWidth),
    clip(formatPercent(run.latestPercent), finalPercentWidth),
    clip(formatClock(run.lastReceivedAt), finalSeenWidth),
    clip(formatElapsed(run.elapsedSeconds), finalElapsedWidth),
  ].join(' '));
}

export function formatFleetRunDetail(run, latestScreenshot = null) {
  if (!run) {
    return [
      'No client selected.',
      'WinPE clients will appear here after POST /osdcloud/status.',
    ];
  }

  const lines = [
    `Status   : ${run.status}${run.previousStatus ? ` (${run.previousStatus})` : ''}`,
    `Run      : ${run.runId ?? ''}`,
    `Client   : ${run.clientId ?? ''}`,
    `Stage    : ${run.latestStage ?? ''}  Percent: ${formatPercent(run.latestPercent)}  Elapsed: ${formatElapsed(run.elapsedSeconds)}`,
    `Started  : ${formatTimestamp(run.startedAt)}`,
    `WinPE End: ${formatTimestamp(run.winpeEndedAt)}`,
    `Windows  : ${formatTimestamp(run.windowsStartedAt)}`,
    `Finished : ${formatTimestamp(run.completedAt ?? run.failedAt)}`,
    `Seen     : ${formatTimestamp(run.lastReceivedAt)}`,
    `Message  : ${compact(run.staleReason ? `${run.staleReason}; ${run.latestMessage ?? ''}` : run.latestMessage, 160)}`,
  ];

  if (run.warnings?.length) {
    lines.push(`Warnings : ${run.warnings.join(', ')}`);
  }

  if (latestScreenshot) {
    lines.push(`Latest Shot: ${formatScreenshotLine(latestScreenshot) ?? ''}`);
    lines.push(`Shot File  : ${compact(latestScreenshot.filePath, 180)}`);
  }

  return lines;
}

export function formatDeploymentStatus(latest, summary = null, latestScreenshot = null) {
  if (!latest) {
    return [
      'No deployment status yet.',
      'WinPE will POST to /osdcloud/status after boot.',
    ];
  }

  const statusLabel = summary?.status === 'stale'
    ? `stale (${summary.previousStatus ?? 'unknown'}; previous run)`
    : summary?.status ?? 'running';

  const lines = [
    `Status   : ${statusLabel}`,
    `Run      : ${latest.runId ?? ''}`,
    `Client   : ${latest.clientId ?? ''}`,
    `Stage    : ${latest.stage ?? ''}  Percent: ${Number.isFinite(latest.percent) ? latest.percent : ''}  Elapsed: ${latest.elapsedSeconds ?? ''}`,
    `Started  : ${formatTimestamp(summary?.startedAt)}`,
    `WinPE End: ${formatTimestamp(summary?.winpeEndedAt)}`,
    `Finished : ${formatTimestamp(summary?.completedAt ?? summary?.failedAt)}`,
    `Seen     : ${formatTimestamp(latest.receivedAt)}`,
    `Message  : ${compact(summary?.staleReason ? `${summary.staleReason}; ${latest.message ?? ''}` : latest.message, 140)}`,
  ];

  if (latestScreenshot) {
    lines.push(`Latest Shot: ${formatScreenshotLine(latestScreenshot) ?? ''}`);
    lines.push(`Shot File  : ${compact(latestScreenshot.filePath, 180)}`);
  }

  return lines;
}

export function summarizeValidation(config) {
  const httpLines = tailFile(config.http.logPath, 500);
  const required = ['boot.ipxe', 'wimboot', 'boot.wim'];
  const results = [];
  for (const name of required) {
    results.push({
      name: `HTTP ${name}`,
      ok: httpLines.some((line) => line.includes(name) && line.includes(' 200 ')),
    });
  }

  const imagePattern = config.paths.imageNamePattern;
  const esdOverHttp = imagePattern
    ? httpLines.some((line) => line.includes(imagePattern) && /\b(HEAD|GET)\b/.test(line))
    : false;
  results.push({
    name: 'No HTTP ESD transfer',
    ok: !esdOverHttp,
  });

  const fleet = readFleetStatus(config);
  results.push({
    name: 'Fleet runs',
    ok: fleet.total > 0,
    detail: fleet.total > 0 ? `total=${fleet.total} ${formatFleetCounts(fleet.counts)}` : 'no deployment runs',
  });

  return results;
}
