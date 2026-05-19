import { loadConfig } from './config.js';
import { runPreflight } from './windows.js';

function parseArgs(argv) {
  const result = { configPath: undefined, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      result.json = true;
    } else if (arg === '--config') {
      index += 1;
      if (!argv[index]) {
        throw new Error('--config requires a path');
      }
      result.configPath = argv[index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function formatCheck(check) {
  const status = check.ok ? 'PASS' : 'FAIL';
  const detail = check.detail ? ` - ${check.detail}` : '';
  return `[${status}] ${check.name}${detail}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig(options.configPath);
  const checks = await runPreflight(config, {});
  const failures = checks.filter((check) => !check.ok);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, checks }, null, 2)}\n`);
  } else {
    for (const check of checks) {
      process.stdout.write(`${formatCheck(check)}\n`);
    }
    process.stdout.write(`Preflight ${failures.length === 0 ? 'passed' : `failed: ${failures.length} failure(s)`}\n`);
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
