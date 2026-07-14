import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadSoftwareTestConfiguration,
  normalizeSoftwareTestConfiguration,
  prepareSoftwareTestRun,
  readSoftwareTestStatus,
  requestSoftwareTestAbort,
  runPreparedSoftwareTest,
  saveSoftwareTestConfiguration,
  softwareTestConfigPath,
  softwareTestRunPaths,
  writeSoftwareTestStatus,
} from '../src/softwareTest.js';

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'winception-software-test-'));
}

function makeConfig(root) {
  return {
    paths: {
      repoRoot: root,
      appRoot: root,
      stateRoot: path.join(root, 'State'),
    },
  };
}

function runnerOutput(value) {
  return `WINCEPTION_SOFTWARE_TEST_RESULT:${JSON.stringify(value)}`;
}

test('software test configuration validates a dedicated VM and does not persist an invalid checkpoint', async () => {
  const root = makeRoot();
  try {
    const config = makeConfig(root);
    const runner = path.join(root, 'Invoke-SoftwareTestVm.ps1');
    fs.writeFileSync(runner, '# test runner\n', 'utf8');

    assert.deepEqual(loadSoftwareTestConfiguration(config), {
      configured: false,
      ready: false,
      detail: 'Register a dedicated software test VM and clean checkpoint.',
    });
    assert.throws(
      () => normalizeSoftwareTestConfiguration({ vmName: '../other', checkpointName: 'clean', targetUser: 'operator' }),
      /Enter a valid software test VM name/,
    );
    await assert.rejects(
      () => saveSoftwareTestConfiguration(config, {
        vmName: 'winception-software-test-01',
        checkpointName: 'Winception-SoftwareTest-Clean',
        targetUser: 'operator',
      }, {
        runnerPath: runner,
        runPowerShell: async () => ({ stdout: 'checkpoint missing' }),
      }),
      /could not be verified/i,
    );
    assert.equal(fs.existsSync(softwareTestConfigPath(config)), false);

    const saved = await saveSoftwareTestConfiguration(config, {
      vmName: 'winception-software-test-01',
      checkpointName: 'Winception-SoftwareTest-Clean',
      targetUser: 'operator',
    }, {
      runnerPath: runner,
      runPowerShell: async (args) => {
        assert.deepEqual(args.slice(-6), [
          '-Mode', 'Validate',
          '-VmName', 'winception-software-test-01',
          '-CheckpointName', 'Winception-SoftwareTest-Clean',
        ]);
        return { stdout: runnerOutput({ valid: true }) };
      },
    });
    assert.equal(saved.ready, true);
    assert.equal(saved.vmName, 'winception-software-test-01');
    assert.equal(readSoftwareTestStatus(config).configuration.targetUser, 'operator');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software test registration exposes structured safe validation errors without persisting configuration', async () => {
  const root = makeRoot();
  try {
    const config = makeConfig(root);
    const runner = path.join(root, 'Invoke-SoftwareTestVm.ps1');
    fs.writeFileSync(runner, '# test runner\n', 'utf8');
    const settings = {
      vmName: 'winception-software-test-01',
      checkpointName: 'Winception-SoftwareTest-Clean',
      targetUser: 'operator',
    };
    const expected = {
      vm_not_found: 'software_test_vm_not_found',
      vm_wrong_generation: 'software_test_vm_wrong_generation',
      vm_not_off: 'software_test_vm_not_off',
      checkpoint_not_found: 'software_test_checkpoint_not_found',
    };

    for (const [reason, code] of Object.entries(expected)) {
      const raw = new Error('C:\\private\\Invoke-SoftwareTestVm.ps1:44 raw PowerShell output');
      raw.stdout = runnerOutput({ valid: false, reason });
      await assert.rejects(
        () => saveSoftwareTestConfiguration(config, settings, {
          runnerPath: runner,
          runPowerShell: async () => { throw raw; },
        }),
        (error) => {
          assert.equal(error.publicError?.code, code);
          assert.doesNotMatch(error.publicError?.message ?? '', /private|PowerShell/u);
          assert.ok(error.publicError?.action);
          if (reason === 'vm_not_off') {
            assert.match(error.publicError.action, /Saved and Paused states are not supported/u);
          }
          return true;
        },
      );
    }
    assert.equal(fs.existsSync(softwareTestConfigPath(config)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software test runner emits structured validation reasons', () => {
  const runner = fs.readFileSync(path.resolve('tools', 'Invoke-SoftwareTestVm.ps1'), 'utf8');
  assert.match(runner, /function Test-SoftwareTestVmRegistration/u);
  assert.match(runner, /reason = 'vm_not_found'/u);
  assert.match(runner, /reason = 'vm_wrong_generation'/u);
  assert.match(runner, /reason = 'vm_not_off'/u);
  assert.match(runner, /reason = 'checkpoint_not_found'/u);
  assert.match(runner, /function Get-CleanupFailure/u);
  assert.match(runner, /runner-diagnostic\.log/u);
  assert.match(runner, /Write-Result \$validation/u);
});

test('software test materialization stays in State and runner status is safe for the Web API', async () => {
  const root = makeRoot();
  try {
    const config = makeConfig(root);
    const liveAppsRoot = path.join(root, 'Live', 'Apps');
    fs.mkdirSync(liveAppsRoot, { recursive: true });
    fs.writeFileSync(path.join(liveAppsRoot, 'keep.txt'), 'live', 'utf8');
    fs.mkdirSync(path.dirname(softwareTestConfigPath(config)), { recursive: true });
    fs.writeFileSync(softwareTestConfigPath(config), JSON.stringify({
      vmName: 'winception-software-test-01',
      checkpointName: 'Winception-SoftwareTest-Clean',
      targetUser: 'operator',
      verifiedAt: '2026-07-12T00:00:00.000Z',
    }), 'utf8');

    const prepared = await prepareSoftwareTestRun(config, 'profile-01', {
      materializePayload: async (_config, profileId, testRoot) => {
        fs.mkdirSync(path.join(testRoot, 'Apps'), { recursive: true });
        fs.writeFileSync(path.join(testRoot, 'Apps', 'selected-profile.json'), '{}', 'utf8');
        return {
          profile: { id: profileId, name: 'Test profile' },
          appsRoot: path.join(testRoot, 'Apps'),
        };
      },
    });
    assert.match(prepared.paths.root, /software-test-runs/u);
    assert.equal(fs.readFileSync(path.join(liveAppsRoot, 'keep.txt'), 'utf8'), 'live');
    assert.equal(readSoftwareTestStatus(config).latest.phase, 'payload-ready');

    const completed = await runPreparedSoftwareTest(config, prepared, {
      runnerPath: path.join(root, 'Invoke-SoftwareTestVm.ps1'),
      runPowerShell: async () => ({
        stdout: runnerOutput({
          profileId: 'profile-01',
          profileName: 'Test profile',
          status: 'succeeded',
          phase: 'completed',
          cleanup: 'succeeded',
          elapsedSeconds: 42,
          rebootCount: 1,
          detail: 'Software test completed successfully.',
          steps: [{
            index: 1,
            type: 'software',
            id: 'app-01',
            name: 'App 01',
            status: 'succeeded',
            durationSeconds: 40,
            timeoutSeconds: 600,
            networkWaitSeconds: 2,
            rebootRecommended: true,
            script: 'C:\\secret\\install.ps1',
            commandLine: 'secret command',
          }],
        }),
      }),
    });
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.cleanup, 'succeeded');
    assert.equal(completed.steps[0].networkWaitSeconds, 2);
    assert.equal(Object.hasOwn(completed.steps[0], 'script'), false);
    assert.equal(Object.hasOwn(completed.steps[0], 'commandLine'), false);
    assert.equal(readSoftwareTestStatus(config).latest.runId, prepared.runId);

    await assert.rejects(
      () => prepareSoftwareTestRun(config, '../invalid', { materializePayload: async () => null }),
      /Invalid deployment profile id/i,
    );
    const cleanupFailed = writeSoftwareTestStatus(config, prepared.runId, {
      ...completed,
      cleanup: 'failed',
      cleanupReason: 'checkpoint_not_found',
      cleanupAction: 'C:\\private\\raw-action',
    });
    assert.equal(cleanupFailed.cleanupReason, 'checkpoint_not_found');
    assert.match(cleanupFailed.cleanupAction, /Rebuild or select the clean checkpoint/u);
    assert.doesNotMatch(cleanupFailed.cleanupAction, /private|raw-action/u);
    await assert.rejects(
      () => prepareSoftwareTestRun(config, 'profile-02', { materializePayload: async () => null }),
      /Previous software test cleanup requires recovery/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('successful re-registration marks a failed cleanup recovered and unlocks a new test', async () => {
  const root = makeRoot();
  try {
    const config = makeConfig(root);
    const runner = path.join(root, 'Invoke-SoftwareTestVm.ps1');
    fs.writeFileSync(runner, '# test runner\n', 'utf8');
    writeSoftwareTestStatus(config, 'failed-run', {
      runId: 'failed-run',
      profileId: 'profile-01',
      profileName: 'Test profile',
      status: 'failed',
      phase: 'cleanup-failed',
      cleanup: 'failed',
      cleanupReason: 'checkpoint_not_found',
    });
    await saveSoftwareTestConfiguration(config, {
      vmName: 'winception-software-test-01',
      checkpointName: 'Winception-SoftwareTest-Clean',
      targetUser: 'operator',
    }, {
      runnerPath: runner,
      runPowerShell: async () => ({ stdout: runnerOutput({ valid: true }) }),
    });
    const recovered = readSoftwareTestStatus(config).latest;
    assert.equal(recovered.cleanup, 'failed');
    assert.equal(recovered.recovery?.status, 'verified');
    await assert.doesNotReject(() => prepareSoftwareTestRun(config, 'profile-02', {
      materializePayload: async (_config, profileId, testRoot) => ({
        profile: { id: profileId, name: 'Recovered profile' },
        appsRoot: testRoot,
      }),
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('successful re-registration recovers a stale payload-ready run that never started the runner', async () => {
  const root = makeRoot();
  try {
    const config = makeConfig(root);
    const runner = path.join(root, 'Invoke-SoftwareTestVm.ps1');
    fs.writeFileSync(runner, '# test runner\n', 'utf8');
    const now = Date.parse('2026-07-13T06:00:00.000Z');
    writeSoftwareTestStatus(config, 'stale-run', {
      runId: 'stale-run',
      profileId: 'profile-01',
      profileName: 'Test profile',
      status: 'running',
      phase: 'payload-ready',
      startedAt: '2026-07-13T05:58:00.000Z',
      cleanup: 'pending',
    });
    await saveSoftwareTestConfiguration(config, {
      vmName: 'winception-software-test-01',
      checkpointName: 'Winception-SoftwareTest-Clean',
      targetUser: 'operator',
    }, {
      now,
      runnerPath: runner,
      runPowerShell: async () => ({ stdout: runnerOutput({ valid: true }) }),
    });
    const recovered = readSoftwareTestStatus(config).latest;
    assert.equal(recovered.status, 'failed');
    assert.equal(recovered.phase, 'runner-not-started');
    assert.equal(recovered.cleanup, 'not-required');
    assert.equal(recovered.recovery?.status, 'verified');
    await assert.doesNotReject(() => prepareSoftwareTestRun(config, 'profile-02', {
      materializePayload: async (_config, profileId, testRoot) => ({
        profile: { id: profileId, name: 'Recovered profile' },
        appsRoot: testRoot,
      }),
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software test keeps a safe runner result even when PowerShell returns a nonzero code', async () => {
  const root = makeRoot();
  try {
    const config = makeConfig(root);
    fs.mkdirSync(path.dirname(softwareTestConfigPath(config)), { recursive: true });
    fs.writeFileSync(softwareTestConfigPath(config), JSON.stringify({
      vmName: 'winception-software-test-01',
      checkpointName: 'Winception-SoftwareTest-Clean',
      targetUser: 'operator',
      verifiedAt: '2026-07-12T00:00:00.000Z',
    }), 'utf8');
    const prepared = await prepareSoftwareTestRun(config, 'profile-01', {
      materializePayload: async (_config, profileId, testRoot) => ({
        profile: { id: profileId, name: 'Test profile' },
        appsRoot: path.join(testRoot, 'Apps'),
      }),
    });
    const error = new Error('runner failed');
    error.stdout = runnerOutput({
      profileId: 'profile-01',
      profileName: 'Test profile',
      status: 'failed',
      phase: 'cleanup-failed',
      cleanup: 'failed',
      detail: 'Software test cleanup failed; restore the dedicated checkpoint before another test.',
      failure: { category: 'runner_error', stepId: '', stepType: '' },
    });
    const result = await runPreparedSoftwareTest(config, prepared, {
      runnerPath: path.join(root, 'Invoke-SoftwareTestVm.ps1'),
      runPowerShell: async () => { throw error; },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.cleanup, 'failed');
    assert.equal(readSoftwareTestStatus(config).latest.failure.category, 'runner_error');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software test abort request is limited to the latest active run and exposes only safe status', () => {
  const root = makeRoot();
  try {
    const config = makeConfig(root);
    writeSoftwareTestStatus(config, 'test-run-001', {
      runId: 'test-run-001',
      profileId: 'profile-01',
      profileName: 'Test profile',
      status: 'running',
      phase: 'running-installer',
      startedAt: '2026-07-13T00:00:00.000Z',
      cleanup: 'pending',
      detail: 'Running the published software sequence as SYSTEM.',
    });

    const requested = requestSoftwareTestAbort(config, 'test-run-001', { now: Date.parse('2026-07-13T00:01:00.000Z') });
    assert.equal(requested.status, 'running');
    assert.equal(requested.phase, 'cancellation-requested');
    assert.equal(requested.abortRequestedAt, '2026-07-13T00:01:00.000Z');
    assert.equal(fs.existsSync(softwareTestRunPaths(config, 'test-run-001').abortRequestPath), true);
    assert.match(requested.detail, /Stopping the test and restoring the clean checkpoint/u);

    assert.throws(
      () => requestSoftwareTestAbort(config, 'test-run-001'),
      (error) => error.publicError?.code === 'software_test_abort_in_progress',
    );
    assert.throws(
      () => requestSoftwareTestAbort(config, 'other-run'),
      (error) => error.publicError?.code === 'software_test_not_running',
    );
    const safe = readSoftwareTestStatus(config).latest;
    assert.equal(safe.abortRequestedAt, '2026-07-13T00:01:00.000Z');
    assert.doesNotMatch(JSON.stringify(safe), /abort-request\.json|command|secret/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('software test runner checks cancellation requests and preserves checkpoint cleanup', () => {
  const runner = fs.readFileSync(path.resolve('tools', 'Invoke-SoftwareTestVm.ps1'), 'utf8');
  assert.match(runner, /abort-request\.json/u);
  assert.match(runner, /function Test-AbortRequested/u);
  assert.match(runner, /function Stop-RemoteInstallerTask/u);
  assert.match(runner, /Phase 'stopping-installer'/u);
  assert.match(runner, /Phase 'restoring-checkpoint'/u);
  assert.match(runner, /Status 'aborted'/u);
  assert.match(runner, /Split-Path -Parent \$RunRoot\) 'latest\.json'/u);
  assert.match(runner, /Stop-SoftwareTestVmForCleanup/u);
  assert.match(runner, /Restore-VMSnapshot -VMName \$VmName -Name \$CheckpointName/u);
});

test('software test runner tolerates transient progress-file sharing violations', () => {
  const runner = fs.readFileSync(path.resolve('tools', 'Invoke-SoftwareTestVm.ps1'), 'utf8');
  assert.match(runner, /for \(\$attempt = 0; \$attempt -lt 3; \$attempt\+\+\)/u);
  assert.match(runner, /Get-Content -LiteralPath \$Path -Raw -ErrorAction Stop/u);
  assert.match(runner, /Start-Sleep -Milliseconds 100/u);
});
