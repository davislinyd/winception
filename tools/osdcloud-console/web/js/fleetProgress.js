// Pure (DOM-free) deployment-progress logic shared by the fleet UI.
// Kept separate from fleet.js so it can be unit-tested in Node without a DOM.

// Stale runs that stopped at these stages have effectively completed Windows
// setup — SetupComplete finished and the desktop-ready reporter was installed.
// Treat them as done in the UI (✓ ring, all flow steps green) rather than
// showing a raw sub-100% percentage.
export const STALE_DONE_STAGES = new Set([
  'windows-setupcomplete-finished',
  'windows-logon-start',
]);

export const FLEET_STAGE_FLOW = [
  ['winpe-start', 'winpe-start'],
  ['smb-mounted', 'smb-mounted'],
  ['osdcloud-start', 'osdcloud-start'],
  ['apply-image', 'apply-image'],
  ['rebooting', 'reboot'],
  ['windows-setupcomplete', 'windows-setupcomplete'],
  ['windows-desktop-ready', 'desktop-ready'],
];

// Intermediate client stages that are not themselves flow steps but occur
// within a known phase. Mapping them to that phase's flow step keeps the ring
// monotonic (no backwards jumps) and the execution-flow checkmarks consistent,
// instead of dropping to -1 (which would blank the flow and reset the ring).
const STAGE_ALIASES = new Map([
  // Image selection, P2P/HTTP download, SHA-256 verify, and disk prep all run
  // within the OSDCloud download/apply preamble — hold at the osdcloud-start step.
  ['os-image-selected', 'osdcloud-start'],
  ['torrent-download', 'osdcloud-start'],
  ['torrent-peers', 'osdcloud-start'],
  ['torrent-firewall', 'osdcloud-start'],
  ['torrent-fallback', 'osdcloud-start'],
  ['torrent-verify', 'osdcloud-start'],
  ['disk', 'osdcloud-start'],
  ['partition-target', 'osdcloud-start'],
  // Post-apply WinPE finalization (driver injection, scripts, metadata, finish)
  // runs after the image is on disk, in the lead-up to the reboot into Windows.
  ['drivers', 'rebooting'],
  ['post-apply-scripts', 'rebooting'],
  ['windows-metadata-written', 'rebooting'],
  ['osdcloud-finished', 'rebooting'],
  // Driver-pack cache request runs inside the SetupComplete phase.
  ['windows-driverpack-cache-request', 'windows-setupcomplete'],
]);

// Resolve a reported stage to its position in FLEET_STAGE_FLOW so the ring
// percentage and the execution-flow checkmarks stay consistent (the ring is
// scaled within the matched step's slice). App-install substages and the
// aliases above map into their owning phase rather than dropping to -1.
export function flowIndexForStage(stage) {
  if (!stage) return -1;
  let key = stage;
  if (key.startsWith('windows-apps')) {
    key = 'windows-setupcomplete';
  } else if (STAGE_ALIASES.has(key)) {
    key = STAGE_ALIASES.get(key);
  }
  return FLEET_STAGE_FLOW.findIndex(([flowKey]) =>
    key === flowKey || key.startsWith(flowKey + '-'));
}

export function estPct(stage) {
  const ri = flowIndexForStage(stage);
  if (ri >= 0) {
    return Math.round((ri / FLEET_STAGE_FLOW.length) * 100);
  }
  return stage ? 5 : 0;
}

// Numeric 0–100 used for the ring fill.
export function ringPercent(run) {
  const ri = flowIndexForStage(run.latestStage);
  if (run.latestPercent != null && ri >= 0) {
    // Scale the client-reported percent into this step's slice of the overall
    // flow so the ring advances in step with the execution-flow checkmarks.
    const raw = Math.max(0, Math.min(100, run.latestPercent));
    const lo = Math.round((ri / FLEET_STAGE_FLOW.length) * 100);
    const hi = Math.round(((ri + 1) / FLEET_STAGE_FLOW.length) * 100);
    return Math.round(lo + raw * (hi - lo) / 100);
  }
  if (run.latestPercent != null) {
    return Math.max(0, Math.min(100, Math.round(run.latestPercent)));
  }
  return estPct(run.latestStage);
}
