import test from 'node:test';
import assert from 'node:assert/strict';
import { isCancelKey, isConfirmKey } from '../src/confirmKeys.js';

test('accepts y and enter as confirmation', () => {
  assert.equal(isConfirmKey('y'), true);
  assert.equal(isConfirmKey('Y'), true);
  assert.equal(isConfirmKey('', { name: 'enter' }), true);
  assert.equal(isConfirmKey('n'), false);
});

test('accepts n, q, and escape as cancellation', () => {
  assert.equal(isCancelKey('n'), true);
  assert.equal(isCancelKey('q'), true);
  assert.equal(isCancelKey('', { name: 'escape' }), true);
  assert.equal(isCancelKey('y'), false);
});
