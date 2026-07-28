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
 *   - a set-aware rank-1 'biggest' band.
 *
 * ## ⭐ FAMILY-4 S1b — THE 'biggest' BAND CHANGED BASIS (2026-07-28)
 *
 * `'biggest'` USED to be argmax over `influence_score`, computed here. That
 * selector was NOT lever-aware, and on the live wire it crowned the
 * option-pinned lever the same response publishes at `sensitivity_score: 0` /
 * `elasticity: 0` — while `importance_rank: 1` named a different factor.
 *
 * It is now a **PROJECTION of `driver_order.ranked_factor_ids[0]`** — PLoT's one
 * canonical, lever-aware order — so the five #1-naming surfaces are one claim
 * instead of five (amendment §4.3/§8-S1). The raw structural argmax is NOT lost:
 * it is still published, under its own honest name, as `influence_rank === 1`.
 *
 * ⚠ The three MAGNITUDE bands are untouched, and so is their doctrine status:
 * cut-points remain DOCTRINE-PENDING (Neil), one const each; the basis flip
 * (elasticity vs influence) and UI adoption remain UI-confirmation-gated (D-7).
 * What S1b settled is which ORDER a crown projects — not what a magnitude means.
 *
 * Describes:
 *  - unit: `deriveDriverLabel` — the pure 3-band magnitude helper (never 'biggest').
 *  - unit: `indexOfCanonicalTopDriver` — the rank-1 projection.
 *  - route: the 4-valued emit lands on the /v2/run wire, with exactly one
 *    'biggest' on the CANONICAL rank-1 factor (live 07-07 capture).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveDriverLabel,
  indexOfCanonicalTopDriver,
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
// Unit — the rank-1 PROJECTION (the 'biggest' band)
//
// ⭐ These replace the `indexOfBiggestDriver` block, which tested the argmax
//    selector S1b removed (see the file header). Each assertion below is the
//    same question asked of the new basis.
// ---------------------------------------------------------------------------

describe('indexOfCanonicalTopDriver — the rank-1 projection', () => {
  it('⭐ names index 0 — the canonical order, NOT the influence argmax', () => {
    // The old selector returned 1 here. The array is the canonical order
    // (Rule S3), so the crown belongs to index 0 regardless of magnitude.
    const factors = [
      { influence_score: 0.2 }, // canonical rank 1
      { influence_score: 0.9 }, // bigger, but demoted — e.g. an option-pinned lever
      { influence_score: 0.5 },
    ];
    expect(indexOfCanonicalTopDriver(factors)).toBe(0);
  });

  it('the crown is magnitude-BLIND: rank 1 is biggest even when its band is minor', () => {
    // Unchanged property, new basis. `'biggest'` answers "which factor does
    // this producer rank first?", which has an answer at any magnitude.
    const factors = [{ influence_score: 0.1 }, { influence_score: 0.05 }];
    const idx = indexOfCanonicalTopDriver(factors);
    expect(idx).toBe(0);
    expect(deriveDriverLabel(factors[idx].influence_score)).toBe('minor');
  });

  it('no ties to break — one order, one first element (deterministic by construction)', () => {
    // The old argmax needed a documented tie rule because two rows could share
    // the max. A projection of a total order cannot tie with itself.
    const factors = [{ influence_score: 0.8 }, { influence_score: 0.8 }];
    expect(indexOfCanonicalTopDriver(factors)).toBe(0);
  });

  it('single-factor → that factor (index 0) is rank-1', () => {
    expect(indexOfCanonicalTopDriver([{ influence_score: 0.42 }])).toBe(0);
  });

  it('empty array → -1 (no order, no crown)', () => {
    expect(indexOfCanonicalTopDriver([])).toBe(-1);
  });

  it('⚠ BEHAVIOUR CHANGE, deliberate: rank 1 is crowned even with absent influence', () => {
    // The old selector returned -1 here, because it could not compute an
    // argmax. `'biggest'` is now a RANK claim, and the producer HAS ranked
    // these rows — so the crown lands, while the row still carries no
    // MAGNITUDE band (deriveDriverLabel returns undefined and the caller omits
    // the field before this override).
    const factors = [
      { influence_score: undefined },
      { influence_score: 0.1 },
      { influence_score: 0.3 },
    ];
    expect(indexOfCanonicalTopDriver(factors)).toBe(0);
    expect(deriveDriverLabel(factors[0].influence_score)).toBeUndefined();
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

  /**
   * ⭐ PIN FLIPPED. This read *"the 'biggest' factor is the single greatest
   * influence_score (rank-1)"* — an accurate description of the argmax basis
   * S1b replaced. The positive control below proves the two bases genuinely
   * disagree on this capture, so the new assertion cannot pass for the old
   * reason.
   */
  it("⭐ the 'biggest' factor is the CANONICAL rank 1, not the influence argmax", () => {
    const eligible = factors.filter(
      (f) => typeof f.influence_score === 'number' && Number.isFinite(f.influence_score),
    );
    expect(eligible.length).toBeGreaterThan(0);
    const maxScore = Math.max(...eligible.map((f) => f.influence_score));
    const argmax = factors.find((f) => f.influence_score === maxScore);

    // Positive control (trap 13): on this capture the two bases DISAGREE, so
    // the assertion below can see the difference.
    expect(argmax.factor_id, 'the two bases must differ or this test is vacuous').not.toBe(
      factors[0].factor_id,
    );

    // Rule S3 — the emitted array IS the canonical order.
    expect(factors[0].driver_label).toBe('biggest');
    expect(argmax.driver_label).not.toBe('biggest');
    for (const f of factors) {
      if (f !== factors[0]) expect(f.driver_label).not.toBe('biggest');
    }
  });

  it('every NON-biggest driver_label is still the pure magnitude band (the three bands are untouched)', () => {
    for (const f of factors) {
      if (f === factors[0]) {
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

  it('⭐ the DEMOTED lever now carries its honest magnitude band instead of the crown', () => {
    // This is the user-visible half of the fix: the factor the same response
    // publishes at sensitivity_score 0 / elasticity 0 stops being labelled the
    // biggest driver in the decision, and is labelled by its own number.
    const eligible = factors.filter(
      (f) => typeof f.influence_score === 'number' && Number.isFinite(f.influence_score),
    );
    const maxScore = Math.max(...eligible.map((f) => f.influence_score));
    const demoted = factors.filter((f) => f !== factors[0] && f.influence_score !== undefined);
    expect(demoted.length).toBeGreaterThan(0);
    for (const f of demoted) {
      expect(f.driver_label).not.toBe('biggest');
      expect(f.driver_label).toBe(deriveDriverLabel(f.influence_score));
      expect(['strong', 'moderate', 'minor']).toContain(f.driver_label);
    }
    // …and specifically the old crown-holder, named by its own influence.
    const oldCrown = factors.find((f) => f.influence_score === maxScore);
    expect(oldCrown.driver_label).toBe(deriveDriverLabel(maxScore));
  });

  it('driver_label is one of the 4 ratified categories', () => {
    for (const f of factors) {
      if (f.driver_label !== undefined) {
        expect(['biggest', 'strong', 'moderate', 'minor']).toContain(f.driver_label);
      }
    }
  });
});
