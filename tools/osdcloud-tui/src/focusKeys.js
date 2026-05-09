export const focusOrder = ['actions', 'services', 'clients', 'preflight', 'details', 'validation', 'logs'];

export const focusShortcutMap = new Map([
  ['a', 'actions'],
  ['s', 'services'],
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

export function resolveShortcutHintRequest(key = {}, { dialogOpen = false } = {}) {
  return !dialogOpen && isShortcutHintKey(key);
}

export function formatPanelLabel(title, mnemonic = '', hintsVisible = false) {
  if (!hintsVisible || !mnemonic) {
    return `  ${title}  `;
  }

  const index = title.toLowerCase().indexOf(String(mnemonic).toLowerCase());
  if (index === -1) {
    return `  ${title}  `;
  }

  const highlighted = [
    title.slice(0, index),
    `{underline}${title.slice(index, index + 1)}{/underline}`,
    title.slice(index + 1),
  ].join('');
  return `  ${highlighted}  `;
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
