import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/diff', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer();
  });

  afterAll(async () => {
    await server.kill();
  });

  it('returns a diff between two simple graphs', async () => {
    const body = {
      before: {
        nodes: [{ id: 'A', label: 'Before' }],
        edges: [],
      },
      after: {
        nodes: [
          { id: 'A', label: 'Before' },
          { id: 'B', label: 'After' },
        ],
        edges: [
          { from: 'A', to: 'B', weight: 1.0 },
        ],
      },
    };

    const res = await fetch(`${server.baseUrl}/v1/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.schema).toBe('diff.v1');
    expect(data.graphs.before.nodes).toBe(1);
    expect(data.graphs.after.nodes).toBe(2);

    expect(Array.isArray(data.diff.nodes_added)).toBe(true);
    expect(data.diff.nodes_added.length).toBe(1);
    expect(data.diff.nodes_added[0].id).toBe('B');

    expect(Array.isArray(data.diff.edges_added)).toBe(true);
    expect(data.diff.edges_added.length).toBe(1);
    expect(data.diff.edges_added[0].from).toBe('A');
    expect(data.diff.edges_added[0].to).toBe('B');

    expect(typeof data.diff.summary.total_changes).toBe('number');
    expect(data.diff.summary.total_changes).toBeGreaterThan(0);
  });

  it('rejects payloads missing before/after', async () => {
    const res = await fetch(`${server.baseUrl}/v1/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    // Ajv BAD_INPUT
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data?.schema).toBe('error.v1');
    expect(data?.code).toBe('BAD_INPUT');
  });
});
