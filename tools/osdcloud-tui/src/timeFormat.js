function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeTimestampText(value) {
  return String(value ?? '').trim().replace(/(\.\d{3})\d+((?:Z|[+-]\d{2}:?\d{2})?)$/u, '$1$2');
}

const displayLogTimestampPattern = /^(\[[^\]]+\]\s+)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))(\s+)/u;

export function parseTimestamp(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);
  if (Number.isFinite(timestamp)) {
    return timestamp;
  }

  const normalized = normalizeTimestampText(text);
  if (normalized !== text) {
    const normalizedTimestamp = Date.parse(normalized);
    if (Number.isFinite(normalizedTimestamp)) {
      return normalizedTimestamp;
    }
  }

  return null;
}

export function formatLocalOffset(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
}

export function formatLocalTimestamp(value) {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return '';
  }

  const date = new Date(timestamp);
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
    formatLocalOffset(date),
  ].join(' ');
}

export function formatLocalClock(value) {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return '';
  }

  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatLocalLogLine(message, date = new Date()) {
  return `${formatLocalTimestamp(date)} ${message}`;
}

export function formatDisplayLogLine(line) {
  return String(line ?? '').replace(displayLogTimestampPattern, (match, prefix = '', timestamp, separator) => {
    const localTimestamp = formatLocalTimestamp(timestamp);
    return localTimestamp ? `${prefix}${localTimestamp}${separator}` : match;
  });
}
