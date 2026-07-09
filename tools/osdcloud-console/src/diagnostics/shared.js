import fs from 'node:fs';
import path from 'node:path';
import { stateRootForConfig } from '../config.js';

export function diagnosticsRootForConfig(config = {}) {
  return path.join(stateRootForConfig(config), 'diagnostics');
}

export function diagnosticsLatestPathForConfig(config = {}) {
  return path.join(diagnosticsRootForConfig(config), 'latest.json');
}

export function diagnosticsTimestamp(date = new Date()) {
  const iso = date.toISOString().replace(/\.\d{3}Z$/u, 'Z');
  return iso.replace(/[:]/gu, '').replace(/[T]/gu, '-');
}

export function sanitizeName(value, fallback = 'diagnostics') {
  const text = String(value ?? '').trim().replace(/[^A-Za-z0-9_.-]+/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
  return text || fallback;
}

export function ensureInside(rootPath, childPath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(childPath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Resolved path is outside diagnostics root: ${candidate}`);
  }
  return candidate;
}

export function readJsonIfExists(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function runCategoryForStage(stageValue) {
  const stage = String(stageValue ?? '').trim().toLowerCase();
  if (!stage) {
    return 'winpe-run';
  }
  if (stage.startsWith('windows-desktop') || stage.startsWith('windows-logon')) {
    return 'desktop-ready-run';
  }
  if (stage.startsWith('windows-setupcomplete') || stage.startsWith('windows-apps') || stage.startsWith('windows-driverpack')) {
    return 'setupcomplete-run';
  }
  return 'winpe-run';
}
