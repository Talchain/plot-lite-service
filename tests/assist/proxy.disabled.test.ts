/**
 * Tests for assistants proxy when disabled (ASSISTANTS_ENABLED=0)
 *
 * Verifies that all /assist/* routes return 404 when feature is disabled.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Assistants proxy - disabled', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Disable assistants
    process.env.ASSISTANTS_ENABLED = '0';
    delete process.env.ASSISTANTS_BASE_URL;

    app = await createServer({ enableTestRoutes: false });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('POST /assist/draft-graph returns 404 when disabled', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/assist/draft-graph',
      payload: { brief: 'Test brief' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('POST /assist/draft-graph/stream returns 404 when disabled', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/assist/draft-graph/stream',
      payload: { brief: 'Test brief' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('POST /assist/suggest-options returns 404 when disabled', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/assist/suggest-options',
      payload: { goal: 'Test goal' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('POST /assist/explain-diff returns 404 when disabled', async () => {
    const sampleGraph = {
      version: '1',
      default_seed: 17,
      nodes: [{ id: 'g1', kind: 'goal', label: 'Test' }],
      edges: [],
      meta: { roots: ['g1'], leaves: ['g1'], source: 'assistant' },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/assist/explain-diff',
      payload: { before: sampleGraph, after: sampleGraph },
    });

    expect(response.statusCode).toBe(404);
  });

  it('/health shows assistants_enabled: false when disabled', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.assistants_enabled).toBe(false);
    expect(body).not.toHaveProperty('assistants_base_url');
    expect(body).not.toHaveProperty('assistants_upstream_status');
  });
});
