import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:4311';

describe('Ajv request validation', () => {
  it('returns BAD_INPUT when /critique missing parse_json', async () => {
    const res = await fetch(`${BASE}/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error?.type).toBe('BAD_INPUT');
  });

  it('returns 200 when /critique parse_json matches schema', async () => {
    const valid = {
      nodes: [
        { id: 'n1', type: 'decision', label: 'Adjust price', baseline: 99 },
        { id: 'n2', type: 'outcome', label: 'Revenue', baseline: 100000 }
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', weight: 0.4, belief: 0.7 }
      ],
      comments: [],
      metadata: { thresholds: [99] }
    };
    const res = await fetch(`${BASE}/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parse_json: valid }) });
    expect(res.status).toBe(200);
    const arr = await res.json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(3);
    expect(arr[0].severity).toBe('BLOCKER');
  });
});