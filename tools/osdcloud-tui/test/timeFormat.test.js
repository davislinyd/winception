import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDisplayLogLine,
  formatLocalClock,
  formatLocalLogLine,
  formatLocalTimestamp,
  parseTimestamp,
} from '../src/timeFormat.js';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function expectedLocalOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
}

function expectedLocalTimestamp(value) {
  const date = new Date(value);
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
    expectedLocalOffset(date),
  ].join(' ');
}

function expectedLocalClock(value) {
  const date = new Date(value);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

test('formats timestamps in the host system timezone', () => {
  const source = '2026-05-09T01:00:00Z';

  assert.equal(formatLocalTimestamp(source), expectedLocalTimestamp(source));
  assert.equal(formatLocalClock(source), expectedLocalClock(source));
  assert.doesNotMatch(formatLocalTimestamp(source), /T|Z$/);
});

test('parses long fractional ISO timestamps from screenshot metadata', () => {
  const source = '2026-05-10T20:18:47.8856260-08:00';

  assert.equal(parseTimestamp(source), Date.parse('2026-05-10T20:18:47.885-08:00'));
  assert.equal(formatLocalTimestamp(source), expectedLocalTimestamp('2026-05-10T20:18:47.885-08:00'));
});

test('formats live and prefixed log lines for display in local time', () => {
  const source = '2026-05-09T01:00:00Z';
  const expected = expectedLocalTimestamp(source);

  assert.equal(formatLocalLogLine('message', new Date(source)), `${expected} message`);
  assert.equal(formatDisplayLogLine(`[HTTP] ${source} GET /osdcloud/status 200`), `[HTTP] ${expected} GET /osdcloud/status 200`);
});
