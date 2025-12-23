/**
 * Early idempotency marker - runs before rate limiter
 * Marks requests as in-flight so rate limiter can detect replays
 */
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { principalFor, markInflight, isInflightOrCached } from './idempotency.js';
import { isCanonicalKeyKnown } from './idempotency-canonical.js';

export function makeIdempotencyMarker() {
  return function idempotencyMarker(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
    try {
      const idkHeader = (req.headers as any)['idempotency-key'] || (req.headers as any)['Idempotency-Key'];
      if (!idkHeader || typeof idkHeader !== 'string' || !idkHeader.trim()) {
        return done();
      }

      const idk = idkHeader.trim();
      const principal = principalFor(req);

      // Check route for canonical cache (POST /v1/run uses canonical)
      const url = req.url || '';
      const isCanonicalRoute = url.startsWith('/v1/run');

      // Check if this is a replay (already in cache or in-flight)
      // For /v1/run, also check canonical cache
      const legacyHit = isInflightOrCached(principal, idk);
      const canonicalHit = isCanonicalRoute && isCanonicalKeyKnown('/v1/run', principal, idk);

      if (legacyHit || canonicalHit) {
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
