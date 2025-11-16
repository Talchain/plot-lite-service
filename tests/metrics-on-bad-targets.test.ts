/**
 * Test: Validation metrics increment on bad targets
 * Ensures query.targets type errors are counted by validation metrics
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import { __resetValidationMetricsForTest, getValidationErrors } from '../src/observability/validationMetrics.js';
import { startServer, closeServer } from './helpers/server.js';

describe('Validation metrics on bad targets', () => {
  let app: any;
  let baseUrl: string;

  beforeAll(async () => {
    app = await createServer();
    const context = await startServer(app);
    baseUrl = context.baseUrl;
    __resetValidationMetricsForTest();
  });

  afterAll(async () => {
    await closeServer(app);
  });

  it('increments validation metric on query.targets with non-string types', async () => {
    const beforeMetrics = getValidationErrors();
    const beforeCount = Array.from(beforeMetrics.values()).reduce((sum, count) => sum + count, 0);

    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        query: { targets: [123] }  // number should be rejected
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('BAD_INPUT');
    expect(body.field).toBe('query.targets');

    // Verify metric incremented
    const afterMetrics = getValidationErrors();
    const afterCount = Array.from(afterMetrics.values()).reduce((sum, count) => sum + count, 0);
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  it('increments validation metric on targets with non-string types', async () => {
    const beforeMetrics = getValidationErrors();
    const beforeCount = Array.from(beforeMetrics.values()).reduce((sum, count) => sum + count, 0);

    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        targets: [456, 'B']  // number should be rejected
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('BAD_INPUT');
    expect(body.field).toBe('targets');

    // Verify metric incremented
    const afterMetrics = getValidationErrors();
    const afterCount = Array.from(afterMetrics.values()).reduce((sum, count) => sum + count, 0);
    expect(afterCount).toBeGreaterThan(beforeCount);
  });
});
