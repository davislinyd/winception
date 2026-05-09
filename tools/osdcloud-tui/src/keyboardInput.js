export function ensureKeyboardInput(screen, focusElement) {
  screen.enableKeys(focusElement);
  const input = screen.program.input;
  if (input?.setRawMode && !input.isRaw) {
    input.setRawMode(true);
  }
  input?.resume?.();
}
