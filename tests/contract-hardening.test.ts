/**
 * WP-P4: Contract Hardening Tests
 * Verifies strict AJV validation with friendly errors (code, field, hint)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Contract Hardening (WP-P4)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ enableTestRoutes: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Request Validation', () => {
    it('rejects missing required field (graph)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run',
        headers: { 'Content-Type': 'application/json' },
        payload: { outcome_node: 'A' },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.code).toBe('BAD_INPUT');
      expect(data.field).toBe('graph');
      expect(data.hint).toContain('Include');
    });

    it('rejects unknown field (graphX)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          graph: { nodes: [], edges: [] },
          graphX: { nodes: [], edges: [] },
          outcome_node: 'A',
        },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.code).toBe('BAD_INPUT');
      expect(data.field).toBe('graphX');
      expect(data.hint).toContain('Remove');
    });

    it('rejects wrong type (seed as string)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          graph: { nodes: [{ id: 'A' }], edges: [] },
          outcome_node: 'A',
          seed: 'not-a-number',
        },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.code).toBe('BAD_INPUT');
    });

    it('accepts valid minimal request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
          outcome_node: 'A',
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it('accepts valid full request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          graph: {
            nodes: [
              { id: 'A', label: 'A' },
              { id: 'B', label: 'B' },
            ],
            edges: [{ from: 'A', to: 'B', weight: 0.5 }],
          },
          outcome_node: 'B',
          seed: 4242,
          k_samples: 1000,
          treatment_node: 'A',
          baseline_value: 100,
        },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('Error Format', () => {
    it('includes code, field, hint in error response', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run',
        headers: { 'Content-Type': 'application/json' },
        payload: { extra_field: 'value' },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data).toHaveProperty('code');
      expect(data).toHaveProperty('field');
      expect(data).toHaveProperty('hint');
      expect(data).toHaveProperty('message');
      expect(data.code).toBe('BAD_INPUT');
    });
  });
});
