import test from 'node:test';
import assert from 'node:assert/strict';
import { bindFallbackKeyboardInput, ensureKeyboardInput, parseRawKeypresses } from '../src/keyboardInput.js';

test('enables blessed keys and resumes raw stdin', () => {
  const calls = [];
  const input = {
    isRaw: false,
    setRawMode(value) {
      calls.push(['setRawMode', value]);
      this.isRaw = value;
    },
    resume() {
      calls.push(['resume']);
    },
  };
  const focusElement = { id: 'actions' };
  const screen = {
    program: { input },
    enableKeys(element) {
      calls.push(['enableKeys', element]);
    },
  };

  ensureKeyboardInput(screen, focusElement);

  assert.deepEqual(calls, [
    ['enableKeys', focusElement],
    ['setRawMode', true],
    ['resume'],
  ]);
});

test('does not reset raw mode when stdin is already raw', () => {
  const calls = [];
  const input = {
    isRaw: true,
    setRawMode(value) {
      calls.push(['setRawMode', value]);
    },
    resume() {
      calls.push(['resume']);
    },
  };
  const screen = {
    program: { input },
    enableKeys() {
      calls.push(['enableKeys']);
    },
  };

  ensureKeyboardInput(screen, {});

  assert.deepEqual(calls, [
    ['enableKeys'],
    ['resume'],
  ]);
});

test('parses raw terminal key sequences', () => {
  assert.deepEqual(
    parseRawKeypresses(Buffer.from('\x1b[A\x1b[B\r\t\x03q')),
    [
      { ch: undefined, key: { name: 'up', full: 'up' } },
      { ch: undefined, key: { name: 'down', full: 'down' } },
      { ch: '\r', key: { name: 'enter', full: 'enter' } },
      { ch: '\t', key: { name: 'tab', full: 'tab' } },
      { ch: '\x03', key: { name: 'c', ctrl: true, full: 'C-c' } },
      { ch: 'q', key: { name: 'q', shift: false, full: 'q' } },
    ],
  );
});

test('parses shift-tab and Alt mnemonic raw sequences', () => {
  assert.deepEqual(
    parseRawKeypresses('\x1b[Z\x1bc'),
    [
      { ch: undefined, key: { name: 'tab', shift: true, full: 'S-tab' } },
      { ch: 'c', key: { name: 'c', meta: true, full: 'M-c' } },
    ],
  );
});

test('ignores unhandled CSI sequences such as mouse input', () => {
  assert.deepEqual(parseRawKeypresses('\x1b[<0;10;10M'), []);
});

test('fallback emits keypresses only when blessed observed none', () => {
  const emitted = [];
  let observed = 0;
  const input = {
    listeners: new Map(),
    on(event, handler) {
      this.listeners.set(event, handler);
    },
    off(event, handler) {
      if (this.listeners.get(event) === handler) {
        this.listeners.delete(event);
      }
    },
  };
  const screen = {
    program: {
      input,
      emit(event, ch, key) {
        emitted.push([event, ch, key.full]);
      },
    },
  };
  const queued = [];
  const unbind = bindFallbackKeyboardInput(screen, {
    getObservedKeypressCount: () => observed,
    defer: (callback) => queued.push(callback),
  });

  input.listeners.get('data')('\x1b[A');
  queued.shift()();

  assert.deepEqual(emitted, [
    ['keypress', undefined, 'up'],
    ['key up', undefined, 'up'],
  ]);

  input.listeners.get('data')('\x1b[B');
  observed += 1;
  queued.shift()();
  assert.equal(emitted.length, 2);

  unbind();
  assert.equal(input.listeners.has('data'), false);
});

test('fallback prepends data listener so blessed can suppress duplicates', () => {
  const calls = [];
  const input = {
    prependListener(event, handler) {
      calls.push(['prependListener', event, handler]);
    },
    on(event, handler) {
      calls.push(['on', event, handler]);
    },
    off(event, handler) {
      calls.push(['off', event, handler]);
    },
  };
  const screen = {
    program: {
      input,
      emit() {},
    },
  };

  const unbind = bindFallbackKeyboardInput(screen);
  const handler = calls[0][2];
  unbind();

  assert.equal(calls[0][0], 'prependListener');
  assert.equal(calls[0][1], 'data');
  assert.deepEqual(calls[1], ['off', 'data', handler]);
});
