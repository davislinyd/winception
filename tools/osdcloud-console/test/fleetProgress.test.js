import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FLEET_STAGE_FLOW,
  flowIndexForStage,
  estPct,
  ringPercent,
} from '../web/js/fleetProgress.js';

test('flowIndexForStage maps stages and substages to flow positions', () => {
  assert.equal(flowIndexForStage('winpe-start'), 0);
  assert.equal(flowIndexForStage('apply-image'), 3);
  assert.equal(flowIndexForStage('windows-setupcomplete'), 5);
  assert.equal(flowIndexForStage('windows-setupcomplete-start'), 5);
  assert.equal(flowIndexForStage('windows-setupcomplete-finished'), 5);
  assert.equal(flowIndexForStage('windows-desktop-ready'), 6);
  // App install + driver cache run inside the SetupComplete phase.
  assert.equal(flowIndexForStage('windows-apps-start'), 5);
  assert.equal(flowIndexForStage('windows-apps-progress'), 5);
  assert.equal(flowIndexForStage('windows-apps-finished'), 5);
  assert.equal(flowIndexForStage('windows-driverpack-cache-request'), 5);
  // Image acquisition / verify / disk prep hold at osdcloud-start (idx 2).
  for (const s of ['os-image-selected', 'torrent-download', 'torrent-peers',
    'torrent-firewall', 'torrent-fallback', 'torrent-verify', 'disk', 'partition-target']) {
    assert.equal(flowIndexForStage(s), 2, `${s} should map to osdcloud-start`);
  }
  // Post-apply WinPE finalization maps to rebooting (idx 4).
  for (const s of ['drivers', 'post-apply-scripts', 'windows-metadata-written', 'osdcloud-finished']) {
    assert.equal(flowIndexForStage(s), 4, `${s} should map to rebooting`);
  }
  assert.equal(flowIndexForStage('reporter-stop'), 4);
  // Unknown / empty stages do not map.
  assert.equal(flowIndexForStage('running'), -1);
  assert.equal(flowIndexForStage(null), -1);
  assert.equal(flowIndexForStage(''), -1);
});

test('estPct derives a step-aligned percentage from stage alone', () => {
  assert.equal(estPct(null), 0);
  assert.equal(estPct('winpe-start'), 0);
  assert.equal(estPct('apply-image'), 43); // round(3/7*100)
  assert.equal(estPct('windows-setupcomplete'), 71); // round(5/7*100)
  assert.equal(estPct('windows-apps-progress'), 71); // mapped into SetupComplete
  assert.equal(estPct('bogus-stage'), 5); // non-null but unmatched
});

test('ringPercent scales reported percent within the current step slice', () => {
  // apply-image occupies slice [43, 57] of the overall flow.
  assert.equal(ringPercent({ latestStage: 'apply-image', latestPercent: null }), 43);
  assert.equal(ringPercent({ latestStage: 'apply-image', latestPercent: 0 }), 43);
  assert.equal(ringPercent({ latestStage: 'apply-image', latestPercent: 50 }), 50);
  assert.equal(ringPercent({ latestStage: 'apply-image', latestPercent: 100 }), 57);
  // windows-apps-progress maps into SetupComplete slice [71, 86].
  assert.equal(ringPercent({ latestStage: 'windows-apps-progress', latestPercent: 94.5 }), 85);
  // The reporter stopping is the expected WinPE reboot handoff, not a reset.
  assert.equal(ringPercent({ latestStage: 'reporter-stop', latestPercent: null }), 57);
  // Unmatched stage with a reported percent falls back to the raw clamped value.
  assert.equal(ringPercent({ latestStage: 'custom-progress', latestPercent: 50 }), 50);
  assert.equal(ringPercent({ latestStage: 'custom-progress', latestPercent: 150 }), 100);
  // No stage, no percent → 0 (idle).
  assert.equal(ringPercent({ latestStage: null, latestPercent: null }), 0);
});

test('the ring never reports backwards across a realistic torrent deployment', () => {
  // The actual stage sequence a torrent (default-on) deployment emits, including
  // the intermediate substages that previously dropped the ring back to 5%.
  const sequence = [
    { latestStage: 'winpe-start', latestPercent: null },
    { latestStage: 'smb-mounted', latestPercent: null },
    { latestStage: 'osdcloud-start', latestPercent: null },
    { latestStage: 'os-image-selected', latestPercent: null },
    { latestStage: 'torrent-peers', latestPercent: null },
    { latestStage: 'torrent-download', latestPercent: null },
    { latestStage: 'torrent-verify', latestPercent: null },
    { latestStage: 'partition-target', latestPercent: null },
    { latestStage: 'apply-image', latestPercent: 0 },
    { latestStage: 'apply-image', latestPercent: 100 },
    { latestStage: 'drivers', latestPercent: null },
    { latestStage: 'post-apply-scripts', latestPercent: null },
    { latestStage: 'osdcloud-finished', latestPercent: null },
    { latestStage: 'rebooting', latestPercent: null },
    { latestStage: 'reporter-stop', latestPercent: null },
    { latestStage: 'windows-setupcomplete-start', latestPercent: 94 },
    { latestStage: 'windows-apps-start', latestPercent: 94.5 },
    { latestStage: 'windows-apps-progress', latestPercent: 94.5 },
    { latestStage: 'windows-setupcomplete-finished', latestPercent: 96 },
    { latestStage: 'windows-desktop-ready', latestPercent: 100 },
  ];
  let previous = -1;
  for (const run of sequence) {
    const pct = ringPercent(run);
    assert.ok(pct >= previous, `ring went backwards at ${run.latestStage}: ${pct} < ${previous}`);
    assert.ok(pct >= 0 && pct <= 100);
    previous = pct;
  }
  assert.equal(FLEET_STAGE_FLOW.length, 7);
});
