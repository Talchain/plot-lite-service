import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import http from 'http';

let app: FastifyInstance;
let port = 0;
const prevs: Record<string, string | undefined> = {
  TEST_ROUTES: process.env.TEST_ROUTES,
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
  TRUST_PROXY: process.env.TRUST_PROXY,
  MAX_RATE_KEYS: process.env.MAX_RATE_KEYS,
  AUTH_ENABLED: process.env.AUTH_ENABLED,
};

beforeAll(async () => {
  process.env.TEST_ROUTES = '1';
  process.env.RATE_LIMIT_ENABLED = '1';
  process.env.TRUST_PROXY = '1';
  process.env.MAX_RATE_KEYS = '50';
  process.env.AUTH_ENABLED = '0';
  const { createServer } = await import('../src/createServer.js');
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  for (const k of Object.keys(prevs)) {
    const v = (prevs as any)[k];
    if (v === undefined) delete (process.env as any)[k]; else (process.env as any)[k] = v;
  }
});

function postDraft(ip: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: '/v1/draft',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    }, res => {
      const code = res.statusCode || 0;
      res.resume();
      res.on('end', () => resolve(code));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ description: 'x' }));
    req.end();
  });
}

describe('rate limiter pruning and IPv6 safety', () => {
  it('bounds key map size and handles IPv6 addresses', async () => {
    const ips: string[] = [];
    for (let i = 0; i < 120; i++) ips.push(`10.0.${Math.floor(i/255)}.${i%255}`);
    ips.push('2001:db8::1');
    const codes = await Promise.all(ips.map(ip => postDraft(ip)));
    expect(codes.includes(200)).toBe(true);
    const { __rateLimitKeyCount } = await import('../src/rateLimit.js');
    expect(__rateLimitKeyCount()).toBeLessThanOrEqual(50);
  });
});
