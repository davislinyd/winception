const SENSITIVE_KEY_PATTERN = /(password|secret|token)/iu;

const TEXT_PATTERNS = [
  /((?:windowsPassword|pxeinstallPassword|smbPassword|password|secret|token)"?\s*:\s*")([^"]*)(")/giu,
  /((?:windowsPassword|pxeinstallPassword|smbPassword|password|secret|token)'\s*:\s*')([^']*)(')/giu,
  /((?:windowsPassword|pxeinstallPassword|smbPassword|password|secret|token)\s*=\s*)([^\s\r\n;]+)/giu,
  /((?:windowsPassword|pxeinstallPassword|smbPassword|password|secret|token)\s*[:=]\s*)([^\s,]+)/giu,
  /(Bearer\s+)([A-Za-z0-9._-]{16,})(\b)/giu,
];

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/gu;

export function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERN.test(String(key ?? ''));
}

export function redactJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (isSensitiveKey(key)) {
      return [key, 'REDACTED'];
    }
    return [key, typeof item === 'string' ? redactText(item) : redactJson(item)];
  }));
}

export function redactText(value) {
  let text = String(value ?? '');
  for (const pattern of TEXT_PATTERNS) {
    text = text.replace(pattern, (...args) => {
      const captures = args.slice(1, -2);
      const prefix = captures[0] ?? '';
      const suffix = captures[2] ?? '';
      return `${prefix}REDACTED${suffix}`;
    });
  }
  text = text.replace(JWT_PATTERN, 'REDACTED');
  return text;
}
