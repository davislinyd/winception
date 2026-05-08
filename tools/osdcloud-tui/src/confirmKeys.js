export function isConfirmKey(ch, key = {}) {
  const name = String(key.name ?? '').toLowerCase();
  const value = String(ch ?? '').trim().toLowerCase();
  return name === 'enter' || value === 'y';
}

export function isCancelKey(ch, key = {}) {
  const name = String(key.name ?? '').toLowerCase();
  const value = String(ch ?? '').trim().toLowerCase();
  return name === 'escape' || value === 'n' || value === 'q';
}
