import { describe, it, expect, afterEach } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('/v1/validate', () => {
  let server: ServerHandle | null = null;
  afterEach(async () => { await server?.kill(); server = null; });

  it('valid payload returns valid:true', async () => {
    server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0' } });
    const r = await requestJSON(`${server.baseUrl}/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: { nodes: [{ id: 'A', label: 'Test' }], edges: [] } }),
    });
    expect(r.status).toBe(200);
    expect(r.data.valid).toBe(true);
  });

  /**
   * Factor with incoming edges should trigger FACTOR_HAS_INCOMING_EDGES warning
   * Factors represent external inputs and should be root nodes.
   */
  it('factor with incoming edges triggers FACTOR_HAS_INCOMING_EDGES warning', async () => {
    server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0' } });
    const r = await requestJSON(`${server.baseUrl}/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'X', label: 'X' },
            { id: 'Price', label: 'Price', kind: 'factor' }, // Factor with incoming edge
            { id: 'Y', label: 'Y', kind: 'goal' },
          ],
          edges: [
            { from: 'X', to: 'Price', weight: 1, belief: 1.0 }, // Incoming edge to factor!
            { from: 'Price', to: 'Y', weight: 1, belief: 1.0 },
          ],
        },
      }),
    });
    expect(r.status).toBe(200);
    // Valid is true because it's only a warning, not an error
    expect(r.data.valid).toBe(true);
    // Should have the FACTOR_HAS_INCOMING_EDGES warning
    const factorWarning = r.data.violations?.find(
      (v: any) => v.code === 'FACTOR_HAS_INCOMING_EDGES'
    );
    expect(factorWarning).toBeDefined();
    expect(factorWarning.severity).toBe('warning');
    expect(factorWarning.at?.node_id).toBe('Price');
    expect(factorWarning.suggestion).toContain('Remove incoming edges');
  });

  describe('category field preservation', () => {
    it('preserves category: controllable on factor nodes', async () => {
      server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0' } });
      const r = await requestJSON(`${server.baseUrl}/v1/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [
              { id: 'fac_test', kind: 'factor', label: 'Test Factor', category: 'controllable' },
              { id: 'goal', kind: 'goal', label: 'Goal' },
            ],
            edges: [{ from: 'fac_test', to: 'goal', weight: 1 }],
          },
        }),
      });
      expect(r.status).toBe(200);
      expect(r.data.valid).toBe(true);
      expect(r.data.normalized).toBeDefined();
      const factorNode = r.data.normalized.nodes.find((n: any) => n.id === 'fac_test');
      expect(factorNode).toBeDefined();
      expect(factorNode.category).toBe('controllable');
    });

    it('preserves category: observable on factor nodes', async () => {
      server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0' } });
      const r = await requestJSON(`${server.baseUrl}/v1/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [
              { id: 'fac_obs', kind: 'factor', label: 'Observable Factor', category: 'observable' },
              { id: 'goal', kind: 'goal', label: 'Goal' },
            ],
            edges: [{ from: 'fac_obs', to: 'goal', weight: 1 }],
          },
        }),
      });
      expect(r.status).toBe(200);
      expect(r.data.normalized).toBeDefined();
      const factorNode = r.data.normalized.nodes.find((n: any) => n.id === 'fac_obs');
      expect(factorNode.category).toBe('observable');
    });

    it('preserves category: external on factor nodes', async () => {
      server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0' } });
      const r = await requestJSON(`${server.baseUrl}/v1/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [
              { id: 'fac_ext', kind: 'factor', label: 'External Factor', category: 'external' },
              { id: 'goal', kind: 'goal', label: 'Goal' },
            ],
            edges: [{ from: 'fac_ext', to: 'goal', weight: 1 }],
          },
        }),
      });
      expect(r.status).toBe(200);
      expect(r.data.normalized).toBeDefined();
      const factorNode = r.data.normalized.nodes.find((n: any) => n.id === 'fac_ext');
      expect(factorNode.category).toBe('external');
    });

    it('factor without category remains without category', async () => {
      server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0' } });
      const r = await requestJSON(`${server.baseUrl}/v1/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [
              { id: 'fac_none', kind: 'factor', label: 'Factor No Category' },
              { id: 'goal', kind: 'goal', label: 'Goal' },
            ],
            edges: [{ from: 'fac_none', to: 'goal', weight: 1 }],
          },
        }),
      });
      expect(r.status).toBe(200);
      expect(r.data.normalized).toBeDefined();
      const factorNode = r.data.normalized.nodes.find((n: any) => n.id === 'fac_none');
      expect(factorNode).toBeDefined();
      expect(factorNode.category).toBeUndefined();
    });
  });
});
