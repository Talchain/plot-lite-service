/**
 * Doctrine 039 — producer-owned `driver_label`.
 *
 * PLoT emits a producer-owned categorical strong/moderate/minor label over the
 * normalised-influence scalar (`influence_score`). Cut-points ratified from the
 * UI's useResultsSectionData.ts:
 *   influence_score >= 0.50 → 'strong'
 *   influence_score >= 0.20 → 'moderate'
 *   otherwise              → 'minor'
 * NOTE: this does NOT supersede the UI's `getSemanticLabel`, which is 4-valued
 * (adds a rank-1 'biggest' band) and keys off normalised |elasticity|, not
 * influence_score — reconciling the two is a doctrine row (Neil/UI), tracked
 * separately (see src/lib/driver-label.ts header).
 * Absent/non-finite influence ⇒ NO label (honesty: never fabricate 'minor'
 * from a missing value). Thresholds are DOCTRINE-PENDING (Neil), one const each.
 *
 * Two describes:
 *  - unit: the pure helper `deriveDriverLabel` (the ratified cut-points).
 *  - route: the emit actually lands on the /v2/run wire, keyed off the
 *    factor's emitted influence_score (driven with the live 07-07 capture).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveDriverLabel,
  DRIVER_LABEL_STRONG_MIN,
  DRIVER_LABEL_MODERATE_MIN,
} from '../src/lib/driver-label.js';

// ---------------------------------------------------------------------------
// Unit — pure helper
// ---------------------------------------------------------------------------

describe('deriveDriverLabel — ratified normalised-influence cut-points', () => {
  it("influence 0.6 → 'strong'", () => {
    expect(deriveDriverLabel(0.6)).toBe('strong');
  });
  it("influence 0.3 → 'moderate'", () => {
    expect(deriveDriverLabel(0.3)).toBe('moderate');
  });
  it("influence 0.1 → 'minor'", () => {
    expect(deriveDriverLabel(0.1)).toBe('minor');
  });
  it('absent / non-finite influence → undefined (no label fabricated)', () => {
    expect(deriveDriverLabel(undefined)).toBeUndefined();
    expect(deriveDriverLabel(null)).toBeUndefined();
    expect(deriveDriverLabel(NaN)).toBeUndefined();
    expect(deriveDriverLabel(Infinity)).toBeUndefined();
  });

  // Boundaries are inclusive at the min (>=), per the ratified cut-points.
  it("boundary: exactly 0.50 → 'strong'", () => {
    expect(deriveDriverLabel(DRIVER_LABEL_STRONG_MIN)).toBe('strong');
  });
  it("boundary: just below 0.50 → 'moderate'", () => {
    expect(deriveDriverLabel(0.4999)).toBe('moderate');
  });
  it("boundary: exactly 0.20 → 'moderate'", () => {
    expect(deriveDriverLabel(DRIVER_LABEL_MODERATE_MIN)).toBe('moderate');
  });
  it("boundary: just below 0.20 → 'minor'", () => {
    expect(deriveDriverLabel(0.1999)).toBe('minor');
  });
  it("zero → 'minor'", () => {
    expect(deriveDriverLabel(0)).toBe('minor');
  });

  it('the ratified consts are the UI cut-points (0.50 / 0.20)', () => {
    expect(DRIVER_LABEL_STRONG_MIN).toBe(0.5);
    expect(DRIVER_LABEL_MODERATE_MIN).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// Route — the emit lands on the /v2/run wire (live 07-07 capture, mocked ISL)
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isl-v2-live-20260707',
);
const capturePlain = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-staging-capture.json'), 'utf8'),
);
const requestA = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-v2-request.json'), 'utf8'),
);

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(): Promise<{ data: T | null; error: string | null }> {
    return { data: JSON.parse(JSON.stringify(capturePlain)) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

function buildPlotBody() {
  return {
    graph: {
      nodes: requestA.graph.nodes.map((n: any) => ({
        id: n.id,
        kind: n.kind,
        label: n.label,
        ...(n.observed_state?.value !== undefined && n.observed_state?.value !== null
          ? { observed_state: { value: n.observed_state.value } }
          : {}),
      })),
      edges: requestA.graph.edges.map((e: any) => ({
        from: e.from,
        to: e.to,
        exists_probability: e.exists_probability,
        strength: { mean: e.strength.mean, std: e.strength.std },
      })),
    },
    options: requestA.options.map((o: any) => ({
      id: o.id,
      label: o.label,
      interventions: Object.fromEntries(
        Object.entries(o.interventions).map(([nodeId, value]) => [
          nodeId,
          { value, source: 'user_specified' },
        ]),
      ),
    })),
    goal_node_id: requestA.goal_node_id,
    seed: String(requestA.seed),
  };
}

describe('039 route: driver_label lands on /v2/run factor_sensitivity', () => {
  let app: FastifyInstance;
  let factors: any[];

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody(),
    });
    expect(res.statusCode).toBe(200);
    factors = JSON.parse(res.body).factor_sensitivity ?? [];
  }, 120_000);

  afterAll(async () => { await app?.close(); });

  it('emits at least one factor with a driver_label', () => {
    expect(factors.length).toBeGreaterThan(0);
    expect(factors.some((f) => f.driver_label !== undefined)).toBe(true);
  });

  it('every emitted driver_label matches deriveDriverLabel(influence_score)', () => {
    for (const f of factors) {
      const expected = deriveDriverLabel(f.influence_score);
      if (expected === undefined) {
        expect(f.driver_label).toBeUndefined();
      } else {
        expect(f.driver_label).toBe(expected);
      }
    }
  });

  it("driver_label is one of the ratified categories", () => {
    for (const f of factors) {
      if (f.driver_label !== undefined) {
        expect(['strong', 'moderate', 'minor']).toContain(f.driver_label);
      }
    }
  });
});
