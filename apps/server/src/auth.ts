import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ValidationError } from '../../../packages/domain/src/errors.js';

const SESSION_COOKIE = 'winception_v2_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

interface Session { expiresAt: number }

export class ManagementAuth {
  readonly #managementTokenHash: Buffer;
  readonly #sessions = new Map<string, Session>();

  constructor(managementToken: string, readonly secureCookie: boolean) {
    if (managementToken.length < 32) throw new Error('Management token must contain at least 32 characters.');
    this.#managementTokenHash = hash(managementToken);
  }

  createSession(token: string): { cookie: string } {
    if (!timingSafeEqual(hash(token), this.#managementTokenHash)) {
      throw new ValidationError('Management authentication failed.', 'Use the local setup code provisioned by the installer.');
    }
    const id = randomBytes(32).toString('base64url');
    this.#sessions.set(id, { expiresAt: Date.now() + SESSION_TTL_MS });
    return {
      cookie: `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${this.secureCookie ? '; Secure' : ''}`,
    };
  }

  deleteSession(request: FastifyRequest): string {
    const id = sessionId(request);
    if (id) this.#sessions.delete(id);
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.secureCookie ? '; Secure' : ''}`;
  }

  isAuthenticated(request: FastifyRequest): boolean {
    const headerToken = request.headers['x-winception-token'];
    if (typeof headerToken === 'string' && timingSafeEqual(hash(headerToken), this.#managementTokenHash)) return true;
    const id = sessionId(request);
    if (!id) return false;
    const session = this.#sessions.get(id);
    if (!session || session.expiresAt <= Date.now()) {
      this.#sessions.delete(id);
      return false;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return true;
  }

  assertRequest(request: FastifyRequest): void {
    const headerAuthenticated = this.isHeaderAuthenticated(request);
    if (!headerAuthenticated && !this.isAuthenticated(request)) {
      const error = new Error('Management authentication is required.') as Error & { code: string; statusCode: number };
      error.code = 'AUTH_REQUIRED';
      error.statusCode = 401;
      throw error;
    }
    if (!headerAuthenticated && request.method !== 'GET' && request.method !== 'HEAD') assertSameOrigin(request);
  }

  prune(): void {
    const now = Date.now();
    for (const [id, session] of this.#sessions) if (session.expiresAt <= now) this.#sessions.delete(id);
  }

  private isHeaderAuthenticated(request: FastifyRequest): boolean {
    const headerToken = request.headers['x-winception-token'];
    return typeof headerToken === 'string' && timingSafeEqual(hash(headerToken), this.#managementTokenHash);
  }
}

function sessionId(request: FastifyRequest): string | null {
  const cookie = request.headers.cookie;
  if (!cookie) return null;
  for (const item of cookie.split(';')) {
    const [name, ...value] = item.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=') || null;
  }
  return null;
}

function assertSameOrigin(request: FastifyRequest): void {
  if (request.headers['x-winception-requested-with'] !== 'web') {
    throw new ValidationError('The mutation request is missing the Winception request header.');
  }
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) throw new ValidationError('The mutation request origin is missing.');
  const parsed = new URL(origin);
  if (parsed.host.toLowerCase() !== host.toLowerCase()) throw new ValidationError('The mutation request origin is not allowed.');
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
