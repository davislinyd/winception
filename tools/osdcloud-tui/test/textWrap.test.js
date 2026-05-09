import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth, wrapLineWithIndent, wrapLinesWithIndent } from '../src/textWrap.js';

test('counts blessed tags as non-visible text', () => {
  assert.equal(visibleWidth('{green-fg}OK{/green-fg} Latest status'), 16);
});

test('counts common CJK characters as double-width cells', () => {
  assert.equal(visibleWidth('乙太網路 3'), 10);
});

test('wraps continuation lines with two-space hanging indent', () => {
  assert.deepEqual(wrapLineWithIndent('alpha beta gamma delta', 12), [
    'alpha beta',
    '  gamma',
    '  delta',
  ]);
});

test('wraps multiple records without indenting new record starts', () => {
  assert.deepEqual(wrapLinesWithIndent(['one two three', 'four five six'], 9), [
    'one two',
    '  three',
    'four five',
    '  six',
  ]);
});

test('preserves blessed tags while wrapping visible text', () => {
  assert.deepEqual(
    wrapLineWithIndent('{green-fg}OK{/green-fg} Latest status - completed windows-desktop-ready', 32),
    [
      '{green-fg}OK{/green-fg} Latest status - completed',
      '  windows-desktop-ready',
    ],
  );
});
