/**
 * Doctrine 039 (D-7) — producer-owned `driver_label`, 4-valued.
 *
 * PLoT emits a producer-owned categorical driver-strength label over the
 * normalised-influence scalar (`influence_score`). It is now 4-valued to match
 * the SHAPE of the UI's `getSemanticLabel`:
 *   - three magnitude bands (cut-points ratified from useResultsSectionData.ts):
 *       influence_score >= 0.50 → 'strong'
 *       influence_score >= 0.20 → 'moderate'
 *       otherwise              → 'minor'
 *   - a set-aware rank-1 'biggest' band: the SINGLE factor with the greatest
 *     `influence_score` is 'biggest', UNCONDITIONAL of magnitude. Ties on the max
 *     resolve to the FIRST factor in the stable emitted order. A factor with
 *     absent/non-finite influence gets NO label and is NOT eligible to be
 *     'biggest'.
 * NOTE: matching the SHAPE does not yet let the UI drop `getSemanticLabel` — the
 * basis flip (elasticity vs influence) + UI adoption remain UI-confirmation-gated
 * (D-7). Absent/non-finite influence ⇒ NO label (honesty). Magnitude thresholds
 * are DOCTRINE-PENDING (Neil), one const each; 'biggest' is rank-1 unconditional
 * (DOCTRINE-PENDING Neil/UX — a magnitude floor can be added later).
 *
 * Describes:
 *  - unit: `deriveDriverLabel` — the pure 3-band magnitude helper (never 'biggest').
 *  - unit: `indexOfBiggestDriver` — the set-aware rank-1 selector (argmax / ties /
 *    single-factor / absent-not-eligible).
 *  - route: the 4-valued emit lands on the /v2/run wire, keyed off each factor's
 *    emitted influence_score, with exactly one 'biggest' on the rank-1 factor
 *    (driven with the live 07-07 capture).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveDriverLabel,
  indexOfBiggestDriver,
  DRIVER_LABEL_STRONG_MIN,
  DRIVER_LABEL_MODERATE_MIN,
} from '../src/lib/driver-label.js';

// ---------------------------------------------------------------------------
// Unit — pure per-factor magnitude helper
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

  // The magnitude helper is pure/per-factor and can NEVER return 'biggest';
  // 'biggest' is a set-aware rank-1 override (indexOfBiggestDriver).
  it("never returns 'biggest' (rank-1 is set-aware, not a magnitude band)", () => {
    for (const s of [1, 0.99, 0.5, 0.2, 0.1, 0, 1e6]) {
      expect(deriveDriverLabel(s)).not.toBe('biggest');
    }
  });
});

// ---------------------------------------------------------------------------
// Unit — set-aware rank-1 selector (the 'biggest' band)
// ---------------------------------------------------------------------------

describe('indexOfBiggestDriver — set-aware rank-1 by influence_score', () => {
  it('picks the index of the single greatest influence_score', () => {
    const factors = [
      { influence_score: 0.2 },
      { influence_score: 0.9 }, // rank-1
      { influence_score: 0.5 },
    ];
    expect(indexOfBiggestDriver(factors)).toBe(1);
  });

  it('argmax is magnitude-blind: a low-influence max is still rank-1 (biggest unconditional)', () => {
    // Greatest influence here is 0.1 → magnitude band would be 'minor', yet it
    // is still the rank-1 factor. The derive-pass stamps it 'biggest'
    // unconditionally of magnitude.
    const factors = [
      { influence_score: 0.05 },
      { influence_score: 0.1 }, // rank-1, but deriveDriverLabel(0.1) === 'minor'
      { influence_score: 0.03 },
    ];
    const idx = indexOfBiggestDriver(factors);
    expect(idx).toBe(1);
    expect(deriveDriverLabel(factors[idx].influence_score)).toBe('minor');
  });

  it('ties on the max → the FIRST factor in emitted order (deterministic)', () => {
    const factors = [
      { influence_score: 0.4 },
      { influence_score: 0.8 }, // first occurrence of the max
      { influence_score: 0.8 }, // tie — must NOT win
      { influence_score: 0.1 },
    ];
    expect(indexOfBiggestDriver(factors)).toBe(1);
  });

  it('single-factor → that factor (index 0) is rank-1', () => {
    expect(indexOfBiggestDriver([{ influence_score: 0.42 }])).toBe(0);
  });

  it('empty array → -1 (no eligible factor)', () => {
    expect(indexOfBiggestDriver([])).toBe(-1);
  });

  it('all influence absent/non-finite → -1 (none eligible to be biggest)', () => {
    expect(
      indexOfBiggestDriver([
        { influence_score: undefined },
        { influence_score: null },
        { influence_score: NaN },
        { influence_score: Infinity },
        {},
      ]),
    ).toBe(-1);
  });

  it('a factor with absent influence is skipped even when it appears first', () => {
    // The absent-influence factor at index 0 is NOT eligible; the real max is
    // the finite 0.3 at index 2.
    const factors = [
      { influence_score: undefined }, // ineligible
      { influence_score: 0.1 },
      { influence_score: 0.3 }, // rank-1 among the eligible
    ];
    expect(indexOfBiggestDriver(factors)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Route — the 4-valued emit lands on the /v2/run wire (live 07-07 capture)
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

describe('039 route: 4-valued driver_label lands on /v2/run factor_sensitivity', () => {
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

  it("exactly ONE factor is 'biggest'", () => {
    const biggest = factors.filter((f) => f.driver_label === 'biggest');
    expect(biggest.length).toBe(1);
  });

  it("the 'biggest' factor is the single greatest influence_score (rank-1)", () => {
    // Argmax over the EMITTED influence_score, computed independently of the field.
    const eligible = factors.filter(
      (f) => typeof f.influence_score === 'number' && Number.isFinite(f.influence_score),
    );
    expect(eligible.length).toBeGreaterThan(0);
    const maxScore = Math.max(...eligible.map((f) => f.influence_score));
    const argmax = factors.find((f) => f.influence_score === maxScore);
    expect(argmax.driver_label).toBe('biggest');
    // and no OTHER factor carries 'biggest'
    for (const f of factors) {
      if (f !== argmax) expect(f.driver_label).not.toBe('biggest');
    }
  });

  it('every NON-biggest driver_label matches the magnitude helper; the biggest is the argmax', () => {
    const eligible = factors.filter(
      (f) => typeof f.influence_score === 'number' && Number.isFinite(f.influence_score),
    );
    const maxScore = Math.max(...eligible.map((f) => f.influence_score));
    const argmax = factors.find((f) => f.influence_score === maxScore);
    for (const f of factors) {
      if (f === argmax) {
        expect(f.driver_label).toBe('biggest');
        continue;
      }
      const expected = deriveDriverLabel(f.influence_score);
      if (expected === undefined) {
        expect(f.driver_label).toBeUndefined();
      } else {
        expect(f.driver_label).toBe(expected);
      }
    }
  });

  it('a mid-rank factor keeps its magnitude band (strong/moderate), not biggest', () => {
    // In the 07-07 capture the mid factors are dev_headcount (~0.72 → strong)
    // and hiring_cost (~0.50 → moderate). Whichever mid factors exist, none is
    // 'biggest' and each equals its magnitude band.
    const eligible = factors.filter(
      (f) => typeof f.influence_score === 'number' && Number.isFinite(f.influence_score),
    );
    const maxScore = Math.max(...eligible.map((f) => f.influence_score));
    const mids = eligible.filter((f) => f.influence_score !== maxScore);
    expect(mids.length).toBeGreaterThan(0);
    for (const f of mids) {
      expect(f.driver_label).not.toBe('biggest');
      expect(f.driver_label).toBe(deriveDriverLabel(f.influence_score));
      expect(['strong', 'moderate', 'minor']).toContain(f.driver_label);
    }
  });

  it('driver_label is one of the 4 ratified categories', () => {
    for (const f of factors) {
      if (f.driver_label !== undefined) {
        expect(['biggest', 'strong', 'moderate', 'minor']).toContain(f.driver_label);
      }
    }
  });
});
