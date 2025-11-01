import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Metrics endpoint (gated)', () => {
  let server: ServerHandle | null = null;

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  it('absent when METRICS unset', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        TEST_ROUTES: '1',
        AUTH_ENABLED: '0',
        RATE_LIMIT_ENABLED: '0',
        METRICS: undefined as any, // Explicitly unset
        COMPARE_VIEW_ENABLE: '0',
        INSPECTOR_DEBUG_ENABLE: '0',
        SCM_LITE_ENABLE: '0',
      },
    });

    const res = await fetch(`${server.baseUrl}/metrics`);
    expect(res.status).toBe(404);
  });

  it('exposes counters and draft p95s when METRICS=1', async () => {
    vi.resetModules();
    server = await spawnServer({
      env: {
        TEST_ROUTES: '1',
        AUTH_ENABLED: '0',
        RATE_LIMIT_ENABLED: '0',
        METRICS: '1',
        COMPARE_VIEW_ENABLE: '0',
        INSPECTOR_DEBUG_ENABLE: '0',
        SCM_LITE_ENABLE: '0',
      },
    });

    // Trigger a few draft-flows to populate history
    await fetch(`${server.baseUrl}/draft-flows?template=pricing_change&seed=101`);
    await fetch(`${server.baseUrl}/draft-flows?template=pricing_change&seed=101`);

    const res = await fetch(`${server.baseUrl}/metrics`);
    expect(res.status).toBe(200);
    
    const data: any = await res.json();
    expect(typeof data.stream_started).toBe('number');
    expect(typeof data.stream_done).toBe('number');
    expect(typeof data.stream_cancelled).toBe('number');
    expect(typeof data.stream_limited).toBe('number');
    expect(typeof data.stream_retryable).toBe('number');
    expect(Array.isArray(data.draft_flows_p95_last5)).toBe(true);
    expect(data.draft_flows_p95_last5.length).toBeLessThanOrEqual(5);
  });
});
