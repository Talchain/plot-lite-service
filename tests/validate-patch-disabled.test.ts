/**
 * Validate-patch FEATURE_DISABLED response shape lock test (Medium 1)
 *
 * When ENABLE_VALIDATE_PATCH=0, POST /v1/validate-patch must return:
 *   HTTP 501
 *   { status: 'rejected', code: 'FEATURE_DISABLED', message: string }
 *
 * This locks the disabled-path contract so callers (CEE, UI) can detect
 * the flag state without parsing error messages.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('validate-patch: FEATURE_DISABLED response when flag OFF', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ENABLE_VALIDATE_PATCH = '0';
    process.env.RATE_LIMIT_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ENABLE_VALIDATE_PATCH;
  });

  it('returns HTTP 501 when ENABLE_VALIDATE_PATCH=0', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/validate-patch',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: {
          nodes: [{ id: 'goal', kind: 'goal', label: 'G' }],
          edges: [],
        },
        operations: [],
      },
    });

    expect(res.statusCode).toBe(501);
  });

  it('response body has status=rejected, code=FEATURE_DISABLED, message string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/validate-patch',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: {
          nodes: [{ id: 'goal', kind: 'goal', label: 'G' }],
          edges: [],
        },
        operations: [],
      },
    });

    const body = JSON.parse(res.payload);
    expect(body.status).toBe('rejected');
    expect(body.code).toBe('FEATURE_DISABLED');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('response body contains no graph or repairs_applied (disabled path returns error envelope only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/validate-patch',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph: {
          nodes: [{ id: 'goal', kind: 'goal', label: 'G' }],
          edges: [],
        },
        operations: [],
      },
    });

    const body = JSON.parse(res.payload);
    expect(body).not.toHaveProperty('graph');
    expect(body).not.toHaveProperty('graph_hash');
    expect(body).not.toHaveProperty('repairs_applied');
  });
});
