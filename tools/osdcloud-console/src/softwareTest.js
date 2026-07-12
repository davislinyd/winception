import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appRootForConfig, stateRootForConfig } from './config.js';
import { materializeSoftwareTestPayload } from './profiles/publish.js';
import { deploymentSecretsPath } from './controller/helpers.js';
import { runPowerShell } from './windows/powershell.js';

const configFileName = 'software-test.json';
const runsDirectoryName = 'software-test-runs';
const latestFileName = 'latest.json';
const statusFileName = 'status.json';

function readJson(filePath, fallback = null) {
  try {
    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '').trim();
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function cleanValue(value, label, pattern, maxLength = 128) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength || !pattern.test(text)) {
    throw new Error('Invalid ' + label + '.');
  }
  return text;
}

export function softwareTestConfigPath(config = {}) {
  return path.join(stateRootForConfig(config), 'config', configFileName);
}

export function softwareTestRunsRoot(config = {}) {
  return path.join(stateRootForConfig(config), runsDirectoryName);
}

export function normalizeSoftwareTestConfiguration(input = {}) {
  return {
    vmName: cleanValue(input.vmName, 'software test VM name', /^[A-Za-z0-9][A-Za-z0-9._ -]{0,62}$/u, 63),
    checkpointName: cleanValue(input.checkpointName, 'software test checkpoint name', /^[A-Za-z0-9][A-Za-z0-9._ -]{0,126}$/u, 127),
    targetUser: cleanValue(input.targetUser, 'software test target user', /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u, 63),
  };
}

export function loadSoftwareTestConfiguration(config = {}) {
  const value = readJson(softwareTestConfigPath(config), null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { configured: false, ready: false, detail: 'Register a dedicated software test VM and clean checkpoint.' };
  }
  try {
    return {
      configured: true,
      ready: Boolean(value.verifiedAt),
      ...normalizeSoftwareTestConfiguration(value),
      verifiedAt: value.verifiedAt ?? null,
      detail: value.verifiedAt
        ? 'Dedicated software test VM is registered.'
        : 'Verify the dedicated software test VM checkpoint before running a test.',
    };
  } catch {
    return { configured: false, ready: false, detail: 'Software test VM configuration is invalid.' };
  }
}

export function softwareTestRunPaths(config = {}, runId) {
  const root = path.join(softwareTestRunsRoot(config), runId);
  return {
    root,
    appsRoot: path.join(root, 'Apps'),
    scriptsRoot: path.join(root, 'Scripts'),
    statusPath: path.join(root, statusFileName),
  };
}

export function readSoftwareTestStatus(config = {}) {
  const configuration = loadSoftwareTestConfiguration(config);
  const latest = readJson(path.join(softwareTestRunsRoot(config), latestFileName), null);
  return {
    configuration: {
      configured: configuration.configured,
      ready: configuration.ready,
      vmName: configuration.vmName ?? null,
      checkpointName: configuration.checkpointName ?? null,
      targetUser: configuration.targetUser ?? null,
      detail: configuration.detail,
      verifiedAt: configuration.verifiedAt ?? null,
    },
    latest: latest && typeof latest === 'object' ? latest : null,
  };
}

export function writeSoftwareTestStatus(config, runId, value) {
  const paths = softwareTestRunPaths(config, runId);
  const safe = {
    runId,
    profileId: String(value.profileId ?? ''),
    profileName: String(value.profileName ?? ''),
    status: String(value.status ?? 'running'),
    phase: String(value.phase ?? ''),
    startedAt: value.startedAt ?? null,
    finishedAt: value.finishedAt ?? null,
    elapsedSeconds: Number.isFinite(Number(value.elapsedSeconds)) ? Number(value.elapsedSeconds) : null,
    rebootCount: Number.isInteger(value.rebootCount) ? value.rebootCount : 0,
    cleanup: String(value.cleanup ?? 'pending'),
    detail: String(value.detail ?? ''),
    steps: Array.isArray(value.steps) ? value.steps.map((step) => ({
      index: Number(step.index ?? 0),
      type: String(step.type ?? ''),
      id: String(step.id ?? ''),
      name: String(step.name ?? step.id ?? ''),
      status: String(step.status ?? ''),
      durationSeconds: Number.isFinite(Number(step.durationSeconds)) ? Number(step.durationSeconds) : null,
      timeoutSeconds: Number.isFinite(Number(step.timeoutSeconds)) ? Number(step.timeoutSeconds) : null,
      networkWaitSeconds: Number.isFinite(Number(step.networkWaitSeconds)) ? Number(step.networkWaitSeconds) : 0,
      rebootRecommended: Boolean(step.rebootRecommended),
    })) : [],
    failure: value.failure && typeof value.failure === 'object' ? {
      category: String(value.failure.category ?? ''),
      stepId: String(value.failure.stepId ?? ''),
      stepType: String(value.failure.stepType ?? ''),
    } : null,
  };
  writeJson(paths.statusPath, safe);
  writeJson(path.join(softwareTestRunsRoot(config), latestFileName), safe);
  return safe;
}

function runnerPath(config) {
  return path.join(appRootForConfig(config), 'tools', 'Invoke-SoftwareTestVm.ps1');
}

function resultFromPowerShellOutput(output) {
  const marker = String(output ?? '').split(/\r?\n/u)
    .find((line) => line.startsWith('WINCEPTION_SOFTWARE_TEST_RESULT:'));
  if (!marker) {
    return null;
  }
  try {
    return JSON.parse(marker.slice('WINCEPTION_SOFTWARE_TEST_RESULT:'.length));
  } catch {
    return null;
  }
}

export async function saveSoftwareTestConfiguration(config, input, options = {}) {
  const settings = normalizeSoftwareTestConfiguration(input);
  const execute = options.runPowerShell ?? runPowerShell;
  const scriptPath = options.runnerPath ?? runnerPath(config);
  if (!fs.existsSync(scriptPath)) {
    throw new Error('Software test VM runner not found: ' + scriptPath);
  }
  const result = await execute([
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-Mode',
    'Validate',
    '-VmName',
    settings.vmName,
    '-CheckpointName',
    settings.checkpointName,
  ]);
  const verified = resultFromPowerShellOutput(result.stdout);
  if (!verified?.valid) {
    throw new Error('Software test VM validation did not return a valid checkpoint result.');
  }
  writeJson(softwareTestConfigPath(config), {
    ...settings,
    verifiedAt: new Date().toISOString(),
  });
  return loadSoftwareTestConfiguration(config);
}

export async function prepareSoftwareTestRun(config, profileId, options = {}) {
  const configuration = loadSoftwareTestConfiguration(config);
  if (!configuration.ready) {
    throw new Error(configuration.detail);
  }
  const latest = readJson(path.join(softwareTestRunsRoot(config), latestFileName), null);
  if (latest?.cleanup === 'failed') {
    throw new Error('Previous software test cleanup failed. Restore the dedicated clean checkpoint before another test.');
  }
  const id = String(profileId ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(id)) {
    throw new Error('Invalid deployment profile id for software test.');
  }
  const runId = new Date().toISOString().replace(/[-:.TZ]/gu, '') + '-' + randomUUID().slice(0, 8);
  const paths = softwareTestRunPaths(config, runId);
  fs.mkdirSync(paths.root, { recursive: true });
  const materialize = options.materializePayload ?? materializeSoftwareTestPayload;
  const payload = await materialize(config, id, paths.root, options);
  const initial = writeSoftwareTestStatus(config, runId, {
    runId,
    profileId: payload.profile.id,
    profileName: payload.profile.name,
    status: 'running',
    phase: 'payload-ready',
    startedAt: new Date().toISOString(),
    cleanup: 'pending',
    detail: 'Isolated Apps payload is ready; waiting for dedicated test VM.',
  });
  return {
    runId,
    paths,
    configuration,
    profile: payload.profile,
    status: initial,
  };
}

export async function runPreparedSoftwareTest(config, prepared, options = {}) {
  const execute = options.runPowerShell ?? runPowerShell;
  const scriptPath = options.runnerPath ?? runnerPath(config);
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-Mode',
    'Run',
    '-VmName',
    prepared.configuration.vmName,
    '-CheckpointName',
    prepared.configuration.checkpointName,
    '-TargetUser',
    prepared.configuration.targetUser,
    '-PayloadRoot',
    prepared.paths.root,
    '-RunRoot',
    prepared.paths.root,
    '-RunId',
    prepared.runId,
    '-SecretsPath',
    deploymentSecretsPath(config),
  ];
  const persistResult = (value) => {
    const result = value ?? prepared.status;
    return writeSoftwareTestStatus(config, prepared.runId, {
      ...prepared.status,
      ...result,
      profileId: result.profileId ?? prepared.profile.id,
      profileName: result.profileName ?? prepared.profile.name,
    });
  };
  try {
    const result = await execute(args, options.processOptions ?? {});
    return persistResult(resultFromPowerShellOutput(result.stdout) ?? readJson(prepared.paths.statusPath, prepared.status));
  } catch (error) {
    const result = resultFromPowerShellOutput(error.stdout) ?? readJson(prepared.paths.statusPath, null);
    if (result) {
      return persistResult(result);
    }
    throw error;
  }
}
