import { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { rateLimiter } from './index.js';

interface RateLimitConfig {
  ipBurst: number;
  ipSustained: number;
  userBurst: number;
  userSustained: number;
  orgBurst: number;
  orgSustained: number;
  trustProxy: boolean;
}

// Track 429s per-minute to expose last5m_429 in /health
const perMinute429: Map<number, number> = new Map();

function record429(now: number) {
  const minute = Math.floor(now / 60000);
  perMinute429.set(minute, (perMinute429.get(minute) || 0) + 1);
  // Prune older than 10 minutes
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

function getClientIP(req: FastifyRequest, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.ip || 'unknown';
}

function extractHeaders(req: FastifyRequest): { orgId?: string; userId?: string } {
  const headers = req.headers;
  const orgId = headers['x-org-id'] as string | undefined;
  const userId = headers['x-user-id'] as string | undefined;

  return {
    orgId: orgId ? String(orgId) : undefined,
    userId: userId ? String(userId) : undefined
  };
}

function isHealthEndpoint(req: FastifyRequest): boolean {
  const url = req.url || '';
  return req.method === 'GET' && (
    url.startsWith('/health') ||
    url.startsWith('/ready') ||
    url.startsWith('/live') ||
    url.startsWith('/version') ||
    url.startsWith('/ops/snapshot')
  );
}

const rateLimitPluginImpl: FastifyPluginAsync = async (fastify) => {
  const config: RateLimitConfig = {
    ipBurst: Number(process.env.RL_IP_BURST || 120),
    ipSustained: Number(process.env.RL_IP_SUSTAINED_PER_MIN || 600),
    userBurst: Number(process.env.RL_USER_BURST || 180),
    userSustained: Number(process.env.RL_USER_SUSTAINED_PER_MIN || 900),
    orgBurst: Number(process.env.RL_ORG_BURST || 300),
    orgSustained: Number(process.env.RL_ORG_SUSTAINED_PER_MIN || 1500),
    trustProxy: process.env.TRUST_PROXY === '1'
  };

  // Log configuration on registration
  fastify.log.info({
    rate_limit_enabled: true,
    ip_burst: config.ipBurst,
    ip_sustained_per_min: config.ipSustained,
    user_burst: config.userBurst,
    user_sustained_per_min: config.userSustained,
    org_burst: config.orgBurst,
    org_sustained_per_min: config.orgSustained,
    trust_proxy: config.trustProxy
  }, 'Rate limiting enabled');

  // Hook 1: onRequest - Rate limit enforcement
  fastify.addHook('onRequest', async (req, reply) => {
    // Skip health endpoints
    if (isHealthEndpoint(req)) {
      return;
    }

    const { orgId, userId } = extractHeaders(req);
    const clientIP = getClientIP(req, config.trustProxy);

    // Determine which limit to apply (priority: org > user > ip)
    let key: string;
    let burstCapacity: number;
    let sustainedRate: number;

    if (orgId) {
      key = `org:${orgId}`;
      burstCapacity = config.orgBurst;
      sustainedRate = config.orgSustained;
    } else if (userId) {
      key = `user:${userId}`;
      burstCapacity = config.userBurst;
      sustainedRate = config.userSustained;
    } else {
      key = `ip:${clientIP}`;
      burstCapacity = config.ipBurst;
      sustainedRate = config.ipSustained;
    }

    const result = rateLimiter.checkLimit(key, burstCapacity, sustainedRate);

    // Store result on request for onSend hook
    (req as any).__rateLimit = {
      allowed: result.allowed,
      limit: result.limit,
      remaining: result.tokensRemaining,
      retryAfter: result.retryAfterSeconds
    };

    if (!result.allowed) {
      reply.header('Retry-After', String(result.retryAfterSeconds!));
      record429(Date.now());
      return reply.code(429).send({
        error: 'rate_limited',
        retry_after_seconds: result.retryAfterSeconds!
      });
    }
  });

  // Hook 2: onSend - Set rate limit headers on successful responses
  fastify.addHook('onSend', async (req, reply, payload) => {
    // Skip health endpoints
    if (isHealthEndpoint(req)) {
      return payload;
    }

    const rateLimitInfo = (req as any).__rateLimit;
    if (rateLimitInfo && rateLimitInfo.allowed) {
      reply.header('X-RateLimit-Limit', String(rateLimitInfo.limit));
      reply.header('X-RateLimit-Remaining', String(rateLimitInfo.remaining));
    }

    return payload;
  });
};

// Export wrapped plugin
export const rateLimitPlugin = fp(rateLimitPluginImpl, {
  name: 'rate-limit-plugin'
});

export function rateLimitState() {
  const enabled = process.env.RATE_LIMIT_ENABLED === '1';
  const now = Date.now();
  return {
    enabled,
    buckets_active: enabled ? rateLimiter.getBucketCount() : 0,
    last5m_429: enabled ? last5m429(now) : 0,
    config: enabled ? {
      ip_burst: Number(process.env.RL_IP_BURST || 120),
      ip_sustained_per_min: Number(process.env.RL_IP_SUSTAINED_PER_MIN || 600),
      user_burst: Number(process.env.RL_USER_BURST || 180),
      user_sustained_per_min: Number(process.env.RL_USER_SUSTAINED_PER_MIN || 900),
      org_burst: Number(process.env.RL_ORG_BURST || 300),
      org_sustained_per_min: Number(process.env.RL_ORG_SUSTAINED_PER_MIN || 1500),
      trust_proxy: process.env.TRUST_PROXY === '1'
    } : null
  };
}