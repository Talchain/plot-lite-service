import { FastifyRequest, FastifyReply } from 'fastify';

interface State { count: number; resetAt: number }
const perIp: Map<string, State> = new Map();
const LIMIT = Number(process.env.RATE_LIMIT_RPM || process.env.RATE_LIMIT_PER_MIN || 60);

// Track 429s per-minute to expose last5m_429 in /health
const perMinute429: Map<number, number> = new Map();
function record429(now: number) {
  const minute = Math.floor(now / 60000);
  perMinute429.set(minute, (perMinute429.get(minute) || 0) + 1);
  // prune older than 10 minutes just to be safe
  const cutoff = minute - 10;
  for (const m of perMinute429.keys()) {
    if (m < cutoff) perMinute429.delete(m);
  }
}
function last5m429(now: number): number {
  const minute = Math.floor(now / 60000);
  let sum = 0;
  for (let m = minute - 4; m <= minute; m++) sum += perMinute429.get(m) || 0;
  return sum;
}

export async function rateLimit(req: FastifyRequest, reply: FastifyReply) {
  const ENABLED = process.env.RATE_LIMIT_ENABLED !== '0';
  if (!ENABLED) return; // disabled

  // Exempt basic health/readiness endpoints from rate limiting
  const url = (req as any).url || '';
  if (req.method === 'GET' && (url.startsWith('/health') || url.startsWith('/ready') || url.startsWith('/live') || url.startsWith('/version') || url.startsWith('/ops/snapshot'))) {
    return;
  }

  const ip = req.ip || 'unknown';
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const key = `${ip}:${minute}`;
  let s = perIp.get(key);
  if (!s) {
    s = { count: 1, resetAt: (minute + 1) * 60000 };
    perIp.set(key, s);
    // set 2xx rate-limit headers for allowed request
    reply.header('X-RateLimit-Limit', String(LIMIT));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, LIMIT - s.count)));
    return;
  }
  s.count += 1;
  if (s.count > LIMIT) {
    const retryMs = Math.max(1, s.resetAt - now);
    const retrySec = Math.ceil(retryMs / 1000);
    const resetEpoch = Math.ceil(s.resetAt / 1000);
    reply.header('Retry-After', retrySec);
    reply.header('X-RateLimit-Reset', String(resetEpoch));
    record429(now);
    const { errorResponse } = await import('./errors.js');
    return reply.code(429).send(errorResponse('RATE_LIMIT', 'Rate limit exceeded for this client.', `Please retry after ${retrySec} seconds`));
  }
  // set 2xx rate-limit headers for allowed request
  reply.header('X-RateLimit-Limit', String(LIMIT));
  reply.header('X-RateLimit-Remaining', String(Math.max(0, LIMIT - s.count)));
}

export function rateLimitState() {
  const enabled = process.env.RATE_LIMIT_ENABLED !== '0';
  const now = Date.now();
  return {
    enabled,
    rpm: LIMIT,
    last5m_429: last5m429(now),
  };
}
