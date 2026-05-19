import fs from 'node:fs';
import path from 'node:path';
import { formatLocalLogLine } from './timeFormat.js';

export function formatLogLine(message, date = new Date()) {
  return formatLocalLogLine(message, date);
}

export function appendLog(logPath, message) {
  const line = formatLogLine(message);
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
