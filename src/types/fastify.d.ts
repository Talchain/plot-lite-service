/**
 * Fastify module augmentation for custom decorators
 */

import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    inflight: {
      inc(): number;
      dec(source?: 'onRequest' | 'onResponse' | 'endStream' | 'error'): number;
      count(): number;
      stats(): { count: number; underflows: number };
    };
  }
}
