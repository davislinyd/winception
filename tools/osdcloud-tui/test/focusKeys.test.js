import test from 'node:test';
import assert from 'node:assert/strict';
import {
  focusOrder,
  formatPanelLabel,
  isReverseTab,
  isShortcutHintKey,
  nextFocusTarget,
  resolveFocusShortcut,
  resolveFocusShortcutRequest,
  resolveShortcutHintRequest,
  resolveTabFocusTarget,
} from '../src/focusKeys.js';

test('resolves Alt shortcuts from blessed full key names', () => {
  assert.equal(resolveFocusShortcut({ full: 'M-a' }), 'actions');
  assert.equal(resolveFocusShortcut({ full: 'M-s' }), 'services');
  assert.equal(resolveFocusShortcut({ full: 'M-c' }), 'clients');
  assert.equal(resolveFocusShortcut({ full: 'M-d' }), 'details');
  assert.equal(resolveFocusShortcut({ full: 'M-p' }), 'preflight');
  assert.equal(resolveFocusShortcut({ full: 'M-v' }), 'validation');
  assert.equal(resolveFocusShortcut({ full: 'M-l' }), 'logs');
});

test('resolves Alt shortcuts from meta key fields', () => {
  assert.equal(resolveFocusShortcut({ meta: true, name: 's' }), 'services');
  assert.equal(resolveFocusShortcut({ meta: true, name: 'c' }), 'clients');
  assert.equal(resolveFocusShortcut({ meta: true, name: 'D' }), 'details');
});

test('ignores non-focus shortcuts', () => {
  assert.equal(resolveFocusShortcut({ full: 'c', name: 'c' }), null);
  assert.equal(resolveFocusShortcut({ meta: true, name: 'x' }), null);
  assert.equal(resolveFocusShortcut({ name: 'tab' }), null);
});

test('cycles focus targets forward and backward', () => {
  assert.deepEqual(focusOrder, ['actions', 'services', 'clients', 'preflight', 'details', 'validation', 'logs']);
  assert.equal(nextFocusTarget('actions'), 'services');
  assert.equal(nextFocusTarget('logs'), 'actions');
  assert.equal(nextFocusTarget('actions', -1), 'logs');
  assert.equal(nextFocusTarget('details', -1), 'preflight');
  assert.equal(nextFocusTarget('unknown'), 'services');
});

test('detects reverse tab', () => {
  assert.equal(isReverseTab({ name: 'tab', shift: true }), true);
  assert.equal(isReverseTab({ name: 'tab' }), false);
  assert.equal(isReverseTab({ name: 'down', shift: true }), false);
});

test('formats panel labels with temporary shortcut underlines', () => {
  assert.equal(formatPanelLabel('Actions', 'A', false), '  Actions  ');
  assert.equal(formatPanelLabel('Actions', 'A', true), '  {underline}A{/underline}ctions  ');
  assert.equal(formatPanelLabel('Clients', 'C', false), '  Clients  ');
  assert.equal(formatPanelLabel('Clients', 'C', true), '  {underline}C{/underline}lients  ');
  assert.equal(formatPanelLabel('Client Detail', 'D', true), '  Client {underline}D{/underline}etail  ');
  assert.equal(formatPanelLabel('Services', 'S', true), '  {underline}S{/underline}ervices  ');
  assert.equal(formatPanelLabel('Services', '', true), '  Services  ');
});

test('detects shortcut hint key events', () => {
  assert.equal(isShortcutHintKey({ meta: true, name: 'c' }), true);
  assert.equal(isShortcutHintKey({ full: 'M-c' }), true);
  assert.equal(isShortcutHintKey({ name: 'escape' }), true);
  assert.equal(isShortcutHintKey({ name: 'c' }), false);
  assert.equal(resolveShortcutHintRequest({ full: 'M-c' }, { dialogOpen: true }), false);
  assert.equal(resolveShortcutHintRequest({ full: 'M-c' }, { dialogOpen: false }), true);
});

test('ignores panel focus requests while dialogs are open', () => {
  assert.equal(resolveFocusShortcutRequest({ full: 'M-c' }, { dialogOpen: true }), null);
  assert.equal(resolveFocusShortcutRequest({ full: 'M-c' }, { dialogOpen: false }), 'clients');
  assert.equal(resolveTabFocusTarget('actions', { name: 'tab' }, { dialogOpen: true }), null);
  assert.equal(resolveTabFocusTarget('actions', { name: 'tab' }, { dialogOpen: false }), 'services');
});
