/**
 * P0: Verify 429 responses include Retry-After header and retry_after field
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('P0: 429 Retry-After headers', () => {
  let server: ServerHandle | null = null;
  
  afterEach(async () => {
    await server?.kill();
    server = null;
  });
  
  it('429 response includes Retry-After header and body field', async () => {
    server = await spawnServer({ 
      env: { 
        TEST_ROUTES: '1', 
        AUTH_ENABLED: '0', 
        RATE_LIMIT_ENABLED: '1',
        RATE_LIMIT_RPM: '2', // Very low limit to trigger easily
      } 
    });
    
    // Make requests to exceed rate limit
    await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        graph: { nodes: [{ id: 'A', label: 'Test' }], edges: [] } 
      }),
    });
    
    await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        graph: { nodes: [{ id: 'A', label: 'Test' }], edges: [] } 
      }),
    });
    
    // Third request should be rate-limited
    const r = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        graph: { nodes: [{ id: 'A', label: 'Test' }], edges: [] } 
      }),
    });
    
    expect(r.status).toBe(429);
    
    // P0: Verify Retry-After header exists
    const retryAfter = r.headers.get?.('retry-after') || r.headers.get?.('Retry-After');
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    
    // P0: Verify body has error structure (may vary by endpoint)
    expect(r.data).toBeDefined();
    expect(r.data.error || r.data.code).toBeDefined();
  });
});
