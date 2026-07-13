import { join, resolve } from 'node:path';
import { WinceptionDatabase } from '../../../packages/infrastructure/src/database.js';
import { DpapiSecretProtector } from '../../../packages/infrastructure/src/dpapi.js';
import { importV1State } from '../../../packages/infrastructure/src/v1Importer.js';

interface Arguments {
  appRoot: string;
  stateRoot: string;
  backupRoot: string;
  databasePath: string;
  protectorScript: string;
  v2StateRoot: string;
  dryRun: boolean;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const database = new WinceptionDatabase(args.databasePath);
  try {
    const report = await importV1State({
      appRoot: args.appRoot,
      stateRoot: args.stateRoot,
      backupRoot: args.backupRoot,
      database,
      secretProtector: new DpapiSecretProtector(args.protectorScript),
      targetAssetRoot: join(args.v2StateRoot, 'legacy'),
      ...(args.dryRun ? { dryRun: true } : {}),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  finally {
    database.close();
  }
}

function parseArguments(values: string[]): Arguments {
  const parsed = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (name === '--dry-run') { dryRun = true; continue; }
    const value = values[index + 1];
    if (!name?.startsWith('--') || !value || value.startsWith('--')) throw new Error('Migration arguments are invalid.');
    parsed.set(name, value);
    index += 1;
  }
  const appRoot = requiredPath(parsed, '--app-root');
  const stateRoot = requiredPath(parsed, '--state-root');
  const v2StateRoot = requiredPath(parsed, '--v2-state-root');
  return {
    appRoot,
    stateRoot,
    backupRoot: resolve(parsed.get('--backup-root') ?? join(v2StateRoot, 'migration-backups')),
    databasePath: resolve(parsed.get('--database') ?? join(v2StateRoot, 'winception-v2.db')),
    protectorScript: resolve(parsed.get('--protector-script') ?? join(process.cwd(), 'tools', 'v2', 'Protect-WinceptionSecret.ps1')),
    v2StateRoot,
    dryRun,
  };
}

function requiredPath(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return resolve(value);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'v1 migration failed.'}\n`);
  process.exitCode = 1;
});
