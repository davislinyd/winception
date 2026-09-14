/** Test-only opt-in; ordinary profiles never request automatic login. */
export function normalizeAcceptance(value) {
  if (value == null) return null;
  if (value.testOnly !== true || !Number.isInteger(value.autoLogonCount) || value.autoLogonCount < 1 || value.autoLogonCount > 3) {
    throw new Error('Acceptance requires testOnly=true and autoLogonCount between 1 and 3');
  }
  return { testOnly: true, autoLogonCount: value.autoLogonCount };
}
