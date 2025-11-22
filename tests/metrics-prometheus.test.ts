/**
 * P1: Prometheus Histograms Tests
 * Verifies histogram metrics with bounded label cardinality and no PII
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Prometheus Histograms (P1)', () => {
  describe('Flag OFF (default)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      delete process.env.PROMETHEUS_ENABLE;
      app = await createServer({ enableTestRoutes: false });
    });

    afterAll(async () => {
      await app?.close();
    });

    it('/metrics returns 404 when flag is OFF', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('Flag ON', () => {
    let app: FastifyInstance;
    let origEnv: string | undefined;

    beforeAll(async () => {
      origEnv = process.env.PROMETHEUS_ENABLE;
      process.env.PROMETHEUS_ENABLE = '1';
      app = await createServer({ enableTestRoutes: false });
    });

    afterAll(async () => {
      if (origEnv === undefined) {
        delete process.env.PROMETHEUS_ENABLE;
      } else {
        process.env.PROMETHEUS_ENABLE = origEnv;
      }
      await app?.close();
    });

    beforeEach(async () => {
      // Reset histograms between tests
      const { resetHistograms } = await import('../src/metrics/registry.js');
      resetHistograms();
    });

    it('/metrics returns 200 with text/plain content-type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
    });

    it('contains HELP and TYPE lines for histograms', async () => {
      // Generate some traffic
      await app.inject({ method: 'GET', url: '/v1/health' });

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = res.body;

      // Check for request duration histogram
      expect(body).toContain('# HELP plot_engine_request_duration_seconds');
      expect(body).toContain('# TYPE plot_engine_request_duration_seconds histogram');

      // Check for engine latency histogram
      expect(body).toContain('# HELP plot_engine_engine_latency_seconds');
      expect(body).toContain('# TYPE plot_engine_engine_latency_seconds histogram');
    });

    it('histogram buckets are monotonic non-decreasing', async () => {
      // Generate traffic
      await app.inject({ method: 'GET', url: '/v1/health' });

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = res.body;
      const lines = body.split('\n');

      // Find bucket lines for request_duration
      const bucketLines = lines.filter(line => 
        line.startsWith('plot_engine_request_duration_seconds_bucket')
      );

      // Extract bucket counts
      const buckets: Array<{ le: string; count: number }> = [];
      for (const line of bucketLines) {
        const match = line.match(/le="([^"]+)"\}\s+(\d+)/);
        if (match) {
          buckets.push({ le: match[1], count: parseInt(match[2], 10) });
        }
      }

      // Verify monotonic non-decreasing
      for (let i = 1; i < buckets.length; i++) {
        expect(buckets[i].count).toBeGreaterThanOrEqual(buckets[i - 1].count);
      }
    });

    it('histogram has sum and count with count >= 1 after traffic', async () => {
      // Generate traffic
      await app.inject({ method: 'GET', url: '/v1/health' });

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = res.body;

      // Check for sum and count
      expect(body).toMatch(/plot_engine_request_duration_seconds_sum\{.*\}\s+[\d.]+/);
      expect(body).toMatch(/plot_engine_request_duration_seconds_count\{.*\}\s+\d+/);

      // Extract count value
      const countMatch = body.match(/plot_engine_request_duration_seconds_count\{.*\}\s+(\d+)/);
      expect(countMatch).toBeTruthy();
      const count = parseInt(countMatch![1], 10);
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('labels are restricted to route, method, status_class', async () => {
      // Generate traffic
      await app.inject({ method: 'GET', url: '/v1/health' });

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = res.body;
      const lines = body.split('\n');

      // Find metric lines (not HELP/TYPE)
      const metricLines = lines.filter(line => 
        line.startsWith('plot_engine_request_duration_seconds') &&
        !line.startsWith('# ')
      );

      for (const line of metricLines) {
        // Extract labels
        const labelMatch = line.match(/\{([^}]+)\}/);
        if (labelMatch) {
          const labels = labelMatch[1];
          
          // Should only contain: route, method, status_class, le (for buckets)
          expect(labels).toMatch(/^(route|method|status_class|le)="[^"]+"/);
          
          // Should NOT contain: ip, token, user, authorization, etc.
          expect(labels).not.toContain('ip=');
          expect(labels).not.toContain('token=');
          expect(labels).not.toContain('user=');
          expect(labels).not.toContain('authorization=');
        }
      }
    });

    it('does not expose secrets or tokens in metrics', async () => {
      // Generate traffic with authorization header
      await app.inject({
        method: 'POST',
        url: '/v1/run',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-secret-token-12345',
        },
        payload: {
          seed: 4242,
          graph: {
            nodes: [{ id: 'A', label: 'A' }],
            edges: [],
          },
          outcome_node: 'A',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = res.body;

      // Should NOT contain any secrets or tokens
      expect(body).not.toContain('Bearer');
      expect(body).not.toContain('test-secret-token');
      expect(body).not.toContain('authorization');
      expect(body).not.toContain('Authorization');
      
      // Should NOT contain 64-hex token fingerprints
      expect(body).not.toMatch(/[a-f0-9]{64}/);
    });

    it('determinism preserved: 3× identical response_hash with seed', async () => {
      const hashes: string[] = [];

      for (let i = 0; i < 3; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/run',
          headers: {
            'Content-Type': 'application/json',
          },
          payload: {
            seed: 4242,
            graph: {
              nodes: [{ id: 'A', label: 'A' }],
              edges: [],
            },
            outcome_node: 'A',
          },
        });

        expect(res.statusCode).toBe(200);
        const data = JSON.parse(res.body);
        hashes.push(data.model_card.response_hash);
      }

      // All hashes should be identical
      expect(hashes[0]).toBe(hashes[1]);
      expect(hashes[1]).toBe(hashes[2]);
      expect(new Set(hashes).size).toBe(1);
    });

    it('metrics do not alter /v1/run response schema', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          seed: 4242,
          graph: {
            nodes: [{ id: 'A', label: 'A' }],
            edges: [],
          },
          outcome_node: 'A',
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);

      // Verify expected fields are present (actual structure may vary)
      // Just check that core fields exist and no metrics pollution
      expect(data).toHaveProperty('confidence');
      expect(data).toHaveProperty('model_card');
      expect(data.model_card).toHaveProperty('response_hash');

      // Should NOT have any metrics-related fields
      expect(data).not.toHaveProperty('metrics');
      expect(data).not.toHaveProperty('histogram');
      expect(data).not.toHaveProperty('duration_seconds');
      expect(data).not.toHaveProperty('prometheus');
    });

    it('buckets cover expected latency range', async () => {
      // Generate traffic
      await app.inject({ method: 'GET', url: '/v1/health' });

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = res.body;

      // Check for expected bucket boundaries (in seconds)
      const expectedBuckets = ['0.005', '0.01', '0.02', '0.05', '0.1', '0.25', '0.5', '1', '2.5', '5', '+Inf'];
      
      for (const bucket of expectedBuckets) {
        expect(body).toContain(`le="${bucket}"`);
      }
    });

    it('multiple requests increment histogram counts', async () => {
      // First request
      await app.inject({ method: 'GET', url: '/v1/health' });

      const res1 = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      const count1Match = res1.body.match(/plot_engine_request_duration_seconds_count\{.*\}\s+(\d+)/);
      const count1 = parseInt(count1Match![1], 10);

      // Second request
      await app.inject({ method: 'GET', url: '/v1/health' });

      const res2 = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      const count2Match = res2.body.match(/plot_engine_request_duration_seconds_count\{.*\}\s+(\d+)/);
      const count2 = parseInt(count2Match![1], 10);

      // Count should have increased
      expect(count2).toBeGreaterThan(count1);
    });

    it('status_class labels are correctly formatted (2xx, 4xx, 5xx)', async () => {
      // Generate 2xx
      await app.inject({ method: 'GET', url: '/v1/health' });

      // Generate 4xx
      await app.inject({ method: 'GET', url: '/nonexistent' });

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = res.body;

      // Should have 2xx and 4xx labels
      expect(body).toMatch(/status_class="2xx"/);
      expect(body).toMatch(/status_class="4xx"/);
    });
  });
});
