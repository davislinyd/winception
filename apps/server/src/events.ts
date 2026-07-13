import { randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { Value } from '@sinclair/typebox/value';
import {
  CONTRACT_VERSION,
  JsonValueSchema,
  type ServerEvent,
} from '../../../packages/contracts/src/index.js';

export class ServerEventHub {
  readonly #clients = new Set<FastifyReply>();

  add(reply: FastifyReply): void {
    this.#clients.add(reply);
    reply.raw.on('close', () => this.#clients.delete(reply));
  }

  publish(type: ServerEvent['type'], data: unknown): void {
    if (!Value.Check(JsonValueSchema, data)) throw new TypeError('Server event data must be valid JSON.');
    const event: ServerEvent = {
      version: CONTRACT_VERSION,
      id: randomUUID(),
      type,
      at: new Date().toISOString(),
      data,
    };
    const payload = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.#clients) client.raw.write(payload);
  }

  heartbeat(): void {
    this.publish('heartbeat', {});
  }
}
