import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve('tools', 'osdcloud-tui', 'web');

test('web UI exposes dashboard view topology', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');

  assert.match(html, /id="tailwind-config"/);
  assert.match(html, /cdn\.tailwindcss\.com\?plugins=forms,container-queries/);
  assert.match(html, /bg-surface text-on-surface min-h-screen flex flex-col font-body-sm/);
  assert.match(html, /dashboard-grid grid grid-cols-12 gap-sm/);
  assert.match(html, /dashboard-operations-column/);
  assert.match(html, /dashboard-status-column/);
  assert.match(html, /dashboard-log-column/);
  assert.match(html, /id="view-dashboard"/);
  assert.match(html, /id="view-endpoints"/);
  assert.match(html, /id="view-sync"/);
  assert.match(html, /id="view-validation"/);
  assert.match(html, /Client Validation Evidence/);
  assert.match(html, /Refresh Evidence/);
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
