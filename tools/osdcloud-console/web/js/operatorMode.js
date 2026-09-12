import { elements } from './dom.js';
import { state } from './state.js';
import { setConsoleDockCollapsed } from './ui.js';

export const OPERATOR_MODE_STORAGE_KEY = 'winception-operator-mode';
export const OPERATOR_MODES = new Set(['guided', 'console']);

/**
 * Read the last operator mode. Invalid or missing values default to guided.
 * @returns {'guided' | 'console'}
 */
export function readStoredOperatorMode() {
  try {
    const value = window.localStorage.getItem(OPERATOR_MODE_STORAGE_KEY);
    return OPERATOR_MODES.has(value) ? value : 'guided';
  } catch {
    return 'guided';
  }
}

/**
 * Apply guided/console density. Optionally persist and set the console-dock default.
 * @param {string} mode
 * @param {{ persist?: boolean, applyDockDefault?: boolean }} [options]
 */
export function applyOperatorMode(mode, options = {}) {
  const persist = options.persist !== false;
  const applyDockDefault = options.applyDockDefault === true;
  const next = OPERATOR_MODES.has(mode) ? mode : 'guided';
  state.operatorMode = next;
  document.body.dataset.operatorMode = next;

  if (elements.operatorModeGuided) {
    elements.operatorModeGuided.setAttribute('aria-checked', String(next === 'guided'));
  }
  if (elements.operatorModeConsole) {
    elements.operatorModeConsole.setAttribute('aria-checked', String(next === 'console'));
  }
  if (elements.guidedShell) {
    elements.guidedShell.hidden = next !== 'guided';
  }
  if (elements.beginnerHome) {
    elements.beginnerHome.hidden = next !== 'guided';
  }
  if (elements.consoleBoard) {
    elements.consoleBoard.hidden = next !== 'console';
  }

  if (persist) {
    try {
      window.localStorage.setItem(OPERATOR_MODE_STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable on locked-down hosts.
    }
  }

  if (applyDockDefault && !state.consoleDockUserToggled) {
    setConsoleDockCollapsed(next === 'guided');
  }
}
