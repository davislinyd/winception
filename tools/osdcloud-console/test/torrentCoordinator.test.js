import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TorrentDistributionCoordinator } from '../src/torrentCoordinator.js';

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'torrent-coordinator-'));
  let now = options.start ?? Date.parse('2026-06-19T00:00:00Z');
  const timers = [];
  const coordinator = new TorrentDistributionCoordinator({ stateRoot: root }, {
    now: () => now,
    setTimer: (fn, delay) => {
      const timer = { fn, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {},
  });
  coordinator.configureTorrent({ infoHash: 'a'.repeat(40), totalPieces: 12, wimBytes: 1_000_000 });
  return {
    root,
    coordinator,
    timers,
    setNow(value) { now = value; },
    advance(ms) { now += ms; },
    now() { return now; },
  };
}

function peer(id, ip = `10.0.0.${id}`) {
  return { infoHash: 'a'.repeat(40), peerId: Buffer.alloc(20, id), ip, port: 7000 + id, wire: {} };
}

test('batch collection is fixed at 24 seconds from the first new peer', () => {
  const f = fixture();
  try {
    f.coordinator.registerPeer(peer(1));
    assert.equal(f.timers[0].delay, 24_000);
    const originalDeadline = f.coordinator.state().batchDeadline;
    f.advance(10_000);
    f.coordinator.registerPeer(peer(2));
    assert.equal(f.coordinator.state().batchDeadline, originalDeadline, 'later peers do not reset collection');
    const released = f.coordinator.releaseBatch(1);
    assert.deepEqual(released.map((item) => item.mode), ['striped', 'striped']);
    assert.deepEqual(released.map((item) => item.slot), [0, 1]);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('same infoHash and peerId reconnect keeps its assignment and completed peers return as seeders', () => {
  const f = fixture();
  try {
    const first = f.coordinator.registerPeer(peer(1));
    f.coordinator.releaseBatch(1);
    for (let piece = 0; piece < 12; piece += 1) f.coordinator.recordHave(first.key, piece);
    f.coordinator.disconnectPeer(first.key);
    f.advance(1000);
    const reconnect = f.coordinator.registerPeer(peer(1, '10.0.0.9'));
    assert.equal(reconnect.reconnect, true);
    assert.equal(reconnect.batch, 1);
    assert.equal(reconnect.mode, 'seeder');
    assert.equal(f.coordinator.state().batch, 1, 'reconnect does not create another batch');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('late batch is peer-only while a prior peer has recent piece coverage', () => {
  const f = fixture();
  try {
    const first = f.coordinator.registerPeer(peer(1));
    f.coordinator.releaseBatch(1);
    f.advance(20_000);
    f.coordinator.recordHave(first.key, 0);
    f.coordinator.registerPeer(peer(2));
    const released = f.coordinator.releaseBatch(2);
    assert.equal(released[0].mode, 'peer-only');
    assert.equal(released[0].assignedMode, 'peer-only');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('wave expires after 30 seconds without non-host heartbeat and resets host budget', () => {
  const f = fixture();
  try {
    const first = f.coordinator.registerPeer(peer(1));
    f.coordinator.releaseBatch(1);
    f.coordinator.recordHostBytes(500_000);
    const waveId = f.coordinator.state().waveId;
    f.advance(30_001);
    const next = f.coordinator.registerPeer(peer(2));
    assert.notEqual(f.coordinator.state().waveId, waveId);
    assert.equal(next.batch, 1);
    assert.equal(f.coordinator.state().hostServedBytes, 0);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('normal host bytes stop at 1.15x and a visible emergency opens after 3 minutes stalled', () => {
  const f = fixture();
  try {
    f.coordinator.registerPeer(peer(1));
    f.coordinator.releaseBatch(1);
    assert.equal(f.coordinator.state().budgetBytes, 1_150_000);
    f.coordinator.recordHostBytes(1_149_000);
    assert.equal(f.coordinator.allowHostBytes(1_000), true);
    assert.equal(f.coordinator.allowHostBytes(1_001), false);
    for (let elapsed = 0; elapsed <= 180_000; elapsed += 20_000) {
      f.setNow(Date.parse('2026-06-19T00:00:00Z') + elapsed);
      f.coordinator.receiveTelemetry({ runId: 'run-1', clientId: 'c1', phase: 'downloading', completedLength: 100, totalLength: 1000 }, '10.0.0.1');
    }
    const state = f.coordinator.state();
    assert.equal(state.emergency.reason, 'completedLength-stalled-180s');
    assert.equal(f.coordinator.allowHostBytes(10_000_000), true);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('telemetry is bounded, stale at 15 seconds, removed at 60, and release survives restart', () => {
  const f = fixture();
  try {
    f.coordinator.receiveTelemetry({
      runId: 'run-1', clientId: 'client-1', phase: 'waiting', completedLength: 1000, totalLength: 1000,
      sources: Array.from({ length: 20 }, (_, index) => `10.0.0.${index + 1}:7001 [Peer]`),
      receivers: ['not-an-endpoint', '10.0.0.2:7002 [Peer]'],
    }, '10.0.0.1');
    assert.equal(f.coordinator.state().clients[0].sources.length, 16);
    assert.deepEqual(f.coordinator.state().clients[0].receivers, ['10.0.0.2:7002 [Peer]']);
    assert.equal(f.coordinator.release({ allWaiting: true }).count, 1);
    f.coordinator.close();
    const restored = new TorrentDistributionCoordinator({ stateRoot: f.root }, { now: () => f.now() });
    assert.equal(restored.getControl('run-1').released, true);
    restored.close();
    f.advance(15_001);
    assert.equal(f.coordinator.state().clients[0].stale, true);
    f.advance(45_000);
    assert.equal(f.coordinator.state().clients.length, 0);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('waiting clients can receive persisted cumulative extensions up to 1440 minutes', () => {
  const f = fixture();
  try {
    f.coordinator.receiveTelemetry({
      runId: 'run-extend', clientId: 'client-extend', phase: 'waiting',
      seedBaseMinutes: 15, seedLocalExtensionMinutes: 60, seedSecondsRemaining: 900,
    }, '10.0.0.8');
    let visible = f.coordinator.state().clients[0];
    assert.equal(visible.seedBaseMinutes, 15);
    assert.equal(visible.seedLocalExtensionMinutes, 60);
    assert.equal(visible.seedHostExtensionMinutes, 0);
    assert.equal(visible.seedDeadline, '2026-06-19T00:15:00.000Z');
    const first = f.coordinator.extend({ runId: 'run-extend', additionalMinutes: 900 });
    assert.equal(first.extensionId, 1);
    assert.equal(first.extensionMinutes, 900);
    visible = f.coordinator.state().clients[0];
    assert.equal(visible.seedHostExtensionMinutes, 900, 'shows a Web extension before the next client telemetry poll');
    const second = f.coordinator.extend({ runId: 'run-extend', additionalMinutes: 465 });
    assert.equal(second.extensionId, 2);
    assert.equal(second.extensionMinutes, 1365);
    assert.throws(() => f.coordinator.extend({ runId: 'run-extend', additionalMinutes: 1 }), /cannot exceed 1440/);
    f.coordinator.close();
    const restored = new TorrentDistributionCoordinator({ stateRoot: f.root }, { now: () => f.now() });
    assert.equal(restored.getControl('run-extend').extensionMinutes, 1365);
    assert.throws(() => restored.extend({ runId: 'run-extend', additionalMinutes: 1 }), /Only an active waiting client/);
    restored.close();
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('extensions reject stale, non-waiting, and released clients', () => {
  const f = fixture();
  try {
    f.coordinator.receiveTelemetry({ runId: 'run-downloading', phase: 'downloading' }, '10.0.0.9');
    assert.throws(() => f.coordinator.extend({ runId: 'run-downloading', additionalMinutes: 1 }), /active waiting/);
    f.coordinator.receiveTelemetry({ runId: 'run-released', phase: 'waiting', seedBaseMinutes: 15 }, '10.0.0.10');
    f.coordinator.release({ runId: 'run-released' });
    assert.throws(() => f.coordinator.extend({ runId: 'run-released', additionalMinutes: 1 }), /Released client/);
    f.coordinator.receiveTelemetry({ runId: 'run-stale', phase: 'waiting', seedBaseMinutes: 15 }, '10.0.0.11');
    f.advance(15_001);
    assert.throws(() => f.coordinator.extend({ runId: 'run-stale', additionalMinutes: 1 }), /active waiting/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
