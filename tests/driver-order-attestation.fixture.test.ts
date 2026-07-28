/**
 * `/v2/run` `driver_order` — canonical-order + attestation SELF-CONSISTENCY pin
 * (family 4, slice S1).
 *
 * ## What this pins
 *
 * PLoT's role in the ratified authority model is **order + attest**: exactly ONE
 * ordering over the factor set, plus an attestation describing how it was made.
 * An attestation nobody can check is decoration, so every assertion here
 * re-derives the claim from the SAME payload and compares:
 *
 *   1. `ranked_factor_ids` is a faithful permutation of the emitted rows —
 *      no id invented, none dropped, none duplicated;
 *   2. it is PARALLEL to `factor_sensitivity[]` ("one order, and the array IS
 *      it" — amendment Rule S3), so a consumer joining by index and a consumer
 *      joining by id cannot disagree;
 *   3. it satisfies the DECLARED ordering rule, re-applied here INDEPENDENTLY
 *      (this spec deliberately does not import `src/lib/driver-order.ts`) from
 *      the REQUEST's option interventions — the canonical D-U source of lever
 *      identity, never the response's own `zero_reason` stamp;
 *   4. every attested member agrees with the payload it describes — basis vs
 *      the per-row `importance_basis` mirror, species vs the rows' `source`,
 *      lever_ids vs the D-U union, rank_stability vs ISL's measurements.
 *
 * Every one of these FAILS on the pre-S1 build: `driver_order` does not exist
 * there. Mutation-checked in a throwaway worktree OUTSIDE the repo root by
 * perturbing the ordering rule — see the PR body.
 *
 * ## ⚠ THIS SLICE IS ADDITIVE — and the additivity is pinned, not asserted
 *
 * S1 emits `driver_order` ALONGSIDE the surfaces that rank and crown today; it
 * changes none of them. The RESIDUAL block at the foot of this file pins the
 * live divergences AS THEY ARE, so that (a) nobody believes S1 fixed them and
 * (b) none of them can drift silently before the slice that reconciles them.
 *
 * Fixture: `tests/fixtures/isl-v2-live-20260707/` — the 2026-07-07 live
 * capture, pinned by content, kept separate from anything tracking live
 * (a control pinned to "current" decays into a tautology the first time
 * "current" changes).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * The option-pinned levers, derived from the REQUEST — the canonical D-U source
 * of lever identity — and NOT from the response. Deriving them from the
 * response's own `zero_reason` would make the lever assertions a mirror of the
 * thing under test.
 */
const LEVER_IDS: ReadonlySet<string> = new Set(
  requestA.options.flatMap((o: any) => Object.keys(o.interventions ?? {})),
);

/**
 * The DECLARED canonical ordering rule, re-implemented here independently of
 * `src/lib/driver-order.ts`: a STABLE partition over the producer's emitted
 * assembly order placing every non-lever ahead of every lever.
 */
function canonicalOrderByRule(rows: any[]): string[] {
  const nonLevers = rows.filter((f) => !LEVER_IDS.has(f.factor_id)).map((f) => f.factor_id);
  const levers = rows.filter((f) => LEVER_IDS.has(f.factor_id)).map((f) => f.factor_id);
  return [...nonLevers, ...levers];
}

const STABILITY_WORST_FIRST = ['negligible', 'low', 'moderate', 'high'];

describe('/v2/run driver_order — canonical order + attestation (fixture isl-v2-live-20260707)', () => {
  let app: FastifyInstance;
  let body: any;
  let factors: any[];
  let order: any;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody(),
    });
    expect(res.statusCode).toBe(200);
    body = JSON.parse(res.body);
    factors = body.factor_sensitivity as any[];
    order = body.driver_order;
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------
  // POSITIVE CONTROLS — prove every assertion below can SEE something.
  // Without these a shape change (empty array, renamed field, levers gone,
  // stability fields absent) would make the whole spec vacuously green.
  // ---------------------------------------------------------------------
  it('positive control: the payload carries ranked rows, levers AND non-levers, and ISL stability measurements', () => {
    expect(Array.isArray(factors), 'factor_sensitivity must be an array').toBe(true);
    expect(factors.length).toBeGreaterThanOrEqual(2);
    expect(LEVER_IDS.size, 'the request must pin at least one lever').toBeGreaterThan(0);
    const levers = factors.filter((f) => LEVER_IDS.has(f.factor_id));
    const nonLevers = factors.filter((f) => !LEVER_IDS.has(f.factor_id));
    expect(levers.length, 'fixture must contain at least one lever').toBeGreaterThan(0);
    expect(nonLevers.length, 'fixture must contain at least one non-lever').toBeGreaterThan(0);
    // The stability aggregation below is only meaningful if ISL measured
    // something. If ISL ever stops emitting these, this control fails LOUD
    // instead of letting the null-vs-measured assertions pass by testing nothing.
    expect(
      factors.some((f) => typeof f.rank_flip_rate === 'number'),
      'fixture must carry at least one measured rank_flip_rate',
    ).toBe(true);
    expect(
      factors.some((f) => typeof f.attribution_stability === 'string'),
      'fixture must carry at least one attribution_stability band',
    ).toBe(true);
  });

  it('positive control: the ordering rule is LOAD-BEARING here — the raw influence order is a DIFFERENT order', () => {
    // A lever tops the raw structural influence order in this fixture, so the
    // lever-partition step really does move something. If it did not, the
    // ordering assertions below would hold for the wrong reason.
    const byInfluence = [...factors]
      .sort((a, b) => (b.influence_score ?? -Infinity) - (a.influence_score ?? -Infinity))
      .map((f) => f.factor_id);
    const declared = canonicalOrderByRule(factors);
    expect(
      byInfluence,
      'raw influence order equals the canonical order — the lever step is doing nothing and this spec is vacuous',
    ).not.toEqual(declared);
    expect(LEVER_IDS.has(byInfluence[0])).toBe(true);
  });

  // ---------------------------------------------------------------------
  // THE OBJECT EXISTS AND IS WELL-FORMED — RED before S1 (no such field)
  // ---------------------------------------------------------------------
  it('driver_order is emitted alongside factor_sensitivity, versioned, with every attested member present', () => {
    expect(order, 'driver_order must be emitted whenever factor_sensitivity is').toBeDefined();
    expect(order.version).toBe(1);
    expect(['graph_structural', 'isl_uncertainty', 'none']).toContain(order.basis);
    expect(['single', 'mixed_graph_isl']).toContain(order.species);
    expect(['du_union', 'stamp_only', 'none']).toContain(order.lever_policy);
    expect(Array.isArray(order.ranked_factor_ids)).toBe(true);
    expect(Array.isArray(order.lever_ids)).toBe(true);
    // Rule S2: these members are REQUIRED, and their null is a first-class
    // "unresolved" value. A missing member and a null member are different
    // claims, and only the second is the one this producer means.
    expect(order.separability, 'separability must be present, never omitted').toBeDefined();
    expect(order.separability).toHaveProperty('top_pair_separable');
    expect(order.separability).toHaveProperty('method');
    expect(order.rank_stability, 'rank_stability must be present, never omitted').toBeDefined();
    expect(order.rank_stability).toHaveProperty('max_rank_flip_rate');
    expect(order.rank_stability).toHaveProperty('min_attribution_stability');
  });

  // ---------------------------------------------------------------------
  // ⭐ SELF-CONSISTENCY — the emitted order matches the ordering rule
  //    applied to the SAME payload
  // ---------------------------------------------------------------------
  it('ranked_factor_ids is a faithful permutation of the emitted rows (nothing invented, dropped or duplicated)', () => {
    const emitted = factors.map((f) => f.factor_id);
    expect(order.ranked_factor_ids).toHaveLength(emitted.length);
    expect(new Set(order.ranked_factor_ids).size, 'no duplicate ids in the order').toBe(
      order.ranked_factor_ids.length,
    );
    expect([...order.ranked_factor_ids].sort()).toEqual([...emitted].sort());
  });

  it('⭐ ranked_factor_ids is PARALLEL to factor_sensitivity[] — the array IS the order (Rule S3)', () => {
    expect(order.ranked_factor_ids).toEqual(factors.map((f) => f.factor_id));
  });

  it('⭐ ranked_factor_ids equals the DECLARED ordering rule re-applied independently to the same payload', () => {
    expect(order.ranked_factor_ids).toEqual(canonicalOrderByRule(factors));
  });

  it('no lever precedes a non-lever in the canonical order (lever_policy du_union, honoured)', () => {
    expect(order.lever_policy).toBe('du_union');
    const positions = order.ranked_factor_ids.map((id: string) => LEVER_IDS.has(id));
    const firstLever = positions.indexOf(true);
    const lastNonLever = positions.lastIndexOf(false);
    expect(firstLever, 'fixture must contain a lever').toBeGreaterThanOrEqual(0);
    expect(lastNonLever, 'fixture must contain a non-lever').toBeGreaterThanOrEqual(0);
    expect(firstLever).toBeGreaterThan(lastNonLever);
  });

  it('lever_ids names exactly the D-U levers present in the order, in rank order', () => {
    expect(order.lever_ids).toEqual(
      order.ranked_factor_ids.filter((id: string) => LEVER_IDS.has(id)),
    );
    // ⚠ MARKED, NOT REMOVED: a lever stays IN the order. Whether a lever may be
    // CROWNED is a permission question owned by CEE, not by this producer.
    expect(order.lever_ids.length).toBeGreaterThan(0);
    for (const id of order.lever_ids) {
      expect(order.ranked_factor_ids).toContain(id);
    }
  });

  // ---------------------------------------------------------------------
  // ATTESTATION vs PAYLOAD — every attested member checked against the
  // thing it describes
  // ---------------------------------------------------------------------
  it('basis is graph_structural and AGREES with every row\'s importance_basis (the transition mirror, failing loud)', () => {
    expect(order.basis).toBe('graph_structural');
    // ⚠ Trap 12b. The per-row `importance_basis` is kept for one release while
    // consumers migrate to the ordering object. A mirror is acceptable ONLY
    // while it fails loud on drift — this is that failure. Delete the per-row
    // field, and this assertion, in the release after.
    for (const f of factors) {
      expect(f.importance_basis, `${f.factor_id} disagrees with driver_order.basis`).toBe(
        order.basis,
      );
    }
  });

  it('species agrees with the rows\' own source labels', () => {
    const sources = new Set(factors.map((f) => f.source));
    const expected = sources.has('graph') && sources.has('isl') ? 'mixed_graph_isl' : 'single';
    expect(order.species).toBe(expected);
    // Fixture premise, pinned: this capture is single-species (graph-primary).
    expect([...sources]).toEqual(['graph']);
  });

  it('rank_stability aggregates ISL\'s measurements — worst flip rate, worst stability band', () => {
    const flips = factors
      .map((f) => f.rank_flip_rate)
      .filter((v) => typeof v === 'number' && Number.isFinite(v));
    expect(order.rank_stability.max_rank_flip_rate).toBe(Math.max(...flips));
    const bands = factors
      .map((f) => f.attribution_stability)
      .filter((b) => STABILITY_WORST_FIRST.includes(b));
    const worst = STABILITY_WORST_FIRST.find((b) => bands.includes(b));
    expect(order.rank_stability.min_attribution_stability).toBe(worst);
  });

  // ---------------------------------------------------------------------
  // THE TIE VERDICT — a producer verdict, and this build can only PROVE
  // non-separation. `true` is never emitted; `null` means UNRESOLVED.
  // ---------------------------------------------------------------------
  it('positive control: the top pair is COMPARABLE and NOT an exact tie, so the verdict below is the provisional branch', () => {
    const a = factors[0].influence_score;
    const b = factors[1].influence_score;
    expect(typeof a).toBe('number');
    expect(typeof b).toBe('number');
    expect(a, 'if these ever become equal the assertion below tests a different branch').not.toBe(b);
    // The comparability guard must not be what decides this fixture: both rows
    // are non-levers of the same species, so the arithmetic really does run.
    expect(LEVER_IDS.has(factors[0].factor_id)).toBe(false);
    expect(LEVER_IDS.has(factors[1].factor_id)).toBe(false);
    expect(factors[0].source).toBe(factors[1].source);
  });

  /**
   * ⭐ PIN FLIPPED — this read *"separability is UNRESOLVED (null), never a
   * fabricated 'separable'"*, correct at S1 where `true` was unreachable by
   * construction. Paul ratified a PROVISIONAL default on 2026-07-28, so the
   * golden's top pair is now DECIDED. What has NOT changed, and is asserted
   * here, is that the verdict may never arrive without its provenance.
   */
  it('separability is now DECIDED on this fixture — and carries the statistic, threshold and provisional status', () => {
    const a = factors[0].influence_score;
    const b = factors[1].influence_score;
    const relativeGap = (a - b) / a;
    // Re-derived here from the payload, not read from the module under test.
    expect(order.separability.top_pair_separable).toBe(relativeGap >= 0.1);
    expect(order.separability.top_pair_separable).toBe(true);
    expect(order.separability.method).toBe('relative_gap_0.10_provisional');
    // ⛔ T3: one threshold, on the wire. A `true` with a null method would be an
    // unauditable claim, and that remains forbidden.
    expect(order.separability.method).not.toBeNull();
    expect(order.separability.method).toContain('provisional');
  });

  // ---------------------------------------------------------------------
  // ⚠ ADDITIVITY — S1 changed NOTHING that already ranked or crowned.
  // These pin the residual divergences AS THEY ARE.
  // ---------------------------------------------------------------------
  it('ADDITIVITY: importance_rank is untouched — still dense 1..n and still parallel to the emitted array', () => {
    const ranks = factors.map((f) => f.importance_rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(
      Array.from({ length: factors.length }, (_, i) => i + 1),
    );
    factors.forEach((f, i) => expect(f.importance_rank).toBe(i + 1));
  });

  it('ADDITIVITY: influence_rank/influence_score still carry the raw graph order (no re-sort was introduced)', () => {
    const top = factors.find((f) => f.influence_rank === 1);
    expect(LEVER_IDS.has(top.factor_id)).toBe(true);
    expect(top.influence_score).toBe(1);
  });

  /**
   * ⭐ THE TWO RESIDUAL PINS BELOW ARE NOW AGREEMENT PINS — S1b CLOSED THEM.
   *
   * S1 wrote them as RESIDUALS on purpose: *"the RESIDUAL block pins the live
   * divergences AS THEY ARE, so that (a) nobody believes S1 fixed them and
   * (b) none of them can drift silently before the slice that reconciles
   * them."* This is that slice, so each is flipped to the agreement it was
   * holding a place for. The full five-surface law lives in
   * `tests/driver-order-projection.fixture.test.ts`; these stay here so this
   * spec's own residual table cannot go stale in-file.
   */
  it("CLOSED by S1b: driver_label 'biggest' AGREES with ranked_factor_ids[0]", () => {
    const biggest = factors.filter((f) => f.driver_label === 'biggest');
    expect(biggest).toHaveLength(1);
    expect(biggest[0].factor_id).toBe(order.ranked_factor_ids[0]);
    // It no longer crowns the option-pinned lever the same response publishes
    // at sensitivity_score 0 / elasticity 0.
    expect(LEVER_IDS.has(biggest[0].factor_id)).toBe(false);
  });

  it('CLOSED by S1b: m1_coaching.key_drivers[0] AGREES with ranked_factor_ids[0]', () => {
    const kd = body.m1_coaching?.key_drivers ?? [];
    expect(kd.length, 'key_drivers must be populated for this fixture').toBeGreaterThan(0);
    expect(kd[0].rank).toBe(1);
    expect(kd[0].factor_id).toBe(order.ranked_factor_ids[0]);
  });

  it('CLOSED by S1b: decision_brief.top_drivers[0] agrees BY PROJECTION now, not by its stamp-only predicate', () => {
    const top = body.decision_brief?.top_drivers?.[0];
    expect(top, 'top_drivers must be populated for this fixture').toBeDefined();
    const rank1Row = factors.find((f) => f.factor_id === order.ranked_factor_ids[0]);
    expect(top.factor_label).toBe(rank1Row.factor_label);
    // The VALUE is unchanged on this capture — the stamp happened to cover
    // here. What changed is the derivation, and the separating input (an
    // UNSTAMPED D-U lever, which the stamp misses) is in
    // tests/driver-surface-projection.unit.test.ts.
  });

  it('dominant_factor is suppressed on this fixture by its own >0.5 influence floor', () => {
    expect(body.dominant_factor).toBeUndefined();
    // ⭐ THE SUPPRESSING GATE MOVED, and that is the S1b change: the candidate
    // is now the canonical #1, which fails the influence FLOOR — where before
    // the candidate was the raw argmax (the lever), suppressed only by the
    // ratio gate at 1 / 0.7243 = 1.38. The F-D3 leg in
    // tests/driver-surface-projection.unit.test.ts opens that ratio gate and
    // proves the lever still cannot be crowned.
    const rank1 = factors.find((f) => f.factor_id === order.ranked_factor_ids[0]);
    expect(rank1.influence_score).toBeLessThanOrEqual(0.5);
  });
});
