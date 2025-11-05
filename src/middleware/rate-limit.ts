import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { FLAGS } from '../config/flags.js';

export function makeRateLimiter() {
  const store = new Map<string, { count: number; resetAt: number }>();
  
  return function rateLimiter(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
    const now = Date.now();
    const windowMs = FLAGS.RATE_LIMIT_WINDOW_MS;
    const max = FLAGS.RATE_LIMIT_MAX;

    const key = req.ip ?? 'local';
    let rec = store.get(key);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
    }
    rec.count++;
    store.set(key, rec);

    const remaining = Math.max(0, max - rec.count);
    const resetUnix = Math.ceil(rec.resetAt / 1000);

    reply.header('X-RateLimit-Limit', String(max));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header('X-RateLimit-Reset', String(resetUnix));

    if (rec.count > max) {
      const retryAfter = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));
      reply.header('Retry-After', String(retryAfter));
      reply.header('X-RateLimit-Reason', 'exceeded');
      reply.code(429).send({ error: 'rate_limited' });
      return;
    }
    done();
  };
}
