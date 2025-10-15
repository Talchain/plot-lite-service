import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('OpenAPI exposure', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ enableTestRoutes: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /openapi.json returns 200 with valid JSON', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    
    const json = res.json();
    expect(json).toHaveProperty('openapi');
    expect(json).toHaveProperty('info');
    expect(json).toHaveProperty('paths');
  });

  it('/openapi.json includes /v1/run path', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    const json = res.json();
    expect(json.paths).toHaveProperty('/v1/run');
    expect(json.paths['/v1/run']).toHaveProperty('post');
  });

  it('/openapi.json includes /v1/health path', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    const json = res.json();
    expect(json.paths).toHaveProperty('/v1/health');
    expect(json.paths['/v1/health']).toHaveProperty('get');
  });

  it('/openapi.json includes /version path', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    const json = res.json();
    expect(json.paths).toHaveProperty('/version');
    expect(json.paths['/version']).toHaveProperty('get');
  });

  it('GET /docs returns 200 (Swagger UI)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docs',
    });

    // Swagger UI redirects to /docs/ or returns HTML
    expect([200, 301, 302]).toContain(res.statusCode);
  });

  it('/openapi.json has security schemes for bearer auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    const json = res.json();
    expect(json.components).toHaveProperty('securitySchemes');
    expect(json.components.securitySchemes).toHaveProperty('bearerAuth');
  });
});
