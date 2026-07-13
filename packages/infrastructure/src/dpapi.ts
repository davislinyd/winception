import { spawn } from 'node:child_process';
import type { SecretProtector } from '../../domain/src/ports.js';

const SAFE_SECRET_NAME = /^[A-Za-z][A-Za-z0-9.-]{0,127}$/u;

export class DpapiSecretProtector implements SecretProtector {
  constructor(readonly scriptPath: string) {}

  protect(name: string, plaintext: string): Promise<string> {
    return this.#invoke('Protect', name, plaintext);
  }

  unprotect(name: string, ciphertext: string): Promise<string> {
    return this.#invoke('Unprotect', name, ciphertext);
  }

  async #invoke(mode: 'Protect' | 'Unprotect', name: string, input: string): Promise<string> {
    if (process.platform !== 'win32') throw new Error('DPAPI secret protection is supported only on Windows.');
    if (!SAFE_SECRET_NAME.test(name)) throw new Error('Secret name is invalid.');
    if (!input) throw new Error('Secret input is empty.');
    return new Promise<string>((resolve, reject) => {
      const child = spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', this.scriptPath, '-Mode', mode, '-Name', name,
      ], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let outputTooLarge = false;
      const timer = setTimeout(() => child.kill(), 30_000);
      timer.unref();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > 1024 * 1024) {
          outputTooLarge = true;
          child.kill();
        }
      });
      child.stderr.resume();
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error(`DPAPI ${mode.toLowerCase()} operation failed.`));
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        const output = stdout.trim();
        if (exitCode !== 0 || outputTooLarge || !output) {
          reject(new Error(`DPAPI ${mode.toLowerCase()} operation failed.`));
          return;
        }
        resolve(output);
      });
      child.stdin.end(input);
    });
  }
}
