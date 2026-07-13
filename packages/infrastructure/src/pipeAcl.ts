import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PipeAclResult {
  serviceSid: string;
  protectedDacl: true;
  broadAccess: false;
}

export async function applyNamedPipeAcl(options: {
  endpoint: string;
  serviceName?: string;
  scriptPath: string;
  powershellPath?: string;
}): Promise<PipeAclResult> {
  const serviceName = options.serviceName ?? 'Winception.Web';
  if (!/^\\\\\.\\pipe\\ProtectedPrefix\\Administrators\\[A-Za-z0-9._-]+$/u.test(options.endpoint)) {
    throw new Error('The Agent pipe endpoint is outside the protected Winception namespace.');
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(serviceName)) throw new Error('The Web service name is invalid.');
  const { stdout } = await execFileAsync(options.powershellPath ?? 'powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', options.scriptPath, '-PipePath', options.endpoint, '-WebServiceName', serviceName,
  ], { windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 });
  const value = JSON.parse(stdout.trim()) as Partial<PipeAclResult>;
  if (!/^S-1-5-80-(?:\d+-){4}\d+$/u.test(value.serviceSid ?? '') || value.protectedDacl !== true || value.broadAccess !== false) {
    throw new Error('The Agent pipe DACL verification result is invalid.');
  }
  return value as PipeAclResult;
}
