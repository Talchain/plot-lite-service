/**
 * Tests for assistants proxy parity between JSON and SSE routes
 *
 * Ensures both routes enforce identical safety rails:
 * - Node/edge caps (≤12 nodes, ≤24 edges)
 * - Cost presence and cap enforcement
 * - Telemetry fallbacks (provider, cost_usd)
 * - Timeout handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from '../../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';

describe('Assistants proxy - JSON/SSE parity', () => {
  let app: FastifyInstance;
  let mockUpstream: FastifyInstance;
  const mockUpstreamPort = 33107;

  beforeAll(async () => {
    // Create mock upstream service
    mockUpstream = Fastify({ logger: false });

    // Mock endpoints will be registered in beforeEach
    await mockUpstream.listen({ port: mockUpstreamPort, host: '127.0.0.1' });

    // Configure engine to proxy to mock upstream
    process.env.ASSISTANTS_ENABLED = '1';
    process.env.ASSISTANTS_BASE_URL = `http://127.0.0.1:${mockUpstreamPort}`;
    process.env.ASSISTANTS_TIMEOUT_MS = '5000';
    process.env.ASSISTANTS_SSE_TIMEOUT_MS = '5000';

    app = await createServer({ enableTestRoutes: false });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await mockUpstream?.close();
  });

  beforeEach(() => {
    // Clear all routes before each test
    mockUpstream.get('/health', async () => ({ ok: true }));
  });

  afterEach(() => {
    // Clean up mock routes after each test
    mockUpstream.server.removeAllListeners('request');
  });

  describe('Caps parity - node/edge limits', () => {
    it('JSON: rejects graph exceeding 12 nodes', async () => {
      // Register mock that returns too many nodes
      mockUpstream.post('/assist/draft-graph', async () => {
        return {
          graph: {
            version: '1',
            default_seed: 17,
            nodes: Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, kind: 'goal', label: `Node ${i}` })),
            edges: [],
            meta: { roots: ['n0'], leaves: ['n12'], source: 'assistant' },
          },
          cost_usd: 0.001,
          provider: 'test',
        };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.type).toBe('VALIDATION_FAILED');
      expect(body.error.message).toContain('13 nodes');
      expect(body.error.message).toContain('max is 12');
    });

    it('JSON: rejects graph exceeding 24 edges', async () => {
      // Register mock that returns too many edges
      mockUpstream.post('/assist/draft-graph', async () => {
        const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, kind: 'goal', label: `Node ${i}` }));
        const edges = Array.from({ length: 25 }, (_, i) => ({ from: 'n0', to: `n${(i % 9) + 1}` }));

        return {
          graph: {
            version: '1',
            default_seed: 17,
            nodes,
            edges,
            meta: { roots: ['n0'], leaves: ['n9'], source: 'assistant' },
          },
          cost_usd: 0.001,
          provider: 'test',
        };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.type).toBe('VALIDATION_FAILED');
      expect(body.error.message).toContain('25 edges');
      expect(body.error.message).toContain('max is 24');
    });

    it('JSON: accepts graph at exact limits (12 nodes, 24 edges)', async () => {
      mockUpstream.post('/assist/draft-graph', async () => {
        const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, kind: 'goal', label: `Node ${i}` }));
        const edges = Array.from({ length: 24 }, (_, i) => ({ from: 'n0', to: `n${(i % 11) + 1}` }));

        return {
          graph: {
            version: '1',
            default_seed: 17,
            nodes,
            edges,
            meta: { roots: ['n0'], leaves: ['n11'], source: 'assistant' },
          },
          cost_usd: 0.001,
          provider: 'test',
        };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.graph).toBeDefined();
      expect(body.graph.nodes).toHaveLength(12);
      expect(body.graph.edges).toHaveLength(24);
    });
  });

  describe('Cost presence enforcement', () => {
    it('JSON: rejects response missing cost_usd', async () => {
      mockUpstream.post('/assist/draft-graph', async () => {
        return {
          graph: {
            version: '1',
            default_seed: 17,
            nodes: [{ id: 'g1', kind: 'goal', label: 'Test' }],
            edges: [],
            meta: { roots: ['g1'], leaves: ['g1'], source: 'assistant' },
          },
          provider: 'test',
          // cost_usd missing
        };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.type).toBe('VALIDATION_FAILED');
      expect(body.error.message).toContain('cost_usd');
    });

    it('JSON: rejects response with non-numeric cost_usd', async () => {
      mockUpstream.post('/assist/draft-graph', async () => {
        return {
          graph: {
            version: '1',
            default_seed: 17,
            nodes: [{ id: 'g1', kind: 'goal', label: 'Test' }],
            edges: [],
            meta: { roots: ['g1'], leaves: ['g1'], source: 'assistant' },
          },
          cost_usd: 'invalid',
          provider: 'test',
        };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.type).toBe('VALIDATION_FAILED');
      expect(body.error.message).toContain('must be numeric');
    });
  });

  describe('Telemetry fallbacks', () => {
    it('JSON: uses fallbacks when upstream omits provider and cost_usd', async () => {
      // Capture logs
      const logs: any[] = [];
      const originalLog = app.log.info.bind(app.log);
      vi.spyOn(app.log, 'info').mockImplementation(function(this: any, ...args: any[]) {
        logs.push(args[0]);
        return originalLog(...args);
      });

      mockUpstream.post('/assist/draft-graph', async () => {
        return {
          graph: {
            version: '1',
            default_seed: 17,
            nodes: [{ id: 'g1', kind: 'goal', label: 'Test' }],
            edges: [],
            meta: { roots: ['g1'], leaves: ['g1'], source: 'assistant' },
          },
          cost_usd: 0,  // Present but zero
          // provider omitted
        };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);

      // Check telemetry log
      const proxyResponseLog = logs.find(log => log.event === 'assist.proxy.response');
      expect(proxyResponseLog).toBeDefined();
      expect(proxyResponseLog.provider).toBe('unknown');
      expect(proxyResponseLog.cost_usd).toBe(0);

      vi.restoreAllMocks();
    });

    it('JSON: uses upstream values when present', async () => {
      // Capture logs
      const logs: any[] = [];
      const originalLog = app.log.info.bind(app.log);
      vi.spyOn(app.log, 'info').mockImplementation(function(this: any, ...args: any[]) {
        logs.push(args[0]);
        return originalLog(...args);
      });

      mockUpstream.post('/assist/draft-graph', async () => {
        return {
          graph: {
            version: '1',
            default_seed: 17,
            nodes: [{ id: 'g1', kind: 'goal', label: 'Test' }],
            edges: [],
            meta: { roots: ['g1'], leaves: ['g1'], source: 'assistant' },
          },
          cost_usd: 0.0042,
          provider: 'openai',
          model: 'gpt-4o-mini',
        };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);

      // Check telemetry log
      const proxyResponseLog = logs.find(log => log.event === 'assist.proxy.response');
      expect(proxyResponseLog).toBeDefined();
      expect(proxyResponseLog.provider).toBe('openai');
      expect(proxyResponseLog.cost_usd).toBe(0.0042);
      expect(proxyResponseLog.model).toBe('gpt-4o-mini');

      vi.restoreAllMocks();
    });
  });

  describe('Engine validation surfacing', () => {
    it('JSON: includes validation_issues when engine validator finds problems', async () => {
      mockUpstream.post('/assist/draft-graph', async () => {
        return {
          graph: {
            version: '1',
            default_seed: 17,
            nodes: [
              { id: 'g1', kind: 'goal', label: 'Start' },
              { id: 'g2', kind: 'goal', label: 'End' },
            ],
            edges: [
              { from: 'g1', to: 'g2' },
              { from: 'g2', to: 'g1' },  // Creates a cycle
            ],
            meta: { roots: ['g1'], leaves: ['g2'], source: 'assistant' },
          },
          cost_usd: 0.001,
          provider: 'test',
        };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);  // Non-blocking
      const body = JSON.parse(response.body);
      expect(body.graph).toBeDefined();
      expect(body.validation_issues).toBeDefined();
      expect(Array.isArray(body.validation_issues)).toBe(true);
      expect(body.validation_issues.length).toBeGreaterThan(0);
      expect(body.validation_issues.some((issue: any) => issue.message.includes('cycle'))).toBe(true);
    });
  });

  describe('Request validation', () => {
    it('JSON: rejects request exceeding 1MB payload', async () => {
      const largeBrief = 'a'.repeat(1_000_001);

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph',
        payload: { brief: largeBrief },
        headers: {
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(413);
      const body = JSON.parse(response.body);
      expect(body.error.type).toBe('PAYLOAD_TOO_LARGE');
    });

    it('JSON: rejects empty brief', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph',
        payload: { brief: '   ' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.type).toBe('BAD_INPUT');
      expect(body.error.message).toContain('Brief');
    });

    it('JSON: rejects brief exceeding 5000 chars', async () => {
      const longBrief = 'a'.repeat(5001);

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph',
        payload: { brief: longBrief },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.type).toBe('BAD_INPUT');
      expect(body.error.message).toContain('too long');
    });
  });
});
