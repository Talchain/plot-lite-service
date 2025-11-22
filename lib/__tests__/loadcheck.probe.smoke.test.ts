import { describe, it, expect } from 'vitest';

// This smoke test uses the programmatic probe; keep short and serial.
describe.sequential('loadcheck programmatic probe (smoke)', () => {
  it('returns p95_ms number and no non2xx for deterministic GET', async () => {
    const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4313';
    const mod = await import('../../tools/loadcheck-probe.cjs');
    const runProbe = (mod as any).runProbe as (opts: any) => Promise<any>;
    const res = await runProbe({ baseUrl: base, path: '/draft-flows?template=pricing_change&seed=101', connections: 5, durationSeconds: 2 });
    expect(typeof res.p95_ms).toBe('number');
    expect(res.p95_ms).toBeGreaterThanOrEqual(0);
    expect(typeof res.requests).toBe('number');
    expect(res.requests).toBeGreaterThan(0);
    expect(res.non2xx).toBe(0);
    expect(res.errors).toBe(0);
  }, 15000);
});
