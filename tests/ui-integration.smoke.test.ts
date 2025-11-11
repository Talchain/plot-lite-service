import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import { BODY_LIMIT_BYTES } from '../src/config/constants.js';
import type { FastifyInstance } from 'fastify';

describe('UI Integration Smoke Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('HEAD /v1/run returns 204 with empty body', async () => {
    const res = await app.inject({
      method: 'HEAD',
      url: '/v1/run',
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('GET /v1/limits returns limits.v1 schema with correct max_body_kb', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/limits',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);

    // Verify schema
    expect(data.schema).toBe('limits.v1');

    // Verify required fields
    expect(typeof data.max_nodes).toBe('number');
    expect(typeof data.max_edges).toBe('number');
    expect(typeof data.max_body_kb).toBe('number');

    // Critical: advertised limit must match enforced limit
    const expectedKb = Math.floor(BODY_LIMIT_BYTES / 1024);
    expect(data.max_body_kb).toBe(expectedKb);
  });
});
