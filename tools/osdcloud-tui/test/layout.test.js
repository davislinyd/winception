import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, minimumTerminalSize } from '../src/layout.js';

test('shows minimum-size guard below supported terminal dimensions', () => {
  const layout = computeLayout(minimumTerminalSize.columns - 1, minimumTerminalSize.rows);

  assert.equal(layout.tooSmall, true);
  assert.equal(layout.minimum.columns, minimumTerminalSize.columns);
  assert.equal(layout.warning.hidden, false);
});

test('computes non-overlapping panes at the minimum supported size', () => {
  const layout = computeLayout(minimumTerminalSize.columns, minimumTerminalSize.rows);

  assert.equal(layout.tooSmall, false);
  assert.equal(layout.title.top, 0);
  assert.equal(layout.menu.top, layout.title.height);
  assert.equal(layout.services.left, layout.menu.width);
  assert.equal(layout.clients.left, layout.services.left + layout.services.width);
  assert.equal(layout.details.left, layout.preflight.left + layout.preflight.width);
  assert.equal(layout.logs.top, layout.preflight.top + layout.preflight.height);
  assert.equal(layout.logs.top + layout.logs.height, minimumTerminalSize.rows);
  assert.equal(layout.validation.top, layout.logs.top);
  assert.equal(layout.logs.left, layout.validation.left + layout.validation.width);
  assert.ok(layout.clients.width >= 44);
  assert.ok(layout.logs.height >= 8);
});

test('uses wider panes without exceeding terminal bounds', () => {
  const layout = computeLayout(190, 54);

  assert.equal(layout.tooSmall, false);
  assert.equal(layout.menu.width, 34);
  assert.equal(layout.services.width, 59);
  assert.equal(layout.clients.left + layout.clients.width, 190);
  assert.equal(layout.details.left + layout.details.width, 190);
  assert.equal(layout.validation.left + layout.validation.width, layout.logs.left);
  assert.equal(layout.logs.left + layout.logs.width, 190);
  assert.equal(layout.logs.top + layout.logs.height, 54);
});
