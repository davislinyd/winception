import fs from 'node:fs';
import path from 'node:path';
import { formatLocalLogLine, formatLocalIsoTime } from './timeFormat.js';

export function formatSyslog({
  severity = 6,
  facility = 1,
  timestamp = new Date(),
  hostname = 'localhost',
  appName = 'console',
  procId = process.pid,
  msgId = '-',
  structuredData = '-',
  message = '',
} = {}) {
  const pri = (facility * 8) + severity;
  const timeStr = formatLocalIsoTime(timestamp);
  const cleanMessage = String(message ?? '').trim();
  const msgPart = cleanMessage ? ` ${cleanMessage}` : '';
  return `<${pri}>1 ${timeStr} ${hostname} ${appName} ${procId} ${msgId} ${structuredData}${msgPart}`;
}

export function inferAppNameAndSeverity(message, logPath) {
  let appName = 'console';
  let severity = 6;

  const msgText = String(message ?? '');
  const pathText = String(logPath ?? '').toLowerCase();

  if (pathText.includes('dhcp') || msgText.startsWith('[DHCP]')) {
    appName = 'DHCP';
  } else if (pathText.includes('tftp') || msgText.startsWith('[TFTP]')) {
    appName = 'TFTP';
  } else if (pathText.includes('http') || msgText.startsWith('[HTTP]')) {
    appName = 'HTTP';
  } else if (
    msgText.startsWith('[WEB]') ||
    msgText.startsWith('[WEB-OP]') ||
    msgText.startsWith('[runtime]') ||
    msgText.startsWith('[endpoint]')
  ) {
    appName = 'WEB-OP';
  }

  const upperMsg = msgText.toUpperCase();
  if (!msgText.startsWith('[PREFLIGHT]') && (upperMsg.includes('ERROR') || upperMsg.includes('FAILED') || upperMsg.includes('FAIL'))) {
    severity = 3;
  } else if (upperMsg.includes('WARN') || upperMsg.includes('WARNING')) {
    severity = 4;
  }

  return { appName, severity };
}

export function formatLogLine(message, date = new Date(), options = {}) {
  const msgStr = String(message ?? '');
  if (/^<\d+>1 /u.test(msgStr)) {
    return msgStr;
  }

  const inferred = inferAppNameAndSeverity(msgStr, options.logPath);
  const appName = options.appName || inferred.appName;
  const severity = options.severity ?? inferred.severity;
  const facility = options.facility ?? 1;
  const hostname = options.hostname || 'localhost';
  const procId = options.procId || process.pid;
  const msgId = options.msgId || '-';
  const structuredData = options.structuredData || '-';

  return formatSyslog({
    severity,
    facility,
    timestamp: date,
    hostname,
    appName,
    procId,
    msgId,
    structuredData,
    message: msgStr,
  });
}

export function appendLog(logPath, message, options = {}) {
  const line = formatLogLine(message, new Date(), { logPath, ...options });
  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${line}\n`, 'ascii');
  }
  return line;
}


export function tailFile(filePath, maxLines = 80) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).slice(-maxLines);
}

export class RingBuffer {
  constructor(limit = 300) {
    this.limit = limit;
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    if (this.items.length > this.limit) {
      this.items.splice(0, this.items.length - this.limit);
    }
  }

  clear() {
    this.items = [];
  }

  lines() {
    return [...this.items];
  }
}
