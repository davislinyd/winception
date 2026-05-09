import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureKeyboardInput } from '../src/keyboardInput.js';

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
