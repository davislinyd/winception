import test from 'node:test';
import assert from 'node:assert/strict';
import { focusOrder, isReverseTab, nextFocusTarget, resolveFocusShortcut, resolveFocusShortcutRequest, resolveTabFocusTarget } from '../src/focusKeys.js';

test('resolves Alt shortcuts from blessed full key names', () => {
  assert.equal(resolveFocusShortcut({ full: 'M-a' }), 'actions');
  assert.equal(resolveFocusShortcut({ full: 'M-c' }), 'clients');
  assert.equal(resolveFocusShortcut({ full: 'M-d' }), 'details');
  assert.equal(resolveFocusShortcut({ full: 'M-p' }), 'preflight');
  assert.equal(resolveFocusShortcut({ full: 'M-v' }), 'validation');
  assert.equal(resolveFocusShortcut({ full: 'M-l' }), 'logs');
});

test('resolves Alt shortcuts from meta key fields', () => {
  assert.equal(resolveFocusShortcut({ meta: true, name: 'c' }), 'clients');
  assert.equal(resolveFocusShortcut({ meta: true, name: 'D' }), 'details');
});

test('ignores non-focus shortcuts', () => {
  assert.equal(resolveFocusShortcut({ full: 'c', name: 'c' }), null);
  assert.equal(resolveFocusShortcut({ meta: true, name: 'x' }), null);
  assert.equal(resolveFocusShortcut({ name: 'tab' }), null);
});

test('cycles focus targets forward and backward', () => {
  assert.deepEqual(focusOrder, ['actions', 'clients', 'details', 'preflight', 'validation', 'logs']);
  assert.equal(nextFocusTarget('actions'), 'clients');
  assert.equal(nextFocusTarget('logs'), 'actions');
  assert.equal(nextFocusTarget('actions', -1), 'logs');
  assert.equal(nextFocusTarget('details', -1), 'clients');
  assert.equal(nextFocusTarget('unknown'), 'clients');
});

test('detects reverse tab', () => {
  assert.equal(isReverseTab({ name: 'tab', shift: true }), true);
  assert.equal(isReverseTab({ name: 'tab' }), false);
  assert.equal(isReverseTab({ name: 'down', shift: true }), false);
});

test('ignores panel focus requests while dialogs are open', () => {
  assert.equal(resolveFocusShortcutRequest({ full: 'M-c' }, { dialogOpen: true }), null);
  assert.equal(resolveFocusShortcutRequest({ full: 'M-c' }, { dialogOpen: false }), 'clients');
  assert.equal(resolveTabFocusTarget('actions', { name: 'tab' }, { dialogOpen: true }), null);
  assert.equal(resolveTabFocusTarget('actions', { name: 'tab' }, { dialogOpen: false }), 'clients');
});
