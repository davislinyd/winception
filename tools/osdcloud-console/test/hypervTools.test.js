import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const restartScript = fs.readFileSync(
  path.join(process.cwd(), 'tools', 'Restart-HyperVms.ps1'),
  'utf8',
);

test('Hyper-V restart helper preserves enough fixed memory for concurrent WinPE deployment', () => {
  assert.match(restartScript, /\[long\]\$MemoryStartupBytes = 4GB/);
  assert.match(restartScript, /\$MemoryStartupBytes -lt 4GB/);
  assert.match(
    restartScript,
    /Set-VMMemory -VMName \$vmName -DynamicMemoryEnabled \$false -StartupBytes \$MemoryStartupBytes/,
  );

  const stopAt = restartScript.indexOf('Stop-VM -Name $vmName');
  const memoryAt = restartScript.indexOf('Set-VMMemory -VMName $vmName');
  const startAt = restartScript.indexOf('Start-VM -Name $vmName');
  assert.ok(stopAt >= 0 && stopAt < memoryAt && memoryAt < startAt);
});
