import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve('tools', 'osdcloud-tui', 'web');

test('web UI exposes dashboard view topology', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

  assert.match(html, /id="tailwind-config"/);
  assert.match(html, /cdn\.tailwindcss\.com\?plugins=forms,container-queries/);
  assert.match(html, /bg-surface text-on-surface min-h-screen flex flex-col font-body-sm/);
  assert.match(html, /dashboard-grid grid grid-cols-12 gap-sm/);
  assert.match(html, /dashboard-operations-column/);
  assert.match(html, /dashboard-status-column/);
  assert.match(html, /dashboard-log-column/);
  assert.match(html, /id="view-dashboard"/);
  assert.doesNotMatch(html, /id="view-endpoints"/);
  assert.doesNotMatch(html, /id="view-sync"/);
  assert.doesNotMatch(html, /id="view-validation"/);
  assert.doesNotMatch(html, /class="nav-button/);
  assert.doesNotMatch(html, /data-view=/);
  assert.match(html, /id="endpoint-settings-dialog"/);
  assert.match(html, /id="deployment-profiles-dialog"/);
  assert.match(html, /id="validation-evidence-dialog"/);
  assert.match(html, /Endpoint Sync Progress/);
  assert.match(html, /Validation Evidence/);
  assert.match(html, /Refresh Evidence/);
  assert.doesNotMatch(script, /switchView\(/);
  assert.match(script, /openDialog\(elements\.endpointSettingsDialog\)/);
  assert.match(script, /openDialog\(elements\.deploymentProfilesDialog\)/);
  assert.match(script, /openDialog\(elements\.validationEvidenceDialog\)/);
  assert.match(script, /dataset\.runAction = 'evidence'/);
  assert.match(script, /showValidationEvidence/);
  assert.match(html, /Material\+Symbols\+Outlined/);
  assert.match(html, /Inter:wght@400;500;600/);
  assert.match(html, />Operations</);
  assert.match(html, />System Log</);
  assert.doesNotMatch(html, /Quick Actions/);
  assert.doesNotMatch(html, /quick-actions-panel/);
  assert.doesNotMatch(html, /```html/);
});

test('web UI uses confirmation dialog instead of window confirm', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

  assert.match(html, /id="confirm-dialog"/);
  assert.doesNotMatch(script, /window\.confirm/);
});

test('web UI uses a single stateful all-services toggle', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

  assert.match(html, /data-action="all-services-toggle"/);
  assert.doesNotMatch(html, /data-action="start-all"/);
  assert.doesNotMatch(html, /data-action="stop-all"/);
  assert.match(script, /action === 'all-services-toggle'/);
  assert.match(script, /Stop all services/);
  assert.match(script, /Start all services/);
});

test('web UI makes service cards stateful toggles', () => {
  const script = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(webRoot, 'styles.css'), 'utf8');

  assert.match(script, /row\.dataset\.action = action/);
  assert.match(script, /row\.setAttribute\('role', 'button'\)/);
  assert.match(script, /row\.setAttribute\('aria-label', actionLabel\)/);
  assert.match(script, /row\.setAttribute\('tabindex', '0'\)/);
  assert.match(script, /'http-toggle'/);
  assert.match(script, /'tftp-toggle'/);
  assert.match(script, /'dhcp-toggle'/);
  assert.match(script, /button\[data-action="\$\{action\}"\]/);
  assert.match(script, /cardAction\.className = 'service-card-cta'/);
  assert.match(script, /cardAction\.dataset\.icon = service\.running \? 'stop' : 'play_arrow'/);
  assert.match(script, /service-card-action\[data-action\]/);
  assert.match(styles, /\.service-card-cta/);
  assert.match(styles, /\.service-card\[data-service-state="stopped"\] \.service-switch/);
  assert.match(styles, /\.service-card-action:hover/);
  assert.match(styles, /\.service-card-action:focus-visible/);
});

test('operations buttons use one text scale', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(webRoot, 'styles.css'), 'utf8');

  assert.doesNotMatch(html, /quiet-action/);
  assert.doesNotMatch(styles, /button\.quiet-action/);
  assert.match(styles, /button \{\s*appearance: none;[\s\S]*font: 500 12px\/16px Inter, sans-serif;/);
});

test('web UI keeps local component layer', () => {
  const styles = fs.readFileSync(path.join(webRoot, 'styles.css'), 'utf8');
  const script = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

  assert.match(styles, /--primary-container: #1e3a8a/);
  assert.match(styles, /\.view\.active/);
  assert.match(styles, /\.service-switch/);
  assert.match(styles, /\.preflight-summary-list/);
  assert.match(styles, /-webkit-line-clamp: 2/);
  assert.match(styles, /\.dashboard-operations-column/);
  assert.match(styles, /\.dashboard-status-column/);
  assert.match(styles, /\.dashboard-log-column/);
  assert.match(script, /makeIcon/);
  assert.match(script, /service-card/);
  assert.match(script, /card-icon/);
  assert.match(script, /service-row-head/);
  assert.match(script, /checks passed/);
});
