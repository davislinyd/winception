import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { tailFile } from '../src/logger.js';

test('tailFile reads a bounded suffix instead of loading a whole log', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-tail-'));
  const logPath = path.join(root, 'large.log');
  try {
    fs.writeFileSync(logPath, `${'x'.repeat(2 * 1024 * 1024)}\nlast-1\nlast-2\nlast-3\n`, 'utf8');
    const original = fs.readFileSync;
    fs.readFileSync = () => { throw new Error('whole-file read is forbidden'); };
    try {
      assert.deepEqual(tailFile(logPath, 3), ['last-1', 'last-2', 'last-3']);
    }
    finally {
      fs.readFileSync = original;
    }
  }
  finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
