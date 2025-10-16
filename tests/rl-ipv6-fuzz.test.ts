import { describe, it, expect } from 'vitest';
import { canonicalizeRemote } from '../src/lib/net.js';
import { createServer } from '../src/createServer.js';

describe('RL & IPv6 Fuzz (D3)', () => {
  it('IPv6 canonicalize', () => {
    expect(canonicalizeRemote('::1')).toBe(canonicalizeRemote('0:0:0:0:0:0:0:1'));
  });

  it('burst produces 429s', async () => {
    const app = await createServer({ enableTestRoutes: false });
    const results = await Promise.all(
      Array(100).fill(0).map(() => 
        app.inject({ method: 'POST', url: '/v1/run', payload: { seed: 1, graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] }, outcome_node: 'A' } })
      )
    );
    expect(results.filter(r => r.statusCode === 429).length).toBeGreaterThan(0);
    await app.close();
  });
});
