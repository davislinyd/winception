import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..');

const hashPattern = /^[A-Fa-f0-9]{64}$/u;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const allowedSourceTypes = new Set([
  'download',
  'generated',
  'generated-winpe',
  'osd-catalog',
]);

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label} ${filePath}: ${error.message}`);
  }
}

function normalizeId(value, label) {
  const id = String(value ?? '').trim();
  if (!idPattern.test(id)) {
    throw new Error(`Invalid ${label} id: ${value}`);
  }
  return id;
}

function normalizeSourceType(value, label) {
  const sourceType = String(value ?? '').trim().toLowerCase();
  if (!allowedSourceTypes.has(sourceType)) {
    throw new Error(`Invalid ${label} sourceType: ${value}`);
  }
  return sourceType;
}

function normalizeRequired(value) {
  if (value === undefined || value === null) {
    return true;
  }
  return value !== false;
}

function normalizeLength(value, label, required) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new Error(`${label} length is required`);
    }
    return null;
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new Error(`${label} length must be a positive integer`);
  }
  return length;
}

function normalizeSha256(value, label, required) {
  const hash = String(value ?? '').trim().toUpperCase();
  if (!hash) {
    if (required) {
      throw new Error(`${label} sha256 is required`);
    }
    return '';
  }
  if (!hashPattern.test(hash)) {
    throw new Error(`${label} sha256 must be a 64-character hex string`);
  }
  return hash;
}

function normalizeUrl(value, label, required) {
  const text = String(value ?? '').trim();
  if (!text) {
    if (required) {
      throw new Error(`${label} url is required`);
    }
    return '';
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${label} url is invalid: ${text}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${label} url protocol is not allowed: ${parsed.protocol}`);
  }
  return parsed.toString();
}

function normalizeTarget(value, label) {
  const target = String(value ?? '').replace(/\//gu, '\\').trim();
  if (!target) {
    throw new Error(`${label} target is required`);
  }
  if (path.win32.isAbsolute(target) || /^[A-Za-z]:/u.test(target)) {
    throw new Error(`${label} target must be relative: ${target}`);
  }
  const normalized = path.win32.normalize(target);
  if (normalized === '..' || normalized.startsWith(`..${path.win32.sep}`)) {
    throw new Error(`${label} target escapes root: ${target}`);
  }
  return normalized;
}

function normalizeTargets(row, label) {
  const targets = Array.isArray(row.targets)
    ? row.targets
    : [row.target ?? row.path].filter((value) => value !== undefined);
  if (targets.length === 0) {
    throw new Error(`${label} targets are required`);
  }
  return targets.map((target, index) => normalizeTarget(target, `${label} target ${index + 1}`));
}

function normalizeArtifact(row, section) {
  const label = `${section} artifact`;
  const id = normalizeId(row.id, label);
  const sourceType = normalizeSourceType(row.sourceType, `artifact ${id}`);
  const required = normalizeRequired(row.required);
  const download = sourceType === 'download';
  const requireHash = required || download;
  return {
    id,
    kind: String(row.kind ?? section).trim() || section,
    name: String(row.name ?? id).trim() || id,
    sourceType,
    required,
    url: normalizeUrl(row.url, `artifact ${id}`, download),
    targets: normalizeTargets(row, `artifact ${id}`),
    length: normalizeLength(row.length ?? row.size, `artifact ${id}`, requireHash),
    sha256: normalizeSha256(row.sha256, `artifact ${id}`, requireHash),
    osImageId: row.osImageId ? normalizeId(row.osImageId, `artifact ${id} OS image`) : '',
    profileRequired: row.profileRequired === true,
    section,
  };
}

export function runtimeArtifactOptions(config = {}, overrides = {}) {
  const root = path.resolve(config.paths?.repoRoot ?? repoRoot);
  const catalogPath = overrides.catalogPath
    ?? config.runtimeArtifacts?.catalogPath
    ?? path.join(root, 'config', 'runtime-artifacts.json');
  const downloadStagingRoot = overrides.downloadStagingRoot
    ?? config.runtimeArtifacts?.downloadStagingRoot
    ?? path.join(root, '.downloads');
  return {
    repoRoot: root,
    catalogPath: path.isAbsolute(catalogPath) ? path.resolve(catalogPath) : path.resolve(root, catalogPath),
    liveRoot: overrides.liveRoot ?? config.runtimeArtifacts?.liveRoot ?? 'C:\\OSDCloud',
    downloadStagingRoot: path.isAbsolute(downloadStagingRoot)
      ? path.resolve(downloadStagingRoot)
      : path.resolve(root, downloadStagingRoot),
  };
}

export function loadRuntimeArtifactCatalog(config = {}, overrides = {}) {
  const options = runtimeArtifactOptions(config, overrides);
  const raw = readJson(options.catalogPath, 'runtime artifact catalog');
  if (raw.schemaVersion !== 1) {
    throw new Error(`Unsupported runtime artifact catalog schemaVersion: ${raw.schemaVersion}`);
  }

  const sections = [
    ['runtime', raw.artifacts ?? []],
    ['software', raw.software ?? []],
  ];
  const artifacts = [];
  const ids = new Set();
  for (const [section, rows] of sections) {
    if (!Array.isArray(rows)) {
      throw new Error(`runtime artifact catalog ${section} must be an array`);
    }
    for (const row of rows) {
      const artifact = normalizeArtifact(row, section);
      if (ids.has(artifact.id)) {
        throw new Error(`Duplicate runtime artifact id: ${artifact.id}`);
      }
      ids.add(artifact.id);
      artifacts.push(artifact);
    }
  }

  return {
    path: options.catalogPath,
    options,
    artifacts,
    raw,
  };
}

export function planRuntimeArtifacts(catalog, options = {}) {
  const includeOptional = options.includeOptional === true;
  return catalog.artifacts
    .filter((artifact) => artifact.required || includeOptional)
    .map((artifact) => ({
      ...artifact,
      action: artifact.sourceType === 'download' ? 'download' : artifact.sourceType,
    }));
}

export function resolveArtifactTarget(root, relativeTarget) {
  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, relativeTarget);
  const relative = path.relative(rootPath, candidate);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`artifact target escapes root: ${relativeTarget}`);
  }
  return candidate;
}

export function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toUpperCase();
}

export function verifyArtifactFile(filePath, artifact) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      reason: 'missing',
      filePath,
    };
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return {
      ok: false,
      reason: 'not-file',
      filePath,
    };
  }
  if (artifact.length && stat.size !== artifact.length) {
    return {
      ok: false,
      reason: 'size-mismatch',
      filePath,
      actualLength: stat.size,
      expectedLength: artifact.length,
    };
  }
  if (artifact.sha256) {
    const actualSha256 = sha256File(filePath);
    if (actualSha256 !== artifact.sha256) {
      return {
        ok: false,
        reason: 'hash-mismatch',
        filePath,
        actualSha256,
        expectedSha256: artifact.sha256,
      };
    }
  }
  return {
    ok: true,
    reason: 'matches',
    filePath,
    length: stat.size,
  };
}

export function resolveRuntimeArtifactTarget(catalog, artifact, relativeTarget) {
  const target = String(relativeTarget ?? '');
  if (target.replace(/\//gu, '\\').toLowerCase().startsWith('softwares\\')) {
    return resolveArtifactTarget(catalog.options.repoRoot, target);
  }
  return resolveArtifactTarget(catalog.options.liveRoot, target);
}

export function inspectRuntimeArtifactFile(filePath, artifact) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      reason: 'missing',
      filePath,
    };
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return {
      ok: false,
      reason: 'not-file',
      filePath,
    };
  }
  if (artifact.length && stat.size !== artifact.length) {
    return {
      ok: false,
      reason: 'size-mismatch',
      filePath,
      actualLength: stat.size,
      expectedLength: artifact.length,
    };
  }
  return {
    ok: true,
    reason: 'present',
    filePath,
    length: stat.size,
  };
}

export function getRuntimeReadiness(config = {}, overrides = {}) {
  const catalog = loadRuntimeArtifactCatalog(config, overrides);
  const artifacts = planRuntimeArtifacts(catalog, { includeOptional: overrides.includeOptional === true });
  const rows = artifacts.map((artifact) => {
    const targetResults = artifact.targets.map((target) => {
      const filePath = resolveRuntimeArtifactTarget(catalog, artifact, target);
      return {
        target,
        ...inspectRuntimeArtifactFile(filePath, artifact),
      };
    });
    const ok = targetResults.every((result) => result.ok);
    return {
      id: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      sourceType: artifact.sourceType,
      action: artifact.action,
      required: artifact.required,
      ok,
      status: ok ? 'ready' : 'blocked',
      targets: targetResults,
    };
  });
  const missing = rows.filter((artifact) => !artifact.ok);
  return {
    ready: missing.length === 0,
    catalogPath: catalog.path,
    liveRoot: catalog.options.liveRoot,
    downloadStagingRoot: catalog.options.downloadStagingRoot,
    requiredCount: rows.length,
    readyCount: rows.length - missing.length,
    missingCount: missing.length,
    artifacts: rows,
    missing: missing.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      sourceType: artifact.sourceType,
      targets: artifact.targets.filter((target) => !target.ok),
    })),
  };
}
