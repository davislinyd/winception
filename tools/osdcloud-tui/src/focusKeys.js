export const focusOrder = ['actions', 'clients', 'details', 'preflight', 'validation', 'logs'];

export const focusShortcutMap = new Map([
  ['a', 'actions'],
  ['c', 'clients'],
  ['d', 'details'],
  ['p', 'preflight'],
  ['v', 'validation'],
  ['l', 'logs'],
]);

export function normalizeFocusTarget(value) {
  return focusOrder.includes(value) ? value : focusOrder[0];
}

export function nextFocusTarget(current, direction = 1) {
  const normalized = normalizeFocusTarget(current);
  const currentIndex = focusOrder.indexOf(normalized);
  const offset = direction < 0 ? -1 : 1;
  return focusOrder[(currentIndex + offset + focusOrder.length) % focusOrder.length];
}

export function resolveFocusShortcut(key = {}) {
  const full = String(key.full ?? '').toLowerCase();
  if (full.startsWith('m-') && full.length === 3) {
    return focusShortcutMap.get(full.slice(2)) ?? null;
  }

  if (key.meta && key.name) {
    return focusShortcutMap.get(String(key.name).toLowerCase()) ?? null;
  }

  return null;
}

export function resolveFocusShortcutRequest(key = {}, { dialogOpen = false } = {}) {
  return dialogOpen ? null : resolveFocusShortcut(key);
}

export function isShortcutHintKey(key = {}) {
  const full = String(key.full ?? '').toLowerCase();
  return Boolean(key.meta) || key.name === 'escape' || full.startsWith('m-');
}

export function formatPanelLabel(title, shortcutKey = '', hintsVisible = false) {
  const shortcut = shortcutKey
    ? ` Alt+${hintsVisible ? `{underline}${shortcutKey}{/underline}` : shortcutKey}`
    : '';
  return `  ${title}${shortcut}  `;
}

export function isReverseTab(key = {}) {
  return key.name === 'tab' && Boolean(key.shift);
}

export function resolveTabFocusTarget(current, key = {}, { dialogOpen = false } = {}) {
  if (dialogOpen || key.name !== 'tab') {
    return null;
  }
  return nextFocusTarget(current, isReverseTab(key) ? -1 : 1);
}
