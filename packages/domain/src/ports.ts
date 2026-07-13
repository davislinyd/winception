import type { OperationRecord } from '../../contracts/src/index.js';

export interface OperationRepository {
  save(record: OperationRecord): void;
  list(limit?: number): OperationRecord[];
}

export interface Clock {
  now(): Date;
}

export interface SecretProtector {
  protect(name: string, plaintext: string): Promise<string>;
  unprotect(name: string, ciphertext: string): Promise<string>;
}

export const systemClock: Clock = Object.freeze({
  now: () => new Date(),
});
