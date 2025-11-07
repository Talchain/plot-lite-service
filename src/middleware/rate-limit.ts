import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { ERR_MSG } from '../lib/error-messages.js';
import { getRateLimitRpm } from '../config/runtimeConfig.js';
import { FLAGS } from '../config/flags.js';

interface State { count: number; resetAt: number }

// Bounded store configuration (env-tunable with safe defaults)
const SWEEP_INTERVAL_MS = Number(process.env.RATE_LIMIT_SWEEP_INTERVAL_MS) || 1000;
const SWEEP_MAX_DELETE = Number(process.env.RATE_LIMIT_SWEEP_MAX_DELETE) || 1000;
const MAX_BUCKETS = Number(process.env.RATE_LIMIT_MAX_BUCKETS) || 100000;

/**
 * Per-server rate limiter factory for test isolation.
 * Each server instance gets its own isolated state.
 * 
 * Implements bounded store with periodic pruning to prevent unbounded memory growth.
 * Supports both new FLAGS and legacy RATE_LIMIT_RPM env var.
 */
export function makeRateLimiter() {
  const store = new Map<string, State>();
  let lastSweep = 0;
  
  return function rateLimiter(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
    // Check if rate limiting is disabled
    if (process.env.RATE_LIMIT_ENABLED === '0') {
      return done();
    }

    const now = Date.now();
    
    // Periodic pruning of expired buckets
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
    
    // Use runtime config rate_limit_rpm (requests per minute) with 60s window
    const max = getRateLimitRpm();
    const windowMs = 60_000;

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

    // Enforce MAX_BUCKETS cap
    if (store.size > MAX_BUCKETS) {
      // Prefer to drop expired buckets first
      let removed = 0;
      for (const [k, v] of store) {
        if (now > v.resetAt) {
          store.delete(k);
          removed++;
        }
        if (store.size <= MAX_BUCKETS) break;
      }
      // If still above cap, evict oldest resetAt buckets
      if (store.size > MAX_BUCKETS) {
        const arr = [...store.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
        for (const [k] of arr) {
          store.delete(k);
          if (store.size <= MAX_BUCKETS) break;
        }
      }
    }

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
      reply.header('X-RateLimit-Reset', String(resetUnix));
      reply.code(429).send({ error: { type: 'RATE_LIMIT', message: ERR_MSG.RATE_LIMIT_RPM } });
      return;
    }
    
    done();
  };
}

// Test-only export for store size verification
export function makeRateLimiterWithStoreAccess() {
  const store = new Map<string, State>();
  let lastSweep = 0;
  
  const limiter = function rateLimiter(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
    // Same logic as above...
    if (process.env.RATE_LIMIT_ENABLED === '0') {
      return done();
    }

    const now = Date.now();
    
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
    
    const max = getRateLimitRpm();
    const windowMs = 60_000;

    let ip = req.ip ?? 'local';
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
      ip = '127.0.0.1';
    }

    let rec = store.get(ip);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      store.set(ip, rec);
    }
    rec.count++;

    if (store.size > MAX_BUCKETS) {
      let removed = 0;
      for (const [k, v] of store) {
        if (now > v.resetAt) {
          store.delete(k);
          removed++;
        }
        if (store.size <= MAX_BUCKETS) break;
      }
      if (store.size > MAX_BUCKETS) {
        const arr = [...store.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
        for (const [k] of arr) {
          store.delete(k);
          if (store.size <= MAX_BUCKETS) break;
        }
      }
    }

    const remaining = Math.max(0, max - rec.count);
    const resetUnix = Math.ceil(rec.resetAt / 1000);
    const retryAfter = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));

    reply.header('X-RateLimit-Limit', String(max));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header('X-RateLimit-Reset', String(resetUnix));

    if (rec.count > max) {
      reply.header('Retry-After', String(retryAfter));
      reply.header('X-RateLimit-Reason', 'per_ip');
      reply.header('X-RateLimit-Reset', String(resetUnix));
      reply.code(429).send({ error: { type: 'RATE_LIMIT', message: ERR_MSG.RATE_LIMIT_RPM } });
      return;
    }
    
    done();
  };
  
  return { limiter, getStoreSize: () => store.size };
}
