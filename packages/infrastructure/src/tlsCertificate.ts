import { spawn } from 'node:child_process';

const THUMBPRINT = /^[A-F0-9]{40,128}$/u;
const DNS_NAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/u;

export function validateWindowsCertificateStore(scriptPath: string, thumbprint: string, expectedDnsName: string): Promise<void> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows certificate validation is supported only on Windows.'));
  if (!THUMBPRINT.test(thumbprint) || !DNS_NAME.test(expectedDnsName)) return Promise.reject(new Error('HTTPS certificate validation input is invalid.'));
  return new Promise<void>((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath, '-Thumbprint', thumbprint, '-ExpectedDnsName', expectedDnsName,
    ], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 30_000);
    timer.unref();
    child.on('error', () => { clearTimeout(timer); reject(new Error('HTTPS certificate-store validation failed.')); });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (exitCode === 0) resolve();
      else reject(new Error('HTTPS certificate-store validation failed.'));
    });
  });
}
