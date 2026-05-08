import fs from 'node:fs';
import path from 'node:path';
import { tailFile } from './logger.js';
import { failureStages, runEndStages, windowsStartStages, winpeEndStages } from './runSummary.js';

const staleThresholdMs = 15 * 60 * 1000;
const terminalStatuses = new Set(['completed', 'failed', 'stale']);

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

export function readStatusEvents(config, maxLines = 80) {
  return tailFile(config.paths.statusEvents, maxLines);
}

function parseDate(value) {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? timestamp : null;
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

export function formatDeploymentStatus(latest, summary = null) {
  if (!latest) {
    return [
      'No deployment status yet.',
      'WinPE will POST to /osdcloud/status after boot.',
    ];
  }

  const statusLabel = summary?.status === 'stale'
    ? `stale (${summary.previousStatus ?? 'unknown'}; previous run)`
    : summary?.status ?? 'running';

  return [
    `Status   : ${statusLabel}`,
    `Run      : ${latest.runId ?? ''}`,
    `Client   : ${latest.clientId ?? ''}`,
    `Stage    : ${latest.stage ?? ''}  Percent: ${Number.isFinite(latest.percent) ? latest.percent : ''}  Elapsed: ${latest.elapsedSeconds ?? ''}`,
    `Started  : ${summary?.startedAt ?? ''}`,
    `WinPE End: ${summary?.winpeEndedAt ?? ''}`,
    `Finished : ${summary?.completedAt ?? summary?.failedAt ?? ''}`,
    `Seen     : ${latest.receivedAt ?? ''}`,
    `Message  : ${compact(summary?.staleReason ? `${summary.staleReason}; ${latest.message ?? ''}` : latest.message, 140)}`,
  ];
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

  const latest = readLatestStatus(config);
  const summary = resolveDeploymentSummary(config, latest, readLatestSummary(config));
  results.push({
    name: 'Latest status',
    ok: Boolean(latest),
    detail: latest ? `${summary?.status ?? 'running'} ${latest.stage ?? 'unknown'} ${latest.message ?? ''}` : 'no latest.json',
  });

  return results;
}
