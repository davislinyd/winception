import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ValidationError } from '../../domain/src/errors.js';
import type { SecretProtector } from '../../domain/src/ports.js';
import { writeJsonAtomic } from './atomicFile.js';
import type { WinceptionDatabase } from './database.js';

const SECRET_KEYS = ['windowsUsername', 'windowsPassword', 'pxeinstallPassword'] as const;
export type DeploymentSecretName = typeof SECRET_KEYS[number];
export type DeploymentSecretValues = Record<DeploymentSecretName, string>;

export class DeploymentSecretStore {
  readonly #database: WinceptionDatabase;
  readonly #protector: SecretProtector;
  readonly materializedPath: string;
  #active = false;

  constructor(options: { database: WinceptionDatabase; protector: SecretProtector; materializedPath: string }) {
    this.#database = options.database;
    this.#protector = options.protector;
    this.materializedPath = resolve(options.materializedPath);
  }

  async save(values: DeploymentSecretValues): Promise<void> {
    const protectedValues = new Map<DeploymentSecretName, string>();
    for (const name of SECRET_KEYS) {
      const value = values[name];
      if (typeof value !== 'string' || value.length === 0) throw new ValidationError('All deployment secrets are required.');
      protectedValues.set(name, await this.#protector.protect(name, value));
    }
    this.#database.transaction(() => {
      for (const [name, ciphertext] of protectedValues) this.#database.setProtectedSecret(name, ciphertext);
    });
  }

  status(): {
    ready: boolean;
    missing: DeploymentSecretName[];
    status: Record<DeploymentSecretName, { present: boolean; source: 'dpapi' | 'missing' }>;
    filePath: string;
    fileExists: false;
    fileError: null;
    windowsUsername: null;
  } {
    const status = Object.fromEntries(SECRET_KEYS.map((name) => {
      const present = Boolean(this.#database.getProtectedSecret(name));
      return [name, { present, source: present ? 'dpapi' as const : 'missing' as const }];
    })) as Record<DeploymentSecretName, { present: boolean; source: 'dpapi' | 'missing' }>;
    const missing = SECRET_KEYS.filter((name) => !status[name].present);
    return { ready: missing.length === 0, missing, status, filePath: this.materializedPath, fileExists: false, fileError: null, windowsUsername: null };
  }

  async withMaterialized<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.#active) throw new Error('Deployment secrets are already materialized by another operation.');
    const values = await this.#unprotectAll();
    this.#active = true;
    try {
      mkdirSync(dirname(this.materializedPath), { recursive: true });
      writeJsonAtomic(this.materializedPath, values);
      return await action();
    }
    finally {
      scrubFile(this.materializedPath);
      this.#active = false;
    }
  }

  async read(): Promise<DeploymentSecretValues> { return this.#unprotectAll(); }

  clearMaterialized(): void { scrubFile(this.materializedPath); }

  async #unprotectAll(): Promise<DeploymentSecretValues> {
    const values = {} as DeploymentSecretValues;
    const missing: DeploymentSecretName[] = [];
    for (const name of SECRET_KEYS) {
      const ciphertext = this.#database.getProtectedSecret(name);
      if (!ciphertext) { missing.push(name); continue; }
      values[name] = await this.#protector.unprotect(name, ciphertext);
    }
    if (missing.length > 0) {
      throw new ValidationError('Deployment secrets are not configured.', 'Save all deployment credentials before running this operation.');
    }
    return values;
  }
}

function scrubFile(path: string): void {
  if (!existsSync(path)) return;
  const size = statSync(path).size;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, 'r+');
    if (size > 0) writeSync(descriptor, Buffer.alloc(size), 0, size, 0);
    fsyncSync(descriptor);
  }
  finally {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(path, { force: true });
  }
}
