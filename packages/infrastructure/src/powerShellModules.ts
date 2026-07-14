import { existsSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

export function addPackagedPowerShellModulePath(appRoot: string, environment: NodeJS.ProcessEnv = process.env): string | null {
  const moduleRoot = resolve(appRoot, 'powershell-modules');
  if (!existsSync(moduleRoot)) return null;
  const current = environment.PSModulePath ?? '';
  const entries = current.split(delimiter).filter(Boolean);
  const present = entries.some((entry) => process.platform === 'win32'
    ? entry.toLowerCase() === moduleRoot.toLowerCase()
    : entry === moduleRoot);
  if (!present) environment.PSModulePath = [moduleRoot, ...entries].join(delimiter);
  return moduleRoot;
}
