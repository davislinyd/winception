import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createUtf8Collector,
  preparePowerShellArgs,
} from '../src/processOutput.js';

test('shared UTF-8 collector preserves split multibyte output', () => {
  const collector = createUtf8Collector();
  const bytes = Buffer.from('乙太網路 3', 'utf8');

  collector.write(bytes.subarray(0, 2));
  collector.write(bytes.subarray(2, 5));
  collector.write(bytes.subarray(5));
  collector.end();

  assert.equal(collector.text, '乙太網路 3');
});

test('PowerShell command prelude sets UTF-8 console input and output', () => {
  const args = preparePowerShellArgs(['-NoProfile', '-Command', 'Get-NetAdapter | ConvertTo-Json']);

  assert.match(args[2], /\[Console\]::OutputEncoding/);
  assert.match(args[2], /\[Console\]::InputEncoding/);
  assert.match(args[2], /\$OutputEncoding/);
  assert.match(args[2], /Get-NetAdapter/);
  assert.deepEqual(preparePowerShellArgs(['-NoProfile', '-File', 'script.ps1']), ['-NoProfile', '-File', 'script.ps1']);
});

test('external process output collection does not use ad hoc chunk.toString paths', () => {
  const srcRoot = path.join(process.cwd(), 'tools/osdcloud-console/src');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
  for (const file of walk(srcRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /chunk\.toString\(\)/, path.relative(srcRoot, file));
  }
});
