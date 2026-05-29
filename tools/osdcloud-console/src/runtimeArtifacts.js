import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appRootForConfig, stateRootForConfig } from './config.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const hashPattern = /^[A-Fa-f0-9]{64}$/u;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const allowedSourceTypes = new Set([
  'download',
  'generated',
  'generated-winpe',
  'osd-catalog',
  'repo-file',
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

function normalizeSourcePath(value, label, required) {
  const sourcePath = String(value ?? '').replace(/\//gu, '\\').trim();
  if (!sourcePath) {
    if (required) {
      throw new Error(`${label} sourcePath is required`);
    }
    return '';
  }
  if (path.win32.isAbsolute(sourcePath) || /^[A-Za-z]:/u.test(sourcePath)) {
    throw new Error(`${label} sourcePath must be relative: ${sourcePath}`);
  }
  const normalized = path.win32.normalize(sourcePath);
  if (normalized === '..' || normalized.startsWith(`..${path.win32.sep}`)) {
    throw new Error(`${label} sourcePath escapes root: ${sourcePath}`);
  }
  return normalized;
}

function normalizeDependencyIds(value, label) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} dependsOn must be an array`);
  }
  return value.map((dependencyId, index) => normalizeId(dependencyId, `${label} dependency ${index + 1}`));
}

function normalizeArtifact(row, section) {
  const label = `${section} artifact`;
  const id = normalizeId(row.id, label);
  const sourceType = normalizeSourceType(row.sourceType, `artifact ${id}`);
  const required = normalizeRequired(row.required);
  const download = sourceType === 'download';
  const repoFile = sourceType === 'repo-file';
  const requireHash = download || repoFile;
  return {
    id,
    kind: String(row.kind ?? section).trim() || section,
    name: String(row.name ?? id).trim() || id,
    sourceType,
    required,
    url: normalizeUrl(row.url, `artifact ${id}`, download),
    sourcePath: normalizeSourcePath(row.sourcePath, `artifact ${id}`, repoFile),
    targets: normalizeTargets(row, `artifact ${id}`),
    dependencyIds: normalizeDependencyIds(row.dependsOn, `artifact ${id}`),
    prepareGroup: String(row.prepareGroup ?? '').trim(),
    prepareReason: String(row.prepareReason ?? '').trim(),
    length: normalizeLength(row.length ?? row.size, `artifact ${id}`, requireHash),
    sha256: normalizeSha256(row.sha256, `artifact ${id}`, requireHash),
    osImageId: row.osImageId ? normalizeId(row.osImageId, `artifact ${id} OS image`) : '',
    profileRequired: row.profileRequired === true,
    section,
  };
}

export function validateRuntimeDependencyGraph(artifacts) {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const dependentsById = Object.fromEntries(artifacts.map((artifact) => [artifact.id, []]));
  for (const artifact of artifacts) {
    for (const dependencyId of artifact.dependencyIds) {
      if (!byId.has(dependencyId)) {
        throw new Error(`Runtime artifact ${artifact.id} depends on unknown artifact: ${dependencyId}`);
      }
      dependentsById[dependencyId].push(artifact.id);
    }
  }

  const checkOrder = [];
  const stateById = new Map();
  function visit(artifact, stack = []) {
    const state = stateById.get(artifact.id);
    if (state === 'visited') {
      return;
    }
    if (state === 'visiting') {
      const cycleStart = stack.indexOf(artifact.id);
      const cycle = [...stack.slice(cycleStart >= 0 ? cycleStart : 0), artifact.id];
      throw new Error(`Circular runtime artifact dependency: ${cycle.join(' -> ')}`);
    }
    stateById.set(artifact.id, 'visiting');
    for (const dependencyId of artifact.dependencyIds) {
      visit(byId.get(dependencyId), [...stack, artifact.id]);
    }
    stateById.set(artifact.id, 'visited');
    checkOrder.push(artifact.id);
  }

  for (const artifact of artifacts) {
    visit(artifact);
  }
  return { checkOrder, dependentsById };
}

export function runtimeArtifactOptions(config = {}, overrides = {}) {
  const appRoot = appRootForConfig(config);
  const stateRoot = stateRootForConfig(config);
  const catalogPath = overrides.catalogPath
    ?? config.runtimeArtifacts?.catalogPath
    ?? path.join(appRoot, 'config', 'runtime-artifacts.json');
  const downloadStagingRoot = overrides.downloadStagingRoot
    ?? config.runtimeArtifacts?.downloadStagingRoot
    ?? path.join(stateRoot, '.downloads');
  return {
    repoRoot: appRoot,
    appRoot,
    stateRoot,
    catalogPath: path.isAbsolute(catalogPath) ? path.resolve(catalogPath) : path.resolve(appRoot, catalogPath),
    liveRoot: overrides.liveRoot ?? config.runtimeArtifacts?.liveRoot ?? 'C:\\OSDCloud',
    downloadStagingRoot: path.isAbsolute(downloadStagingRoot)
      ? path.resolve(downloadStagingRoot)
      : path.resolve(stateRoot, downloadStagingRoot),
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
  const graph = validateRuntimeDependencyGraph(artifacts);

  return {
    path: options.catalogPath,
    options,
    artifacts,
    checkOrder: graph.checkOrder,
    dependentsById: graph.dependentsById,
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
  return resolveArtifactTarget(catalog.options.liveRoot, relativeTarget);
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
  const plannedIds = new Set(artifacts.map((artifact) => artifact.id));
  const checkOrder = catalog.checkOrder.filter((id) => plannedIds.has(id));
  const rowsById = new Map();
  for (const artifact of artifacts) {
    const targetResults = artifact.targets.map((target) => {
      const filePath = resolveRuntimeArtifactTarget(catalog, artifact, target);
      return {
        target,
        ...inspectRuntimeArtifactFile(filePath, artifact),
      };
    });
    const targetsOk = targetResults.every((result) => result.ok);
    rowsById.set(artifact.id, {
      id: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      sourceType: artifact.sourceType,
      action: artifact.action,
      required: artifact.required,
      dependencyIds: artifact.dependencyIds,
      blockedBy: [],
      dependents: (catalog.dependentsById[artifact.id] ?? []).filter((id) => plannedIds.has(id)),
      prepareGroup: artifact.prepareGroup,
      prepareReason: artifact.prepareReason,
      ok: targetsOk,
      status: targetsOk ? 'ready' : 'blocked',
      targets: targetResults,
    });
  }

  for (const id of checkOrder) {
    const row = rowsById.get(id);
    const blockedBy = row.dependencyIds
      .map((dependencyId) => rowsById.get(dependencyId))
      .filter((dependency) => dependency && dependency.status !== 'ready')
      .map((dependency) => ({
        id: dependency.id,
        name: dependency.name,
        status: dependency.status,
      }));
    row.blockedBy = blockedBy;
    if (blockedBy.length > 0) {
      row.ok = false;
      row.status = 'blocked-by-dependency';
    }
  }

  const rows = checkOrder.map((id) => rowsById.get(id));
  const missing = rows.filter((artifact) => artifact.status !== 'ready');
  return {
    ready: missing.length === 0,
    catalogPath: catalog.path,
    liveRoot: catalog.options.liveRoot,
    downloadStagingRoot: catalog.options.downloadStagingRoot,
    requiredCount: rows.length,
    readyCount: rows.length - missing.length,
    missingCount: missing.length,
    checkOrder,
    artifacts: rows,
    missing: missing.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      sourceType: artifact.sourceType,
      status: artifact.status,
      dependencyIds: artifact.dependencyIds,
      blockedBy: artifact.blockedBy,
      dependents: artifact.dependents,
      prepareGroup: artifact.prepareGroup,
      prepareReason: artifact.prepareReason,
      targets: artifact.targets.filter((target) => !target.ok),
    })),
  };
}
