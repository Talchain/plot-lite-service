import { describe, it, expect } from 'vitest';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:4311';

describe('Error taxonomy proofs', () => {
  it('BAD_INPUT for malformed /critique body', async () => {
    const res = await fetch(`${BASE}/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nope: true }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error?.type).toBe('BAD_INPUT');
  });

  it('BLOCKED_CONTENT for sensitive tokens', async () => {
    const res = await fetch(`${BASE}/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret', parse_json: { nodes: [], edges: [] } }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error?.type).toBe('BLOCKED_CONTENT');
  });

  it('TIMEOUT simulated via header (dev-time)', async () => {
    const res = await fetch(`${BASE}/__test/force-error?type=TIMEOUT`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(res.status).toBe(504);
    const json = await res.json();
    expect(json.error?.type).toBe('TIMEOUT');
  });

  it('RETRYABLE simulated via header (dev-time)', async () => {
    const res = await fetch(`${BASE}/__test/force-error?type=RETRYABLE`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error?.type).toBe('RETRYABLE');
  });

  it('INTERNAL simulated via header (dev-time)', async () => {
    const res = await fetch(`${BASE}/__test/force-error?type=INTERNAL`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error?.type).toBe('INTERNAL');
  });
});