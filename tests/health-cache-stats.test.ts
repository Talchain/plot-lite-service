/**
 * P0.2: Health Cache Stats Test
 * Verifies /v1/health exposes cache statistics
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Health Cache Stats (P0.2)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ enableTestRoutes: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exposes idem_cache_stats in /v1/health', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);

    // Check that idem_cache_stats exists
    expect(data.idem_cache_stats).toBeDefined();
    
    if (data.idem_cache_stats) {
      expect(typeof data.idem_cache_stats.hits).toBe('number');
      expect(typeof data.idem_cache_stats.misses).toBe('number');
      expect(typeof data.idem_cache_stats.evictions).toBe('number');
      expect(typeof data.idem_cache_stats.size).toBe('number');
      expect(typeof data.idem_cache_stats.hitRate).toBe('number');
      
      // Hit rate should be between 0 and 1
      expect(data.idem_cache_stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(data.idem_cache_stats.hitRate).toBeLessThanOrEqual(1);
    }
  });

  it('exposes fixtures_cache_stats in /v1/health', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);

    // Check that fixtures_cache_stats exists
    expect(data.fixtures_cache_stats).toBeDefined();
    expect(typeof data.fixtures_cache_stats.hits).toBe('number');
    expect(typeof data.fixtures_cache_stats.misses).toBe('number');
    expect(typeof data.fixtures_cache_stats.evictions).toBe('number');
    expect(typeof data.fixtures_cache_stats.size).toBe('number');
    expect(typeof data.fixtures_cache_stats.hitRate).toBe('number');
    
    // Hit rate should be between 0 and 1
    expect(data.fixtures_cache_stats.hitRate).toBeGreaterThanOrEqual(0);
    expect(data.fixtures_cache_stats.hitRate).toBeLessThanOrEqual(1);
  });

  it('cache stats are numeric and non-negative', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);

    // Verify idem_cache_stats structure
    if (data.idem_cache_stats) {
      expect(data.idem_cache_stats.hits).toBeGreaterThanOrEqual(0);
      expect(data.idem_cache_stats.misses).toBeGreaterThanOrEqual(0);
      expect(data.idem_cache_stats.evictions).toBeGreaterThanOrEqual(0);
      expect(data.idem_cache_stats.size).toBeGreaterThanOrEqual(0);
    }

    // Verify fixtures_cache_stats structure
    expect(data.fixtures_cache_stats.hits).toBeGreaterThanOrEqual(0);
    expect(data.fixtures_cache_stats.misses).toBeGreaterThanOrEqual(0);
    expect(data.fixtures_cache_stats.evictions).toBeGreaterThanOrEqual(0);
    expect(data.fixtures_cache_stats.size).toBeGreaterThanOrEqual(0);
  });

  it('does not expose raw tokens in cache stats', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.body;

    // Ensure no raw tokens appear in the response
    expect(body).not.toContain('Bearer ');
    expect(body).not.toContain('test-token');
    expect(body).not.toContain('Authorization');
  });
});
