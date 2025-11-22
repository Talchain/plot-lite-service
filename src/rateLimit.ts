import { FastifyRequest, FastifyReply } from 'fastify';
import { incJson429Count } from './metrics.js';
import { ERR_MSG } from './lib/error-messages.js';

interface State { count: number; resetAt: number }
const perIp: Map<string, State> = new Map();

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

function getLimit(): number {
  const envRpm = process.env.RATE_LIMIT_RPM || process.env.RATE_LIMIT_PER_MIN;
  const n = Number(envRpm);
  if (Number.isFinite(n)) return n;
  return 60;
}

export async function rateLimit(req: FastifyRequest, reply: FastifyReply) {
  const ENABLED = process.env.RATE_LIMIT_ENABLED !== '0';
  if (!ENABLED) return; // disabled

  const LIMIT = getLimit();
  if (LIMIT <= 0) return; // rpm<=0 disables limiter

  // Exempt basic health/readiness + test probe/SSE endpoints from this coarse limiter
  const url = (req as any).url || '';
  if (
    req.method === 'GET' && (
      url.startsWith('/health') ||
      url.startsWith('/v1/health') ||
      url.startsWith('/ready') ||
      url.startsWith('/live') ||
      url.startsWith('/version') ||
      url.startsWith('/ops/snapshot') ||
      url.startsWith('/metrics') ||
      url.startsWith('/test/inflight') ||
      url.startsWith('/stream') ||
      url.startsWith('/demo/stream')
    )
  ) {
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
    reply.header('X-RateLimit-Reset', String(Math.floor(s.resetAt / 1000)));
    return;
  }
  s.count += 1;
  if (s.count > LIMIT) {
    const retryMs = Math.max(1, s.resetAt - now);
    reply.header('Retry-After', Math.ceil(retryMs / 1000));
    reply.header('X-RateLimit-Limit', String(LIMIT));
    reply.header('X-RateLimit-Remaining', '0');
    reply.header('X-RateLimit-Reset', String(Math.floor(s.resetAt / 1000)));
    try { incJson429Count(); } catch {}
    record429(now);
    return reply.code(429).send({ error: { type: 'RATE_LIMIT', message: ERR_MSG.RATE_LIMIT_RPM } });
  }
  // set 2xx rate-limit headers for allowed request
  reply.header('X-RateLimit-Limit', String(LIMIT));
  reply.header('X-RateLimit-Remaining', String(Math.max(0, LIMIT - s.count)));
  reply.header('X-RateLimit-Reset', String(Math.floor(s.resetAt / 1000)));
}

export function rateLimitState() {
  const enabled = process.env.RATE_LIMIT_ENABLED !== '0';
  const now = Date.now();
  const rpm = getLimit();
  return {
    enabled,
    rpm,
    last5m_429: last5m429(now),
  };
}
