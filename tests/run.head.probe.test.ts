import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('HEAD /v1/run capability probe', () => {
  let app: FastifyInstance;
  let base: string;

  beforeAll(async () => {
    delete process.env.AUTH_ENABLED;
    app = await createServer({});
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 405 with Allow header', async () => {
    const res = await fetch(`${base}/v1/run`, { method: 'HEAD' });
    expect(res.status).toBe(405);
    const allow = res.headers.get('allow') || res.headers.get('Allow') || '';
    expect(allow.includes('POST')).toBe(true);
    expect(allow.includes('OPTIONS')).toBe(true);
    expect(allow.includes('HEAD')).toBe(true);
  });
});
