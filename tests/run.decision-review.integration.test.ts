import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

// Focused /v1/run + CEE Decision Review integration tests using the SDK port shim.
// Verifies:
// - Gating on CEE_ORCHESTRATOR_ENABLE + Idempotency-Key.
// - Best-effort behaviour when CEE is unreachable.
//
// /v2/run + M2 Decision Review integration tests.
// Verifies:
// - Gating on DECISION_REVIEW_ENABLE flag.
// - review_status present when flag enabled.
// - review_status === 'disabled' when flag disabled.

describe('/v1/run CEE Decision Review integration (SDK port shim)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.CEE_ORCHESTRATOR_ENABLE = '1';
    process.env.CEE_BASE_URL = 'http://127.0.0.1:1'; // unreachable → forces degraded path
    process.env.CEE_API_KEY = 'test-decision-review-key';
    process.env.CEE_TIMEOUT_MS = '100';
    process.env.RATE_LIMIT_ENABLED = '0';

    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.CEE_ORCHESTRATOR_ENABLE;
    delete process.env.CEE_BASE_URL;
    delete process.env.CEE_API_KEY;
    delete process.env.CEE_TIMEOUT_MS;
    delete process.env.RATE_LIMIT_ENABLED;
  });

  const payload = {
    graph: {
      nodes: [
        { id: 'A', label: 'Input' },
        { id: 'B', label: 'Output' },
      ],
      edges: [
        { from: 'A', to: 'B', weight: 0.5 },
      ],
    },
    seed: 123,
    outcome_node: 'B',
  };

  it('attaches cee* fields when flag enabled and Idempotency-Key present', async () => {
    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'cee-sdk-port-integration-1',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Core response present
    expect(body.result).toBeDefined();
    expect(body.result.response_hash).toBeDefined();

    // With flag+Idempotency-Key, CEE should have been attempted.
    // We allow any combination of cee* fields, as long as at least one is present.
    expect(
      body.ceeReview !== undefined ||
      body.ceeTrace !== undefined ||
      body.ceeError !== undefined,
    ).toBe(true);
  });

  it('does not attach cee* fields without Idempotency-Key', async () => {
    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.result).toBeDefined();
    expect(body.result.response_hash).toBeDefined();
    expect(body.ceeReview).toBeUndefined();
    expect(body.ceeTrace).toBeUndefined();
    expect(body.ceeError).toBeUndefined();
  });
});

// =============================================================================
// V2 Run + M2 Decision Review Integration Tests
// =============================================================================

describe('/v2/run M2 Decision Review integration', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  // V2 payload with options (required for M2)
  const v2Payload = {
    graph: {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Maximize Revenue' },
        { id: 'factor_a', kind: 'factor', label: 'Market Size' },
        { id: 'factor_b', kind: 'factor', label: 'Competition' },
      ],
      edges: [
        { from: 'factor_a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
        { from: 'factor_b', to: 'goal', strength: { mean: -0.3, std: 0.1 } },
      ],
    },
    options: [
      { id: 'opt_a', label: 'Option A', interventions: { factor_a: 0.8 } },
      { id: 'opt_b', label: 'Option B', interventions: { factor_a: 0.4, factor_b: 0.6 } },
    ],
    goal_node_id: 'goal',  // Required for V2
    brief: 'Comparing market expansion strategies.',
    seed: 42,
  };

  describe('with DECISION_REVIEW_ENABLE=true', () => {
    beforeAll(async () => {
      process.env.DECISION_REVIEW_ENABLE = 'true';
      process.env.CEE_BASE_URL = 'http://127.0.0.1:1'; // unreachable → forces skipped/failed path
      process.env.CEE_API_KEY = 'test-m2-key';
      process.env.CEE_TIMEOUT_MS = '100';
      process.env.RATE_LIMIT_ENABLED = '0';

      app = await createServer();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.DECISION_REVIEW_ENABLE;
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;
      delete process.env.CEE_TIMEOUT_MS;
      delete process.env.RATE_LIMIT_ENABLED;
    });

    it('includes review_status when flag enabled (CEE unreachable → skipped/failed)', async () => {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(v2Payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Core response present
      expect(body.analysis_status).toBeDefined();
      expect(body.response_hash).toBeDefined();

      // M2 fields should be present
      expect(body.review_status).toBeDefined();
      // With unreachable CEE, status should be 'skipped' or 'failed'
      expect(['skipped', 'failed']).toContain(body.review_status);
      // m1_review should be null when CEE unreachable
      expect(body.m1_review).toBeNull();

      // Legacy CEE fields should still work independently
      // (cee_status may or may not be present depending on legacy orchestrator)
    });

    it('includes review_failure_codes when review fails', async () => {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(v2Payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // If status is 'failed', failure codes should be present
      if (body.review_status === 'failed') {
        expect(body.review_failure_codes).toBeDefined();
        expect(Array.isArray(body.review_failure_codes)).toBe(true);
      }
    });
  });

  describe('with DECISION_REVIEW_ENABLE=false', () => {
    beforeAll(async () => {
      process.env.DECISION_REVIEW_ENABLE = 'false';
      process.env.CEE_BASE_URL = 'http://127.0.0.1:1';
      process.env.CEE_API_KEY = 'test-m2-key';
      process.env.RATE_LIMIT_ENABLED = '0';

      app = await createServer();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.DECISION_REVIEW_ENABLE;
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;
      delete process.env.RATE_LIMIT_ENABLED;
    });

    it('returns review_status=disabled when flag is false', async () => {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(v2Payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Core response present
      expect(body.analysis_status).toBeDefined();
      expect(body.response_hash).toBeDefined();

      // M2 fields should indicate disabled
      expect(body.review_status).toBe('disabled');
      expect(body.m1_review).toBeNull();
      // No failure codes when simply disabled
      expect(body.review_failure_codes).toBeUndefined();
    });
  });

  describe('without DECISION_REVIEW_ENABLE set', () => {
    beforeAll(async () => {
      // Explicitly unset the flag
      delete process.env.DECISION_REVIEW_ENABLE;
      process.env.CEE_BASE_URL = 'http://127.0.0.1:1';
      process.env.CEE_API_KEY = 'test-m2-key';
      process.env.RATE_LIMIT_ENABLED = '0';

      app = await createServer();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;
      delete process.env.RATE_LIMIT_ENABLED;
    });

    it('returns review_status=disabled when flag is not set', async () => {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(v2Payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Core response present
      expect(body.analysis_status).toBeDefined();

      // M2 fields should indicate disabled (flag defaults to false)
      expect(body.review_status).toBe('disabled');
      expect(body.m1_review).toBeNull();
    });
  });
});
