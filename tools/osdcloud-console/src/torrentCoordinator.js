import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const BATCH_WINDOW_MS = 24_000;
const ACTIVE_SOURCE_MS = 15_000;
const WAVE_IDLE_MS = 30_000;
const STALL_MS = 180_000;
const TELEMETRY_STALE_MS = 15_000;
const TELEMETRY_REMOVE_MS = 60_000;
const HOST_BUDGET_RATIO = 1.15;

function safeId(value, max = 120) {
  return String(value ?? '').replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, max);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function endpoint(value) {
  const text = String(value ?? '').trim();
  return text.length <= 96 && /^[0-9A-Fa-f:.\[\]-]+(?: \[(?:Seeder|Peer)\])?$/u.test(text)
    ? text
    : null;
}

function peerIdHex(peerId) {
  if (Buffer.isBuffer(peerId) || ArrayBuffer.isView(peerId)) {
    return Buffer.from(peerId).toString('hex');
  }
  return String(peerId ?? '').toLowerCase();
}

function assignmentKey(infoHash, peerId) {
  return `${String(infoHash).toLowerCase()}:${peerIdHex(peerId)}`;
}

export class TorrentDistributionCoordinator extends EventEmitter {
  constructor(config = {}, options = {}) {
    super();
    this.config = config;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.batchWindowMs = options.batchWindowMs ?? BATCH_WINDOW_MS;
    this.activeSourceMs = options.activeSourceMs ?? ACTIVE_SOURCE_MS;
    this.waveIdleMs = options.waveIdleMs ?? WAVE_IDLE_MS;
    this.stallMs = options.stallMs ?? STALL_MS;
    this.telemetryStaleMs = options.telemetryStaleMs ?? TELEMETRY_STALE_MS;
    this.telemetryRemoveMs = options.telemetryRemoveMs ?? TELEMETRY_REMOVE_MS;
    this.budgetRatio = options.budgetRatio ?? HOST_BUDGET_RATIO;
    this.infoHash = null;
    this.hostPeerId = null;
    this.totalPieces = 0;
    this.wimBytes = 0;
    this.wave = null;
    this.assignments = new Map();
    this.telemetry = new Map();
    this.releases = new Map();
    this.batchTimer = null;
    this.persistedServedBytes = 0;
    this._load();
  }

  get statePath() {
    const root = this.config.stateRoot;
    return root ? path.join(root, 'torrent', 'coordinator.json') : null;
  }

  updateConfig(config) {
    this.config = config;
  }

  configureTorrent({ infoHash, totalPieces, wimBytes }) {
    this.infoHash = String(infoHash).toLowerCase();
    this.totalPieces = Number(totalPieces);
    this.wimBytes = Number(wimBytes);
    if (this.wave && this.wave.infoHash !== this.infoHash) {
      this._endWave('torrent-changed');
    }
    if (this.wave) {
      this.wave.wimBytes = this.wimBytes;
      this.wave.budgetBytes = Math.ceil(this.wimBytes * this.budgetRatio);
    }
  }

  setHostPeerId(peerId) {
    this.hostPeerId = peerIdHex(peerId);
  }

  noteTrackerPeer(peerId, details = {}, now = this.now()) {
    const id = peerIdHex(peerId);
    if (!id || id === this.hostPeerId) return;
    this.noteNonHostHeartbeat(now);
    const item = this.infoHash ? this.assignments.get(assignmentKey(this.infoHash, id)) : null;
    if (item) {
      item.lastSeen = now;
      if (details.complete) item.complete = true;
    }
  }

  _load() {
    const filePath = this.statePath;
    if (!filePath || !fs.existsSync(filePath)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
      for (const [runId, release] of Object.entries(saved.releases ?? {})) {
        this.releases.set(runId, release);
      }
      if (saved.wave && finiteNumber(saved.wave.lastNonHostHeartbeat) + this.waveIdleMs > this.now()) {
        this.wave = saved.wave;
        this.persistedServedBytes = finiteNumber(this.wave.hostServedBytes);
        for (const item of saved.assignments ?? []) {
          this.assignments.set(item.key, {
            ...item,
            pieces: new Set(item.pieces ?? []),
            wire: null,
            connected: false,
          });
        }
      }
    } catch {
      this.wave = null;
      this.assignments.clear();
    }
  }

  _persist(force = false) {
    const filePath = this.statePath;
    if (!filePath) return;
    if (!force && this.wave && Math.abs(this.wave.hostServedBytes - this.persistedServedBytes) < 16 * 1024 * 1024) return;
    const releases = Object.fromEntries(this.releases);
    const assignments = [...this.assignments.values()].map(({ wire, pieces, ...item }) => ({
      ...item,
      pieces: [...pieces],
    }));
    const payload = { version: 1, wave: this.wave, assignments, releases };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
    this.persistedServedBytes = finiteNumber(this.wave?.hostServedBytes);
  }

  _startWave(now) {
    this.wave = {
      id: `${new Date(now).toISOString().replace(/[-:.TZ]/gu, '')}-${Math.random().toString(36).slice(2, 8)}`,
      infoHash: this.infoHash,
      startedAt: now,
      lastNonHostHeartbeat: now,
      lastProgressAt: now,
      maxCompletedLength: 0,
      nextBatch: 1,
      batches: [],
      wimBytes: this.wimBytes,
      budgetBytes: Math.ceil(this.wimBytes * this.budgetRatio),
      hostServedBytes: 0,
      emergency: null,
    };
    this.assignments.clear();
    this._persist(true);
  }

  _endWave(reason) {
    if (this.batchTimer) this.clearTimer(this.batchTimer);
    this.batchTimer = null;
    if (this.wave) this.emit('wave-ended', { waveId: this.wave.id, reason });
    this.wave = null;
    this.assignments.clear();
    this._persist(true);
  }

  _ensureWave(now) {
    if (this.wave && (this.wave.infoHash !== this.infoHash || now - this.wave.lastNonHostHeartbeat >= this.waveIdleMs)) {
      this._endWave('idle');
    }
    if (!this.wave) this._startWave(now);
    return this.wave;
  }

  noteNonHostHeartbeat(now = this.now()) {
    if (!this.infoHash) return;
    this._ensureWave(now).lastNonHostHeartbeat = now;
  }

  registerPeer({ infoHash, peerId, ip, port, wire }) {
    const now = this.now();
    if (String(infoHash).toLowerCase() !== this.infoHash) return null;
    const wave = this._ensureWave(now);
    wave.lastNonHostHeartbeat = now;
    const key = assignmentKey(infoHash, peerId);
    const existing = this.assignments.get(key);
    if (existing) {
      existing.ip = ip;
      existing.port = port;
      existing.wire = wire;
      existing.connected = true;
      existing.lastSeen = now;
      if (existing.complete) existing.mode = 'seeder';
      this._persist(true);
      return { ...existing, reconnect: true };
    }

    let batch = wave.batches.find((item) => !item.released);
    if (!batch) {
      const id = wave.nextBatch++;
      batch = { id, startedAt: now, deadline: now + this.batchWindowMs, released: false, keys: [] };
      wave.batches.push(batch);
      this.batchTimer = this.setTimer(() => this.releaseBatch(id), this.batchWindowMs);
      this.batchTimer?.unref?.();
    }
    const assignment = {
      key,
      peerId: peerIdHex(peerId),
      ip,
      port,
      batch: batch.id,
      slot: null,
      peerCount: null,
      mode: 'pending',
      released: false,
      complete: false,
      connected: true,
      firstSeen: now,
      lastSeen: now,
      pieces: new Set(),
      wire,
    };
    batch.keys.push(key);
    this.assignments.set(key, assignment);
    if (batch.id > 1 && this._hasPriorActivePeer(batch.id, now)) {
      assignment.slot = batch.keys.length - 1;
      assignment.peerCount = batch.keys.length;
      assignment.mode = 'peer-only';
      assignment.assignedMode = 'peer-only';
      assignment.released = true;
      for (const batchKey of batch.keys) {
        const batchPeer = this.assignments.get(batchKey);
        if (batchPeer) batchPeer.peerCount = batch.keys.length;
      }
    }
    this._persist(true);
    return { ...assignment, reconnect: false };
  }

  _hasPriorActivePeer(batchId, now) {
    return [...this.assignments.values()].some((item) =>
      item.batch < batchId && now - item.lastSeen <= this.activeSourceMs && (item.connected || item.complete));
  }

  releaseBatch(batchId) {
    if (!this.wave) return [];
    const now = this.now();
    const batch = this.wave.batches.find((item) => item.id === batchId);
    if (!batch || batch.released) return [];
    batch.released = true;
    batch.releasedAt = now;
    this.batchTimer = null;
    const peers = batch.keys.map((key) => this.assignments.get(key)).filter(Boolean);
    const priorActive = this._hasPriorActivePeer(batch.id, now);
    for (let slot = 0; slot < peers.length; slot += 1) {
      const item = peers[slot];
      item.slot = slot;
      item.peerCount = peers.length;
      item.mode = batch.id > 1 && priorActive
        ? 'peer-only'
        : (peers.length === 1 ? 'full-single' : 'striped');
      item.assignedMode = item.mode;
      item.released = true;
    }
    this._persist(true);
    this.emit('batch-released', { waveId: this.wave.id, batch: batch.id, peers });
    return peers;
  }

  disconnectPeer(key) {
    const item = this.assignments.get(key);
    if (!item) return;
    item.connected = false;
    item.wire = null;
    item.lastSeen = this.now();
    this._persist(true);
  }

  recordHave(key, piece) {
    const item = this.assignments.get(key);
    if (!item || piece < 0 || piece >= this.totalPieces) return;
    item.pieces.add(piece);
    item.lastSeen = this.now();
    if (item.pieces.size >= this.totalPieces) item.complete = true;
  }

  recordBitfield(key, bitfield) {
    const item = this.assignments.get(key);
    if (!item) return;
    for (let piece = 0; piece < this.totalPieces; piece += 1) {
      if (bitfield.get(piece)) item.pieces.add(piece);
    }
    item.lastSeen = this.now();
    if (item.pieces.size >= this.totalPieces) item.complete = true;
    this._persist(true);
  }

  assignmentForIp(ip) {
    return [...this.assignments.values()]
      .filter((item) => item.ip === ip)
      .sort((a, b) => b.lastSeen - a.lastSeen)[0] ?? null;
  }

  receiveTelemetry(payload, inferredIp) {
    const now = this.now();
    const runId = safeId(payload?.runId);
    if (!runId) throw new Error('runId is required');
    const phase = safeId(payload?.phase, 40) || 'unknown';
    const sources = (Array.isArray(payload?.sources) ? payload.sources : []).map(endpoint).filter(Boolean).slice(0, 16);
    const receivers = (Array.isArray(payload?.receivers) ? payload.receivers : []).map(endpoint).filter(Boolean).slice(0, 16);
    const completedLength = finiteNumber(payload?.completedLength);
    const totalLength = finiteNumber(payload?.totalLength);
    const item = {
      runId,
      clientId: safeId(payload?.clientId),
      ip: inferredIp,
      phase,
      completedLength,
      totalLength,
      downloadSpeed: finiteNumber(payload?.downloadSpeed),
      uploadSpeed: finiteNumber(payload?.uploadSpeed),
      uploadLength: finiteNumber(payload?.uploadLength),
      etaSeconds: finiteNumber(payload?.etaSeconds),
      sources,
      receivers,
      fallback: Boolean(payload?.fallback),
      updatedAt: now,
    };
    const previous = this.telemetry.get(runId);
    this.telemetry.set(runId, item);
    if (this.infoHash) {
      const wave = this._ensureWave(now);
      wave.lastNonHostHeartbeat = now;
      const aggregateCompleted = [...this.telemetry.values()]
        .filter((entry) => now - entry.updatedAt <= this.telemetryRemoveMs)
        .reduce((sum, entry) => sum + entry.completedLength, 0);
      if (aggregateCompleted > wave.maxCompletedLength) {
        wave.maxCompletedLength = aggregateCompleted;
        wave.lastProgressAt = now;
      }
      const assignment = this.assignmentForIp(inferredIp);
      if (assignment) {
        assignment.lastSeen = now;
        if (totalLength > 0 && completedLength >= totalLength) {
          assignment.complete = true;
          assignment.mode = phase === 'downloading' ? assignment.mode : 'seeder';
          for (let piece = 0; piece < this.totalPieces; piece += 1) assignment.pieces.add(piece);
        }
      }
      this.tick(now);
    }
    if (previous?.phase !== phase) this.emit('phase-transition', { runId, from: previous?.phase ?? null, to: phase });
    this._persist(false);
    return {
      telemetry: item,
      assignment: this.publicAssignment(this.assignmentForIp(inferredIp)),
      control: this.getControl(runId),
      emergency: Boolean(this.wave?.emergency),
    };
  }

  tick(now = this.now()) {
    if (!this.wave) return;
    if (now - this.wave.lastNonHostHeartbeat >= this.waveIdleMs) {
      this._endWave('idle');
      return;
    }
    const downloading = [...this.telemetry.values()].some((item) =>
      item.phase === 'downloading' && item.completedLength < item.totalLength && now - item.updatedAt <= this.telemetryStaleMs);
    if (!this.wave.emergency && downloading && now - this.wave.lastProgressAt >= this.stallMs) {
      this.wave.emergency = {
        startedAt: now,
        reason: 'completedLength-stalled-180s',
        budgetBytes: this.wave.budgetBytes,
        servedBytesAtStart: this.wave.hostServedBytes,
      };
      this._persist(true);
      this.emit('emergency', { waveId: this.wave.id, ...this.wave.emergency });
    }
  }

  allowHostBytes(bytes) {
    if (!this.wave) return true;
    return Boolean(this.wave.emergency) || this.wave.hostServedBytes + bytes <= this.wave.budgetBytes;
  }

  recordHostBytes(bytes) {
    if (!this.wave) return;
    this.wave.hostServedBytes += bytes;
    this._persist(false);
  }

  release({ runId, allWaiting } = {}) {
    const now = this.now();
    let targets = [];
    if (allWaiting === true) {
      targets = [...this.telemetry.values()]
        .filter((item) => item.phase === 'waiting' && now - item.updatedAt <= this.telemetryRemoveMs)
        .map((item) => item.runId);
    } else {
      const safeRunId = safeId(runId);
      if (!safeRunId) throw new Error('runId or allWaiting:true is required');
      targets = [safeRunId];
    }
    for (const target of targets) this.releases.set(target, { released: true, requestedAt: now });
    this._persist(true);
    return { released: targets, count: targets.length };
  }

  getControl(runId) {
    return this.releases.get(safeId(runId)) ?? { released: false, requestedAt: null };
  }

  publicAssignment(item) {
    if (!item) return null;
    const mode = this.wave?.emergency && !item.complete ? 'emergency-host-fallback' : item.mode;
    return { waveId: this.wave?.id ?? null, batch: item.batch, slot: item.slot, peerCount: item.peerCount, mode };
  }

  state() {
    const now = this.now();
    this.tick(now);
    const activeClients = [...this.telemetry.values()]
      .filter((item) => now - item.updatedAt <= this.telemetryRemoveMs)
      .map((item) => ({
        ...item,
        ...this.publicAssignment(this.assignmentForIp(item.ip)),
        stale: now - item.updatedAt > this.telemetryStaleMs,
        lastSeenSeconds: Math.floor((now - item.updatedAt) / 1000),
      }));
    const activeAssignments = [...this.assignments.values()].filter((item) => now - item.lastSeen <= this.activeSourceMs);
    const coverage = new Set();
    for (const item of activeAssignments) for (const piece of item.pieces) coverage.add(piece);
    const phases = { downloading: 0, seeding: 0, waiting: 0, stale: 0, fallback: 0 };
    for (const item of activeClients) {
      if (item.stale) phases.stale += 1;
      else if (item.phase === 'applying') phases.seeding += 1;
      else if (Object.hasOwn(phases, item.phase)) phases[item.phase] += 1;
      if (item.fallback) phases.fallback += 1;
    }
    const collecting = this.wave?.batches?.find((item) => !item.released) ?? null;
    const hostServedBytes = finiteNumber(this.wave?.hostServedBytes);
    const budgetBytes = finiteNumber(this.wave?.budgetBytes);
    return {
      waveId: this.wave?.id ?? null,
      batch: collecting?.id ?? this.wave?.batches?.at(-1)?.id ?? null,
      batchDeadline: collecting ? new Date(collecting.deadline).toISOString() : null,
      batchSecondsRemaining: collecting ? Math.max(0, Math.ceil((collecting.deadline - now) / 1000)) : 0,
      pendingClients: collecting?.keys?.length ?? 0,
      wimBytes: finiteNumber(this.wave?.wimBytes),
      hostServedBytes,
      budgetBytes,
      hostRatio: this.wave?.wimBytes ? hostServedBytes / this.wave.wimBytes : 0,
      emergency: this.wave?.emergency ? {
        ...this.wave.emergency,
        exceededBytes: Math.max(0, hostServedBytes - budgetBytes),
      } : null,
      coveragePieces: coverage.size,
      totalPieces: this.totalPieces,
      coveragePercent: this.totalPieces ? Math.round(coverage.size * 1000 / this.totalPieces) / 10 : 0,
      phases,
      clients: activeClients.sort((a, b) => a.ip.localeCompare(b.ip)),
    };
  }

  close() {
    if (this.batchTimer) this.clearTimer(this.batchTimer);
    this.batchTimer = null;
    this._persist(true);
  }
}

export const torrentDistributionDefaults = Object.freeze({
  batchWindowMs: BATCH_WINDOW_MS,
  activeSourceMs: ACTIVE_SOURCE_MS,
  waveIdleMs: WAVE_IDLE_MS,
  stallMs: STALL_MS,
  telemetryStaleMs: TELEMETRY_STALE_MS,
  telemetryRemoveMs: TELEMETRY_REMOVE_MS,
  budgetRatio: HOST_BUDGET_RATIO,
});
