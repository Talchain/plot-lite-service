import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('v1 router coexistence: templates + stream', () => {
  let app: FastifyInstance;
  let base: string;

  beforeAll(async () => {
    delete process.env.AUTH_ENABLED;
    process.env.STREAM_PARITY_ENABLE = '0';
    process.env.DEMO_MODE_ENABLED = '1';
    app = await createServer({});
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/templates -> 200', async () => {
    const res = await fetch(`${base}/v1/templates`);
    expect(res.status).toBe(200);
    const arr = await res.json();
    expect(Array.isArray(arr)).toBe(true);
  });

  it('GET /v1/stream?demo=1 -> 200 text/event-stream', async () => {
    const res = await fetch(`${base}/v1/stream?demo=1`);
    expect(res.status).toBe(200);
    const ctype = res.headers.get('content-type') || '';
    expect(ctype.includes('text/event-stream')).toBe(true);
    // Close stream
    await res.body?.cancel?.();
  });
});
