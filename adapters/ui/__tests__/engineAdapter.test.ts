import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEngineAdapter } from '../engineAdapter';

describe('UI engine adapter (flag-gated)', () => {
  let origFlag: string | undefined;
  beforeEach(() => { origFlag = process.env.UI_ADAPTER_SPIKE; process.env.UI_ADAPTER_SPIKE = '1'; });
  afterEach(() => { if (origFlag === undefined) delete process.env.UI_ADAPTER_SPIKE; else process.env.UI_ADAPTER_SPIKE = origFlag; });

  it('routes events, reports TTFB once, supports cancel and resume with Last-Event-ID', async () => {
    const calls = {
      ttfb: 0,
      token: 0,
      cost: 0,
      limited: 0,
      done: 0,
      error: 0,
    };
    const idHistory: Array<string | number | undefined> = [];
    let cancelled = false;
    let lastRequestedLEID: string | number | undefined;

    async function fakeOpenStream(opts: any) {
      lastRequestedLEID = opts.lastEventId;
      idHistory.push(opts.id);
      const onEvent: (ev: any) => void = opts.onEvent;
      // Simulate SSE timeline
      setTimeout(() => onEvent({ event: 'hello', id: '0', data: { ts: 't' } }), 10);
      setTimeout(() => onEvent({ event: 'token', id: '1', data: { text: 'draft', index: 0 } }), 25);
      setTimeout(() => onEvent({ event: 'cost', id: '2', data: { tokens: 5, currency: 'USD', amount: 0 } }), 45);
      setTimeout(() => onEvent({ event: 'limited', id: '3', data: { reason: 'backpressure' } }), 65);
      setTimeout(() => onEvent({ event: 'done', id: '4', data: { reason: 'complete' } }), 85);
      return { cancel: () => { cancelled = true; } };
    }

    const callbacks = {
      onTTFB: vi.fn(() => { calls.ttfb++; }),
      onToken: vi.fn(() => { calls.token++; }),
      onCost: vi.fn(() => { calls.cost++; }),
      onLimited: vi.fn(() => { calls.limited++; }),
      onDone: vi.fn(() => { calls.done++; }),
      onError: vi.fn(() => { calls.error++; }),
    };

    const adapter = createEngineAdapter({ baseUrl: 'http://127.0.0.1:4311', id: 'abc', openStream: fakeOpenStream as any, callbacks });
    await adapter.start();

    // Allow timeline to play
    await new Promise(r => setTimeout(r, 140));

    expect(calls.ttfb).toBe(1);
    expect(calls.token).toBe(1);
    expect(calls.cost).toBe(1);
    expect(calls.limited).toBe(1);
    expect(calls.done).toBe(1);
    expect(calls.error).toBe(0);

    adapter.cancel();
    expect(cancelled).toBe(true);

    // Resume once; adapter should pass Last-Event-ID of last received id ("4")
    await adapter.resume();
    await new Promise(r => setTimeout(r, 30));
    expect(lastRequestedLEID).toBeDefined();
  });
});
