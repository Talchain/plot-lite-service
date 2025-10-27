import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('OpenAPI serving (/v1/openapi.json)', () => {
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

  it('serves JSON with expected top-level fields', async () => {
    const res = await fetch(`${base}/v1/openapi.json`);
    expect(res.status).toBe(200);
    const ctype = res.headers.get('content-type') || '';
    expect(ctype.includes('application/json')).toBe(true);
    const obj = await res.json();
    expect(obj).toHaveProperty('openapi');
    expect(obj).toHaveProperty('info');
    expect(obj.info).toHaveProperty('title');
  });
});
