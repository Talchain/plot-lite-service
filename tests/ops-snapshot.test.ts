import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('/ops/snapshot', () => {
  describe('Flag OFF', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      delete process.env.OPS_SNAPSHOT_ENABLE;
      app = await createServer({ enableTestRoutes: false });
    });
    afterAll(async () => await app?.close());
    it('404 when OFF', async () => {
      const res = await app.inject({ method: 'GET', url: '/ops/snapshot' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('Flag ON', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      process.env.OPS_KEY = 'test';
      process.env.OPS_SNAPSHOT_ENABLE = '1';
      app = await createServer({ enableTestRoutes: false });
    });
    afterAll(async () => {
      delete process.env.OPS_KEY;
      delete process.env.OPS_SNAPSHOT_ENABLE;
      await app?.close();
    });

    it('401 without key', async () => {
      const res = await app.inject({ method: 'GET', url: '/ops/snapshot' });
      expect(res.statusCode).toBe(401);
    });

    it('200 with valid key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ops/snapshot',
        headers: { 'X-OPS-KEY': 'test' },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.schema).toBe('ops.snapshot.v1');
      expect(data).toHaveProperty('caches');
      expect(data).toHaveProperty('flags');
    });

    it('no secrets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ops/snapshot',
        headers: { 'X-OPS-KEY': 'test' },
      });
      expect(res.body).not.toContain('Bearer');
      expect(res.body).not.toContain('test');
    });
  });
});
