import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { UploadStore } from '../src/uploadStore.js';

test('upload staging uses opaque tokens and verifies kind, size and SHA256', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-v2-'));
  try {
    const store = new UploadStore(root);
    const staged = await store.stage('custom-script', 'baseline.ps1', Readable.from(['Write-Host safe']), 15);
    assert.match(staged.uploadToken, /^[0-9a-f-]{36}$/u);
    assert.equal((await store.resolve(staged.uploadToken, 'custom-script')).sha256, staged.sha256);
    await assert.rejects(store.resolve(staged.uploadToken, 'software'), /manifest is invalid/u);
    store.consume(staged.uploadToken);
    await assert.rejects(store.resolve(staged.uploadToken, 'custom-script'), /not found/u);
  }
  finally {
    rmSync(root, { recursive: true, force: true });
  }
});
