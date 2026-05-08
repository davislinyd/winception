import fs from 'node:fs';
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

export function readStatusEvents(config, maxLines = 80) {
  return tailFile(config.paths.statusEvents, maxLines);
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
  results.push({
    name: 'Latest status',
    ok: Boolean(latest),
    detail: latest ? `${latest.stage ?? 'unknown'} ${latest.message ?? ''}` : 'no latest.json',
  });

  return results;
}
