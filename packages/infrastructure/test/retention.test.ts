import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enforceRetention } from '../src/retention.js';

test('retention removes oldest and expired files until age and quota constraints pass', () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-v2-retention-'));
  try {
    const now = Date.now();
    for (const [index, age] of [5000, 3000, 1000].entries()) {
      const path = join(root, `${index}.log`);
      writeFileSync(path, '12345');
      utimesSync(path, new Date(now - age), new Date(now - age));
    }
    const result = enforceRetention(root, { maxAgeMs: 4000, maxFiles: 2, maxTotalBytes: 10 }, now);
    assert.equal(result.scanned, 3);
    assert.equal(result.removed, 1);
    assert.equal(result.remainingBytes, 10);
  }
  finally {
    rmSync(root, { recursive: true, force: true });
  }
});
