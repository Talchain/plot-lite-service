/**
 * P0: UI field rejection - reject source/target/data/position in nodes/edges
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('P0: UI field rejection', () => {
  let server: ServerHandle | null = null;
  
  afterEach(async () => {
    await server?.kill();
    server = null;
  });
  
  it('rejects node with UI-editor field (data)', async () => {
    server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0' } });
    
    const r = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'Start', data: { custom: 'value' } }, // UI field
            { id: 'B', label: 'End' },
          ],
          edges: [],
        },
        seed: 42,
      }),
    });
    
    expect(r.status).toBe(400);
    expect(r.data.code).toBe('BAD_INPUT');
    expect(r.data.message).toContain('data');
  });
  
  it('rejects edge with UI-editor field (source)', async () => {
    server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0' } });
    
    const r = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'Start' },
            { id: 'B', label: 'End' },
          ],
          edges: [
            { from: 'A', to: 'B', source: 'A', target: 'B' }, // UI fields
          ],
        },
      }),
    });
    
    expect(r.status).toBe(400);
    expect(r.data.code).toBe('BAD_INPUT');
    expect(r.data.message).toMatch(/source|target/);
  });
  
  it('accepts valid graph without UI fields', async () => {
    server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0' } });
    
    const r = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'Start' },
            { id: 'B', label: 'End' },
          ],
          edges: [
            { from: 'A', to: 'B', weight: 1 },
          ],
        },
        seed: 42,
      }),
    });
    
    expect(r.status).toBe(200);
    expect(r.data.result).toBeDefined();
  });
});
