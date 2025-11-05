import { FLAGS } from '../config/flags.js';

export function makeRateLimiter() {
  const store = new Map<string, { count: number; resetAt: number }>();
  
  return function rateLimiter(req: any, reply: any, next: any) {
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

    reply.header('X-RateLimit-Limit', String(max));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, max - rec.count)));
    reply.header('X-RateLimit-Reset', String(Math.ceil(rec.resetAt / 1000)));

    if (rec.count > max) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
    next();
  };
}
