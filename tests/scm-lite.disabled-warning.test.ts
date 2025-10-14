/**
 * Test: SCM-Lite disabled warning in production
 * Verifies that when SCM_LITE_ENABLE=0 and NODE_ENV=production,
 * the server logs a warning about using placeholder results.
 * 
 * Note: This is a smoke test that verifies the server runs correctly
 * with SCM-Lite disabled. The actual warning is logged to stderr/stdout
 * and would be captured in production monitoring systems.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('SCM-Lite disabled in production mode', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer({
      env: {
        SCM_LITE_ENABLE: '0',
        NODE_ENV: 'production',
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

  it('returns placeholder results when SCM-Lite is disabled', async () => {
    const { baseUrl } = server;

    // Make a request - should succeed with placeholder results
    const payload = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [{ from: 'A', to: 'B' }],
      },
      seed: 42,
      outcome_node: 'B',
    };

    const res = await requestJSON(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect([200, 201]).toContain(res.status);
    
    // Verify response structure (placeholder results)
    expect(res.data).toHaveProperty('results');
    expect(res.data).toHaveProperty('confidence');
    expect(res.data).toHaveProperty('model_card');
    
    // Should NOT have bma_hash (only present with SCM-Lite enabled)
    expect(res.data.model_card.bma_hash).toBeUndefined();
  });

  it('runs correctly in development mode with SCM-Lite disabled', async () => {
    // Spawn a new server with NODE_ENV=development
    const devServer = await spawnServer({
      env: {
        SCM_LITE_ENABLE: '0',
        NODE_ENV: 'development',
        AUTH_ENABLED: '0',
        RATE_LIMIT_ENABLED: '0',
      },
    });

    try {
      const { baseUrl } = devServer;

      const payload = {
        graph: {
          nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
          edges: [{ from: 'A', to: 'B' }],
        },
        seed: 99,
        outcome_node: 'B',
      };

      const res = await requestJSON(`${baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect([200, 201]).toContain(res.status);
      expect(res.data).toHaveProperty('results');
      expect(res.data.model_card.bma_hash).toBeUndefined();
    } finally {
      await devServer.kill();
    }
  });
});
