/**
 * exists_probability default consistency tests
 *
 * Verifies that DEFAULT_EXISTS_PROBABILITY (0.8) is used consistently across:
 * 1. Legacy ISL request path (isl/index.ts inline edge mapping)
 * 2. Preflight uncertainty check (preflight.ts edgeHasUncertainty)
 * 3. Graph normaliser (graph-normaliser.ts normaliseEdge)
 *
 * Regression: these paths previously used hardcoded 1.0 instead of the
 * canonical 0.8 constant, producing different analytical behaviour.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { DEFAULT_EXISTS_PROBABILITY } from '../src/constants/limits.js';
import { edgeHasUncertainty } from '../src/integrations/isl/preflight.js';
import { normaliseEdge } from '../src/normalisation/graph-normaliser.js';
import type { NormalisationWarning } from '../src/normalisation/graph-normaliser.js';

// ---------------------------------------------------------------------------
// 1. Legacy ISL path — capture request payload via ISLClient mock
// ---------------------------------------------------------------------------

// Mock ISLClient to capture the request body sent by analyseRobustness
let capturedBody: any = null;

vi.mock('../src/integrations/isl/client.ts', () => ({
  ISLClient: class {
    async request(opts: any) {
      capturedBody = opts.body;
      return {
        data: {
          options: [],
          sensitivity: [],
          factor_sensitivity: [],
          robustness: { overall: 'robust' },
        },
        islEchoedRequestId: 'test',
      };
    }
    async healthCheck() { return true; }
  },
  getISLClientConfig: () => ({
    baseUrl: 'http://mock-isl',
    apiKey: 'test-key',
    timeoutMs: 5000,
    maxRetries: 0,
    healthCheckTimeoutMs: 1000,
  }),
}));

// Stub metrics to avoid side effects
vi.mock('../src/metrics/registry.ts', () => ({
  recordIslValidation: vi.fn(),
  recordIslSensitivity: vi.fn(),
  recordIslFactorSensitivity: vi.fn(),
  recordIslRobustnessAnalysis: vi.fn(),
  observeIslLatency: vi.fn(),
  recordDownstreamLatency: vi.fn(),
}));

describe('exists_probability default consistency', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.ISL_ENABLE = '1';
    process.env.ISL_BASE_URL = 'http://mock-isl';
    process.env.ISL_API_KEY = 'test-key';
  });

  afterAll(() => {
    process.env.ISL_ENABLE = originalEnv.ISL_ENABLE;
    process.env.ISL_BASE_URL = originalEnv.ISL_BASE_URL;
    process.env.ISL_API_KEY = originalEnv.ISL_API_KEY;
  });

  // -------------------------------------------------------------------------
  // Test 1: Legacy ISL path uses DEFAULT_EXISTS_PROBABILITY
  // -------------------------------------------------------------------------
  it('legacy ISL path defaults exists_probability to 0.8', async () => {
    // Reset singleton so it picks up mocked client + env vars
    const { resetISLService, getISLService } = await import(
      '../src/integrations/isl/index.js'
    );
    resetISLService();
    const service = getISLService();

    const graph = {
      nodes: [
        { id: 'factor_a', kind: 'factor' as const, label: 'Factor A', observed_state: { value: 5 } },
        { id: 'goal', kind: 'goal' as const, label: 'Goal' },
        { id: 'opt1', kind: 'option' as const, label: 'Option 1' },
      ],
      edges: [
        // Edge with NO exists_probability, belief_exists, or belief
        { from: 'factor_a', to: 'goal', weight: 0.6 },
      ],
    };

    capturedBody = null;
    await service.analyseRobustness(
      graph,
      'goal',
      [{ id: 'opt1', label: 'Option 1', interventions: { factor_a: 10 } }],
      'test-req-1'
    );

    expect(capturedBody).not.toBeNull();
    const islEdge = capturedBody.graph.edges[0];
    expect(islEdge.exists_probability).toBe(DEFAULT_EXISTS_PROBABILITY);
    expect(islEdge.exists_probability).toBe(0.8);
  });

  // -------------------------------------------------------------------------
  // Test 2: Preflight treats missing exists_probability as uncertain (0.8)
  // -------------------------------------------------------------------------
  it('preflight detects uncertainty when exists_probability defaults to 0.8', () => {
    const edge = { from: 'a', to: 'b' } as any;

    // With default 0.8, edge IS uncertain (0 < 0.8 < 1)
    expect(edgeHasUncertainty(edge)).toBe(true);
  });

  it('preflight treats explicit exists_probability=1.0 as certain', () => {
    const edge = { from: 'a', to: 'b', exists_probability: 1.0 } as any;
    expect(edgeHasUncertainty(edge)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 3: Cross-path consistency — normaliser and legacy ISL path agree
  // -------------------------------------------------------------------------
  it('normaliser and legacy ISL path produce identical exists_probability for missing field', async () => {
    // Normaliser path
    const warnings: NormalisationWarning[] = [];
    const normalised = normaliseEdge(
      { from: 'A', to: 'B', weight: 0.5 },
      0,
      new Map(),
      warnings
    );

    // Legacy ISL path (captured from test 1)
    const { resetISLService, getISLService } = await import(
      '../src/integrations/isl/index.js'
    );
    resetISLService();
    const service = getISLService();

    capturedBody = null;
    await service.analyseRobustness(
      {
        nodes: [
          { id: 'A', kind: 'factor' as const, label: 'A', observed_state: { value: 1 } },
          { id: 'B', kind: 'goal' as const, label: 'B' },
          { id: 'opt', kind: 'option' as const, label: 'Opt' },
        ],
        edges: [{ from: 'A', to: 'B', weight: 0.5 }],
      },
      'B',
      [{ id: 'opt', label: 'Opt', interventions: { A: 2 } }],
      'test-req-2'
    );

    expect(capturedBody).not.toBeNull();
    const islEdge = capturedBody.graph.edges[0];

    // Both paths must produce the same value
    expect(normalised.exists_probability).toBe(islEdge.exists_probability);
    expect(normalised.exists_probability).toBe(DEFAULT_EXISTS_PROBABILITY);
  });
});
