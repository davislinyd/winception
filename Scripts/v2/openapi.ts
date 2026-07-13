import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UploadStore } from '../../packages/infrastructure/src/uploadStore.js';
import { createWebApp } from '../../apps/server/src/app.js';
import type { AgentClientPort } from '../../apps/server/src/ports.js';

const output = resolve('packages/contracts/openapi.v2.json');
const staging = mkdtempSync(resolve('.tmp-openapi-'));
const agent: AgentClientPort = { request: <T>(): Promise<T> => Promise.resolve({} as T) };
const app = await createWebApp({
  agent,
  managementToken: 'openapi-generation-token-000000000000000000000000',
  secureCookie: false,
  staticRoot: join(staging, 'missing-web-root'),
  uploadStore: new UploadStore(join(staging, 'uploads')),
});
try {
  await app.ready();
  const content = `${JSON.stringify(app.swagger(), null, 2)}\n`;
  if (process.argv.includes('--write')) {
    writeFileSync(output, content, 'utf8');
  }
  else if (process.argv.includes('--check')) {
    if (!existsSync(output) || readFileSync(output, 'utf8') !== content) throw new Error('OpenAPI contract drifted. Run npm run v2:openapi:write and review the contract change.');
  }
  else throw new Error('Use --write or --check.');
}
finally {
  await app.close();
  rmSync(staging, { recursive: true, force: true });
}
