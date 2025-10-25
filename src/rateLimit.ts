import { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { replyWithAppError } from './errors.js';
import { incJson429Count } from './metrics.js';
import { getRateLimitRpm } from './config/runtimeConfig.js';
import { MAX_RATE_KEYS } from './config/constants.js';

interface State { count: number; windowMinute: number; resetAt: number }
const perKey: Map<string, State> = new Map();
function LIMIT() { return Number(getRateLimitRpm()); }

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

// Prune entries outside the current window and enforce capacity
function bound(): number {
  const env = Number(process.env.MAX_RATE_KEYS || '');
  return Number.isFinite(env) && env > 0 ? env : MAX_RATE_KEYS;
}

function pruneAndEnforceCapacity(now: number) {
  const currentMinute = Math.floor(now / 60000);
  // Remove windows older than previous minute
  for (const [k, s] of perKey) {
    if (s.windowMinute < currentMinute - 1) perKey.delete(k);
  }
  // Enforce capacity only if over bound
  const cap = bound();
  if (perKey.size > cap) {
    const excess = perKey.size - cap;
    // Evict by oldest resetAt (oldest windows first)
    const arr = Array.from(perKey.entries());
    arr.sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (let i = 0; i < excess; i++) {
      const [k] = arr[i];
      perKey.delete(k);
    }
  }
}

// Periodic cleanup to prevent memory leak (runs every 10s for faster response); unref'd
setInterval(() => { try { pruneAndEnforceCapacity(Date.now()); } catch {} }, 10000).unref();

export async function rateLimit(req: FastifyRequest, reply: FastifyReply) {
  // Opportunistic pruning (1% of requests to avoid overhead)
  if (Math.random() < 0.01) {
    pruneAndEnforceCapacity(Date.now());
  }
  const ENABLED = process.env.RATE_LIMIT_ENABLED !== '0';
  if (!ENABLED) return; // disabled

  // Emergency brake: if key map exceeds 2× capacity, reject immediately
  const cap = bound();
  if (perKey.size > 2 * cap) {
    try { incJson429Count(); } catch {}
    reply.header('X-RateLimit-Reason', 'global');
    reply.header('Retry-After', '10');
    return reply.code(429).send({
      error: { type: 'RATE_LIMITED', message: 'System under heavy load', hint: 'Please retry after 10 seconds' }
    });
  }

  // Exempt basic health/readiness endpoints from rate limiting
  const url = (req as any).url || '';
  if (req.method === 'GET' && (url.startsWith('/health') || url.startsWith('/v1/health') || url.startsWith('/ready') || url.startsWith('/live') || url.startsWith('/version') || url.startsWith('/v1/version') || url.startsWith('/ops/snapshot'))) {
    return;
  }
  
  // Exempt /v1/stream - it has its own slot-based rate limiting
  if (req.method === 'GET' && url.startsWith('/v1/stream')) {
    return;
  // Exempt /v1/run/stream - SSE has slot-based limiter
  if (req.method === 'POST' && url.startsWith('/v1/run/stream')) {
    return;
  }
  }

  // Normalize IPv6/loopback variants for stable bucketing
  const { canonicalizeRemote } = await import('./lib/net.js');
  const ip = canonicalizeRemote(req.ip as any);
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const methodRaw = String(req.method || 'GET').toUpperCase();
  // Treat HEAD like GET for bucketization to avoid behavior drift
  const method = methodRaw === 'HEAD' ? 'GET' : methodRaw;
  // Bucketize by method + top-level route (e.g., POST:/v1/run)
  const pathOnly = String(url || '').split('?')[0];
  const segs = pathOnly.split('/').filter(Boolean);
  const bucketPath = (segs.length >= 2 && segs[0] === 'v1') ? `/v1/${segs[1]}` : (pathOnly || '/');
  // IPv6-safe: hash the IP to a fixed short token
  const ipHash = createHash('sha1').update(String(ip)).digest('hex').slice(0, 12);
  const key = `${ipHash}:${method}:${bucketPath}`;
  const lim = LIMIT();

  // Idempotency replay: do not count RPM for POST /v1/run replays
  try {
    const path = String(url || '').split('?')[0];
    if (method === 'POST' && path.startsWith('/v1/run')) {
      const idk = String(((req.headers as any)['idempotency-key'] || (req.headers as any)['Idempotency-Key']) || '').trim();
      if (idk) {
        const { principalFor, getCached } = await import('./middleware/idempotency.js');
        const principal = principalFor(req as any);
        const hit = getCached(principal, idk);
        if (hit) {
          const curr = perKey.get(key);
          reply.header('X-RateLimit-Limit', String(lim));
          reply.header('X-RateLimit-Remaining', String(Math.max(0, lim - (curr?.count || 0))));
          return; // allow without incrementing count
        }
      }
    }
  } catch {}

  let s = perKey.get(key);
  if (!s || s.windowMinute !== minute) {
    s = { count: 0, windowMinute: minute, resetAt: (minute + 1) * 60000 };
    perKey.set(key, s);
    pruneAndEnforceCapacity(now);
  }
  s.count += 1;
  if (s.count > lim) {
    const retryMs = Math.max(1, s.resetAt - now);
    const retrySec = Math.ceil(retryMs / 1000);
    const resetEpoch = Math.ceil(s.resetAt / 1000);
    reply.header('Retry-After', retrySec);
    reply.header('X-RateLimit-Reset', String(resetEpoch));
    reply.header('X-RateLimit-Reason', 'per_ip');
    record429(now);
    try { incJson429Count(); } catch {}
    return replyWithAppError(reply, { type: 'RATE_LIMIT', statusCode: 429, hint: `Please retry after ${retrySec} seconds` });
  }
  // set 2xx rate-limit headers for allowed request
  reply.header('X-RateLimit-Limit', String(lim));
  reply.header('X-RateLimit-Remaining', String(Math.max(0, lim - s.count)));
}

export function rateLimitState() {
  const enabled = process.env.RATE_LIMIT_ENABLED !== '0';
  const now = Date.now();
  return {
    enabled,
    rpm: LIMIT(),
    last5m_429: last5m429(now),
  };
}

// Test-only helper
export function __rateLimitKeyCount(): number {
  return perKey.size;
}

// Test-only reset for isolation
export function __rateLimitReset(): void {
  if (process.env.NODE_ENV !== 'test') return;
  perKey.clear();
  perMinute429.clear();
}

// Test-only: compute bucket key and return current count for a given ip/method/url
export function __rateLimitBucketCount(ip: string, method: string, url: string): number {
  try {
    const methodRaw = String(method || 'GET').toUpperCase();
    const m = methodRaw === 'HEAD' ? 'GET' : methodRaw;
    const pathOnly = String(url || '').split('?')[0];
    const segs = pathOnly.split('/').filter(Boolean);
    const bucketPath = (segs.length >= 2 && segs[0] === 'v1') ? `/v1/${segs[1]}` : (pathOnly || '/');
    const ipStr = String(ip || 'unknown');
    const norm = ipStr === '::1' ? '127.0.0.1' : (ipStr.startsWith('::ffff:') ? ipStr.slice(7) : ipStr);
    const ipHash = createHash('sha1').update(norm).digest('hex').slice(0, 12);
    const key = `${ipHash}:${m}:${bucketPath}`;
    const state = perKey.get(key);
    return state ? state.count : 0;
  } catch {
    return -1;
  }
}