import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { FLAGS } from '../config/flags.js';

interface State { count: number; resetAt: number }

/**
 * Per-server rate limiter factory for test isolation.
 * Each server instance gets its own isolated state.
 * 
 * Supports both new FLAGS and legacy RATE_LIMIT_RPM env var.
 */
export function makeRateLimiter() {
  const store = new Map<string, State>();
  
  return function rateLimiter(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
    // Check if rate limiting is disabled
    if (process.env.RATE_LIMIT_ENABLED === '0') {
      return done();
    }

    const now = Date.now();
    
    // Support legacy RATE_LIMIT_RPM (requests per minute) or new FLAGS
    const legacyRpm = Number(process.env.RATE_LIMIT_RPM);
    const max = legacyRpm > 0 ? legacyRpm : FLAGS.RATE_LIMIT_MAX;
    const windowMs = legacyRpm > 0 ? 60_000 : FLAGS.RATE_LIMIT_WINDOW_MS;

    // Normalize IPv6 addresses for consistent bucketing
    let ip = req.ip ?? 'local';
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
      ip = '127.0.0.1'; // Normalize loopback
    }

    let rec = store.get(ip);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      store.set(ip, rec);
    }
    rec.count++;

    const remaining = Math.max(0, max - rec.count);
    const resetUnix = Math.ceil(rec.resetAt / 1000);
    const retryAfter = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));

    // Always set rate limit headers
    reply.header('X-RateLimit-Limit', String(max));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header('X-RateLimit-Reset', String(resetUnix));

    if (rec.count > max) {
      reply.header('Retry-After', String(retryAfter));
      reply.header('X-RateLimit-Reason', 'per_ip');
      reply.code(429).send({ error: 'rate_limited' });
      return;
    }
    
    done();
  };
}
