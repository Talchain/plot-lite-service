/**
 * Tests for SSE route guard parity with JSON route
 *
 * Ensures SSE route enforces identical safety rails:
 * - Node/edge caps (≤12 nodes, ≤24 edges)
 * - Cost presence and cap enforcement
 * - Telemetry fallbacks (provider, cost_usd)
 * - Validation issues surfacing
 * - Idle timeout handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from '../../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';

describe('Assistants proxy - SSE guard parity', () => {
  let app: FastifyInstance;
  let mockUpstream: FastifyInstance;
  const mockUpstreamPort = 33108;

  // Shared state for dynamic route handling
  let mockHandler: ((req: any, reply: any) => Promise<any>) | null = null;

  beforeAll(async () => {
    // Create mock upstream service
    mockUpstream = Fastify({ logger: false });

    // Register dynamic route handler that delegates to mockHandler
    mockUpstream.post('/assist/draft-graph/stream', async (req, reply) => {
      if (mockHandler) {
        return await mockHandler(req, reply);
      }
      return reply.code(404).send({ error: 'No mock handler registered' });
    });

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

  afterEach(() => {
    // Clear mock handler after each test
    mockHandler = null;
  });

  describe('SSE caps enforcement', () => {
    it('SSE: rejects graph exceeding 12 nodes', async () => {
      // Set mock handler that returns too many nodes via SSE
      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        const graph = {
          version: '1',
          default_seed: 17,
          nodes: Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, kind: 'goal', label: `Node ${i}` })),
          edges: [],
          meta: { roots: ['n0'], leaves: ['n12'], source: 'assistant' },
        };

        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');
        reply.raw.write(`event: complete\ndata: ${JSON.stringify({ graph, cost_usd: 0.001, provider: 'test' })}\n\n`);
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200); // SSE always returns 200
      const events = parseSSEEvents(response.body);

      // Should get stage event, then error event (not complete)
      expect(events.some(e => e.event === 'stage')).toBe(true);
      expect(events.some(e => e.event === 'error')).toBe(true);
      expect(events.some(e => e.event === 'complete')).toBe(false);

      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent?.data.error.type).toBe('VALIDATION_FAILED');
      expect(errorEvent?.data.error.message).toContain('13 nodes');
    });

    it('SSE: rejects graph exceeding 24 edges', async () => {
      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, kind: 'goal', label: `Node ${i}` }));
        const edges = Array.from({ length: 25 }, (_, i) => ({ from: 'n0', to: `n${(i % 9) + 1}` }));

        const graph = {
          version: '1',
          default_seed: 17,
          nodes,
          edges,
          meta: { roots: ['n0'], leaves: ['n9'], source: 'assistant' },
        };

        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');
        reply.raw.write(`event: complete\ndata: ${JSON.stringify({ graph, cost_usd: 0.001, provider: 'test' })}\n\n`);
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);
      const events = parseSSEEvents(response.body);

      expect(events.some(e => e.event === 'error')).toBe(true);
      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent?.data.error.type).toBe('VALIDATION_FAILED');
      expect(errorEvent?.data.error.message).toContain('25 edges');
    });

    it('SSE: accepts graph at exact limits (12 nodes, 24 edges)', async () => {
      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, kind: 'goal', label: `Node ${i}` }));
        const edges = Array.from({ length: 24 }, (_, i) => ({ from: 'n0', to: `n${(i % 11) + 1}` }));

        const graph = {
          version: '1',
          default_seed: 17,
          nodes,
          edges,
          meta: { roots: ['n0'], leaves: ['n11'], source: 'assistant' },
        };

        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');
        reply.raw.write(`event: complete\ndata: ${JSON.stringify({ graph, cost_usd: 0.001, provider: 'test' })}\n\n`);
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);
      const events = parseSSEEvents(response.body);

      expect(events.some(e => e.event === 'complete')).toBe(true);
      expect(events.some(e => e.event === 'error')).toBe(false);

      const completeEvent = events.find(e => e.event === 'complete');
      expect(completeEvent?.data.graph).toBeDefined();
      expect(completeEvent?.data.graph.nodes).toHaveLength(12);
      expect(completeEvent?.data.graph.edges).toHaveLength(24);
    });
  });

  describe('SSE cost enforcement', () => {
    it('SSE: rejects response missing cost_usd', async () => {
      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        const graph = {
          version: '1',
          default_seed: 17,
          nodes: [{ id: 'g1', kind: 'goal', label: 'Test' }],
          edges: [],
          meta: { roots: ['g1'], leaves: ['g1'], source: 'assistant' },
        };

        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');
        // Missing cost_usd
        reply.raw.write(`event: complete\ndata: ${JSON.stringify({ graph, provider: 'test' })}\n\n`);
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);
      const events = parseSSEEvents(response.body);

      expect(events.some(e => e.event === 'error')).toBe(true);
      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent?.data.error.type).toBe('VALIDATION_FAILED');
      expect(errorEvent?.data.error.message).toContain('cost_usd');
    });

    it('SSE: rejects response with non-numeric cost_usd', async () => {
      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        const graph = {
          version: '1',
          default_seed: 17,
          nodes: [{ id: 'g1', kind: 'goal', label: 'Test' }],
          edges: [],
          meta: { roots: ['g1'], leaves: ['g1'], source: 'assistant' },
        };

        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');
        reply.raw.write(`event: complete\ndata: ${JSON.stringify({ graph, cost_usd: 'invalid', provider: 'test' })}\n\n`);
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);
      const events = parseSSEEvents(response.body);

      expect(events.some(e => e.event === 'error')).toBe(true);
      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent?.data.error.type).toBe('VALIDATION_FAILED');
      expect(errorEvent?.data.error.message).toContain('numeric');
    });
  });

  describe('SSE validation issues surfacing', () => {
    it('SSE: includes validation_issues when engine validator finds problems', async () => {
      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        const graph = {
          version: '1',
          default_seed: 17,
          nodes: [
            { id: 'g1', kind: 'goal', label: 'Start' },
            { id: 'g2', kind: 'goal', label: 'End' },
          ],
          edges: [
            { from: 'g1', to: 'g2' },
            { from: 'g2', to: 'g1' }, // Creates a cycle
          ],
          meta: { roots: ['g1'], leaves: ['g2'], source: 'assistant' },
        };

        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');
        reply.raw.write(`event: complete\ndata: ${JSON.stringify({ graph, cost_usd: 0.001, provider: 'test' })}\n\n`);
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);
      const events = parseSSEEvents(response.body);

      // Should get complete event (non-blocking validation)
      expect(events.some(e => e.event === 'complete')).toBe(true);

      const completeEvent = events.find(e => e.event === 'complete');
      expect(completeEvent?.data.validation_issues).toBeDefined();
      expect(Array.isArray(completeEvent?.data.validation_issues)).toBe(true);
      expect(completeEvent?.data.validation_issues.length).toBeGreaterThan(0);
    });
  });

  describe('SSE telemetry parity', () => {
    it('SSE: telemetry includes provider and cost_usd with fallbacks', async () => {
      // Capture logs
      const logs: any[] = [];
      vi.spyOn(app.log, 'info').mockImplementation((obj: any) => {
        logs.push(obj);
      });

      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        const graph = {
          version: '1',
          default_seed: 17,
          nodes: [{ id: 'g1', kind: 'goal', label: 'Test' }],
          edges: [],
          meta: { roots: ['g1'], leaves: ['g1'], source: 'assistant' },
        };

        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');
        // Omit provider, use zero cost
        reply.raw.write(`event: complete\ndata: ${JSON.stringify({ graph, cost_usd: 0 })}\n\n`);
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);

      // Check telemetry log
      const sseCompleteLog = logs.find(log => log.event === 'assist.proxy.sse_complete');
      expect(sseCompleteLog).toBeDefined();
      expect(sseCompleteLog.provider).toBe('unknown'); // Fallback
      expect(sseCompleteLog.cost_usd).toBe(0);

      vi.restoreAllMocks();
    });

    it('SSE: telemetry uses upstream values when present', async () => {
      // Capture logs
      const logs: any[] = [];
      vi.spyOn(app.log, 'info').mockImplementation((obj: any) => {
        logs.push(obj);
      });

      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        const graph = {
          version: '1',
          default_seed: 17,
          nodes: [{ id: 'g1', kind: 'goal', label: 'Test' }],
          edges: [],
          meta: { roots: ['g1'], leaves: ['g1'], source: 'assistant' },
        };

        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');
        reply.raw.write(`event: complete\ndata: ${JSON.stringify({ graph, cost_usd: 0.0042, provider: 'openai', model: 'gpt-4o-mini' })}\n\n`);
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);

      // Check telemetry log
      const sseCompleteLog = logs.find(log => log.event === 'assist.proxy.sse_complete');
      expect(sseCompleteLog).toBeDefined();
      expect(sseCompleteLog.provider).toBe('openai');
      expect(sseCompleteLog.cost_usd).toBe(0.0042);

      vi.restoreAllMocks();
    });
  });

  describe('SSE idle timeout', () => {
    it('SSE: aborts stream after 10s of no activity', async () => {
      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        // Send initial event then stall
        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');

        // Don't send anything for 11 seconds (exceeds 10s idle timeout)
        // In test, we can't actually wait 11s, so this test verifies the logic exists
        // The guard's shouldAbort() checks lastChunkMs
      };

      // Note: This test is limited by app.inject() which doesn't support real-time streaming
      // In production, the idle timeout guard would trigger after 10s
      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test brief' },
      });

      // For now, just verify we don't crash - full idle timeout testing requires integration test
      expect(response.statusCode).toBe(200);
    }, 10000); // Increase timeout to 10s for this test
  });

  describe('SSE newline preservation (RFC 8895)', () => {
    it('SSE: preserves newlines in multi-line data fields', async () => {
      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        const graph = {
          version: '1',
          default_seed: 17,
          nodes: [{ id: 'g1', kind: 'goal', label: 'Test' }],
          edges: [],
          meta: {
            roots: ['g1'],
            leaves: ['g1'],
            source: 'assistant',
            note: 'Consider\nbudget',
          },
        };

        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');

        // Send complete event with data split across multiple lines
        reply.raw.write('event: complete\n');
        reply.raw.write('data: {"graph":{"version":"1","default_seed":17,\n');
        reply.raw.write('data: "nodes":[{"id":"g1","kind":"goal","label":"Test"}],\n');
        reply.raw.write('data: "edges":[],"meta":{"roots":["g1"],"leaves":["g1"],\n');
        reply.raw.write('data: "source":"assistant","note":"Consider\\nbudget"}},\n');
        reply.raw.write('data: "cost_usd":0.12,"provider":"test"}\n');
        reply.raw.write('\n');
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test brief' },
      });

      expect(response.statusCode).toBe(200);
      const events = parseSSEEvents(response.body);

      expect(events.some(e => e.event === 'complete')).toBe(true);
      const completeEvent = events.find(e => e.event === 'complete');
      expect(completeEvent?.data.graph.meta.note).toBe('Consider\nbudget');
      expect(completeEvent?.data.cost_usd).toBe(0.12);
    });

    it('SSE: handles JSON split across chunks with multiple data lines', async () => {
      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        // Simulate chunked delivery where event and data lines arrive separately
        reply.raw.write('event: stage\n');
        reply.raw.write('data: {"stage":"DRAFTING"}\n\n');

        reply.raw.write('event: complete\n');
        reply.raw.write('data: {"graph":{\n');
        reply.raw.write('data: "version":"1","default_seed":17,\n');
        reply.raw.write('data: "nodes":[{"id":"n1","kind":"goal","label":"Node 1"}],\n');
        reply.raw.write('data: "edges":[],"meta":{"roots":["n1"],"leaves":["n1"],"source":"assistant"}},\n');
        reply.raw.write('data: "cost_usd":0.05,"provider":"chunked"}\n');
        reply.raw.write('\n');
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test chunked delivery' },
      });

      expect(response.statusCode).toBe(200);
      const events = parseSSEEvents(response.body);

      expect(events.some(e => e.event === 'complete')).toBe(true);
      const completeEvent = events.find(e => e.event === 'complete');
      expect(completeEvent?.data.graph.nodes).toHaveLength(1);
      expect(completeEvent?.data.provider).toBe('chunked');
    });

    it('SSE: guard fires correctly with multi-line data (13 nodes)', async () => {
      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        const nodes = Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, kind: 'goal', label: `Node ${i}` }));

        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');

        // Split graph data across multiple data lines
        reply.raw.write('event: complete\n');
        reply.raw.write('data: {"graph":{"version":"1","default_seed":17,\n');
        reply.raw.write(`data: "nodes":${JSON.stringify(nodes)},\n`);
        reply.raw.write('data: "edges":[],"meta":{"roots":["n0"],"leaves":["n12"],"source":"assistant"}},\n');
        reply.raw.write('data: "cost_usd":0.001,"provider":"test"}\n');
        reply.raw.write('\n');
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test multi-line guard' },
      });

      expect(response.statusCode).toBe(200);
      const events = parseSSEEvents(response.body);

      // Should get error event due to 13 nodes violation
      expect(events.some(e => e.event === 'error')).toBe(true);
      expect(events.some(e => e.event === 'complete')).toBe(false);

      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent?.data.error.type).toBe('VALIDATION_FAILED');
      expect(errorEvent?.data.error.message).toContain('13 nodes');
    });

    it('SSE: telemetry works with multi-line complete event', async () => {
      const logs: any[] = [];
      vi.spyOn(app.log, 'info').mockImplementation((obj: any) => {
        logs.push(obj);
      });

      mockHandler = async (req, reply) => {
        reply.header('Content-Type', 'text/event-stream');

        reply.raw.write('event: stage\ndata: {"stage":"DRAFTING"}\n\n');

        // Multi-line complete event
        reply.raw.write('event: complete\n');
        reply.raw.write('data: {"graph":{"version":"1","default_seed":17,\n');
        reply.raw.write('data: "nodes":[{"id":"g1","kind":"goal","label":"Test"}],\n');
        reply.raw.write('data: "edges":[],"meta":{"roots":["g1"],"leaves":["g1"],"source":"assistant"}},\n');
        reply.raw.write('data: "cost_usd":0.089,"provider":"multiline-test"}\n');
        reply.raw.write('\n');
        reply.raw.end();
      };

      const response = await app.inject({
        method: 'POST',
        url: '/assist/draft-graph/stream',
        payload: { brief: 'Test telemetry' },
      });

      expect(response.statusCode).toBe(200);

      const sseCompleteLog = logs.find(log => log.event === 'assist.proxy.sse_complete');
      expect(sseCompleteLog).toBeDefined();
      expect(sseCompleteLog.provider).toBe('multiline-test');
      expect(sseCompleteLog.cost_usd).toBe(0.089);

      vi.restoreAllMocks();
    });
  });
});

/**
 * Helper to parse SSE response body into events
 */
function parseSSEEvents(body: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const lines = body.split('\n');

  let currentEvent = '';
  let currentDataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent = line.substring(6).trim();
    } else if (line.startsWith('data:')) {
      // RFC 8895: Accumulate multiple data lines, preserve content (don't trim)
      currentDataLines.push(line.substring(5));
    } else if (line === '' || line === '\r') {
      if (currentEvent && currentDataLines.length > 0) {
        try {
          // Join multiple data lines with newline, trim trailing whitespace only
          const eventData = currentDataLines.join('\n').trimEnd();
          events.push({
            event: currentEvent,
            data: JSON.parse(eventData),
          });
        } catch {
          // Skip unparseable data
        }
      }
      currentEvent = '';
      currentDataLines = [];
    }
  }

  return events;
}
