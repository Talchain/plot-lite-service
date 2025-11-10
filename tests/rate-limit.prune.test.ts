import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

describe('Rate limiter pruning', () => {
  it('prunes expired buckets and enforces MAX_BUCKETS cap', async () => {
    vi.resetModules();
    process.env.RATE_LIMIT_MAX_BUCKETS = '50';
    process.env.RATE_LIMIT_SWEEP_INTERVAL_MS = '100';
    process.env.RATE_LIMIT_RPM = '100';
    
    const { makeRateLimiterWithStoreAccess } = await import('../src/middleware/rate-limit.js');
    const { limiter, getStoreSize } = makeRateLimiterWithStoreAccess();
    
    // Simulate many unique IPs
    for (let i = 0; i < 100; i++) {
      const mockReq = { ip: `192.168.1.${i}` } as FastifyRequest;
      const mockReply = {
        header: vi.fn().mockReturnThis(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn()
      } as unknown as FastifyReply;
      const done = vi.fn();
      
      limiter(mockReq, mockReply, done);
    }
    
    // Store should be capped at MAX_BUCKETS (50)
    const size = getStoreSize();
    expect(size).toBeLessThanOrEqual(50);
    expect(size).toBeGreaterThan(0);
  });
});
