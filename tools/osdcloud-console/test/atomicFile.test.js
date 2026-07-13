import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeJsonAtomic } from '../src/atomicFile.js';

test('atomic JSON replacement preserves the prior file when rename fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winception-atomic-'));
  const target = path.join(root, 'state.json');
  try {
    fs.writeFileSync(target, '{"version":1}\n', 'utf8');
    const rename = fs.renameSync;
    fs.renameSync = () => { throw new Error('simulated replacement failure'); };
    try {
      assert.throws(() => writeJsonAtomic(target, { version: 2 }), /simulated replacement failure/u);
    }
    finally { fs.renameSync = rename; }
    assert.equal(fs.readFileSync(target, 'utf8'), '{"version":1}\n');
    assert.equal(fs.readdirSync(root).filter((name) => name.endsWith('.tmp')).length, 0);
  }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});
