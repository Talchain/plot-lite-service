import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { ERR_MSG } from '../lib/error-messages.js';
import { FLAGS } from '../config/flags.js';
import { getRateLimitRpm } from '../config/runtimeConfig.js';

interface State { count: number; resetAt: number }

const SWEEP_INTERVAL_MS = Number(process.env.RATE_LIMIT_SWEEP_INTERVAL_MS) || 1000;
const SWEEP_MAX_DELETE = Number(process.env.RATE_LIMIT_SWEEP_MAX_DELETE) || 1000;
const MAX_BUCKETS = Number(process.env.RATE_LIMIT_MAX_BUCKETS) || 100000;

// Precedence: ENV.RATE_LIMIT_RPM > runtimeConfig > FLAGS.RATE_LIMIT_RPM
function getEffectiveRpm(): number {
  const env = process.env.RATE_LIMIT_RPM;
  if (env !== undefined && env !== '') {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 0) return n; // 0 disables
  }
  try {
    const rc = getRateLimitRpm();
    if (Number.isFinite(rc) && rc > 0) return rc;
  } catch {}
  return FLAGS.RATE_LIMIT_RPM;
}

export function makeRateLimiter() {
  const store = new Map<string, State>();
  let lastSweep = 0;
  
  return function rateLimiter(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
    // Global disable
    if (process.env.RATE_LIMIT_ENABLED === '0') return done();
    
    const rpm = getEffectiveRpm();
    if (rpm === 0) return done();
    
    // Route bypasses (do not consume RPM)
    const url = req.url || '';
    if (
      url.startsWith('/v1/health') ||
      url.startsWith('/health') ||
      url.startsWith('/metrics') ||
      url.startsWith('/v1/limits')
    ) {
      return done();
    }

    const now = Date.now();
    const windowMs = 60_000;
    
    // Periodic pruning
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = now;
      let removed = 0;
      for (const [k, v] of store) {
        if (now > v.resetAt) {
          store.delete(k);
          removed++;
        }
        if (removed >= SWEEP_MAX_DELETE) break;
      }
    }

    let ip = req.ip ?? 'local';
    if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1';

    let rec = store.get(ip);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      store.set(ip, rec);
    }
    
    // Check idempotent replay (set by preHandler in /v1/run)
    const isReplay = (req as any).__idempotent_replay === true;
    
    if (!isReplay) {
      rec.count++;
    }

    // Enforce MAX_BUCKETS cap
    if (store.size > MAX_BUCKETS) {
      let removed = 0;
      for (const [k, v] of store) {
        if (now > v.resetAt) {
          store.delete(k);
          removed++;
        }
        if (removed >= SWEEP_MAX_DELETE) break;
      }
    }

    const remaining = Math.max(0, rpm - rec.count);
    const resetUnix = Math.floor(rec.resetAt / 1000);
    
    // Always set rate-limit headers on all JSON routes
    reply.header('X-RateLimit-Limit', String(rpm));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header('X-RateLimit-Reset', String(resetUnix));

    if (rec.count > rpm) {
      const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
      reply.header('Retry-After', String(retryAfter));
      reply.header('X-RateLimit-Reason', 'per_ip');
      
      const app = (req as any).server;
      if (app?.health) {
        const isSSE = req.headers.accept?.includes('text/event-stream');
        if (isSSE) app.health.sse_429_count++;
        else app.health.json_429_count++;
      }
      
      return reply.code(429).send({
        error: { type: 'RATE_LIMIT', message: ERR_MSG.RATE_LIMIT_RPM }
      });
    }
    
    done();
  };
}

export function makeRateLimiterTestOnly() {
  const store = new Map<string, State>();
  let lastSweep = 0;
  
  return function rateLimiter(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
    if (process.env.RATE_LIMIT_ENABLED === '0') return done();
    const rpm = getEffectiveRpm();
    if (rpm === 0) return done();
    const url = req.url || '';
    if (url.startsWith('/v1/health') || url.startsWith('/health') || 
        url.startsWith('/metrics') || url.startsWith('/v1/limits')) return done();
    
    const now = Date.now();
    const windowMs = 60_000;
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = now;
      let removed = 0;
      for (const [k, v] of store) {
        if (now > v.resetAt) { store.delete(k); removed++; }
        if (removed >= SWEEP_MAX_DELETE) break;
      }
    }
    
    let ip = req.ip ?? 'local';
    if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1';
    let rec = store.get(ip);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      store.set(ip, rec);
    }
    
    const isReplay = (req as any).__idempotent_replay === true;
    if (!isReplay) rec.count++;
    
    if (store.size > MAX_BUCKETS) {
      let removed = 0;
      for (const [k, v] of store) {
        if (now > v.resetAt) { store.delete(k); removed++; }
        if (removed >= SWEEP_MAX_DELETE) break;
      }
    }
    
    const remaining = Math.max(0, rpm - rec.count);
    const resetUnix = Math.floor(rec.resetAt / 1000);
    reply.header('X-RateLimit-Limit', String(rpm));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header('X-RateLimit-Reset', String(resetUnix));
    
    if (rec.count > rpm) {
      const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
      reply.header('Retry-After', String(retryAfter));
      reply.header('X-RateLimit-Reason', 'per_ip');
      return reply.code(429).send({ error: { type: 'RATE_LIMIT', message: ERR_MSG.RATE_LIMIT_RPM } });
    }
    
    done();
  };
}

// Test-only: expose store for pruning tests
export function makeRateLimiterWithStoreAccess() {
  const store = new Map<string, State>();
  let lastSweep = 0;
  
  const limiter = function(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
    if (process.env.RATE_LIMIT_ENABLED === '0') return done();
    const rpm = getEffectiveRpm();
    if (rpm === 0) return done();
    const url = req.url || '';
    if (url.startsWith('/v1/health') || url.startsWith('/health') || 
        url.startsWith('/metrics') || url.startsWith('/v1/limits')) return done();
    
    const now = Date.now();
    const windowMs = 60_000;
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = now;
      let removed = 0;
      for (const [k, v] of store) {
        if (now > v.resetAt) { store.delete(k); removed++; }
        if (removed >= SWEEP_MAX_DELETE) break;
      }
    }
    
    let ip = req.ip ?? 'local';
    if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1';
    let rec = store.get(ip);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      store.set(ip, rec);
    }
    
    const isReplay = (req as any).__idempotent_replay === true;
    if (!isReplay) rec.count++;
    
    if (store.size > MAX_BUCKETS) {
      let removed = 0;
      for (const [k, v] of store) {
        if (now > v.resetAt) { store.delete(k); removed++; }
        if (removed >= SWEEP_MAX_DELETE) break;
      }
    }
    
    const remaining = Math.max(0, rpm - rec.count);
    const resetUnix = Math.floor(rec.resetAt / 1000);
    reply.header('X-RateLimit-Limit', String(rpm));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header('X-RateLimit-Reset', String(resetUnix));
    
    if (rec.count > rpm) {
      const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
      reply.header('Retry-After', String(retryAfter));
      reply.header('X-RateLimit-Reason', 'per_ip');
      return reply.code(429).send({ error: { type: 'RATE_LIMIT', message: ERR_MSG.RATE_LIMIT_RPM } });
    }
    
    done();
  };
  
  return { limiter, getStore: () => store };
}
