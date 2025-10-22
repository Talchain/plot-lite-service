/**
 * P2-1: Stream Canary Header Tests
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer } from './helpers/server.js';
import type { FastifyInstance } from 'fastify';

describe('P2-1: Stream Canary Header', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    const { server, url } = await createTestServer();
    app = server;
    baseUrl = url;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('accepts canonical header X-Enable-Enhanced-Stream', async () => {
    const res = await fetch(`${baseUrl}/v1/stream?demo=1`, {
      headers: { 'X-Enable-Enhanced-Stream': '1' }
    });
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('accepts legacy header X-Stream-Enhanced', async () => {
    const res = await fetch(`${baseUrl}/v1/stream?demo=1`, {
      headers: { 'X-Stream-Enhanced': 'true' }
    });
    expect(res.ok).toBe(true);
  });

  it('accepts truthy values case-insensitive', async () => {
    for (const val of ['1', 'TRUE', 'yes', 'ON']) {
      const res = await fetch(`${baseUrl}/v1/stream?demo=1`, {
        headers: { 'X-Enable-Enhanced-Stream': val }
      });
      expect(res.ok).toBe(true);
    }
  });

  it('works without headers (backward compat)', async () => {
    const res = await fetch(`${baseUrl}/v1/stream?demo=1`);
    expect(res.ok).toBe(true);
  });
});
