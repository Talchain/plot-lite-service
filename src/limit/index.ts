interface TokenBucket {
  tokens: number;
  lastRefill: number;
  burstCapacity: number;
  refillRate: number; // tokens per minute
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  tokensRemaining: number;
  limit: number;
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up old buckets every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  private cleanup() {
    const now = Date.now();
    const cutoff = now - (10 * 60 * 1000); // Remove buckets older than 10 minutes

    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefill < cutoff) {
        this.buckets.delete(key);
      }
    }
  }

  private getBucket(key: string, burstCapacity: number, refillRate: number): TokenBucket {
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: burstCapacity,
        lastRefill: Date.now(),
        burstCapacity,
        refillRate
      };
      this.buckets.set(key, bucket);
      return bucket;
    }

    // Refill tokens based on time elapsed
    const now = Date.now();
    const timeDelta = now - bucket.lastRefill;
    const tokensToAdd = (timeDelta / (60 * 1000)) * refillRate; // refillRate is per minute

    bucket.tokens = Math.min(bucket.burstCapacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
    bucket.burstCapacity = burstCapacity; // Allow dynamic reconfiguration
    bucket.refillRate = refillRate;

    return bucket;
  }

  checkLimit(key: string, burstCapacity: number, refillRate: number): RateLimitResult {
    const bucket = this.getBucket(key, burstCapacity, refillRate);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        tokensRemaining: Math.floor(bucket.tokens),
        limit: burstCapacity
      };
    } else {
      // Calculate retry after based on when we'll have 1 token
      const tokensNeeded = 1 - bucket.tokens;
      const secondsToWait = Math.ceil((tokensNeeded / refillRate) * 60);

      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, secondsToWait),
        tokensRemaining: 0,
        limit: burstCapacity
      };
    }
  }

  getBucketCount(): number {
    return this.buckets.size;
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.buckets.clear();
  }
}

// Global instance
export const rateLimiter = new RateLimiter();