import { FastifyRequest, FastifyReply } from 'fastify';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number; // tokens per minute
}

class RateLimiter {
  private buckets = new Map<string, TokenBucket>();

  private getBucket(key: string): TokenBucket {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: Number(process.env.ENQUEUE_BURST || 60),
        lastRefill: now,
        maxTokens: Number(process.env.ENQUEUE_BURST || 60),
        refillRate: Number(process.env.ENQUEUE_SUSTAINED_PER_MIN || 600),
      };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on time passed
    const timePassed = (now - bucket.lastRefill) / 60000; // minutes
    const tokensToAdd = Math.floor(timePassed * bucket.refillRate);

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    return bucket;
  }

  tryConsume(key: string): { allowed: boolean; retryAfter?: number; remaining: number } {
    const bucket = this.getBucket(key);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: bucket.tokens };
    }

    // Calculate retry after (time until next token)
    const retryAfter = Math.ceil(60 / bucket.refillRate); // seconds

    return { allowed: false, retryAfter, remaining: 0 };
  }

  getStats(key: string): { tokens: number; maxTokens: number } {
    const bucket = this.getBucket(key);
    return { tokens: bucket.tokens, maxTokens: bucket.maxTokens };
  }
}

const rateLimiter = new RateLimiter();

export async function rateLimitMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Skip if rate limiting is disabled
  if (process.env.RATE_LIMIT_ENABLED !== '1') {
    return;
  }

  // Determine rate limit key (org > user > IP)
  const orgId = request.headers['x-org-id'] as string;
  const userId = request.headers['x-user-id'] as string;
  const ip = request.ip;

  let key: string;
  if (orgId) {
    key = `org:${orgId}`;
  } else if (userId) {
    key = `user:${userId}`;
  } else {
    key = `ip:${ip}`;
  }

  const result = rateLimiter.tryConsume(key);

  // Set rate limit headers
  reply.header('X-RateLimit-Limit', process.env.ENQUEUE_BURST || '60');
  reply.header('X-RateLimit-Remaining', result.remaining.toString());

  if (!result.allowed) {
    reply.header('Retry-After', result.retryAfter!.toString());
    reply.code(429).send({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: result.retryAfter,
    });
    return;
  }
}