import { $, elements } from './dom.js';
import { FLEET_STAGE_FLOW, STALE_DONE_STAGES, flowIndexForStage, ringPercent } from './fleetProgress.js';
import { localCompactDateTime, text } from './format.js';
import { state } from './state.js';
import { makeIcon, makeStatusPill } from './ui.js';

const isFailedStatus = (run) => run.status === 'failed';
const isStaleStatus = (run) => run.status === 'stale';

function pillTone(status) {
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'fail';
  if (status === 'stale') return 'neutral';
  return 'working';
}

// Resolve the runs shown by the current filter + search. The "archived" filter
// reads from a separate archived index; every other filter slices the active
// fleet. Exported so click handling can compute shift-range selections against
// exactly the order the user sees.
export function visibleFleetRuns(appState) {
  const filter = state.fleetFilter;
  const isArchived = filter === 'archived';
  const allRuns = isArchived ? (appState.archivedFleet?.runs ?? []) : (appState.fleet?.runs ?? []);
  const query = state.fleetSearch.trim().toLowerCase();
  const runs = allRuns.filter((run) => {
    if (!isArchived) {
      if (filter === 'active' && (run.status === 'completed' || isFailedStatus(run) || isStaleStatus(run))) return false;
      if (filter === 'done' && run.status !== 'completed') return false;
      if (filter === 'failed' && !isFailedStatus(run)) return false;
      if (filter === 'stale' && !isStaleStatus(run)) return false;
    }
    if (query) {
      const hay = `${run.clientId ?? ''} ${run.runId ?? ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
  return { runs, allRuns, isArchived };
}

// ---- Aurora: Fleet view card grid (reuses fleet data) ----
export function renderFleetCards(appState) {
  if (elements.fleetStatStrip) {
    const counts = appState.fleet?.counts ?? {};
    const stats = [
      [appState.fleet?.total ?? 0, 'Total', ''],
      [counts.running ?? 0, 'Deploying', ''],
      [counts.completed ?? 0, 'Ready', ''],
      [counts.failed ?? 0, 'Failed', 'fail'],
      [counts.stale ?? 0, 'Stale', ''],
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
  const { runs, allRuns, isArchived } = visibleFleetRuns(appState);

  // Keep the bulk selection scoped to what is currently visible.
  const visibleIds = new Set(runs.map((run) => run.runId));
  state.selectedRunIds = state.selectedRunIds.filter((id) => visibleIds.has(id));
  if (state.selectAnchorRunId && !visibleIds.has(state.selectAnchorRunId)) {
    state.selectAnchorRunId = null;
  }
  renderFleetBulkBar(runs, isArchived);

  elements.fleetCards.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement('div');
    empty.className = 'fc-stage';
    empty.textContent = isArchived
      ? (allRuns.length ? 'No archived runs match the current search.' : 'No archived deployment runs.')
      : (allRuns.length ? 'No clients match the current filter.' : 'No deployment clients have reported status yet.');
    elements.fleetCards.append(empty);
    renderFleetDetail(null, isArchived);
    return;
  }

  const focusKey = isArchived ? 'selectedArchivedRunId' : 'selectedRunId';
  let focusRun = runs.find((run) => run.runId === state[focusKey]);
  if (!focusRun) {
    focusRun = runs[0];
    state[focusKey] = focusRun.runId;
  }
  const selected = new Set(state.selectedRunIds);

  for (const run of runs) {
    const card = document.createElement('div');
    card.className = 'fleet-card';
    if (run.runId === focusRun.runId) {
      card.classList.add('selected');
    }
    const isChecked = selected.has(run.runId);
    if (isChecked) {
      card.classList.add('multi-selected');
    }
    card.dataset.fleetSelect = run.runId;

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'fc-check';
    check.dataset.fleetCheck = run.runId;
    check.setAttribute('aria-pressed', String(isChecked));
    check.setAttribute('aria-label', isChecked ? `Deselect ${run.runId}` : `Select ${run.runId}`);
    check.title = isChecked ? 'Deselect' : 'Select';
    if (isChecked) {
      check.append(makeIcon('check'));
    }
    card.append(check);

    const pill = makeStatusPill(text(run.status), pillTone(run.status));
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
  renderFleetDetail(focusRun, isArchived);
}

function makeBulkButton(labelText, icon, action, variant) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `bento-mini ${variant}`.trim();
  button.dataset.icon = icon;
  button.dataset.bulkAction = action;
  button.textContent = labelText;
  return button;
}

function renderFleetBulkBar(runs, isArchived) {
  const bar = elements.fleetBulkBar;
  if (!bar) {
    return;
  }
  const count = state.selectedRunIds.length;
  if (count === 0) {
    bar.hidden = true;
    bar.replaceChildren();
    return;
  }
  bar.hidden = false;
  bar.replaceChildren();

  const label = document.createElement('span');
  label.className = 'fleet-bulk-count';
  label.textContent = `${count} selected`;

  const actions = document.createElement('div');
  actions.className = 'fleet-bulk-actions';
  const allSelected = runs.length > 0 && runs.every((run) => state.selectedRunIds.includes(run.runId));
  if (!allSelected) {
    actions.append(makeBulkButton('Select all', 'select_all', 'bulk-select-all', 'ghost'));
  }
  if (isArchived) {
    actions.append(makeBulkButton('Restore', 'unarchive', 'bulk-restore', 'ghost'));
    actions.append(makeBulkButton('Delete permanently', 'delete_forever', 'bulk-archived-delete', 'danger'));
  } else {
    actions.append(makeBulkButton('Archive', 'inventory_2', 'bulk-archive', 'ghost'));
    actions.append(makeBulkButton('Delete', 'delete', 'bulk-delete', 'danger'));
  }
  actions.append(makeBulkButton('Clear', 'close', 'bulk-clear', 'ghost'));

  bar.append(label, actions);
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

export function renderFleetDetail(run, isArchived = false) {
  if (!elements.fleetDetail) {
    return;
  }
  elements.fleetDetail.replaceChildren();
  if (!run) {
    elements.fleetDetail.classList.add('empty');
    const empty = document.createElement('div');
    empty.className = 'fc-stage';
    empty.textContent = isArchived
      ? 'Select an archived run to see deployment detail.'
      : 'Select a client to see deployment detail.';
    elements.fleetDetail.append(empty);
    return;
  }
  elements.fleetDetail.classList.remove('empty');

  const head = document.createElement('div');
  head.className = 'fd-head';
  const title = document.createElement('div');
  title.className = 'fd-name';
  title.textContent = text(run.clientId);
  head.append(title, makeStatusPill(text(run.status), pillTone(run.status)));
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
  footer.append(evidence);

  if (isArchived) {
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'bento-mini ghost';
    restore.dataset.icon = 'unarchive';
    restore.dataset.action = 'status-run-restore';
    restore.dataset.runId = run.runId;
    restore.textContent = 'Restore';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'bento-mini ghost danger-text';
    del.dataset.icon = 'delete_forever';
    del.dataset.action = 'archived-run-delete';
    del.dataset.runId = run.runId;
    del.textContent = 'Delete permanently';
    footer.append(restore, del);
  } else {
    const archive = document.createElement('button');
    archive.type = 'button';
    archive.className = 'bento-mini ghost';
    archive.dataset.icon = 'inventory_2';
    archive.dataset.action = 'status-run-archive';
    archive.dataset.runId = run.runId;
    archive.textContent = 'Archive';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'bento-mini ghost danger-text';
    del.dataset.icon = 'delete';
    del.dataset.action = 'status-run-delete';
    del.dataset.runId = run.runId;
    del.textContent = 'Delete run';
    footer.append(archive, del);
  }
  elements.fleetDetail.append(footer);
}
