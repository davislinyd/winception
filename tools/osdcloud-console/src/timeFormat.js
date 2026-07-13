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

export function formatLocalIsoTime(value = new Date()) {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return '';
  }

  const date = new Date(timestamp);
  const pad = (n, m = 2) => String(n).padStart(m, '0');
  const offset = formatLocalOffset(date);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
         `${offset}`;
}

export function formatLocalLogLine(message, date = new Date()) {
  return `${formatLocalTimestamp(date)} ${message}`;
}

const rfc5424Pattern = /^<(\d+)>1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+)(?: (.*))?$/u;
const powerShellTracePattern = /\uFFFD|(?:^|\s)(?:at\s+)?[A-Za-z]:\\[^\r\n]*?\.ps1(?::\d+)?|(?:^|\s)(?:CategoryInfo|FullyQualifiedErrorId)\s*:|(?:^|\s)\+\s+(?:throw|CategoryInfo|FullyQualifiedErrorId)\b|CommandInvocation\(/iu;
const webFailurePrefixPattern = /^(.*?\bfailed:\s*.+?)(?=\s+(?:\uFFFD|(?:at\s+)?[A-Za-z]:\\|CategoryInfo\s*:|FullyQualifiedErrorId\s*:|\+\s+(?:throw|CategoryInfo|FullyQualifiedErrorId)\b|CommandInvocation\())/iu;

function redactPowerShellTrace(line) {
  const value = String(line ?? '');
  const prefix = webFailurePrefixPattern.exec(value)?.[1]?.trim();
  if (prefix) {
    return prefix;
  }
  if (powerShellTracePattern.test(value) || /^[\s~]{6,}$/u.test(value)) {
    return 'Operation could not be completed. Check System Log and try again.';
  }
  return value;
}

export function formatDisplayLogLine(line) {
  const str = redactPowerShellTrace(line);
  const rfcMatch = rfc5424Pattern.exec(str);
  if (rfcMatch) {
    const pri = Number(rfcMatch[1]);
    const severity = pri % 8;
    const timestamp = rfcMatch[2];
    const appName = rfcMatch[4];
    const message = rfcMatch[8] || '';
    const localTimestamp = formatLocalTimestamp(timestamp);
    
    let severityTag = '';
    if (severity <= 3) {
      severityTag = ' ERROR:';
    } else if (severity === 4) {
      severityTag = ' WARN:';
    }
    
    return localTimestamp ? `${localTimestamp} [${appName}]${severityTag} ${message}` : str;
  }

  return str.replace(displayLogTimestampPattern, (match, prefix = '', timestamp, separator) => {
    const localTimestamp = formatLocalTimestamp(timestamp);
    return localTimestamp ? `${prefix}${localTimestamp}${separator}` : match;
  });
}

