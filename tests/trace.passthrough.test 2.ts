import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import http from 'http';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;
let port = 0;
const prevAuth = process.env.AUTH_ENABLED;
const prevTestRoutes = process.env.TEST_ROUTES;
const prevTracePass = process.env.TRACE_ID_PASSTHROUGH;

function headerValue(res: Response | any, name: string): string | undefined {
  const h = (res as any).headers || {};
  const v = h.get ? h.get(name) : h[name.toLowerCase()];
  return v ? String(v) : undefined;
}

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.TEST_ROUTES = '1';
  delete process.env.TRACE_ID_PASSTHROUGH;
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prevAuth;
  if (prevTestRoutes === undefined) delete process.env.TEST_ROUTES; else process.env.TEST_ROUTES = prevTestRoutes;
  if (prevTracePass === undefined) delete process.env.TRACE_ID_PASSTHROUGH; else process.env.TRACE_ID_PASSTHROUGH = prevTracePass;
});

describe('trace passthrough (opt-in, JSON-only)', () => {
  it('default off: no trace_id in JSON v1 responses', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': 'abc123' },
      body: JSON.stringify({ description: 'hello' }),
    });
    expect(r.status).toBe(200);
    // JSON-only security headers
    expect(headerValue(r as any, 'x-content-type-options')).toBe('nosniff');
    expect(headerValue(r as any, 'referrer-policy')).toBe('no-referrer');
    expect(String(headerValue(r as any, 'cache-control'))).toContain('no-store');
    const j = await r.json();
    expect(j).toBeTruthy();
    expect('trace_id' in j).toBe(false);
  });

  it('enabled: inject trace_id in JSON v1 responses; never for SSE', async () => {
    // Enable passthrough and restart server to ensure hook reads env
    await app.close();
    process.env.TRACE_ID_PASSTHROUGH = '1';
    app = await createServer({ enableTestRoutes: true });
    await app.listen({ port: port, host: '127.0.0.1' });

    // JSON route carries trace_id
    const r = await fetch(`http://127.0.0.1:${port}/v1/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': 'abc123' },
      body: JSON.stringify({ description: 'world' }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.trace_id).toBe('abc123');

    // SSE never injects trace_id via passthrough; validate headers/body
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/v1/stream?latency_ms=0`, res => {
        try {
          expect(res.statusCode).toBe(200);
          const ct = res.headers['content-type'] || res.headers['Content-Type'];
          expect(String(ct)).toContain('text/event-stream');
          let buf = '';
          res.on('data', chunk => (buf += chunk.toString('utf8')));
          res.on('end', () => {
            // Should not echo abc123 anywhere
            expect(buf.includes('abc123')).toBe(false);
            resolve();
          });
        } catch (e) { reject(e); }
      });
      req.on('error', reject);
      setTimeout(() => reject(new Error('Timeout')), 4000);
    });
  });
});
