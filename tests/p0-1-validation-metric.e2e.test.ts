import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { startServer, closeServer } from './helpers/server.js';
import { waitForMetric, getMetricValue } from './helpers/metrics.js';

describe('P0-1: Validation Metrics E2E', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.PROMETHEUS_ENABLE = '1';
    process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = 'a'.repeat(64);
    app = await createServer();
    const context = await startServer(app);
    baseUrl = context.baseUrl;
  });

  afterAll(async () => {
    await closeServer(app);
    process.env = originalEnv;
  });

  it('increments validation_errors_total for invalid request to /v1/run', async () => {
    // Get baseline
    const before = await getMetricValue(
      baseUrl,
      /plot_engine_validation_errors_total\{route="\/v1\/run",phase="request",error_type="ajv"\}/
    );
    const beforeCount = before?.value ?? 0;

    // Send invalid request (empty body, missing required fields)
    const response = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(400);

    // Wait for metric to increment
    const after = await waitForMetric({
      baseUrl,
      query: /plot_engine_validation_errors_total\{route="\/v1\/run",phase="request",error_type="ajv"\}/,
      min: beforeCount + 1,
      timeoutMs: 3000
    });

    expect(after.value).toBeGreaterThan(beforeCount);
  });

  it('does not increment validation counter for valid request', async () => {
    // Get baseline
    const metricsBefore = await fetch(`${baseUrl}/metrics`).then(r => r.text());
    const beforeMatch = metricsBefore.match(/plot_engine_validation_errors_total\{route="\/v1\/run",phase="request",error_type="ajv"\} (\d+)/);
    const beforeCount = beforeMatch ? parseInt(beforeMatch[1], 10) : 0;

    // Send valid request (using correct v1 schema)
    const validPayload = {
      graph: {
        nodes: [
          { id: 'Price', label: 'Price' },
          { id: 'Demand', label: 'Demand' }
        ],
        edges: [{ from: 'Price', to: 'Demand' }]
      },
      outcome_node: 'Demand',
      seed: 4242
    };

    const response = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validPayload)
    });

    expect(response.status).toBe(200);

    // Check metrics didn't change
    await new Promise(resolve => setTimeout(resolve, 100));
    const metricsAfter = await fetch(`${baseUrl}/metrics`).then(r => r.text());
    const afterMatch = metricsAfter.match(/plot_engine_validation_errors_total\{route="\/v1\/run",phase="request",error_type="ajv"\} (\d+)/);
    const afterCount = afterMatch ? parseInt(afterMatch[1], 10) : beforeCount;

    expect(afterCount).toBe(beforeCount);
  });
});
