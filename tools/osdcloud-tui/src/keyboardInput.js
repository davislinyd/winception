export function ensureKeyboardInput(screen, focusElement) {
  screen.enableKeys(focusElement);
  const input = screen.program.input;
  if (input?.setRawMode && !input.isRaw) {
    input.setRawMode(true);
  }
  input?.resume?.();
}

function keypress(ch, key) {
  return { ch, key: { ...key, full: key.full ?? key.name } };
}

function printableKey(char) {
  const isUpper = /^[A-Z]$/u.test(char);
  const name = char.length === 1 ? char.toLowerCase() : char;
  return keypress(char, {
    name,
    shift: isUpper,
    full: isUpper ? `S-${name}` : name,
  });
}

export function parseRawKeypresses(data) {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data ?? '');
  const keys = [];

  for (let index = 0; index < text.length;) {
    const rest = text.slice(index);

    if (rest.startsWith('\x1b[A') || rest.startsWith('\x1bOA')) {
      keys.push(keypress(undefined, { name: 'up' }));
      index += 3;
      continue;
    }
    if (rest.startsWith('\x1b[B') || rest.startsWith('\x1bOB')) {
      keys.push(keypress(undefined, { name: 'down' }));
      index += 3;
      continue;
    }
    if (rest.startsWith('\x1b[C') || rest.startsWith('\x1bOC')) {
      keys.push(keypress(undefined, { name: 'right' }));
      index += 3;
      continue;
    }
    if (rest.startsWith('\x1b[D') || rest.startsWith('\x1bOD')) {
      keys.push(keypress(undefined, { name: 'left' }));
      index += 3;
      continue;
    }
    if (rest.startsWith('\x1b[Z')) {
      keys.push(keypress(undefined, { name: 'tab', shift: true, full: 'S-tab' }));
      index += 3;
      continue;
    }
    if (rest.startsWith('\x1b[')) {
      const match = /^\x1b\[[0-9;?<]*[A-Za-z~]/u.exec(rest);
      if (match) {
        index += match[0].length;
        continue;
      }
    }

    const char = text[index];
    if (char === '\x03') {
      keys.push(keypress('\x03', { name: 'c', ctrl: true, full: 'C-c' }));
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      keys.push(keypress(char, { name: 'enter' }));
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (char === '\t') {
      keys.push(keypress('\t', { name: 'tab' }));
      index += 1;
      continue;
    }
    if (char === '\x1b') {
      const next = text[index + 1];
      if (next && /^[A-Za-z]$/u.test(next)) {
        const name = next.toLowerCase();
        keys.push(keypress(next, { name, meta: true, full: `M-${name}` }));
        index += 2;
        continue;
      }
      keys.push(keypress('\x1b', { name: 'escape' }));
      index += 1;
      continue;
    }
    if (char >= ' ' && char <= '~') {
      keys.push(printableKey(char));
    }
    index += 1;
  }

  return keys;
}

export function bindFallbackKeyboardInput(screen, {
  getObservedKeypressCount = () => 0,
  defer = (callback) => setImmediate(callback),
} = {}) {
  const input = screen.program.input;
  const handler = (chunk) => {
    const keypressCountBeforeData = getObservedKeypressCount();
    const keys = parseRawKeypresses(chunk);
    if (keys.length === 0) {
      return;
    }

    defer(() => {
      if (getObservedKeypressCount() !== keypressCountBeforeData) {
        return;
      }
      for (const { ch, key } of keys) {
        screen.program.emit('keypress', ch, key);
        screen.program.emit(`key ${key.full}`, ch, key);
      }
    });
  };

  const addListener = input?.prependListener ?? input?.on;
  addListener?.call(input, 'data', handler);
  return () => {
    if (input?.off) {
      input.off('data', handler);
    } else {
      input?.removeListener?.('data', handler);
    }
  };
}
