import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { ERR_MSG } from '../lib/error-messages.js';
import { FLAGS } from '../config/flags.js';
import { getRateLimitRpm } from '../config/runtimeConfig.js';
import { incJson429Count, incSse429Count } from '../metrics.js';


interface State { count: number; pending: number; resetAt: number }

const SWEEP_INTERVAL_MS = Number(process.env.RATE_LIMIT_SWEEP_INTERVAL_MS) || 1000;
const SWEEP_MAX_DELETE = Number(process.env.RATE_LIMIT_SWEEP_MAX_DELETE) || 1000;
const MAX_BUCKETS = Number(process.env.RATE_LIMIT_MAX_BUCKETS) || 100000;

// Check if request is an idempotent replay (flag set by idempotency-marker)
function isIdempotentReplay(req: FastifyRequest): boolean {
  return (req as any).__idempotent_replay === true;
}

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
  
  const rateLimiter = function(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
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
      url.startsWith('/v1/limits') ||
      url.includes('/stream')
    ) {
      return done();
    }
    
    // SSE bypass: Accept header includes text/event-stream
    const accept = String(req.headers.accept || '');
    if (accept.includes('text/event-stream')) {
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
      rec = { count: 0, pending: 0, resetAt: now + windowMs };
      store.set(ip, rec);
    }
    
    // Oversize preflight: let 413 beat 429
    const contentLength = Number(req.headers["content-length"] ?? 0);
    const bodyLimit = (req.routeOptions as any)?.bodyLimit ?? (req.server as any).initialConfig?.bodyLimit ?? 1_048_576;
    if (contentLength > bodyLimit) {
      // Skip rate limiting - let body parser return 413
      (req as any).__rate_limit_skip = "oversize";
      const remaining = Math.max(0, rpm - rec.count);
      const resetUnix = Math.floor(rec.resetAt / 1000);
      reply.header("X-RateLimit-Limit", String(rpm));
      reply.header("X-RateLimit-Remaining", String(remaining));
      reply.header("X-RateLimit-Reset", String(resetUnix));
      return done();
    }

    // Check idempotent replay (set by preHandler in /v1/run)
    const isReplay = (req as any).__idempotent_replay === true;
    
    // Check admission BEFORE incrementing pending
    const nextPending = rec.pending + 1;
    const wouldExceed = isReplay ? (rec.count > rpm) : ((rec.count + nextPending) > rpm);
    
    if (!isReplay && !wouldExceed) {
      // Mark for deferred counting in onSend (only count successful responses)
      (req as any).__rl_pending = { rec, ip };
      rec.pending = nextPending;
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

    // Account for pending increment (this request will count if successful)
    const remaining = Math.max(0, rpm - rec.count - rec.pending);
    const resetUnix = Math.floor(rec.resetAt / 1000);
    
    // Always set rate-limit headers on all JSON routes
    reply.header('X-RateLimit-Limit', String(rpm));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header('X-RateLimit-Reset', String(resetUnix));

    if (wouldExceed && !isReplay) {
      const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
      reply.header('Retry-After', String(retryAfter));
      reply.header('X-RateLimit-Reason', 'per_ip');
      
      // Increment 429 counters via metrics helpers
      const wantsSSE = (req.headers.accept || '').includes('text/event-stream');
      if (wantsSSE) {
        incSse429Count();
      } else {
        incJson429Count();
      }
      
      return reply.code(429).send({
        error: { type: 'RATE_LIMIT', message: ERR_MSG.RATE_LIMIT_RPM }
      });
    }
    
    done();
  };
  
  const commitHook = function(req: FastifyRequest, reply: FastifyReply, payload: any, done: HookHandlerDoneFunction) {
    try {
      const marker = (req as any).__rl_pending;
      if (marker) {
        marker.rec.pending = Math.max(0, marker.rec.pending - 1);
      }
      
      // Skip counting for oversized requests
      const skip = (req as any).__rate_limit_skip;
      if (skip) return done();
      if (!marker) return done();
      
      const status = reply.statusCode;
      // Only count successful responses (2xx/3xx)
      if (status >= 200 && status < 400) {
        marker.rec.count++;
      }
    } catch {}
    done();
  };
  
  return { rateLimiter, commitHook };
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
      rec = { count: 0, pending: 0, resetAt: now + windowMs };
      store.set(ip, rec);
    }
    
    const isReplay = isIdempotentReplay(req);
    const wouldExceed = isReplay ? (rec.count > rpm) : ((rec.count + rec.pending) > rpm);
    if (!isReplay) {
      (req as any).__rl_pending = { rec, ip };
    }
    
    // Enforce MAX_BUCKETS cap with LRU eviction
    if (store.size > MAX_BUCKETS) {
      let removed = 0;
      // First try removing expired
      for (const [k, v] of store) {
        if (now > v.resetAt) { store.delete(k); removed++; }
        if (removed >= SWEEP_MAX_DELETE || store.size <= MAX_BUCKETS) break;
      }
      // If still over limit, evict oldest (Map preserves insertion order)
      while (store.size > MAX_BUCKETS) {
        const oldest = store.keys().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
    }
    
    // Account for pending increment (this request will count if successful)
    const remaining = Math.max(0, rpm - rec.count - rec.pending);
    const resetUnix = Math.floor(rec.resetAt / 1000);
    reply.header('X-RateLimit-Limit', String(rpm));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header('X-RateLimit-Reset', String(resetUnix));
    
    if (wouldExceed && !isReplay) {
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
      rec = { count: 0, pending: 0, resetAt: now + windowMs };
      store.set(ip, rec);
    }
    
    const isReplay = isIdempotentReplay(req);
    const wouldExceed = isReplay ? (rec.count > rpm) : ((rec.count + rec.pending) > rpm);
    if (!isReplay) {
      (req as any).__rl_pending = { rec, ip };
    }
    
    // Enforce MAX_BUCKETS cap with LRU eviction
    if (store.size > MAX_BUCKETS) {
      let removed = 0;
      // First try removing expired
      for (const [k, v] of store) {
        if (now > v.resetAt) { store.delete(k); removed++; }
        if (removed >= SWEEP_MAX_DELETE || store.size <= MAX_BUCKETS) break;
      }
      // If still over limit, evict oldest (Map preserves insertion order)
      while (store.size > MAX_BUCKETS) {
        const oldest = store.keys().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
    }
    
    // Account for pending increment (this request will count if successful)
    const remaining = Math.max(0, rpm - rec.count - rec.pending);
    const resetUnix = Math.floor(rec.resetAt / 1000);
    reply.header('X-RateLimit-Limit', String(rpm));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header('X-RateLimit-Reset', String(resetUnix));
    
    if (wouldExceed && !isReplay) {
      const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
      reply.header('Retry-After', String(retryAfter));
      reply.header('X-RateLimit-Reason', 'per_ip');
      return reply.code(429).send({ error: { type: 'RATE_LIMIT', message: ERR_MSG.RATE_LIMIT_RPM } });
    }
    
    done();
  };
  
  return { 
    limiter, 
    getStore: () => store,
    getStoreSize: () => store.size 
  };
}
