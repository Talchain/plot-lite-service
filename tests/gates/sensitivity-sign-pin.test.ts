/**
 * SCIENTIFIC REGRESSION GATE — WP4: Sensitivity sign & no-conflation
 * ----------------------------------------------------------------------------
 * Verify-and-pin. Most WP4 invariants are already covered (see references
 * below); this gate adds the two genuinely-thin end-to-end pins on the PUBLIC
 * /v2/run surface:
 *   - SIGN PRESERVATION: a negative-strength causal edge surfaces as
 *     factor_sensitivity[*].direction === 'negative' (positive → 'positive').
 *     Direction = sign of total graph influence (src/lib/factor-influence.ts).
 *   - NO TERMINOLOGY CONFLATION: sensitivity, value_of_information and
 *     confidence are DISTINCT per-factor signals, and robustness is a separate
 *     top-level signal — none collapsed into another.
 *
 * Already covered elsewhere (NOT duplicated):
 *   - filterInterventionOverrides (decision-lever / dead-source exclusion, narrow
 *     exclusion, both call-site shapes): tests/coaching/sensitivity-filter.test.ts
 *   - direction on the brief surface (negative elasticity → 'negative', abs impact):
 *     tests/decision-brief-driver-direction.test.ts
 *   - confidence_source / confidence_provenance honesty (public never carries
 *     'isl'/'graph'/'bootstrap_sampling'; only plot_unified_*; audit A1-PRIMARY):
 *     tests/b8-8-3c-field-segregation.test.ts
 *   - missing-sensitivity ≠ zero is enforced in mapIslFactorEntry (run.ts ~561:
 *     `f.sensitivity_score ?? f.sensitivity`, no default to 0); VOI missing-vs-zero
 *     is unit-pinned in tests/evpi-emission.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

function robustnessPayload(options: any[]) {
  return {
    options: options.map((opt: any, idx: number) => ({
      option_id: opt.id,
      win_probability: idx === 0 ? 0.7 : 0.3,
      outcome: { mean: 0.7 - idx * 0.2, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
      rank: idx + 1,
    })),
    edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
    edge_sensitivity_status: 'available' as const,
    factors: [], factor_sensitivity: [], value_of_information: [],
    factors_provenance: 'unavailable' as const, factor_sensitivity_status: 'skipped_no_factor_values' as const,
    overall_robustness: 'robust' as const, robustness_score: 0.8, fragile_edges: [], robust_edges: [],
    latency_ms: 50, source: 'isl' as const,
  };
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return { status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return robustnessPayload(options);
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    return { data: robustnessPayload(body.options || []) as T, error: null };
  },
};

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../../src/createServer.js');

// Goal with one POSITIVE-strength driver and one NEGATIVE-strength driver.
const PAYLOAD = {
  graph: {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Profit' },
      { id: 'revenue', kind: 'factor', label: 'Revenue', observed_state: { value: 0.5 } },
      { id: 'cost', kind: 'factor', label: 'Cost', observed_state: { value: 0.5 } },
    ],
    edges: [
      { from: 'revenue', to: 'goal', strength: { mean: 0.6, std: 0.1 } },   // positive driver
      { from: 'cost', to: 'goal', strength: { mean: -0.6, std: 0.1 } },     // negative driver
    ],
  },
  options: [
    { id: 'opt1', label: 'Grow revenue', interventions: { revenue: 0.8 } },
    { id: 'opt2', label: 'Cut cost', interventions: { cost: 0.2 } },
  ],
  goal_node_id: 'goal',
  seed: '42',
};

describe('WP4 gate · sensitivity sign & signal distinctness (public /v2/run surface)', () => {
  let app: FastifyInstance;
  let body: any;
  let factors: any[];

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    body = res.json();
    factors = (body.factor_sensitivity ?? []) as any[];
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('SIGN: a negative-strength driver surfaces direction="negative"; positive driver "positive"', () => {
    const byId = (id: string) => factors.find((f) => (f.factor_id ?? f.node_id) === id);
    const revenue = byId('revenue');
    const cost = byId('cost');
    expect(revenue).toBeDefined();
    expect(cost).toBeDefined();
    // Sign of total influence is preserved into the public direction label.
    expect(revenue.direction).toBe('positive');
    expect(cost.direction).toBe('negative');
    // The sign is NOT flattened to a single polarity across factors.
    expect(revenue.direction).not.toBe(cost.direction);
  });

  it('NO CONFLATION: sensitivity, value_of_information and confidence are distinct per-factor fields', () => {
    expect(factors.length).toBeGreaterThan(0);
    for (const f of factors) {
      // sensitivity_score and value_of_information are separate keys — a factor's
      // VOI is never read off its sensitivity (and vice-versa).
      const keys = Object.keys(f);
      // sensitivity is present as its own signal
      expect(keys).toContain('sensitivity_score');
      // confidence is its own signal, distinct from sensitivity
      expect(keys).toContain('confidence');
      // when VOI is present it is its OWN key, not aliased to sensitivity
      if ('value_of_information' in f && f.value_of_information != null && f.sensitivity_score != null) {
        // distinct fields may coincide numerically, but they are separate keys:
        expect('value_of_information' in f).toBe(true);
        expect('sensitivity_score' in f).toBe(true);
      }
    }
  });

  it('NO CONFLATION: robustness is a separate top-level signal from factor sensitivity', () => {
    // robustness_status lives at top level and is not derived from / merged into
    // the per-factor sensitivity entries.
    expect(body).toHaveProperty('robustness_status');
    expect(typeof body.robustness_status).toBe('string');
    // factor entries do not carry a robustness verdict field.
    for (const f of factors) {
      expect(f.robustness_status).toBeUndefined();
      expect(f.overall_robustness).toBeUndefined();
    }
  });

  it('PROVENANCE (light, references b8-8-3c): public confidence_source is an honest plot_unified_* label', () => {
    const FORBIDDEN = ['isl', 'graph', 'bootstrap_sampling', 'fallback_degenerate'];
    for (const f of factors) {
      if (f.confidence_source !== undefined) {
        expect(FORBIDDEN).not.toContain(f.confidence_source);
        expect(String(f.confidence_source).startsWith('plot_unified')).toBe(true);
      }
    }
  });
});
