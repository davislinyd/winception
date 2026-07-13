import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDisplayLogLine,
  formatLocalClock,
  formatLocalLogLine,
  formatLocalTimestamp,
  formatLocalIsoTime,
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

test('formats timestamps as local ISO string with milliseconds and offset', () => {
  const source = '2026-05-09T01:00:00.123Z';
  const date = new Date(source);
  const pad = (n, m = 2) => String(n).padStart(m, '0');
  const offset = expectedLocalOffset(date);
  const expectedIso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
                      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.123` +
                      `${offset}`;

  assert.equal(formatLocalIsoTime(source), expectedIso);
});

test('formats rfc5424 display log lines properly', () => {
  const source = '2026-05-09T01:00:00.123Z';
  const localTime = expectedLocalTimestamp(source);
  const rfcLine = `<14>1 2026-05-09T01:00:00.123Z myhost DHCP 1234 - - Message here`;

  assert.equal(formatDisplayLogLine(rfcLine), `${localTime} [DHCP] Message here`);

  const rfcErrorLine = `<11>1 2026-05-09T01:00:00.123Z myhost TFTP 1234 - - Error message`;
  assert.equal(formatDisplayLogLine(rfcErrorLine), `${localTime} [TFTP] ERROR: Error message`);
});

test('redacts PowerShell trace details from display logs', () => {
  const line = '2026-07-13 01:05:51 +08:00 [WEB-OP] ERROR: [WEB] Registering software test VM failed: Software test VM "winception-software-test-01" must be powered off before registration. \uFFFD\uFFFD\uFFFD C:\\OSDCloud\\HostTools\\App\\tools\\Invoke-SoftwareTestVm.ps1:44 \uFFFD\uFFFD\uFFFD CategoryInfo : OperationStopped';
  assert.equal(
    formatDisplayLogLine(line),
    '2026-07-13 01:05:51 +08:00 [WEB-OP] ERROR: [WEB] Registering software test VM failed: Software test VM "winception-software-test-01" must be powered off before registration.',
  );
  assert.equal(
    formatDisplayLogLine('CategoryInfo : OperationStopped: (private:String) [], RuntimeException'),
    'Operation could not be completed. Check System Log and try again.',
  );
});

