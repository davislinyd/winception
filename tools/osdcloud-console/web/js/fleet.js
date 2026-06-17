import { $, elements } from './dom.js';
import { FLEET_STAGE_FLOW, STALE_DONE_STAGES, flowIndexForStage, ringPercent } from './fleetProgress.js';
import { localCompactDateTime, text } from './format.js';
import { state } from './state.js';
import { makeIcon, makeStatusPill } from './ui.js';

// ---- Aurora: Fleet view card grid (reuses fleet data) ----
export function renderFleetCards(appState) {
  if (elements.fleetStatStrip) {
    const counts = appState.fleet?.counts ?? {};
    const stats = [
      [appState.fleet?.total ?? 0, 'Total', ''],
      [counts.running ?? 0, 'Deploying', ''],
      [counts.completed ?? 0, 'Ready', ''],
      [(counts.failed ?? 0) + (counts.stale ?? 0), 'Failed', 'fail'],
    ];
    elements.fleetStatStrip.replaceChildren();
    for (const [num, lbl, cls] of stats) {
      const stat = document.createElement('div');
      stat.className = `fleet-stat ${cls}`.trim();
      const n = document.createElement('span');
      n.className = 'num';
      n.textContent = String(num);
      const l = document.createElement('span');
      l.className = 'lbl';
      l.textContent = lbl;
      stat.append(n, l);
      elements.fleetStatStrip.append(stat);
    }
  }
  if (elements.fleetFilter) {
    for (const button of elements.fleetFilter.querySelectorAll('[data-fleet-filter]')) {
      button.classList.toggle('active', button.dataset.fleetFilter === state.fleetFilter);
    }
  }
  if (!elements.fleetCards) {
    return;
  }
  const allRuns = appState.fleet?.runs ?? [];
  const query = state.fleetSearch.trim().toLowerCase();
  const isFailed = (run) => run.status === 'failed' || run.status === 'stale';
  const runs = allRuns.filter((run) => {
    if (state.fleetFilter === 'active' && (run.status === 'completed' || isFailed(run))) return false;
    if (state.fleetFilter === 'done' && run.status !== 'completed') return false;
    if (state.fleetFilter === 'failed' && !isFailed(run)) return false;
    if (query) {
      const hay = `${run.clientId ?? ''} ${run.runId ?? ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
  elements.fleetCards.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement('div');
    empty.className = 'fc-stage';
    empty.textContent = allRuns.length ? 'No clients match the current filter.' : 'No deployment clients have reported status yet.';
    elements.fleetCards.append(empty);
    renderFleetDetail(null);
    return;
  }
  if (!runs.some((run) => run.runId === state.selectedRunId)) {
    state.selectedRunId = runs[0].runId;
  }
  for (const run of runs) {
    const card = document.createElement('div');
    card.className = 'fleet-card';
    if (run.runId === state.selectedRunId) {
      card.classList.add('selected');
    }
    card.dataset.fleetSelect = run.runId;
    const pill = makeStatusPill(text(run.status), run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'fail' : run.status === 'stale' ? 'neutral' : 'working');
    const name = document.createElement('div');
    name.className = 'fc-name';
    name.textContent = text(run.clientId);
    const runId = document.createElement('div');
    runId.className = 'fc-run';
    runId.textContent = text(run.runId);
    const ring = makeFleetRing(run);
    const stageLabel = document.createElement('div');
    stageLabel.className = 'fc-stage-label';
    stageLabel.textContent = 'Current Stage';
    const stage = document.createElement('div');
    stage.className = 'fc-stage';
    stage.textContent = text(run.latestStage, 'pending');
    const started = document.createElement('div');
    started.className = 'fc-started';
    started.textContent = localCompactDateTime(run.startedAt);
    card.append(pill, name, ring, stageLabel, stage, runId, started);
    elements.fleetCards.append(card);
  }
  renderFleetDetail(runs.find((run) => run.runId === state.selectedRunId) ?? runs[0]);
}

// Resolve a reported stage to its position in FLEET_STAGE_FLOW so the ring
// percentage and the execution-flow checkmarks stay consistent (the ring is
// scaled within the matched step's slice). App installation and driver-cache
// substages run inside the SetupComplete phase, so they map to that step
// rather than dropping to -1 (which would blank the whole flow during install).
export function makeFleetRing(run) {
  const pct = ringPercent(run);
  const isDone = run.status === 'completed' ||
    (run.status === 'stale' && STALE_DONE_STAGES.has(run.latestStage));
  const isFailed = run.status === 'failed';
  const isIdle = !isDone && !isFailed && !pct;
  const ring = document.createElement('div');
  ring.className = 'ring';
  let label;
  if (isDone) {
    ring.classList.add('done');
    ring.style.setProperty('--val', '100');
    label = '✓';
  } else if (isIdle) {
    ring.classList.add('idle');
    label = '—';
  } else {
    ring.style.setProperty('--val', String(pct));
    label = `${pct}%`;
    // in-progress runs animate; failed runs stay static
    if (!isFailed) {
      ring.classList.add('active');
    }
  }
  if (isFailed) {
    ring.style.setProperty('--ring-color', 'var(--error)');
  } else if (!isDone) {
    ring.style.setProperty('--ring-color', pct < 50 ? 'var(--term-ok)' : 'var(--ok)');
  }
  // Layered ring: base fill, flowing sheen (active, clipped to the filled arc),
  // shimmer halo (done), and the centered label.
  const fill = document.createElement('div');
  fill.className = 'ring-fill';
  ring.append(fill);
  if (ring.classList.contains('active')) {
    const sheen = document.createElement('div');
    sheen.className = 'ring-sheen';
    sheen.append(document.createElement('div'));
    ring.append(sheen);
  }
  if (isDone) {
    const halo = document.createElement('div');
    halo.className = 'ring-halo';
    ring.append(halo);
  }
  const centerLabel = document.createElement('div');
  centerLabel.className = 'ring-label';
  centerLabel.textContent = label;
  ring.append(centerLabel);
  return ring;
}

export function renderFleetDetail(run) {
  if (!elements.fleetDetail) {
    return;
  }
  elements.fleetDetail.replaceChildren();
  if (!run) {
    elements.fleetDetail.classList.add('empty');
    const empty = document.createElement('div');
    empty.className = 'fc-stage';
    empty.textContent = 'Select a client to see deployment detail.';
    elements.fleetDetail.append(empty);
    return;
  }
  elements.fleetDetail.classList.remove('empty');

  const head = document.createElement('div');
  head.className = 'fd-head';
  const title = document.createElement('div');
  title.className = 'fd-name';
  title.textContent = text(run.clientId);
  head.append(title, makeStatusPill(text(run.status), run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'fail' : run.status === 'stale' ? 'neutral' : 'working'));
  elements.fleetDetail.append(head);

  const meta = document.createElement('div');
  meta.className = 'fd-meta';
  meta.textContent = `${text(run.runId)}${run.clientIp ? ' · ' + run.clientIp : ''}`;
  elements.fleetDetail.append(meta);

  const startedMeta = document.createElement('div');
  startedMeta.className = 'fd-meta';
  startedMeta.textContent = `Started ${localCompactDateTime(run.startedAt)}`;
  elements.fleetDetail.append(startedMeta);

  elements.fleetDetail.append(makeFleetRing(run));

  const flowTitle = document.createElement('div');
  flowTitle.className = 'fd-section-title';
  flowTitle.textContent = 'Execution Flow';
  elements.fleetDetail.append(flowTitle);

  const flow = document.createElement('div');
  flow.className = 'fd-flow';
  const reachedIndex = flowIndexForStage(run.latestStage);
  const isDone = run.status === 'completed' ||
    (run.status === 'stale' && STALE_DONE_STAGES.has(run.latestStage));
  FLEET_STAGE_FLOW.forEach(([key, label], idx) => {
    const isReached = isDone || (reachedIndex >= 0 && idx < reachedIndex);
    const isCurrent = !isDone && reachedIndex === idx;
    const cls = isReached ? 'done' : isCurrent ? 'current' : 'pending';
    const row = document.createElement('div');
    row.className = `fd-flow-step ${cls}`;
    const dot = document.createElement('span');
    dot.className = 'fd-flow-dot';
    if (isReached) {
      dot.append(makeIcon('check'));
    }
    const name = document.createElement('span');
    name.className = 'fd-flow-name';
    name.textContent = label;
    row.append(dot, name);
    flow.append(row);
  });
  elements.fleetDetail.append(flow);

  const footer = document.createElement('div');
  footer.className = 'fd-footer';
  const evidence = document.createElement('button');
  evidence.type = 'button';
  evidence.className = 'bento-mini ghost';
  evidence.dataset.icon = 'fact_check';
  evidence.dataset.action = 'run-evidence';
  evidence.dataset.runAction = 'evidence';
  evidence.dataset.runId = run.runId;
  evidence.textContent = 'View evidence';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'bento-mini ghost danger-text';
  del.dataset.icon = 'delete';
  del.dataset.action = 'status-run-delete';
  del.dataset.runId = run.runId;
  del.textContent = 'Delete run';
  footer.append(evidence, del);
  elements.fleetDetail.append(footer);
}
