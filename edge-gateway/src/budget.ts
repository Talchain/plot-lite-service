interface BudgetBucket {
  tokens: number;
  lastRefill: number;
  burstCapacity: number;
  refillRate: number; // tokens per minute
}

export class BudgetManager {
  private buckets = new Map<string, BudgetBucket>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private burstCapacity = Number(process.env.BUDGET_BURST || 200),
    private refillRate = Number(process.env.BUDGET_SUSTAINED_PER_MIN || 5000)
  ) {
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

  private getBucket(orgId: string): BudgetBucket {
    let bucket = this.buckets.get(orgId);
    if (!bucket) {
      bucket = {
        tokens: this.burstCapacity,
        lastRefill: Date.now(),
        burstCapacity: this.burstCapacity,
        refillRate: this.refillRate
      };
      this.buckets.set(orgId, bucket);
      return bucket;
    }

    // Refill tokens based on time elapsed
    const now = Date.now();
    const timeDelta = now - bucket.lastRefill;
    const tokensToAdd = (timeDelta / (60 * 1000)) * this.refillRate;
    bucket.tokens = Math.min(this.burstCapacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    return bucket;
  }

  canConsume(orgId: string, tokens: number): boolean {
    const bucket = this.getBucket(orgId);
    return bucket.tokens >= tokens;
  }

  consume(orgId: string, tokens: number): boolean {
    const bucket = this.getBucket(orgId);
    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return true;
    }
    return false;
  }

  getRemainingTokens(orgId: string): number {
    const bucket = this.getBucket(orgId);
    return Math.floor(bucket.tokens);
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