import path from 'node:path';
import { loadConfig } from '../config.js';
import { ServiceController } from '../controller/index.js';

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  config.paths ??= {};
  if (args['app-root']) {
    config.paths.appRoot = path.resolve(args['app-root']);
  }
  if (args['state-root']) {
    config.paths.stateRoot = path.resolve(args['state-root']);
  }
  const controller = new ServiceController({ config });
  try {
    const result = await controller.performDiagnostics({
      scope: args.scope ?? 'host',
      runId: args['run-id'],
      trigger: args.trigger ?? 'manual',
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      summary: result.summary,
      bundleName: result.bundleName,
      bundlePath: result.bundlePath,
    }, null, 2)}\n`);
  } finally {
    await controller.shutdown();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
