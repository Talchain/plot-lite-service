import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('CORS: CORS_ORIGINS CSV', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.CORS_ORIGINS = 'https://app.example.com,https://staging.example.com';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app.close();
    delete process.env.CORS_ORIGINS;
  });

  it('echoes Access-Control-Allow-Origin for allowed origin', async () => {
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: 'https://app.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });
});
