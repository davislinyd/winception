import { spawnSync } from 'node:child_process';
import { writeReport, sourceFingerprint } from './report.mjs';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const report = { layer: 'Source', status: 'Passed', checks: [], installed: 'NotRun', vm: 'NotRun', physical: 'NotRun', human: 'NotRun' };
report.sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding:'utf8', windowsHide:true }).stdout?.trim();
report.sourceHash = sourceFingerprint();
for (const command of ['check', 'test', 'smoke']) {
  const env = { ...process.env };
  if (process.platform === 'win32' && env.PSModulePath) env.PSModulePath = env.PSModulePath.split(';').filter((entry) => !/codex-runtimes/i.test(entry)).join(';');
  const result = spawnSync(npm, ['run', command], { stdio: 'inherit', shell: process.platform === 'win32', env });
  report.checks.push({ command, status: result.status === 0 ? 'Passed' : 'Failed', exitCode: result.status });
  if (result.status !== 0) { report.status = 'Failed'; writeReport('test-results/acceptance-source', report); process.exit(result.status ?? 1); }
}
writeReport('test-results/acceptance-source', report);
