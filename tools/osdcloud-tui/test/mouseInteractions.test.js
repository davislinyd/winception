import test from 'node:test';
import assert from 'node:assert/strict';
import { mouseWheelStep, nextLogAutoFollowState, resolveMouseFocusTarget, wheelDeltaForAction } from '../src/mouseInteractions.js';

test('resolves mouse focus target unless dialogs are open', () => {
  assert.equal(resolveMouseFocusTarget('clients', { dialogOpen: false }), 'clients');
  assert.equal(resolveMouseFocusTarget('logs', { dialogOpen: true }), null);
  assert.equal(resolveMouseFocusTarget('', { dialogOpen: false }), null);
});

test('converts wheel actions to fixed scroll deltas', () => {
  assert.equal(mouseWheelStep, 3);
  assert.equal(wheelDeltaForAction('wheelup'), -3);
  assert.equal(wheelDeltaForAction('wheeldown'), 3);
  assert.equal(wheelDeltaForAction('mousemove'), 0);
});

test('tracks Logs auto-follow state for mouse and End key behavior', () => {
  assert.equal(nextLogAutoFollowState({ current: true, action: 'wheelup', scrollPercent: 100 }), false);
  assert.equal(nextLogAutoFollowState({ current: false, action: 'wheeldown', scrollPercent: 35 }), false);
  assert.equal(nextLogAutoFollowState({ current: false, action: 'wheeldown', scrollPercent: 100 }), true);
  assert.equal(nextLogAutoFollowState({ current: false, action: 'end', scrollPercent: 20 }), true);
});
