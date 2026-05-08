import fs from 'node:fs';
import path from 'node:path';
import { tailFile } from './logger.js';

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

  return [
    `Status   : ${summary?.status ?? 'running'}`,
    `Run      : ${latest.runId ?? ''}`,
    `Client   : ${latest.clientId ?? ''}`,
    `Stage    : ${latest.stage ?? ''}  Percent: ${Number.isFinite(latest.percent) ? latest.percent : ''}  Elapsed: ${latest.elapsedSeconds ?? ''}`,
    `Started  : ${summary?.startedAt ?? ''}`,
    `WinPE End: ${summary?.winpeEndedAt ?? ''}`,
    `Finished : ${summary?.completedAt ?? summary?.failedAt ?? ''}`,
    `Seen     : ${latest.receivedAt ?? ''}`,
    `Message  : ${compact(latest.message, 140)}`,
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
  const summary = readLatestSummary(config);
  results.push({
    name: 'Latest status',
    ok: Boolean(latest),
    detail: latest ? `${summary?.status ?? 'running'} ${latest.stage ?? 'unknown'} ${latest.message ?? ''}` : 'no latest.json',
  });

  return results;
}
