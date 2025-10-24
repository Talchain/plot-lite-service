/**
 * L1: /v1/limits endpoint tests
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import { startServer } from './helpers/server.js';
import type { FastifyInstance } from 'fastify';

describe('L1: /v1/limits endpoint', () => {
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

  it('returns limits with correct shape', async () => {
    const res = await fetch(`${baseUrl}/v1/limits`);
    expect(res.ok).toBe(true);
    
    const data = await res.json();
    expect(data).toEqual({
      max_nodes: 12,
      max_edges: 20,
      version: 1
    });
  });

  it('includes ETag header', async () => {
    const res = await fetch(`${baseUrl}/v1/limits`);
    const etag = res.headers.get('etag');
    
    expect(etag).toBeTruthy();
    expect(etag).toMatch(/^"/);  // Should be quoted
  });

  it('includes Cache-Control header', async () => {
    const res = await fetch(`${baseUrl}/v1/limits`);
    const cc = res.headers.get('cache-control');
    
    expect(cc).toContain('max-age=60');
    expect(cc).toContain('must-revalidate');
  });

  it('returns 304 when If-None-Match matches ETag', async () => {
    // First request to get ETag
    const res1 = await fetch(`${baseUrl}/v1/limits`);
    const etag = res1.headers.get('etag');
    expect(etag).toBeTruthy();
    
    // Second request with If-None-Match
    const res2 = await fetch(`${baseUrl}/v1/limits`, {
      headers: { 'If-None-Match': etag! }
    });
    
    expect(res2.status).toBe(304);
    const body = await res2.text();
    expect(body).toBe('');  // 304 has no body
  });

  it('returns 200 when If-None-Match does not match', async () => {
    const res = await fetch(`${baseUrl}/v1/limits`, {
      headers: { 'If-None-Match': '"wrong-etag"' }
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.max_nodes).toBe(12);
  });

  it('ETag remains stable across requests', async () => {
    const res1 = await fetch(`${baseUrl}/v1/limits`);
    const etag1 = res1.headers.get('etag');
    
    const res2 = await fetch(`${baseUrl}/v1/limits`);
    const etag2 = res2.headers.get('etag');
    
    expect(etag1).toBe(etag2);
  });
});
