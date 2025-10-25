import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { collectEventsUntil } from '../helpers/sse.js';

function baseUrl(app: FastifyInstance) {
  const addr = app.server.address() as any;
  return `http://127.0.0.1:${addr.port}`;
}

function makeGraph() {
  return {
    nodes: [
      { id: 'A', label: 'A' },
      { id: 'B', label: 'B' }
    ],
    edges: [
      { from: 'A', to: 'B', label: 'A->B' }
    ]
  } as any;
}

async function openRunStream(app: FastifyInstance, body: any, headers: Record<string,string> = {}) {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl(app)}/v1/run/stream`, {
    method: 'POST',
    headers: { 'Accept': 'text/event-stream', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  if (!res.ok) return { res, reader: null as any, controller };
  const reader = res.body!.getReader();
  return { res, reader, controller };
}

function parseData<T = any>(s?: string): T | null { try { return s ? JSON.parse(s) : null; } catch { return null; } }

describe('E2E: POST /v1/run/stream', () => {
  let app: FastifyInstance;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.SSE_HEARTBEAT_MS = '1000';
    process.env.SSE_FINALIZE_DELAY_MS = '1000';
    process.env.PROMETHEUS_ENABLE = '1';
    process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = 'a'.repeat(64);
    app = await createServer();
    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  it('happy path: RUN_STARTED → PROGRESS(≤90, monotonic) → COMPLETE', async () => {
    const { res, reader, controller } = await openRunStream(app, { graph: makeGraph(), seed: 4242 });
    expect(res.ok).toBe(true);
    expect((res.headers.get('content-type') || '').includes('text/event-stream')).toBe(true);

    const events = await collectEventsUntil(reader, evts => evts.some(e => e.event === 'COMPLETE'), 7000);

    // Cleanup reader
    try { await reader.cancel(); } catch {}
    controller.abort();

    const types = events.map(e => e.event);
    expect(types[0]).toBe('RUN_STARTED');
    expect(types.includes('PROGRESS')).toBe(true);
    expect(types.includes('COMPLETE')).toBe(true);

    // PROGRESS monotonic and <= 90 until final PROGRESS (100 at end)
    let last = -1;
    for (const e of events) {
      if (e.event === 'PROGRESS') {
        const d = parseData<any>(e.data);
        if (d.pct < 100) expect(d.pct).toBeLessThanOrEqual(90);
        expect(d.pct).toBeGreaterThanOrEqual(last);
        last = d.pct;
      }
    }

    // COMPLETE has report.schema === 'run.v1'
    const complete = events.find(e => e.event === 'COMPLETE');
    const compData = parseData<any>(complete?.data);
    expect(compData?.report?.schema).toBe('run.v1');
  }, 12000);

  it('cancel: POST /v1/run/{id}/cancel → ERROR{CANCELLED} then close', async () => {
    const { res, reader, controller } = await openRunStream(app, { graph: makeGraph(), seed: 4242 });
    expect(res.ok).toBe(true);
    const events = await collectEventsUntil(reader, evts => evts.some(e => e.event === 'RUN_STARTED'), 3000);
    const started = events.find(e => e.event === 'RUN_STARTED');
    const run_id = parseData<any>(started?.data)?.run_id;
    expect(typeof run_id).toBe('string');

    // Issue cancel
    const cancelRes = await fetch(`${baseUrl(app)}/v1/run/${run_id}/cancel`, { method: 'POST' });
    expect(cancelRes.status).toBe(200);

    // Expect ERROR CANCELLED to arrive
    const events2 = await collectEventsUntil(reader, evts => evts.some(e => e.event === 'ERROR'), 5000);
    const errEv = events2.find(e => e.event === 'ERROR');
    const errData = parseData<any>(errEv?.data);
    expect(errData?.code).toBe('CANCELLED');

    try { await reader.cancel(); } catch {}
    controller.abort();
  }, 12000);

  it('timeout: SSE_MAX_MS short → ERROR{TIMEOUT}', async () => {
    // Separate server instance with short timeout
    const app2 = await (async () => {
      const prev = { ...process.env };
      process.env.SSE_MAX_MS = '200';
      process.env.SSE_HEARTBEAT_MS = '100';
      process.env.SSE_FINALIZE_DELAY_MS = '500';
      process.env.PROMETHEUS_ENABLE = '1';
      process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = 'a'.repeat(64);
      const a = await createServer();
      await a.listen({ port: 0 });
      // restore env snapshot for later tests; server keeps its own
      process.env = prev;
      return a;
    })();

    const { res, reader, controller } = await openRunStream(app2, { graph: makeGraph() });
    expect(res.ok).toBe(true);
    const events = await collectEventsUntil(reader, evts => evts.some(e => e.event === 'ERROR'), 5000);
    const err = parseData<any>(events.find(e => e.event === 'ERROR')?.data);
    expect(err?.code).toBe('TIMEOUT');

    try { await reader.cancel(); } catch {}
    controller.abort();
    await app2.close();
  }, 12000);

  it('limiter: exceed per-IP/global slots ⇒ 429', async () => {
    // New app with strict caps
    const app3 = await (async () => {
      const prev = { ...process.env };
      process.env.SSE_PER_IP_MAX = '1';
      process.env.SSE_GLOBAL_MAX = '1';
      process.env.SSE_FINALIZE_DELAY_MS = '1000';
      process.env.PROMETHEUS_ENABLE = '1';
      process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = 'a'.repeat(64);
      const a = await createServer();
      await a.listen({ port: 0 });
      process.env = prev;
      return a;
    })();

    // Open first stream and keep it alive briefly
    const s1 = await openRunStream(app3, { graph: makeGraph() });
    expect(s1.res.ok).toBe(true);

    // Second should be rate-limited
    const s2 = await fetch(`${baseUrl(app3)}/v1/run/stream`, {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: makeGraph() }),
    });
    expect(s2.status).toBe(429);

    // Cleanup
    try { await s1.reader.cancel(); } catch {}
    s1.controller.abort();
    await app3.close();
  }, 12000);

  it('heartbeat cadence ≈ SSE_HEARTBEAT_MS', async () => {
    const app4 = await (async () => {
      const prev = { ...process.env };
      process.env.SSE_HEARTBEAT_MS = '200';
      process.env.SSE_FINALIZE_DELAY_MS = '800';
      process.env.PROMETHEUS_ENABLE = '1';
      process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = 'a'.repeat(64);
      const a = await createServer();
      await a.listen({ port: 0 });
      process.env = prev;
      return a;
    })();

    const { res, reader, controller } = await openRunStream(app4, { graph: makeGraph() });
    expect(res.ok).toBe(true);

    // Collect until two HEARTBEATs observed or timeout
    const hbTimes: number[] = [];
    const start = Date.now();
    const decoder = new TextDecoder();
    let buffer = '';
    while (Date.now() - start < 4000 && hbTimes.length < 2) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('event:') && line.includes('HEARTBEAT')) {
          hbTimes.push(Date.now());
        }
      }
    }

    expect(hbTimes.length).toBeGreaterThanOrEqual(2);
    const interval = hbTimes[1] - hbTimes[0];
    expect(interval).toBeGreaterThanOrEqual(120);
    expect(interval).toBeLessThanOrEqual(400);

    try { await reader.cancel(); } catch {}
    controller.abort();
    await app4.close();
  }, 12000);
});
