/**
 * Fastify module augmentation for custom decorators
 */

import 'fastify';
import type { FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    inflight: {
      inc(): number;
      dec(source?: string): number;
      count(): number;
      stats(): { count: number; underflows: number };
    };
    decrementInflightOnce(reply: FastifyReply, source: string): void;
  }
}
