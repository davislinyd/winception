export const mouseWheelStep = 3;

export function resolveMouseFocusTarget(targetId, { dialogOpen = false } = {}) {
  return dialogOpen || !targetId ? null : targetId;
}

export function wheelDeltaForAction(action, step = mouseWheelStep) {
  if (action === 'wheelup') {
    return -Math.abs(step);
  }
  if (action === 'wheeldown') {
    return Math.abs(step);
  }
  return 0;
}

export function nextLogAutoFollowState({ current = true, action, scrollPercent = 100 } = {}) {
  if (action === 'wheelup') {
    return false;
  }
  if (action === 'end' || scrollPercent >= 99) {
    return true;
  }
  return current;
}
