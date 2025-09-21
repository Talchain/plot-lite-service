import { describe, it, expect } from 'vitest';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:4311';

describe('Idempotency-Key', () => {
  it('replays identical response for same body+key', async () => {
    const body = { fixture_case: 'price-rise-15pct-enGB', seed: 42 };
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-abc' } as any;
    const r1 = await fetch(`${BASE}/draft-flows`, { method: 'POST', headers, body: JSON.stringify(body) });
    const t1 = await r1.text();
    const r2 = await fetch(`${BASE}/draft-flows`, { method: 'POST', headers, body: JSON.stringify(body) });
    const t2 = await r2.text();
    expect(t2).toBe(t1);
  });

  it('returns BAD_INPUT when same key used with different body', async () => {
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-mismatch' } as any;
    const r1 = await fetch(`${BASE}/draft-flows`, { method: 'POST', headers, body: JSON.stringify({ seed: 1 }) });
    expect(r1.ok).toBe(true);
    const r2 = await fetch(`${BASE}/draft-flows`, { method: 'POST', headers, body: JSON.stringify({ seed: 2 }) });
    expect(r2.status).toBe(400);
    const j = await r2.json();
    expect(j.error?.type).toBe('BAD_INPUT');
  });

  it('works for /critique as well', async () => {
    const body = { parse_json: { nodes: [{ id: 'd', type: 'decision', label: 'Adjust price', baseline: 99 }], edges: [] } };
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-critique' } as any;
    const r1 = await fetch(`${BASE}/critique`, { method: 'POST', headers, body: JSON.stringify(body) });
    const t1 = await r1.text();
    const r2 = await fetch(`${BASE}/critique`, { method: 'POST', headers, body: JSON.stringify(body) });
    const t2 = await r2.text();
    expect(t2).toBe(t1);
  });
});