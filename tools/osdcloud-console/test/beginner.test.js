import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBeginnerHomeModel } from '../web/js/beginnerModel.js';

function makeState(overrides = {}) {
  const base = {
    initialization: { initialized: true },
    profile: { activeProfile: { id: 'profile-1', name: 'Default' } },
    osImage: { activeImage: { id: 'image-1', cached: true } },
    runtime: { ready: true },
    preflight: [
      { name: 'Endpoint', ok: true },
      { name: 'Runtime', ok: true },
    ],
    services: {
      http: { running: true },
      tftp: { running: true },
      dhcp: { running: true },
    },
    fleet: { counts: { running: 0, failed: 0, completed: 0 }, total: 0 },
    operation: null,
  };
  const result = {
    ...base,
    ...overrides,
    initialization: { ...base.initialization, ...overrides.initialization },
    profile: { ...base.profile, ...overrides.profile },
    osImage: { ...base.osImage, ...overrides.osImage },
    runtime: { ...base.runtime, ...overrides.runtime },
    services: { ...base.services, ...overrides.services },
    fleet: { ...base.fleet, ...overrides.fleet },
  };
  if (Object.prototype.hasOwnProperty.call(overrides, 'fleet') && overrides.fleet === undefined) {
    delete result.fleet;
  }
  return result;
}

test('beginner home prioritizes physical pairing and invalidates stale site readiness', () => {
  const pending = buildBeginnerHomeModel(makeState({ bootRequests: [{ requestId: 'test' }] }));
  assert.equal(pending.primaryAction, 'pairing');
  assert.equal(pending.pxeReady, false);
  const changed = buildBeginnerHomeModel(makeState({ endpointDrift: true }));
  assert.equal(changed.primaryAction, 'initialization');
  assert.equal(changed.step, 'endpoint');
  assert.equal(changed.pxeReady, false);
  const ipxe = buildBeginnerHomeModel(makeState({ config: { dhcp: { bootMode: 'ipxe' } } }));
  assert.match(ipxe.why, /Secure Boot 必須關閉/);
  const signed = buildBeginnerHomeModel(makeState({ config: { dhcp: { bootMode: 'secureboot' } } }));
  assert.match(signed.why, /Secure Boot 可保持開啟/);
});

test('beginner home asks for basic setup first', () => {
  const model = buildBeginnerHomeModel(makeState({
    initialization: { initialized: false, nextStepId: 'endpoint' },
  }));

  assert.equal(model.phase, 'setup');
  assert.equal(model.primaryAction, 'initialization');
  assert.equal(model.primaryLabel, '完成基本設定');
  assert.match(model.why, /第一次使用/);
  assert.equal(model.pxeReady, false);
  assert.equal(model.steps[0].id, 'setup');
  assert.equal(model.steps[0].status, 'current');
});

test('beginner home points to missing deployment content', () => {
  const profileMissing = buildBeginnerHomeModel(makeState({ profile: { activeProfile: null } }));
  assert.equal(profileMissing.phase, 'content');
  assert.equal(profileMissing.primaryAction, 'profiles');
  assert.equal(profileMissing.primaryLabel, '選擇要安裝的內容');

  const imageMissing = buildBeginnerHomeModel(makeState({ osImage: { activeImage: { cached: false } } }));
  assert.equal(imageMissing.phase, 'content');
  assert.equal(imageMissing.primaryAction, 'os-images');
  assert.equal(imageMissing.primaryLabel, '選擇要安裝的內容');
});

test('beginner home prepares runtime before preflight', () => {
  const model = buildBeginnerHomeModel(makeState({ runtime: { ready: false } }));

  assert.equal(model.phase, 'runtime');
  assert.equal(model.primaryAction, 'prepare-runtime');
  assert.equal(model.primaryLabel, '準備部署檔案');
});

test('beginner home distinguishes preflight not run, ready, and failed', () => {
  const notRun = buildBeginnerHomeModel(makeState({ preflight: [] }));
  assert.equal(notRun.phase, 'preflight');
  assert.equal(notRun.primaryAction, 'preflight');

  const ready = buildBeginnerHomeModel(makeState({ preflight: [{ name: 'Endpoint', ok: true }] }));
  assert.equal(ready.preflight.ready, true);
  assert.notEqual(ready.phase, 'preflight');

  const failed = buildBeginnerHomeModel(makeState({
    preflight: [{ name: 'DHCP safety', ok: false, detail: 'LAN DHCP is still active.' }],
  }));
  assert.equal(failed.phase, 'repair');
  assert.equal(failed.primaryAction, 'initialization');
  assert.equal(failed.primaryLabel, '檢視問題');
  assert.equal(failed.blockers[0].name, 'DHCP safety');
  assert.equal(failed.steps.find((step) => step.id === 'environment')?.status, 'blocked');
  assert.notEqual(failed.primaryAction, 'all-services-toggle');
});

test('beginner home shows service progress and ready activity', () => {
  const partial = buildBeginnerHomeModel(makeState({
    preflight: [{ name: 'Endpoint', ok: true }],
    services: {
      http: { running: true },
      tftp: { running: false },
      dhcp: { running: false },
    },
  }));
  assert.equal(partial.phase, 'services');
  assert.equal(partial.primaryAction, 'all-services-toggle');
  assert.equal(partial.primaryLabel, '啟動網路開機服務');
  assert.equal(partial.services.running, 1);

  const ready = buildBeginnerHomeModel(makeState());
  assert.equal(ready.phase, 'activity');
  assert.equal(ready.primaryAction, 'fleet');
  assert.equal(ready.primaryLabel, '查看電腦進度');
  assert.equal(ready.pxeReady, true);
  assert.match(ready.why, /PXE/);
  assert.equal(ready.steps.map((step) => step.id).join(','), 'setup,content,environment,services');
});

test('beginner home prioritizes operation progress and handles an empty fleet', () => {
  const model = buildBeginnerHomeModel(makeState({
    operation: { running: true, label: 'Preparing runtime' },
    fleet: undefined,
  }));

  assert.equal(model.phase, 'progress');
  assert.equal(model.primaryAction, 'host-progress');
  assert.equal(model.primaryLabel, '查看主機作業進度');
  assert.deepEqual(model.deploymentSummary.map((item) => item.value), [0, 0, 0, 0]);
});
