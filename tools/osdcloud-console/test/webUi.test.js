import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve('tools', 'osdcloud-console', 'web');
const manualPath = path.resolve('docs', 'winception-operations-manual.html');

// The web UI source is split into per-page ES modules under web/js and per-region
// stylesheets under web/css. These helpers reconstruct the full source text so the
// content assertions below keep working regardless of which module a symbol lives in.
// They fall back to the legacy single-file layout when the split dirs are absent.
function collectFiles(dir, ext) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, ext));
    } else if (entry.name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

function readWebScript() {
  const files = collectFiles(path.join(webRoot, 'js'), '.js');
  if (files.length) {
    return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  }
  return fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
}

// Concatenate stylesheets in <link> (cascade) order so order-sensitive `A[\s\S]*B`
// assertions still see the same sequence the browser does.
function readWebStyles() {
  const cssDir = path.join(webRoot, 'css');
  if (fs.existsSync(cssDir)) {
    const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
    const hrefs = [...html.matchAll(/<link[^>]+href="\.\/(css\/[^"]+\.css)"/g)].map((m) => m[1]);
    if (hrefs.length) {
      return hrefs.map((h) => fs.readFileSync(path.join(webRoot, h), 'utf8')).join('\n');
    }
  }
  return fs.readFileSync(path.join(webRoot, 'styles.css'), 'utf8');
}

test('manual language switch preserves the current reading position', () => {
  const manual = fs.readFileSync(manualPath, 'utf8');

  assert.match(manual, /var scrollAnchor = \{ top: window\.scrollY, section: "", offset: 0 \}/);
  assert.match(manual, /scrollAnchor\.section = section\.id\.replace\(\/\^en-\//);
  assert.match(manual, /target\.getBoundingClientRect\(\)\.top - scrollAnchor\.offset/);
  assert.match(manual, /history\.replaceState\(null, "", "#" \+ targetId\)/);
  assert.doesNotMatch(manual, /window\.scrollTo\(\{ top: 0, behavior: "auto" \}\)/);
});

test('torrent card renders live wave telemetry and release controls', () => {
  const script = readWebScript();
  const styles = readWebStyles();
  assert.match(script, /Wave \/ batch/);
  assert.match(script, /Batch collection/);
  assert.match(script, /Swarm coverage/);
  assert.match(script, /Continue to reboot/);
  assert.match(script, /Continue all waiting/);
  assert.match(script, /\/api\/torrent\/release/);
  assert.match(script, /Emergency host fallback/);
  assert.match(styles, /\.torrent-client-table/);
  assert.match(styles, /\.torrent-emergency/);
});

// Slice from a marker to the next function declaration, tolerating `export`/`async`
// prefixes that appear once the source is split into modules.
function blockFromMarker(text, startMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) {
    return { start, end: -1, block: '' };
  }
  const after = start + startMarker.length;
  const rest = text.slice(after);
  const match = rest.match(/\n(?:export )?(?:async )?function /);
  const end = match ? after + match.index : text.length;
  return { start, end, block: text.slice(start, end) };
}

test('web UI exposes dashboard view topology', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const script = readWebScript();
  const styles = readWebStyles();

  assert.match(html, /id="tailwind-config"/);
  assert.match(html, /cdn\.tailwindcss\.com\?plugins=forms,container-queries/);
  assert.match(html, /bg-paper text-ink h-screen overflow-hidden flex font-body/);
  // 暖紙墨 shell: top bar (brand + nav + status) + full-width content + bottom console dock
  assert.match(html, /class="shell"/);
  assert.match(html, /class="topbar"/);
  assert.match(html, /class="topbar-nav"/);
  assert.match(html, /class="brand-mark"/);
  assert.match(html, /id="manual-link"[^>]*href="\/manual\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(html, /aria-label="Open deployment manual in a new tab"/);
  assert.match(html, /<span class="material-symbols-outlined" aria-hidden="true">menu_book<\/span>/);
  assert.match(html, /<span class="topbar-manual-label">Manual<\/span>/);
  assert.ok(html.indexOf('id="updated-at"') < html.indexOf('id="manual-link"'));
  assert.ok(html.indexOf('id="manual-link"') < html.indexOf('id="refresh-button"'));
  // Setup is integrated as a collapsible right rail on the Deploy view (no sidebar chip)
  assert.match(html, /id="deploy-grid"/);
  assert.match(html, /id="setup-rail"/);
  assert.doesNotMatch(html, /id="setup-progress-chip"/);
  assert.doesNotMatch(html, /class="shell-sidebar"/);
  assert.doesNotMatch(html, /id="sidebar"/);
  assert.doesNotMatch(html, /sidebar-step-row/);
  // Top-bar nav is Deploy + Activity only (Setup moved into the rail)
  assert.match(html, /id="tab-dashboard"[\s\S]*id="tab-fleet"/);
  assert.doesNotMatch(html, /id="tab-guided"/);
  assert.match(styles, /\.topbar-manual-link \{/);
  assert.match(styles, /@media \(max-width: 1024px\)[\s\S]*\.topbar-manual-label \{ display: none; \}/);
  // Deploy = dashboard: config summary + status tiles + inline services (no run list/log)
  assert.match(html, /class="deploy-summary"/);
  assert.match(html, /id="summary-action"/);
  assert.match(html, /id="dash-tiles"/);
  assert.doesNotMatch(html, /id="clients-body"/);
  // Global console dock hosts the system log; no collapsed rail or details block
  assert.match(html, /id="console-dock"/);
  assert.match(html, /id="console-dock-head"/);
  assert.match(html, /id="console-op-badge"/);
  assert.match(html, /id="console-dock-copy"/);
  assert.match(html, /<pre id="logs" class="console-dock-log/);
  assert.doesNotMatch(html, /id="log-rail"/);
  assert.doesNotMatch(html, /class="v3-more"/);
  // Hidden JS-only render targets stay in the DOM
  assert.match(html, /id="pipeline-steps"/);
  assert.match(html, /id="live-metrics"/);
  assert.match(html, /id="endpoint-summary"/);
  assert.match(html, /dashboard-diagnostics-grid grid grid-cols-1 xl:grid-cols-2 gap-sm/);
  assert.match(html, /id="view-dashboard"/);
  // Fleet view = filter + search + card grid + detail drawer + activity log
  assert.match(html, /id="view-fleet"/);
  assert.match(html, /id="fleet-filter"/);
  assert.match(html, /id="fleet-detail"/);
  // Activity filters expose stale as a first-class status, plus an archived view
  assert.match(html, /data-fleet-filter="stale"/);
  assert.match(html, /data-fleet-filter="archived"/);
  // bulk multi-select toolbar host
  assert.match(html, /id="fleet-bulkbar"/);
  assert.doesNotMatch(html, /id="view-endpoints"/);
  assert.doesNotMatch(html, /id="view-sync"/);
  assert.doesNotMatch(html, /id="view-validation"/);
  assert.doesNotMatch(html, /class="nav-button/);
  assert.doesNotMatch(html, /data-view=/);
  assert.match(html, /id="endpoint-settings-dialog"/);
  assert.match(html, /id="deployment-profiles-dialog"/);
  const endpointDialogHtml = html.slice(
    html.indexOf('id="endpoint-settings-dialog"'),
    html.indexOf('id="deployment-profiles-dialog"'),
  );
  const deploymentProfilesDialogHtml = html.slice(
    html.indexOf('id="deployment-profiles-dialog"'),
    html.indexOf('id="os-images-dialog"'),
  );
  assert.doesNotMatch(endpointDialogHtml, /Software Catalog/);
  assert.match(deploymentProfilesDialogHtml, /Profile Management[\s\S]*Software Catalog/);
  assert.match(html, /Software Catalog/);
  assert.match(html, /id="software-catalog-body"/);
  assert.match(html, /Software Catalog[\s\S]*>Actions</);
  assert.match(html, /data-action="software-add" data-icon="upload_file" class="warning"/);
  assert.match(html, /id="software-add-dialog"/);
  assert.match(html, /id="software-detail-dialog"/);
  assert.match(html, /id="software-detail-list"/);
  assert.match(html, /id="software-script-dialog"/);
  assert.match(html, /id="software-script-content"/);
  assert.match(html, /id="software-script-status"/);
  assert.match(html, /id="software-script-open"[^>]*>Open with\.\.\./);
  assert.match(html, /id="software-select-all" data-icon="playlist_add_check"/);
  assert.match(html, /id="software-select-none" data-icon="remove_done"/);
  assert.match(html, /id="software-list" class="software-order-editor"/);
  assert.match(html, /id="profile-display-language" name="displayLanguage"/);
  assert.match(html, /id="profile-locale" name="locale"/);
  assert.match(html, /id="profile-input-language" name="inputLanguage"/);
  assert.match(html, /id="profile-timezone" name="timeZone"/);
  assert.match(html, /id="software-profile-display-language" name="displayLanguage"/);
  assert.match(html, /id="software-profile-input-language" name="inputLanguage"/);
  assert.match(html, /Display language/);
  assert.match(html, /Regional format/);
  assert.match(html, /Input language/);
  assert.doesNotMatch(html, /id="software-add-id"/);
  assert.doesNotMatch(html, /Software ID <input/);
  assert.match(html, /id="software-add-file"[^>]*accept="\.msi,\.exe"/);
  assert.match(html, /id="software-add-script-mode"/);
  assert.match(html, /value="template"/);
  assert.match(html, /value="raw"/);
  assert.match(html, /Installed file to verify \(optional\)/);
  assert.match(html, /Leave blank to trust the installer success exit code only/);
  assert.match(script, /installer exit code only/);
  assert.match(script, /data-software-action/);
  assert.match(script, /Remove from profiles first/);
  assert.match(script, /\/api\/software\/delete/);
  assert.match(script, /showSoftwareDetails/);
  assert.match(script, /dataset\.softwareAction = 'script-view'/);
  assert.match(script, /\/api\/software\/script\?softwareId=/);
  assert.match(script, /\/api\/software\/script\/open/);
  assert.match(script, /Opening\.\.\./);
  assert.match(script, /Open request sent:/);
  assert.match(html, /id="software-add-raw-script"/);
  assert.match(html, /id="os-images-dialog"/);
  assert.match(html, /class="drawer-dialog os-images-dialog"/);
  assert.match(html, /class="dialog-card drawer-card drawer-card-wide os-images-card"/);
  assert.match(html, /id="validation-evidence-dialog"/);
  assert.match(html, /id="fleet-backdrop" class="fleet-backdrop" hidden/);
  assert.match(html, /OS Image Cache/);
  assert.match(html, /Local Import/);
  assert.match(html, /Microsoft Official Downloads/);
  assert.match(html, /Upload file/);
  assert.match(html, /id="os-filter-release"/);
  assert.match(html, /id="os-upload-file"/);
  assert.doesNotMatch(html, /Host path/);
  assert.doesNotMatch(html, /id="os-import-source"/);
  assert.match(html, /id="os-load-catalog-button"/);
  assert.match(html, /Windows 11 Pro Retail only/);
  assert.doesNotMatch(html, /name="os-catalog-family"/);
  assert.doesNotMatch(html, /value="win10"/);
  assert.doesNotMatch(html, /name="os-catalog-activation"/);
  assert.doesNotMatch(html, /name="os-catalog-source"/);
  assert.doesNotMatch(html, /id="os-filter-activation"/);
  assert.doesNotMatch(html, /id="os-filter-source"/);
  assert.match(html, /name="os-catalog-language"/);
  assert.match(html, /value="en-us"/);
  assert.match(html, /value="zh-cn"/);
  assert.match(html, /value="zh-tw"/);
  assert.match(html, /value="ja-jp"/);
  assert.match(html, /value="ko-kr"/);
  assert.match(html, /value="vi-vn"/);
  assert.match(html, /value="th-th"/);
  assert.match(html, /value="id-id"/);
  assert.match(html, /value="es-es"/);
  assert.match(html, /id="os-catalog-language-custom"/);
  assert.match(html, /name="os-catalog-release"/);
  assert.match(html, /Release <span class="subtle">required<\/span>/);
  assert.match(html, /value="25H1"/);
  assert.match(html, /value="25H2"/);
  assert.match(html, /value="26H1"/);
  assert.match(html, /value="26H2"/);
  assert.match(html, /id="os-catalog-release-custom"/);
  assert.match(html, /26H1\/26H2 may not be available in the Microsoft download catalog yet\./);
  assert.match(html, /Future release tags, e\.g\. 27H1/);
  assert.doesNotMatch(html, /value="27H2"/);
  assert.doesNotMatch(html, /Not available yet/);
  assert.doesNotMatch(html, /value="21H2"/);
  assert.doesNotMatch(html, /value="22H2"/);
  assert.doesNotMatch(html, /value="23H2"/);
  assert.doesNotMatch(html, /value="24H2"/);
  assert.match(html, /Refine loaded results/);
  assert.match(html, /Software Catalog[\s\S]*>Source</);
  assert.match(html, /aria-live="polite"/);
  assert.match(styles, /\.os-images-dialog/);
  assert.match(styles, /width: min\(1480px, calc\(100vw - 40px\)\)/);
  assert.match(styles, /#validation-evidence-dialog \{\s*width: min\(960px, calc\(100vw - 32px\)\);/);
  assert.match(styles, /\.drawer-card-wide \{\s*max-width: 100%;\s*width: 100%;/);
  assert.match(styles, /\.validation-evidence-grid > \* \{\s*max-width: 100%;\s*min-width: 0;/);
  assert.match(styles, /@media \(max-width: 900px\) \{[\s\S]*\.validation-evidence-grid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /\.stitch-details dt,[\s\S]*\.stitch-details dd \{[\s\S]*min-width: 0;[\s\S]*overflow-wrap: anywhere;/);
  assert.match(styles, /\.os-cache-table \{\s*min-width: 980px;/);
  assert.match(styles, /\.os-download-catalog-table \{\s*min-width: 1180px;/);
  assert.match(styles, /\.os-import-table \{\s*min-width: 960px;/);
  assert.match(styles, /\.local-import-grid/);
  assert.match(html, /Endpoint Sync Progress/);
  assert.match(html, /Runtime Readiness/);
  assert.match(html, /id="runtime-readiness-badge"/);
  assert.match(html, /Driver Cache/);
  assert.match(html, /id="driver-cache-details"/);
  assert.match(html, /data-action="prepare-runtime"/);
  assert.match(html, /Set up deployment/);
  assert.match(html, /class="guided-timeline"/);
  assert.match(html, /id="init-progress-fill"/);
  assert.match(html, /id="initialization-dialog"/);
  assert.doesNotMatch(html, /id="initialization-operation"/);
  assert.match(html, /id="initialization-steps"/);
  assert.doesNotMatch(html, /<h4>Deployment Secrets<\/h4>/);
  assert.doesNotMatch(html, /id="init-secrets-form"/);
  assert.doesNotMatch(html, /id="init-davis-password"/);
  assert.doesNotMatch(html, /id="init-pxeinstall-password"/);
  assert.match(script, /function renderRuntimeReadiness\(appState\)/);
  assert.match(script, /const requiresElevation = appState\?\.host\?\.elevated === false/);
  assert.match(script, /Restart the Web console from an elevated PowerShell session before preparing runtime artifacts\./);
  assert.match(script, /button\.disabled = state\.busy[\s\S]*selectedStep\.action === 'prepare-runtime' && requiresElevation/);
  assert.match(script, /function appendInitializationDetailItems\(body, stepId, detailItems = \[\]\)/);
  assert.match(script, /function appendGuidedStepOverview\(body, step\)/);
  assert.match(script, /'Objective', step\.objective/);
  assert.match(script, /'Done when', step\.doneWhen/);
  assert.match(script, /'Safety note', step\.safetyNote/);
  assert.match(script, /deploymentReady/);
  assert.match(script, /deploymentLive/);
  assert.match(script, /selectedStep\.action === 'all-services-toggle' && initialization\.deploymentReady !== true/);
  assert.match(script, /function initializationDetailStatusLabel\(statusClass\)/);
  assert.match(script, /statusClass === 'blocked'[\s\S]*return 'MISSING'/);
  assert.match(script, /statusClass === 'blocked-by-dependency'[\s\S]*return 'BLOCKED'/);
  assert.match(script, /statusClass/);
  assert.match(script, /item\.status/);
  assert.match(script, /status\.className = 'initialization-detail-status'/);
  assert.match(script, /row\.classList\.add\('has-status'\)/);
  assert.match(script, /function appendInitializationSecretsForm\(body\)/);
  assert.match(script, /function appendInitializationProjectRootForm\(body, step\)/);
  assert.match(script, /\/api\/project-root/);
  assert.match(script, /state\.initializationRootDraft/);
  assert.match(script, /initializationSecretsDraft: \{[\s\S]*windowsUsername: DEFAULT_WINDOWS_USERNAME[\s\S]*windowsPassword: ''/);
  assert.match(script, /function captureInitializationSecretsDraft\(\)/);
  assert.match(script, /function clearInitializationSecretsDraft\(\)/);
  assert.match(script, /function initializationDialogBody\(\)/);
  assert.match(script, /function captureInitializationDialogScrollPosition\(\)/);
  assert.match(script, /function restoreInitializationDialogScrollPosition\(position\)/);
  assert.match(script, /function focusedInitializationTextControl\(\)/);
  assert.match(script, /function restoreInitializationTextControlFocus\(focusedControl\)/);
  assert.match(script, /input\.value = state\.initializationSecretsDraft\[name\] \?\? ''/);
  assert.match(script, /input\.addEventListener\('input', \(\) => \{[\s\S]*state\.initializationSecretsDraft\[name\] = input\.value;/);
  assert.match(script, /const focusedTextControl = focusedInitializationTextControl\(\);/);
  assert.match(script, /activeId !== 'init-windows-username' && activeId !== 'init-windows-password' && activeId !== 'init-project-root'/);
  assert.match(script, /const dialogScrollPosition = captureInitializationDialogScrollPosition\(\);/);
  assert.match(script, /restoreInitializationDialogScrollPosition\(dialogScrollPosition\);/);
  assert.match(script, /restoreInitializationTextControlFocus\(focusedTextControl\);/);
  assert.match(script, /clearInitializationSecretsDraft\(\);[\s\S]*controls\.windowsPassword\.value = ''/);
  assert.match(script, /function renderConsoleDock\(appState\)/);
  assert.match(script, /function setConsoleDockCollapsed\(collapsed\)/);
  assert.match(script, /consoleDockCollapsed: true/);
  assert.match(script, /consoleDockOperationKey: ''/);
  assert.match(script, /function copyConsoleLog\(button\)/);
  assert.match(script, /navigator\.clipboard\?\.writeText/);
  assert.match(script, /fallbackCopyText\(text\)/);
  assert.match(script, /initializationDetailScrollPositions: \{\}/);
  assert.match(script, /function renderInitialization\(appState\)/);
  assert.match(script, /function captureInitializationDetailScrollPositions\(\)/);
  assert.match(script, /querySelectorAll\('\.initialization-detail-list\[data-initialization-step-id\]'\)/);
  assert.match(script, /function restoreInitializationDetailScrollPosition\(stepId, list\)/);
  assert.match(script, /body\.scrollTop = position\.atBottom \? body\.scrollHeight : Math\.min\(position\.scrollTop, maxScrollTop\)/);
  assert.match(script, /state\.initializationDetailScrollPositions = captureInitializationDetailScrollPositions\(\);[\s\S]*elements\.initializationSteps\.replaceChildren\(\);/);
  assert.match(script, /initializationPendingAction/);
  assert.match(script, /initializationOperationAction/);
  assert.match(script, /step\.id === 'secrets' && \(!step\.done \|\| state\.initializationSecretsEditing\)/);
  assert.match(script, /appendInitializationSecretsForm\(body\)/);
  assert.match(script, /function appendInitializationSecretsEditButton\(body\)/);
  assert.match(script, /dataset\.initAction = 'edit-secrets'/);
  assert.match(script, /resolvedAction === 'edit-secrets'/);
  assert.match(script, /resolvedAction === 'cancel-secrets'/);
  assert.match(script, /const detailList = appendInitializationDetailItems\(body, step\.id, step\.detailItems\);/);
  assert.match(script, /restoreInitializationDetailScrollPosition\(step\.id, detailList\);/);
  assert.match(script, /!hasInlineSecretsForm/);
  assert.match(script, /dataset\.initAction = 'save-secrets'/);
  assert.match(script, /initializationAutoOpened/);
  assert.match(script, /\/api\/secrets/);
  assert.match(script, /dataset\.initAction/);
  assert.match(script, /\/api\/runtime\/prepare/);
  assert.match(script, /function handleInitializationLongAction\(action\)/);
  assert.match(script, /await mutate\('\/api\/runtime\/prepare', null, \{ alertOnError: false \}\)/);
  assert.match(script, /closeDialog\(elements\.initializationDialog\);[\s\S]*const ok = await confirmPrepareRuntime\(runtime\);[\s\S]*if \(!ok\) \{[\s\S]*openDialog\(elements\.initializationDialog\);/);
  assert.match(script, /state\.initializationPendingAction = action;[\s\S]*state\.initializationOperationAction = action;[\s\S]*openDialog\(elements\.initializationDialog\);/);
  assert.match(script, /endpointSyncReturnToInitialization: false/);
  assert.match(script, /if \(operation\.label === 'Applying service endpoint'\) \{\s*return 'endpoint-sync';\s*\}/);
  assert.match(script, /step\.id === 'endpoint' && activeOperation\?\.action === 'endpoint-sync' && initializationBusy/);
  assert.match(script, /if \(resolvedAction === 'interfaces'\) \{\s*state\.endpointSyncReturnToInitialization = true;\s*\}/);
  assert.match(script, /const returnToInitialization = state\.endpointSyncReturnToInitialization/);
  assert.match(script, /state\.initializationPendingAction = 'endpoint-sync';[\s\S]*state\.initializationOperationAction = 'endpoint-sync';[\s\S]*openDialog\(elements\.initializationDialog\);/);
  assert.match(script, /await mutate\('\/api\/endpoint', choice, \{ alertOnError: !returnToInitialization \}\)/);
  assert.match(script, /elements\.endpointSettingsDialog\?\.addEventListener\('close', \(\) => \{[\s\S]*state\.endpointSyncReturnToInitialization = false;/);
  assert.match(script, /Prepare runtime/);
  assert.match(styles, /\.runtime-readiness-panel/);
  assert.match(styles, /\.console-dock \{/);
  assert.match(styles, /\.console-dock-head/);
  assert.match(styles, /\.console-dock-log/);
  assert.match(styles, /\.console-dock\.collapsed \.console-dock-log \{ display: none; \}/);
  assert.doesNotMatch(styles, /\.initialization-operation-panel/);
  assert.doesNotMatch(styles, /#log-rail/);
  assert.match(styles, /\.guided-step-overview/);
  assert.match(styles, /\.guided-step-overview-row/);
  assert.match(styles, /\.initialization-step-list/);
  assert.match(styles, /\.initialization-secrets-form/);
  assert.match(styles, /\.initialization-detail-list/);
  assert.match(styles, /\.initialization-detail-item/);
  assert.match(styles, /\.initialization-detail-item\.has-status/);
  assert.match(styles, /\.initialization-detail-item\.status-blocked/);
  assert.match(styles, /\.initialization-detail-item\.status-blocked-by-dependency/);
  assert.match(styles, /\.initialization-detail-status/);
  assert.match(styles, /\.initialization-detail-item\.status-blocked \.initialization-detail-status/);
  assert.match(styles, /\.initialization-detail-item\.status-blocked-by-dependency \.initialization-detail-status/);
  assert.doesNotMatch(styles, /grid-area: runtime;/);
  assert.match(html, /data-action="preflight"[\s\S]{0,90}>Run preflight</);
  assert.doesNotMatch(html, /data-action="preflight"[^>]*primary-action/);
  assert.match(html, /data-action="endpoint-sync" data-icon="sync_alt" class="warning"/);
  assert.match(html, /id="preflight-status-badge"[^>]*aria-live="polite"/);
  assert.match(html, /Validation Evidence/);
  assert.match(html, /Refresh Evidence/);
  assert.doesNotMatch(script, /switchView\(/);
  assert.match(script, /openDialog\(elements\.endpointSettingsDialog\)/);
  assert.match(script, /openDialog\(elements\.deploymentProfilesDialog\)/);
  assert.match(script, /openDialog\(elements\.osImagesDialog\)/);
  assert.match(script, /openDialog\(elements\.validationEvidenceDialog\)/);
  assert.match(script, /function isDialogOpen\(dialog\)/);
  assert.match(script, /dialog-fallback-open/);
  assert.match(styles, /dialog\.dialog-fallback-open/);
  assert.match(script, /function renderSoftwareCatalog\(appState\)/);
  assert.match(script, /function showAddSoftwareDialog\(\)/);
  assert.match(script, /function handleSoftwareAdd\(input\)/);
  assert.match(script, /function updateAddSoftwareSelectedInstallerDefaults\(\)/);
  assert.doesNotMatch(script, /softwareAddId/);
  assert.doesNotMatch(script, /safeSoftwareId/);
  assert.match(script, /\/api\/software-upload\?fileName=/);
  assert.match(script, /\/api\/software\/create/);
  assert.match(script, /It does not publish Apps or change the active profile/);
  assert.match(script, /Select it in a deployment profile before publishing/);
  assert.match(styles, /\.software-catalog-table/);
  assert.match(script, /function cancelDialog\(dialog\)/);
  assert.match(script, /new Event\('cancel', \{ cancelable: true \}\)/);
  assert.match(script, /closeDialog\(dialog, 'cancel'\)/);
  assert.match(script, /function enableBackdropClose\(dialog\)/);
  assert.match(script, /dialog\.addEventListener\('pointerdown'/);
  assert.match(script, /if \(event\.button !== 0\)/);
  assert.match(script, /if \(event\.target !== dialog\)/);
  assert.match(script, /suppressBackdropClickUntil = performance\.now\(\) \+ 500/);
  assert.match(script, /function suppressBackdropCloseClickThrough\(event\)/);
  assert.match(script, /event\.stopImmediatePropagation\(\)/);
  assert.match(script, /document\.addEventListener\('click', suppressBackdropCloseClickThrough, true\)/);
  assert.match(script, /enableBackdropCloseForDialogs\(\)/);
  assert.doesNotMatch(script, /handleOsImageSelect/);
  assert.match(script, /handleOsImageDelete/);
  assert.match(script, /\/api\/os-image-delete/);
  assert.doesNotMatch(script, /Republish active OS image/);
  assert.doesNotMatch(script, /Set active OS image/);
  assert.doesNotMatch(script, /osImageAction = 'select'/);
  assert.match(script, /dataset\.osImageAction = 'delete'/);
  assert.match(script, /Delete cached OS image/);
  assert.match(script, /populateOsImageSelect/);
  assert.match(script, /handleOsImageDownload/);
  assert.match(script, /osDownloadStarting/);
  assert.match(script, /\/api\/os-download/);
  assert.match(script, /Starting\.\.\./);
  assert.match(script, /osDownloadStatusText/);
  assert.match(script, /Downloading source image \$\{osDownloadBytes\(status\)\}/);
  assert.match(script, /return status\.message/);
  assert.match(script, /Exporting WIM\.\.\./);
  assert.match(script, /Connection to Web console lost; status may be stale\./);
  assert.doesNotMatch(script, /mutate\('\/api\/os-download'/);
  assert.match(script, /handleOsImageUploadInspect/);
  assert.match(script, /handleOsImageImport/);
  assert.doesNotMatch(script, /handleOsImageInspect/);
  assert.doesNotMatch(script, /\/api\/os-image-inspect/);
  assert.doesNotMatch(script, /\/api\/os-image-import/);
  assert.match(script, /osDownloadCatalogLoading/);
  assert.match(script, /osDownloadCatalogError/);
  assert.match(script, /selectedOsCatalogFilters/);
  assert.match(script, /edition: \['Pro'\]/);
  assert.match(script, /activation: \['Retail'\]/);
  assert.match(script, /missing\.push\('release'\)/);
  assert.match(script, /Select at least one release before loading the catalog/);
  assert.match(script, /catalogFilterQuery/);
  assert.match(script, /osFamily/);
  assert.doesNotMatch(script, /checkedValues\('os-catalog-family'\)/);
  assert.doesNotMatch(script, /checkedValues\('os-catalog-activation'\)/);
  assert.doesNotMatch(script, /checkedValues\('os-catalog-source'\)/);
  assert.match(script, /Loading Microsoft official Windows image catalog/);
  assert.match(script, /\/api\/os-image-upload/);
  assert.match(script, /\/api\/os-image-upload-import/);
  assert.match(script, /Loading catalog\.\.\./);
  assert.match(script, /Catalog load failed/);
  assert.match(script, /No catalog rows matched the selected filters/);
  assert.match(script, /function twoDigit\(value\)/);
  assert.match(script, /function localCompactDateTime\(value\)/);
  assert.match(script, /const TZ = 'Asia\/Taipei'/);
  assert.match(script, /\$\{p\.year\}\/\$\{p\.month\}\/\$\{p\.day\} \$\{p\.hour\}:\$\{p\.minute\}/);
  assert.match(script, /timeZoneName\.replace\('GMT', 'UTC'\)/);
  assert.match(script, /function appendFleetLastSeenCell\(row, value\)/);
  assert.match(script, /cell\.className = 'fleet-last-seen-cell'/);
  assert.match(script, /cell\.textContent = localCompactDateTime\(value\)/);
  assert.match(script, /appendFleetLastSeenCell\(tr, run\.lastReceivedAt\)/);
  assert.match(styles, /\.fleet-last-seen-cell \{[\s\S]*min-width: 0;[\s\S]*white-space: nowrap;/);
  assert.match(script, /cache\.className = 'profile-software active-os-cache-line'/);
  assert.match(script, /file\.className = 'service-address active-os-cache-file'/);
  assert.match(styles, /#active-os-details,[\s\S]*#active-os-details > \* \{[\s\S]*max-width: 100%;[\s\S]*min-width: 0;/);
  assert.match(styles, /\.status-os-panel \{[\s\S]*min-width: 0;[\s\S]*overflow: hidden;/);
  assert.match(styles, /\.active-os-cache-line \{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*min-width: 0;/);
  assert.match(styles, /\.active-os-cache-file \{[\s\S]*display: block;[\s\S]*min-width: 0;[\s\S]*overflow-wrap: anywhere;[\s\S]*white-space: normal;[\s\S]*width: 100%;[\s\S]*word-break: break-word;/);
  assert.match(script, /dataset\.runAction = 'evidence'/);
  assert.match(script, /showValidationEvidence/);
  assert.match(script, /selectedRunEvents/);
  assert.match(script, /Not reported/);
  assert.match(script, /\['DisplayLanguage', evidenceValue/);
  assert.match(script, /\['InputLanguages', evidenceValue/);
  assert.match(script, /imageFileDestination', 'imagePath/);
  assert.doesNotMatch(script, /return 'Unknown'/);
  assert.match(script, /status-run-delete/);
  assert.match(script, /Delete client run/);
  assert.match(script, /\/api\/status\/run\/delete/);
  assert.match(script, /dataset\.icon = 'delete'/);
  assert.match(script, /If the client is still reporting, this run may appear again/);
  // Activity multi-select: range/toggle selection + bulk delete/archive/restore endpoints
  assert.match(script, /export function visibleFleetRuns/);
  assert.match(script, /export function selectFleetCard/);
  assert.match(script, /event\?\.shiftKey && state\.selectAnchorRunId/);
  assert.match(script, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(script, /data-fleet-check|dataset\.fleetCheck/);
  assert.match(script, /data-bulk-action|dataset\.bulkAction/);
  assert.match(script, /\/api\/status\/runs\/delete/);
  assert.match(script, /\/api\/status\/runs\/archive/);
  assert.match(script, /\/api\/status\/runs\/restore/);
  assert.match(script, /\/api\/status\/archive\/delete/);
  assert.match(script, /status-run-archive/);
  assert.match(script, /archived-run-delete/);
  // CSS for the bulk toolbar + per-card checkbox affordance
  assert.match(styles, /\.fleet-bulkbar \{/);
  assert.match(styles, /\.fc-check \{/);
  assert.match(script, /elements\.confirmSubmit\.classList\.toggle\('warning', resolvedSeverity === 'warning'\)/);
  assert.match(script, /severity: 'warning'/);
  assert.match(script, /const softwareKey = \(id\) => `software:\$\{id\}`/);
  assert.match(script, /Selected install sequence/);
  assert.match(script, /Available software/);
  assert.match(script, /Available custom scripts/);
  assert.match(script, /installSequence,/);
  assert.match(script, /softwareIds: selectedSoftwareIds\(\)/);
  assert.match(script, /dataset\.softwareOrderAction = action/);
  assert.match(script, /dataset\.softwareOrderAction = 'add'/);
  assert.match(script, /draggedSoftwareId/);
  assert.match(script, /handleDrop/);
  assert.match(script, /fleetBackdrop: \$\('#fleet-backdrop'\)/);
  assert.match(script, /function setFleetExpanded\(expanded\)/);
  assert.match(script, /elements\.fleetBackdrop\.hidden = !state\.fleetExpanded/);
  assert.match(script, /target === elements\.fleetBackdrop/);
  assert.match(script, /event\.key === 'Escape' && state\.fleetExpanded && !document\.querySelector\('dialog\[open\]'\)/);
  assert.doesNotMatch(script, /client-fleet-home/);
  assert.doesNotMatch(script, /insertBefore\(elements\.clientFleetPanel/);
  assert.match(styles, /\.fleet-backdrop \{[\s\S]*position: fixed;[\s\S]*z-index: 40;/);
  assert.match(styles, /body\.fleet-expanded \{[\s\S]*overflow: hidden;/);
  assert.match(styles, /body\.fleet-expanded \.client-fleet-panel \{[\s\S]*position: fixed;[\s\S]*z-index: 45;/);
  assert.match(styles, /\.software-order-editor \{[\s\S]*display: grid;/);
  assert.match(styles, /\.software-order-row \{[\s\S]*grid-template-columns: auto auto minmax\(0, 1fr\) auto auto;/);
  assert.match(styles, /\.software-drag-handle \{[\s\S]*font-family: "Material Symbols Outlined";/);
  assert.match(styles, /button\.software-icon-button \{[\s\S]*min-width: 28px;/);
  assert.doesNotMatch(styles, /body\.fleet-expanded \.dashboard-status-column/);
  assert.doesNotMatch(styles, /body\.fleet-expanded \.dashboard-log-column/);
  assert.match(html, /Material\+Symbols\+Outlined/);
  assert.match(html, /Inter:wght@400;500;600;700/);
  assert.match(html, /Source\+Serif\+4/);
  assert.match(html, />Services</);
  assert.doesNotMatch(html, /Quick Actions/);
  assert.doesNotMatch(html, /quick-actions-panel/);
  assert.doesNotMatch(html, /```html/);
});

test('preflight failed rows expose hover fix hints', () => {
  const script = readWebScript();

  assert.match(script, /function preflightResolutionHint\(check\)/);
  assert.match(script, /selected manifest stale/);
  assert.match(script, /Open Deployment profiles/);
  assert.match(script, /active profile/);
  assert.match(script, /run preflight again/);
  assert.match(script, /nameLower === 'smb image'/);
  assert.match(script, /nameLower\.startsWith\('service ip'\)/);
  assert.match(script, /nameLower === 'dhcp subnet'/);
  assert.match(script, /nameLower\.startsWith\('http file'\)/);
  assert.match(script, /\^\(udp 67\|udp 69\|tcp 80\)\$/);
  assert.match(script, /nameLower === 'deployment profile'/);
  assert.match(script, /nameLower === 'administrator'/);
  assert.match(script, /Review the detail and System Log/);
  assert.match(script, /How to fix:/);
  assert.match(script, /detail\.title = tooltip/);
  assert.match(script, /row\.title = tooltip/);

  const { start: summaryStart, end: summaryEnd, block: passedSummaryBlock } =
    blockFromMarker(script, 'if (passedCount > 0 || !issues.length) {');
  assert.notEqual(summaryStart, -1);
  assert.notEqual(summaryEnd, -1);
  assert.doesNotMatch(passedSummaryBlock, /How to fix:/);
  assert.doesNotMatch(passedSummaryBlock, /preflightTooltip/);
});

test('system log follows only when already scrolled to bottom', () => {
  const script = readWebScript();

  assert.match(script, /logsText: null/);
  assert.match(script, /function isScrolledToBottom\(element, tolerance = 2\)/);
  assert.match(script, /element\.scrollHeight - element\.scrollTop - element\.clientHeight <= tolerance/);
  assert.match(script, /const nextText = \(appState\.logs \?\? \[\]\)\.length \? appState\.logs\.join\('\\n'\) : 'No operation logs observed yet\.'/);
  assert.match(script, /if \(state\.logsText === nextText\) \{\s*return;\s*\}/);
  assert.match(script, /const previousScrollTop = logElement\.scrollTop/);
  assert.match(script, /const wasAtBottom = isScrolledToBottom\(logElement\)/);
  assert.match(script, /logElement\.textContent = nextText/);
  assert.match(script, /state\.logsText = nextText/);
  assert.match(script, /logElement\.scrollTop = wasAtBottom \? logElement\.scrollHeight : previousScrollTop/);

  const { start: renderLogsStart, end: renderLogsEnd, block: renderLogsBlock } =
    blockFromMarker(script, 'function renderLogs(appState) {');
  assert.notEqual(renderLogsStart, -1);
  assert.notEqual(renderLogsEnd, -1);
  assert.ok(renderLogsBlock.indexOf('const wasAtBottom = isScrolledToBottom(logElement)') < renderLogsBlock.indexOf('logElement.textContent = nextText'));
});

test('web UI uses confirmation dialog instead of window confirm', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const script = readWebScript();

  assert.match(html, /id="confirm-dialog"/);
  assert.doesNotMatch(script, /window\.confirm/);
});

test('select interface drawer opens before live interface refresh settles', () => {
  const script = readWebScript();
  const styles = readWebStyles();

  const interfacesActionStart = script.indexOf("} else if (action === 'interfaces') {");
  const reloadActionStart = script.indexOf("} else if (action === 'reload-endpoints') {", interfacesActionStart);
  assert.notEqual(interfacesActionStart, -1);
  assert.notEqual(reloadActionStart, -1);
  const interfacesAction = script.slice(interfacesActionStart, reloadActionStart);
  assert.ok(
    interfacesAction.indexOf('openDialog(elements.endpointSettingsDialog)') < interfacesAction.indexOf('void loadInterfaces()'),
  );

  assert.match(script, /interfacesLoading: false/);
  assert.match(script, /interfacesError: null/);
  assert.match(script, /let interfacesLoadPromise = null/);
  assert.match(script, /if \(interfacesLoadPromise\) \{\s*return interfacesLoadPromise;\s*\}/);
  assert.match(script, /state\.interfacesLoading = true/);
  assert.match(script, /state\.interfacesError = null/);
  assert.match(script, /state\.interfacesError = error\.message/);
  assert.match(script, /state\.interfacesLoading = false/);
  assert.match(script, /interfacesLoadPromise = null/);
  assert.match(script, /Loading endpoints\.\.\./);
  assert.match(script, /Refreshing endpoints\.\.\./);
  assert.match(script, /Endpoint load failed: \$\{state\.interfacesError\}\. Use Refresh endpoints to retry\./);
  assert.match(script, /Endpoint refresh failed: \$\{state\.interfacesError\}\. Showing last loaded interface data\./);
  assert.match(script, /select\.disabled = state\.interfacesLoading/);
  assert.match(script, /sync\.disabled = state\.interfacesLoading/);
  assert.match(styles, /tbody tr\.status-row td \{/);
  assert.match(styles, /tbody tr\.status-row\.failed td \{/);
});

test('web UI uses a single stateful all-services toggle', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const script = readWebScript();

  assert.match(html, /data-action="all-services-toggle"/);
  assert.doesNotMatch(html, /data-action="start-all"/);
  assert.doesNotMatch(html, /data-action="stop-all"/);
  assert.match(script, /action === 'all-services-toggle'/);
  assert.match(script, /Stop all services/);
  assert.match(script, /Start all services/);
});

test('web UI makes service cards stateful toggles', () => {
  const script = readWebScript();
  const styles = readWebStyles();

  assert.match(script, /row\.dataset\.action = action/);
  assert.match(script, /row\.setAttribute\('role', 'button'\)/);
  assert.match(script, /row\.setAttribute\('aria-label', actionLabel\)/);
  assert.match(script, /row\.setAttribute\('tabindex', '0'\)/);
  assert.match(script, /'http-toggle'/);
  assert.match(script, /'tftp-toggle'/);
  assert.match(script, /'dhcp-toggle'/);
  assert.match(script, /button\[data-action="\$\{action\}"\]/);
  assert.match(script, /makeStatusPill\(service\.running \? 'Running' : 'Stopped', service\.running \? 'ok' : 'neutral'\)/);
  assert.match(script, /cardAction\.className = `service-card-cta\$\{action === 'dhcp-toggle' && !service\.running \? ' danger' : ''\}`/);
  assert.match(script, /cardAction\.dataset\.icon = service\.running \? 'stop' : 'play_arrow'/);
  assert.match(script, /service-card-action\[data-action\]/);
  assert.match(styles, /\.service-card-cta/);
  assert.match(styles, /\.service-card-cta\.danger/);
  assert.match(styles, /\.service-card\[data-service-state="stopped"\] \.service-switch/);
  assert.match(styles, /\.service-switch\.running \{\s*background: var\(--ok\);/);
  assert.match(styles, /\.status-services-grid \{\s*grid-template-columns: minmax\(0, 1fr\) !important;/);
  assert.match(styles, /\.service-card-action:hover/);
  assert.match(styles, /\.service-card-action:focus-visible/);
});

test('operations buttons use neutral, warning, and danger severity without blue default', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const script = readWebScript();
  const styles = readWebStyles();

  assert.doesNotMatch(html, /quiet-action/);
  assert.doesNotMatch(html, /primary-action/);
  assert.doesNotMatch(styles, /button\.quiet-action/);
  assert.doesNotMatch(styles, /button\.primary-action/);
  assert.match(styles, /button \{\s*appearance: none;[\s\S]*font: 500 12px\/16px Inter, sans-serif;/);
  assert.match(styles, /button\.warning/);
  assert.match(styles, /button\.all-services-toggle\.is-running \{\s*border-color: var\(--outline\);[\s\S]*color: var\(--on-surface\);/);
  assert.match(script, /button\.className = 'warning'/);
  assert.match(script, /select\.className = 'warning'/);
  assert.match(script, /sync\.className = 'warning'/);
  assert.match(script, /return \['Blocked', 'fail'\]/);
});

test('web UI keeps local component layer', () => {
  const styles = readWebStyles();
  const script = readWebScript();

  assert.match(styles, /--clay:\s+#9C4221/);
  assert.match(styles, /--term-bg:\s+#2A2520/);
  assert.match(styles, /--hairline:/);
  assert.match(styles, /\.view\.active/);
  assert.match(styles, /\.service-switch/);
  assert.match(styles, /\.preflight-summary-list/);
  assert.match(styles, /-webkit-line-clamp: 2/);
  assert.match(styles, /\.dashboard-diagnostics-grid \{\s*display: grid;[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  // 暖紙墨 shell pins: top bar + full-width content + collapsible setup rail
  assert.match(styles, /\.shell \{\s*display: grid;[\s\S]*grid-template-rows: var\(--topbar-h\) minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.topbar \{/);
  assert.match(styles, /\.shell-main > \* \{[\s\S]*max-width: none;/);
  assert.match(styles, /--topbar-h:\s+56px/);
  assert.match(styles, /\.deploy-grid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 40%;/);
  assert.match(styles, /\.deploy-grid\.setup-collapsed \{/);
  assert.doesNotMatch(styles, /grid-template-areas:\s*"operations endpoint log"/);
  assert.doesNotMatch(styles, /\.preflight-summary-panel \{[\s\S]*max-height: 220px;/);
  assert.doesNotMatch(styles, /#view-dashboard\.active \.operations-panel \{\s*min-height:/);
  assert.match(script, /makeIcon/);
  assert.match(script, /service-card/);
  assert.match(script, /card-icon/);
  assert.match(script, /service-row-head/);
  assert.match(script, /checks passed/);
});
