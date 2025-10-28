import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('Templates ETag behaviour', () => {
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

  it('returns strong ETag and 304 on If-None-Match', async () => {
    const r1 = await fetch(`${base}/v1/templates/small/graph`);
    expect(r1.status).toBe(200);
    const etag = r1.headers.get('etag');
    expect(etag && etag.startsWith('"') && etag.endsWith('"')).toBe(true);

    const r2 = await fetch(`${base}/v1/templates/small/graph`, {
      headers: { 'If-None-Match': etag || '' }
    });
    expect(r2.status).toBe(304);
  });
});
