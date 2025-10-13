import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import http from 'http';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;
let port = 0;
const prevAuth = process.env.AUTH_ENABLED;
const prevTestRoutes = process.env.TEST_ROUTES;

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.TEST_ROUTES = '1';
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prevAuth;
  if (prevTestRoutes === undefined) delete process.env.TEST_ROUTES; else process.env.TEST_ROUTES = prevTestRoutes;
});

async function runDemo() {
  const res = await fetch(`http://127.0.0.1:${port}/v1/run?demo=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return res.json();
}

function openStream() {
  return new Promise<string[]>((resolve, reject) => {
    const events: string[] = [];
    const req = http.get(`http://127.0.0.1:${port}/v1/stream?demo=1&latency_ms=10`, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => {
        buf += String(c);
        let m: RegExpMatchArray | null;
        while ((m = buf.match(/event:\s*(\w+)\s*\ndata:\s*(\{[^\n]*\})\s*\n\n/))) {
          const ev = m[1];
          events.push(ev);
          buf = buf.slice(m.index! + m[0].length);
          if (events.length >= 3) {
            try { req.destroy(); } catch {}
            return resolve(events);
          }
        }
      });
      res.on('end', () => resolve(events));
    });
    req.on('error', reject);
    setTimeout(() => { try { req.destroy(); } catch {}; resolve(events); }, 4000);
  });
}

describe('SDK JS smoke', () => {
  it('POST /v1/run (demo) returns a valid response_hash', async () => {
    const js = await runDemo();
    const rh = js?.model_card?.response_hash;
    expect(typeof rh).toBe('string');
    expect(rh).toMatch(/^[0-9a-f]{64}$/);
  });

  it('GET /v1/stream (demo) returns hello → token → done', async () => {
    const evs = await openStream();
    expect(evs.slice(0, 3)).toEqual(['hello', 'token', 'done']);
  });
});
