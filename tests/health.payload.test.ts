/**
 * Health Payload Tests
 * Verifies /v1/health exposes required observability fields
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('GET /v1/health observability fields', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer({
      env: {
        AUTH_ENABLED: '0',
        RATE_LIMIT_ENABLED: '0',
      },
    });
  });

  afterAll(async () => {
    try {
      await server?.kill();
    } catch (err) {
      console.warn('Server cleanup warning:', err);
    }
  });

  it('exposes last_compute_ms and engine_p95_ms fields', async () => {
    const { baseUrl } = server;
    
    // Initial health check
    const health0 = await requestJSON(`${baseUrl}/v1/health`);
    expect(health0.status).toBe(200);
    expect(health0.data).toBeTruthy();
    
    // Verify fields exist (initially 0)
    expect(typeof health0.data.last_compute_ms).toBe('number');
    expect(typeof health0.data.engine_p95_ms).toBe('number');
    expect(typeof health0.data.json_429_count).toBe('number');
    expect(typeof health0.data.sse_429_count).toBe('number');
    expect(typeof health0.data.idem_cache_size).toBe('number');
    
    // Make a /v1/run request to populate compute metrics
    const runPayload = {
      graph: {
        nodes: [
          { id: 'A', label: 'Node A' },
          { id: 'B', label: 'Node B' },
        ],
        edges: [{ from: 'A', to: 'B' }],
      },
      seed: 42,
      outcome_node: 'B',
    };
    
    const runRes = await requestJSON(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(runPayload),
    });
    
    expect(runRes.status).toBe(200);
    
    // Check health again - last_compute_ms should be > 0
    const health1 = await requestJSON(`${baseUrl}/v1/health`);
    expect(health1.status).toBe(200);
    expect(health1.data.last_compute_ms).toBeGreaterThan(0);
    
    // Make a few more requests to populate engine_p95_ms
    for (let i = 0; i < 5; i++) {
      await requestJSON(`${baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...runPayload, seed: 100 + i }),
      });
    }
    
    const health2 = await requestJSON(`${baseUrl}/v1/health`);
    expect(health2.status).toBe(200);
    expect(health2.data.last_compute_ms).toBeGreaterThan(0);
    // engine_p95_ms should be >= 0 (may be 0 if not enough samples)
    expect(typeof health2.data.engine_p95_ms).toBe('number');
    expect(health2.data.engine_p95_ms).toBeGreaterThanOrEqual(0);
  });

  it('includes standard health fields', async () => {
    const { baseUrl } = server;
    
    const health = await requestJSON(`${baseUrl}/v1/health`);
    
    expect(health.status).toBe(200);
    expect(health.data.status).toBe('ok');
    expect(health.data.api_version).toBe('v1');
    expect(typeof health.data.p95_ms).toBe('number');
    expect(health.data.version).toBe('1.0.0');
    expect(typeof health.data.uptime_s).toBe('number');
    expect(health.data.uptime_s).toBeGreaterThan(0);
  });
});
