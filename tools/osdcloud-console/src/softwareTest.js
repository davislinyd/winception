import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appRootForConfig, stateRootForConfig } from './config.js';
import { materializeSoftwareTestPayload } from './profiles/publish.js';
import { deploymentSecretsPath, errorWithStatus } from './controller/helpers.js';
import { runPowerShell } from './windows/powershell.js';
import { writeJsonAtomic } from './atomicFile.js';

const configFileName = 'software-test.json';
const runsDirectoryName = 'software-test-runs';
const latestFileName = 'latest.json';
const statusFileName = 'status.json';
const abortRequestFileName = 'abort-request.json';
const stalePayloadReadyMs = 60 * 1000;
const cleanupActions = {
  checkpoint_not_found: 'Rebuild or select the clean checkpoint in Hyper-V Manager, power off the dedicated VM, then use Test VM Settings and Register and verify.',
  vm_not_off: 'In Hyper-V Manager, shut down the dedicated VM. Saved and Paused states are not supported. Then use Test VM Settings and Register and verify.',
  restore_failed: 'Restore the clean checkpoint manually in Hyper-V Manager, power off the dedicated VM, then use Test VM Settings and Register and verify.',
  cleanup_failed: 'Check System Log, restore the dedicated clean checkpoint, power off the VM, then use Test VM Settings and Register and verify.',
};

function readJson(filePath, fallback = null) {
  try {
    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '').trim();
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function isStalePayloadReadyRun(value, now = Date.now()) {
  if (value?.status !== 'running' || value?.phase !== 'payload-ready') {
    return false;
  }
  const startedAt = Date.parse(value.startedAt ?? '');
  return Number.isFinite(startedAt) && now - startedAt >= stalePayloadReadyMs;
}

function writeJson(filePath, value) {
  writeJsonAtomic(filePath, value);
}

function cleanValue(value, label, pattern, maxLength = 128) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength || !pattern.test(text)) {
    throw errorWithStatus('Enter a valid ' + label + '.', 400, {
      code: 'invalid_software_test_configuration',
      action: 'Use letters, numbers, spaces, periods, underscores, or hyphens only.',
    });
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
    abortRequestPath: path.join(root, abortRequestFileName),
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
  const cleanupReason = Object.hasOwn(cleanupActions, value.cleanupReason)
    ? value.cleanupReason
    : (value.cleanup === 'failed' ? 'cleanup_failed' : '');
  const safe = {
    runId,
    profileId: String(value.profileId ?? ''),
    profileName: String(value.profileName ?? ''),
    status: String(value.status ?? 'running'),
    phase: String(value.phase ?? ''),
    startedAt: value.startedAt ?? null,
    finishedAt: value.finishedAt ?? null,
    abortRequestedAt: value.abortRequestedAt ? String(value.abortRequestedAt) : null,
    elapsedSeconds: Number.isFinite(Number(value.elapsedSeconds)) ? Number(value.elapsedSeconds) : null,
    rebootCount: Number.isInteger(value.rebootCount) ? value.rebootCount : 0,
    cleanup: String(value.cleanup ?? 'pending'),
    cleanupReason,
    cleanupAction: cleanupReason ? cleanupActions[cleanupReason] : '',
    recovery: value.recovery?.status === 'verified' ? {
      status: 'verified',
      verifiedAt: String(value.recovery.verifiedAt ?? ''),
    } : null,
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

export function requestSoftwareTestAbort(config, runId, options = {}) {
  const id = String(runId ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/u.test(id)) {
    throw errorWithStatus('The selected software test is no longer active.', 409, {
      code: 'software_test_not_running',
      action: 'Refresh the page and start a new software test if needed.',
    });
  }
  const latest = readJson(path.join(softwareTestRunsRoot(config), latestFileName), null);
  if (latest?.runId !== id || latest?.status !== 'running') {
    throw errorWithStatus('The selected software test is no longer active.', 409, {
      code: 'software_test_not_running',
      action: 'Refresh the page and start a new software test if needed.',
    });
  }
  const paths = softwareTestRunPaths(config, id);
  if (fs.existsSync(paths.abortRequestPath) || latest.phase === 'cancellation-requested' || latest.phase === 'stopping-installer' || latest.phase === 'restoring-checkpoint') {
    throw errorWithStatus('Software test cancellation is already in progress.', 409, {
      code: 'software_test_abort_in_progress',
      action: 'Wait for checkpoint cleanup to complete.',
    });
  }
  const requestedAt = new Date(options.now ?? Date.now()).toISOString();
  writeJson(paths.abortRequestPath, { runId: id, requestedAt });
  return writeSoftwareTestStatus(config, id, {
    ...latest,
    status: 'running',
    phase: 'cancellation-requested',
    abortRequestedAt: requestedAt,
    cleanup: 'pending',
    detail: 'Cancellation requested. Stopping the test and restoring the clean checkpoint.',
  });
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

function validationError(result, settings) {
  const vmName = settings.vmName;
  const checkpointName = settings.checkpointName;
  switch (result?.reason) {
    case 'vm_not_found':
      return errorWithStatus(`Software test VM "${vmName}" was not found.`, 404, {
        code: 'software_test_vm_not_found',
        action: 'Check the VM name in Hyper-V Manager, then try again.',
      });
    case 'vm_wrong_generation':
      return errorWithStatus(`Software test VM "${vmName}" must be Generation 2.`, 400, {
        code: 'software_test_vm_wrong_generation',
        action: 'Use a dedicated Generation 2 VM, then try again.',
      });
    case 'vm_not_off':
      return errorWithStatus(`Software test VM "${vmName}" must be powered off before registration.`, 409, {
        code: 'software_test_vm_not_off',
        action: 'In Hyper-V Manager, shut down the VM. Saved and Paused states are not supported.',
      });
    case 'checkpoint_not_found':
      return errorWithStatus(`Clean checkpoint "${checkpointName}" was not found for "${vmName}".`, 404, {
        code: 'software_test_checkpoint_not_found',
        action: 'Create or select the dedicated clean checkpoint in Hyper-V Manager, then try again.',
      });
    default:
      return errorWithStatus('Software test VM could not be verified.', 500, {
        code: 'software_test_validation_failed',
        action: 'Check System Log, confirm the Console is elevated, and try again.',
      });
  }
}

export async function saveSoftwareTestConfiguration(config, input, options = {}) {
  const settings = normalizeSoftwareTestConfiguration(input);
  const execute = options.runPowerShell ?? runPowerShell;
  const scriptPath = options.runnerPath ?? runnerPath(config);
  if (!fs.existsSync(scriptPath)) {
    throw new Error('Software test VM runner not found: ' + scriptPath);
  }
  let result;
  try {
    result = await execute([
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
  } catch (error) {
    throw validationError(resultFromPowerShellOutput(error.stdout), settings);
  }
  const verified = resultFromPowerShellOutput(result.stdout);
  if (!verified?.valid) {
    throw validationError(verified, settings);
  }
  writeJson(softwareTestConfigPath(config), {
    ...settings,
    verifiedAt: new Date().toISOString(),
  });
  const latest = readJson(path.join(softwareTestRunsRoot(config), latestFileName), null);
  if (latest?.cleanup === 'failed') {
    writeSoftwareTestStatus(config, latest.runId, {
      ...latest,
      recovery: {
        status: 'verified',
        verifiedAt: new Date().toISOString(),
      },
    });
  } else if (isStalePayloadReadyRun(latest, options.now ?? Date.now())) {
    writeSoftwareTestStatus(config, latest.runId, {
      ...latest,
      status: 'failed',
      phase: 'runner-not-started',
      finishedAt: new Date(options.now ?? Date.now()).toISOString(),
      cleanup: 'not-required',
      detail: 'Software test runner did not start. Recovery verification completed; you can start a new test.',
      recovery: {
        status: 'verified',
        verifiedAt: new Date(options.now ?? Date.now()).toISOString(),
      },
    });
  }
  return loadSoftwareTestConfiguration(config);
}

export async function prepareSoftwareTestRun(config, profileId, options = {}) {
  const configuration = loadSoftwareTestConfiguration(config);
  if (!configuration.ready) {
    throw new Error(configuration.detail);
  }
  const latest = readJson(path.join(softwareTestRunsRoot(config), latestFileName), null);
  if (latest?.cleanup === 'failed' && latest?.recovery?.status !== 'verified') {
    throw errorWithStatus('Previous software test cleanup requires recovery before another test.', 409, {
      code: 'software_test_cleanup_recovery_required',
      action: latest.cleanupAction || cleanupActions.cleanup_failed,
    });
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
