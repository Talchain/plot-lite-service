/**
 * Early idempotency marker - runs before rate limiter
 * Marks requests as in-flight so rate limiter can detect replays
 */
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { principalFor, markInflight, isInflightOrCached } from './idempotency.js';

export function makeIdempotencyMarker() {
  return function idempotencyMarker(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
    try {
      const idkHeader = (req.headers as any)['idempotency-key'] || (req.headers as any)['Idempotency-Key'];
      if (!idkHeader || typeof idkHeader !== 'string' || !idkHeader.trim()) {
        return done();
      }
      
      const idk = idkHeader.trim();
      const principal = principalFor(req);
      
      // Check if this is a replay (already in cache or in-flight)
      if (isInflightOrCached(principal, idk)) {
        (req as any).__idempotent_replay = true;
      } else {
        // Mark as in-flight for new requests
        markInflight(principal, idk);
        (req as any).__idempotent_replay = false;
      }
    } catch { /* ignore */ }
    done();
  };
}
