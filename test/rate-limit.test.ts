import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Rate Limiting', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Enable rate limiting for tests
    process.env.RATE_LIMIT_ENABLED = '1';
    process.env.RL_IP_BURST = '3'; // Low limit for easy testing
    process.env.RL_IP_SUSTAINED_PER_MIN = '1';
    process.env.RL_USER_BURST = '5';
    process.env.RL_USER_SUSTAINED_PER_MIN = '2';
    process.env.RL_ORG_BURST = '10';
    process.env.RL_ORG_SUSTAINED_PER_MIN = '5';

    app = await createServer({ enableTestRoutes: true });
  });

  afterAll(async () => {
    await app.close();
    // Clean up environment
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.RL_IP_BURST;
    delete process.env.RL_IP_SUSTAINED_PER_MIN;
    delete process.env.RL_USER_BURST;
    delete process.env.RL_USER_SUSTAINED_PER_MIN;
    delete process.env.RL_ORG_BURST;
    delete process.env.RL_ORG_SUSTAINED_PER_MIN;
  });

  it('should allow requests under the limit', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/draft-flows',
      payload: {
        fixture_case: 'price-rise-15pct-enGB',
        seed: 12345
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBe('3');
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('should rate limit after exceeding IP burst limit', async () => {
    // Make requests up to the burst limit (3 tokens)
    const responses = [];
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/draft-flows',
        payload: {
          fixture_case: 'price-rise-15pct-enGB',
          seed: 12345
        }
      });
      responses.push(response);
    }

    // At least the first request should be successful
    expect(responses[0].statusCode).toBe(200);

    // Next request should be rate limited
    const limitedResponse = await app.inject({
      method: 'POST',
      url: '/draft-flows',
      payload: {
        fixture_case: 'price-rise-15pct-enGB',
        seed: 12345
      }
    });

    expect(limitedResponse.statusCode).toBe(429);
    expect(limitedResponse.headers['retry-after']).toBeDefined();

    const body = JSON.parse(limitedResponse.body);
    expect(body.error).toBe('rate_limited');
    expect(body.retry_after_seconds).toBeGreaterThan(0);
  });

  it('should not rate limit health endpoints', async () => {
    // Make many requests to health endpoints
    for (let i = 0; i < 10; i++) {
      const healthResponse = await app.inject({
        method: 'GET',
        url: '/health'
      });
      expect(healthResponse.statusCode).toBe(200);
      // Health endpoints should NOT have rate limit headers
      expect(healthResponse.headers['x-ratelimit-limit']).toBeUndefined();
      expect(healthResponse.headers['x-ratelimit-remaining']).toBeUndefined();

      const versionResponse = await app.inject({
        method: 'GET',
        url: '/version'
      });
      expect(versionResponse.statusCode).toBe(200);
      expect(versionResponse.headers['x-ratelimit-limit']).toBeUndefined();

      const liveResponse = await app.inject({
        method: 'GET',
        url: '/live'
      });
      expect(liveResponse.statusCode).toBe(200);
      expect(liveResponse.headers['x-ratelimit-limit']).toBeUndefined();
    }
  });

  it('should use user-level limits when x-user-id header is present', async () => {
    const userHeaders = { 'x-user-id': 'test-user-123' };

    // Make requests up to user burst limit (5)
    for (let i = 0; i < 5; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/draft-flows',
        headers: userHeaders,
        payload: {
          fixture_case: 'price-rise-15pct-enGB',
          seed: 12345
        }
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBe('5');
    }

    // Next request should be rate limited
    const limitedResponse = await app.inject({
      method: 'POST',
      url: '/draft-flows',
      headers: userHeaders,
      payload: {
        fixture_case: 'price-rise-15pct-enGB',
        seed: 12345
      }
    });

    expect(limitedResponse.statusCode).toBe(429);
  });

  it('should use org-level limits when x-org-id header is present', async () => {
    const orgHeaders = { 'x-org-id': 'test-org-456' };

    // Make requests up to org burst limit (10)
    for (let i = 0; i < 10; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/critique',
        headers: orgHeaders,
        payload: {
          parse_json: {
            nodes: [
              { id: 'n1', type: 'decision', label: 'Adjust price', baseline: 99 },
              { id: 'n2', type: 'outcome', label: 'Revenue', baseline: 100000 }
            ],
            edges: [
              { id: 'e1', from: 'n1', to: 'n2', weight: 0.4, belief: 0.7 }
            ],
            comments: [],
            metadata: { thresholds: [99] }
          }
        }
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBe('10');
    }

    // Next request should be rate limited
    const limitedResponse = await app.inject({
      method: 'POST',
      url: '/critique',
      headers: orgHeaders,
      payload: {
        parse_json: {
          nodes: [
            { id: 'n1', type: 'decision', label: 'Adjust price', baseline: 99 },
            { id: 'n2', type: 'outcome', label: 'Revenue', baseline: 100000 }
          ],
          edges: [
            { id: 'e1', from: 'n1', to: 'n2', weight: 0.4, belief: 0.7 }
          ],
          comments: [],
          metadata: { thresholds: [99] }
        }
      }
    });

    expect(limitedResponse.statusCode).toBe(429);
  });

  it('should prioritize org limits over user limits', async () => {
    const bothHeaders = {
      'x-org-id': 'priority-org',
      'x-user-id': 'priority-user'
    };

    const response = await app.inject({
      method: 'POST',
      url: '/improve',
      headers: bothHeaders,
      payload: { parse_json: { test: 'data' } }
    });

    expect(response.statusCode).toBe(200);
    // Should use org limits (10), not user limits (5)
    expect(response.headers['x-ratelimit-limit']).toBe('10');
  });

  it('should report rate limit status in health endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.rate_limit).toBeDefined();
    expect(body.rate_limit.enabled).toBe(true);
    expect(body.rate_limit.buckets_active).toBeGreaterThanOrEqual(0);
    expect(body.rate_limit.last5m_429).toBeGreaterThanOrEqual(0);
    expect(body.rate_limit.config).toBeDefined();
    expect(body.rate_limit.config.ip_burst).toBe(3);
  });
});