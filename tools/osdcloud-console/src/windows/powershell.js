import { collectProcessOutput, preparePowerShellArgs as prepareProcessPowerShellArgs } from '../processOutput.js';
import { spawn, spawnSync } from 'node:child_process';
import { powershellExe } from './shared.js';

export function runPowerShell(args, options = {}) {
  const { onStdout, onStderr, ...spawnOptions } = options;
  const child = spawn(powershellExe(), prepareProcessPowerShellArgs(args), {
    windowsHide: true,
    ...spawnOptions,
  });
  return collectProcessOutput(child, { onStdout, onStderr }).then((result) => {
    if (result.code === 0) {
      return result;
    }
    const error = new Error(result.stderr.trim() || result.stdout.trim() || `PowerShell exited with code ${result.code}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.code = result.code;
    throw error;
  });
}

export async function isElevated() {
  if (process.platform !== 'win32') {
    return process.getuid?.() === 0;
  }
  const script = "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)";
  const result = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  return result.stdout.trim().toLowerCase() === 'true';
}

export function isElevatedSync() {
  if (process.platform !== 'win32') {
    return process.getuid?.() === 0;
  }
  const script = "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)";
  const result = spawnSync(powershellExe(), prepareProcessPowerShellArgs([
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]), {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return String(result.stdout ?? '').trim().toLowerCase() === 'true';
  }
  const message = String(result.stderr ?? '').trim() || String(result.stdout ?? '').trim() || `PowerShell exited with code ${result.status}`;
  throw new Error(message);
}
export { preparePowerShellArgs } from '../processOutput.js';
