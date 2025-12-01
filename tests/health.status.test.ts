import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

let app: FastifyInstance;

beforeAll(async () => {
  // Use default test env (no auth, no special flags required)
  app = await createServer({ enableTestRoutes: false });
});

afterAll(async () => {
  await app?.close();
});

describe('GET /v1/health status fields', () => {
  it('exposes degraded flags and SLO budget while preserving status', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);

    const data = JSON.parse(res.body);

    // Backwards-compatible status
    expect(data.status).toBe('ok');

    // New health status fields
    expect(['ok', 'degraded']).toContain(data.health_status);
    expect(typeof data.degraded).toBe('boolean');

    // SLO budget derived from env or default
    expect(typeof data.slo_budget_ms).toBe('number');
    expect(data.slo_budget_ms).toBeGreaterThan(0);

    // degraded_reasons is optional; when present, must be an array of strings
    if (Array.isArray(data.degraded_reasons)) {
      for (const r of data.degraded_reasons) {
        expect(typeof r).toBe('string');
      }
    }
  });
});
