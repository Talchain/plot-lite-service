import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('SCM-Lite disabled in production mode', () => {
  let server: ServerHandle | null = null;

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  it('returns fallback results when SCM-Lite is disabled', async () => {
    vi.resetModules();
    server = await spawnServer({ profile: 'fallback' });

    const payload = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 1 }],
      },
      seed: 42,
      outcome_node: 'B',
    };

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect([200, 201]).toContain(res.status);
    expect(res.data).toHaveProperty('results');
    expect(res.data).toHaveProperty('confidence');
    expect(res.data).toHaveProperty('model_card');
    expect(res.data.model_card.backend).toBe('fallback');
    expect(res.data.model_card.bma_hash).toBeUndefined();
    expect(res.headers.get('x-olumi-backend')).toBe('fallback');
  });

  it('runs correctly with fallback backend', async () => {
    vi.resetModules();
    server = await spawnServer({ profile: 'fallback' });

    const payload = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 1 }],
      },
      seed: 99,
      outcome_node: 'B',
    };

    const res = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect([200, 201]).toContain(res.status);
    expect(res.data).toHaveProperty('results');
    expect(res.data.model_card.backend).toBe('fallback');
    expect(res.data.model_card.bma_hash).toBeUndefined();
    expect(res.headers.get('x-olumi-backend')).toBe('fallback');
  });
});
