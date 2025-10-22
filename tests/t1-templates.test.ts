/**
 * T1: Templates registry tests
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import { startServer } from './helpers/server.js';
import type { FastifyInstance } from 'fastify';

describe('T1: Templates registry', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.AUTH_ENABLED = '0';
    app = await createServer();
    const ctx = await startServer(app);
    baseUrl = ctx.baseUrl;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /v1/templates', () => {
    it('returns list of templates', async () => {
      const res = await fetch(`${baseUrl}/v1/templates`);
      expect(res.ok).toBe(true);
      
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('includes metadata without graph', async () => {
      const res = await fetch(`${baseUrl}/v1/templates`);
      const data = await res.json();
      
      const template = data[0];
      expect(template).toHaveProperty('id');
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('version');
      expect(template).toHaveProperty('description');
      expect(template).toHaveProperty('hash');
      expect(template).not.toHaveProperty('graph');
    });

    it('includes ETag and Cache-Control', async () => {
      const res = await fetch(`${baseUrl}/v1/templates`);
      expect(res.headers.get('etag')).toBeTruthy();
      expect(res.headers.get('cache-control')).toContain('max-age=60');
    });

    it('returns 304 on matching If-None-Match', async () => {
      const res1 = await fetch(`${baseUrl}/v1/templates`);
      const etag = res1.headers.get('etag');
      
      const res2 = await fetch(`${baseUrl}/v1/templates`, {
        headers: { 'If-None-Match': etag! }
      });
      
      expect(res2.status).toBe(304);
    });
  });

  describe('GET /v1/templates/:id', () => {
    it('returns full template with graph', async () => {
      const res = await fetch(`${baseUrl}/v1/templates/pricing-change-v1`);
      expect(res.ok).toBe(true);
      
      const data = await res.json();
      expect(data).toHaveProperty('id', 'pricing-change-v1');
      expect(data).toHaveProperty('graph');
      expect(data.graph).toHaveProperty('nodes');
      expect(data.graph).toHaveProperty('edges');
    });

    it('includes default_seed', async () => {
      const res = await fetch(`${baseUrl}/v1/templates/pricing-change-v1`);
      const data = await res.json();
      
      expect(data).toHaveProperty('default_seed');
      expect(typeof data.default_seed).toBe('number');
    });

    it('returns 404 for unknown template', async () => {
      const res = await fetch(`${baseUrl}/v1/templates/nonexistent`);
      expect(res.status).toBe(404);
      
      const data = await res.json();
      expect(data).toHaveProperty('error');
    });

    it('includes ETag based on template hash', async () => {
      const res = await fetch(`${baseUrl}/v1/templates/pricing-change-v1`);
      const etag = res.headers.get('etag');
      
      expect(etag).toBeTruthy();
      expect(etag).toMatch(/^"/);
    });

    it('returns 304 on matching If-None-Match', async () => {
      const res1 = await fetch(`${baseUrl}/v1/templates/pricing-change-v1`);
      const etag = res1.headers.get('etag');
      
      const res2 = await fetch(`${baseUrl}/v1/templates/pricing-change-v1`, {
        headers: { 'If-None-Match': etag! }
      });
      
      expect(res2.status).toBe(304);
    });

    it('enforces graph size limits', async () => {
      const res = await fetch(`${baseUrl}/v1/templates/pricing-change-v1`);
      const data = await res.json();
      
      expect(data.graph.nodes.length).toBeLessThanOrEqual(12);
      expect(data.graph.edges.length).toBeLessThanOrEqual(20);
    });
  });
});
