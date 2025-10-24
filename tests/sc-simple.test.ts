import { describe, it, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('SC simple', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    app = await createServer({ enableTestRoutes: true });
  });

  afterAll(async () => {
    await app.close();
    delete process.env.TEST_ROUTES;
  });

  it('get hash', async () => {
    const sc = await app.inject({ method: 'GET', url: '/v1/self-check' });
    const body = sc.json();
    console.log('\nSelf-check response:', JSON.stringify(body, null, 2));
  });
});
