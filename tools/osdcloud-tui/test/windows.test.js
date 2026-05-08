import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeStatusFiles } from '../src/windows.js';

test('clears status metadata and screenshot directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-status-clear-'));
  const statusRoot = path.join(root, 'status');
  fs.mkdirSync(path.join(statusRoot, 'screenshots', 'run-1'), { recursive: true });
  fs.writeFileSync(path.join(statusRoot, 'latest.json'), '{}');
  fs.writeFileSync(path.join(statusRoot, 'latest-screenshot.json'), '{}');
  fs.writeFileSync(path.join(statusRoot, 'run-1.screenshots.jsonl'), '{}\n');
  fs.writeFileSync(path.join(statusRoot, 'screenshots', 'run-1', 'shot.png'), 'png');
  fs.writeFileSync(path.join(statusRoot, 'keep.txt'), 'keep');

  try {
    const removed = removeStatusFiles({ http: { statusRoot } });
    assert.equal(removed, 4);
    assert.equal(fs.existsSync(path.join(statusRoot, 'latest.json')), false);
    assert.equal(fs.existsSync(path.join(statusRoot, 'latest-screenshot.json')), false);
    assert.equal(fs.existsSync(path.join(statusRoot, 'run-1.screenshots.jsonl')), false);
    assert.equal(fs.existsSync(path.join(statusRoot, 'screenshots')), false);
    assert.equal(fs.readFileSync(path.join(statusRoot, 'keep.txt'), 'utf8'), 'keep');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
