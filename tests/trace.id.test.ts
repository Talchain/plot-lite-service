import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import http from 'http';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;
let port = 0;
const prevAuth = process.env.AUTH_ENABLED;
const prevTestRoutes = process.env.TEST_ROUTES;
const prevTrace = process.env.TRACE_MIN;
const prevDemoMode = process.env.DEMO_MODE_ENABLED;

async function postRunDemo(): Promise<any> {
  const url = `http://127.0.0.1:${port}/v1/run?demo=1`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const js = await res.json();
  return js;
}

async function readHelloTrace(): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/v1/stream?demo=1' }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += String(c);
        if (buf.includes('\nevent: hello') || buf.startsWith('event: hello') || buf.includes('event: hello')) {
          const m = buf.match(/data:\s*(\{.*\})/);
          if (m) {
            try { const obj = JSON.parse(m[1]); resolve(obj.trace_id); } catch { /* ignore */ }
          }
          try { (req as any).destroy(); } catch {}
        }
      });
      res.on('end', () => resolve(undefined));
    });
    req.on('error', reject);
    setTimeout(() => { try { (req as any).destroy(); } catch {}; resolve(undefined); }, 4000);
  });
}

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.TEST_ROUTES = '1';
  process.env.DEMO_MODE_ENABLED = '1';
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prevAuth;
  if (prevTestRoutes === undefined) delete process.env.TEST_ROUTES; else process.env.TEST_ROUTES = prevTestRoutes;
  if (prevTrace === undefined) delete process.env.TRACE_MIN; else process.env.TRACE_MIN = prevTrace;
  if (prevDemoMode === undefined) delete process.env.DEMO_MODE_ENABLED; else process.env.DEMO_MODE_ENABLED = prevDemoMode;
});

describe('Trace ID (TRACE_MIN)', () => {
  it('adds trace_id to /v1/run when TRACE_MIN=1 and omits when not set', async () => {
    delete process.env.TRACE_MIN;
    const off = await postRunDemo();
    expect(off.trace_id).toBeUndefined();

    process.env.TRACE_MIN = '1';
    const on = await postRunDemo();
    expect(typeof on.trace_id).toBe('string');
    expect(on.trace_id).toMatch(/^[0-9a-fA-F-]{36}$/);
  });

  it('adds trace_id to first SSE hello when TRACE_MIN=1', async () => {
    process.env.TRACE_MIN = '1';
    const t = await readHelloTrace();
    expect(typeof t).toBe('string');
    expect(String(t)).toMatch(/^[0-9a-fA-F-]{36}$/);
  });
}, 10000);
