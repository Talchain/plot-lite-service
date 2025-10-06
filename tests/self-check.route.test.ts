import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('GET /v1/self-check', () => {
  let app: FastifyInstance;
  let port: number;

  // Capture original env to restore after suite
  const prevTestRoutes = process.env.TEST_ROUTES;

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    app = await createServer({ enableTestRoutes: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
    
    // Restore env to original state (including undefined)
    if (prevTestRoutes === undefined) {
      delete process.env.TEST_ROUTES;
    } else {
      process.env.TEST_ROUTES = prevTestRoutes;
    }
  });

  it('returns 404 when TEST_ROUTES is not set', async () => {
    // Temporarily unset TEST_ROUTES
    delete process.env.TEST_ROUTES;
    
    // Create new server instance without TEST_ROUTES
    const testApp = await createServer({ enableTestRoutes: false });
    await testApp.listen({ port: 0, host: '127.0.0.1' });
    const testAddr = testApp.server.address();
    const testPort = typeof testAddr === 'object' && testAddr ? testAddr.port : 0;
    
    const res = await fetch(`http://127.0.0.1:${testPort}/v1/self-check`);
    expect(res.status).toBe(404);
    
    await testApp.close();
    
    // Restore TEST_ROUTES for remaining tests
    process.env.TEST_ROUTES = '1';
  });

  it('returns schema self_check.v1 with fixed seed', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/self-check`);
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.schema).toBe('self_check.v1');
    expect(data.seed).toBe(42);
    expect(typeof data.hash).toBe('string');
    expect(data.hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    expect(typeof data.bytes).toBe('number');
    expect(data.bytes).toBeGreaterThan(0);
    expect(Array.isArray(data.notes)).toBe(true);
  });

  it('returns identical hash across 10 consecutive calls', async () => {
    const hashes: string[] = [];
    const bytes: number[] = [];
    
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/v1/self-check`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      hashes.push(data.hash);
      bytes.push(data.bytes);
    }
    
    // All hashes must be identical
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(1);
    
    // All byte counts must be identical
    const uniqueBytes = new Set(bytes);
    expect(uniqueBytes.size).toBe(1);
    
    // Verify hash format
    expect(hashes[0]).toMatch(/^[a-f0-9]{64}$/);
    
    // Verify bytes is positive
    expect(bytes[0]).toBeGreaterThan(0);
  });
});
