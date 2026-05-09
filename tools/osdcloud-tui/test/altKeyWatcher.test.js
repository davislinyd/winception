import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWindowsAltKeyWatcherScript, parseAltKeyWatcherLine } from '../src/altKeyWatcher.js';

test('parses Alt watcher state lines', () => {
  assert.equal(parseAltKeyWatcherLine('down'), true);
  assert.equal(parseAltKeyWatcherLine(' up \r'), false);
  assert.equal(parseAltKeyWatcherLine('noise'), null);
  assert.equal(parseAltKeyWatcherLine(''), null);
});

test('builds Windows Alt watcher script with Alt virtual keys', () => {
  const script = buildWindowsAltKeyWatcherScript({ intervalMs: 30 });
  assert.match(script, /GetAsyncKeyState\(18\)/);
  assert.match(script, /GetAsyncKeyState\(164\)/);
  assert.match(script, /GetAsyncKeyState\(165\)/);
  assert.match(script, /Start-Sleep -Milliseconds 30/);
});
