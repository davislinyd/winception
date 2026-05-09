const blessedTagPattern = /^\{\/?[\w\-,;!#]*\}/;
const ansiPattern = /^\x1b\[[\d;]*m/;

function charWidth(char) {
  const code = char.codePointAt(0);
  if (code === undefined) {
    return 0;
  }
  if (code === 0x03 || code < 0x20 || (code >= 0x7f && code < 0xa0)) {
    return 0;
  }
  if (
    (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 2;
  }
  return 1;
}

export function visibleWidth(text) {
  let width = 0;
  for (let index = 0; index < text.length;) {
    const rest = text.slice(index);
    const tag = rest.match(blessedTagPattern);
    if (tag) {
      index += tag[0].length;
      continue;
    }
    const ansi = rest.match(ansiPattern);
    if (ansi) {
      index += ansi[0].length;
      continue;
    }
    const char = Array.from(rest)[0] ?? '';
    width += charWidth(char);
    index += char.length;
  }
  return width;
}

function splitLineAtWidth(line, width) {
  let visible = 0;
  let lastSpaceIndex = -1;

  for (let index = 0; index < line.length;) {
    const rest = line.slice(index);
    const tag = rest.match(blessedTagPattern);
    if (tag) {
      index += tag[0].length;
      continue;
    }
    const ansi = rest.match(ansiPattern);
    if (ansi) {
      index += ansi[0].length;
      continue;
    }

    const char = Array.from(rest)[0] ?? '';
    const nextVisible = visible + charWidth(char);
    if (nextVisible > width && visible > 0) {
      const splitIndex = /\s/.test(char)
        ? index
        : lastSpaceIndex > 0 ? lastSpaceIndex : index;
      return [
        line.slice(0, splitIndex).trimEnd(),
        line.slice(splitIndex).trimStart(),
      ];
    }

    if (/\s/.test(char)) {
      lastSpaceIndex = index;
    }

    visible = nextVisible;
    index += char.length;
  }

  return [line, ''];
}

export function wrapLineWithIndent(line, width, indent = 2) {
  const firstWidth = Math.max(1, width);
  const continuationPrefix = ' '.repeat(Math.max(0, indent));
  const continuationWidth = Math.max(1, firstWidth - continuationPrefix.length);
  const output = [];
  let remaining = String(line ?? '');

  if (remaining.length === 0) {
    return [''];
  }

  while (visibleWidth(remaining) > (output.length === 0 ? firstWidth : continuationWidth)) {
    const targetWidth = output.length === 0 ? firstWidth : continuationWidth;
    const [head, tail] = splitLineAtWidth(remaining, targetWidth);
    if (!head || tail === remaining) {
      break;
    }
    output.push(`${output.length === 0 ? '' : continuationPrefix}${head}`);
    remaining = tail;
  }

  output.push(`${output.length === 0 ? '' : continuationPrefix}${remaining}`);
  return output;
}

export function wrapLinesWithIndent(lines, width, indent = 2) {
  return lines.flatMap((line) => wrapLineWithIndent(line, width, indent));
}
