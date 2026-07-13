import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentPipeClient, DEFAULT_AGENT_PIPE } from '../../../packages/infrastructure/src/ipc.js';
import { UploadStore } from '../../../packages/infrastructure/src/uploadStore.js';
import { loadServiceSettings } from '../../../packages/infrastructure/src/serviceSettings.js';
import { validateWindowsCertificateStore } from '../../../packages/infrastructure/src/tlsCertificate.js';
import { createWebApp } from './app.js';

async function main(): Promise<void> {
  const installed = process.env.WINCEPTION_MANAGEMENT_TOKEN ? undefined : await loadServiceSettings();
  const host = process.env.WINCEPTION_MANAGEMENT_HOST ?? installed?.managementHost ?? '127.0.0.1';
  const port = parsePort(process.env.WINCEPTION_MANAGEMENT_PORT ?? String(installed?.managementPort ?? 8080));
  const loopback = isLoopback(host);
  const managementToken = process.env.WINCEPTION_MANAGEMENT_TOKEN ?? installed?.managementToken ?? '';
  const agentToken = process.env.WINCEPTION_AGENT_TOKEN ?? installed?.agentToken ?? '';
  if (managementToken.length < 32 || agentToken.length < 32) throw new Error('Installer-provisioned management and Agent tokens are required.');
  if (!loopback && installed?.tls) {
    await validateWindowsCertificateStore(join(installed.appRoot, 'tools', 'v2', 'Test-WinceptionTlsCertificate.ps1'), installed.tls.thumbprint, host);
  }
  const tls = loopback ? undefined : readTlsOptions(installed?.tls);
  const agent = new AgentPipeClient({ endpoint: process.env.WINCEPTION_AGENT_PIPE ?? installed?.agentPipe ?? DEFAULT_AGENT_PIPE, authToken: agentToken });
  const stateRoot = resolve(process.env.WINCEPTION_STATE_ROOT ?? installed?.stateRoot ?? join(process.env.ProgramData ?? 'C:\\ProgramData', 'Winception', 'State'));
  const uploadStore = new UploadStore(join(stateRoot, 'staging'));
  uploadStore.prune();
  const app = await createWebApp({
    agent,
    managementToken,
    secureCookie: !loopback,
    logger: true,
    staticRoot: resolve(process.env.WINCEPTION_WEB_ROOT ?? join(installed?.appRoot ?? process.cwd(), 'dist', 'v2', 'web')),
    uploadStore,
    ...(tls ? { tls } : {}),
  });
  await app.listen({ host, port });
}

function readTlsOptions(installed?: { pfxPath: string; pfxPassword: string; notAfter: string }): { pfx: Buffer; passphrase: string } {
  if (!installed || Date.parse(installed.notAfter) <= Date.now()) throw new Error('LAN management requires a valid installer-provisioned HTTPS certificate.');
  return { pfx: readFileSync(installed.pfxPath), passphrase: installed.pfxPassword };
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WINCEPTION_MANAGEMENT_PORT is invalid.');
  return port;
}

function isLoopback(host: string): boolean {
  const value = host.trim().toLowerCase();
  return value === 'localhost' || value === '::1' || value.startsWith('127.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Winception Web failed to start.');
  process.exitCode = 1;
});
