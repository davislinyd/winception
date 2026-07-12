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
  runPreparedSoftwareTest,
  saveSoftwareTestConfiguration,
  softwareTestConfigPath,
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
      /Invalid software test VM name/,
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
      /validation did not return/i,
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
    writeSoftwareTestStatus(config, prepared.runId, { ...completed, cleanup: 'failed' });
    await assert.rejects(
      () => prepareSoftwareTestRun(config, 'profile-02', { materializePayload: async () => null }),
      /Previous software test cleanup failed/i,
    );
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
