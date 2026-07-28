/**
 * ⭐ `/v2/run` — THE FIVE #1-SURFACES ARE PROJECTIONS OF `driver_order.ranked_factor_ids[0]`
 * (family 4, slice S1b — the consumer half of "one order").
 *
 * ## What this pins, and why it is one test rather than five
 *
 * S1 (PLoT #287) made PLoT publish exactly ONE ordering (`driver_order`). It
 * did NOT change the surfaces that crown, and on the committed golden three of
 * the five named a different factor from `ranked_factor_ids[0]` — the
 * option-pinned lever the same response publishes at `sensitivity_score: 0`,
 * `elasticity: 0`, `zero_reason: 'intervention_override'`.
 *
 * The amendment's §8-S1 states the acceptance test verbatim:
 *
 * > `driver_label`, `dominant_factor`, `m1_coaching.key_drivers[].rank`,
 * > `decision_brief.top_drivers[0]` and the facts-path `importance_rank` all
 * > become **projections of `ranked_factor_ids`** — they stop being independent
 * > argmaxes. […] checkable by a single test asserting all five name
 * > `ranked_factor_ids[0]`.
 *
 * Five independent argmaxes over four different quantities cannot be kept in
 * agreement by five independent tests — that is the hand-maintained mirror
 * (CLAUDE.md trap 12) in test form. So the law is asserted ONCE, against the
 * canonical order, for every surface present.
 *
 * ## ⚠ Method: the canonical order is re-derived FROM THE REQUEST
 *
 * Lever identity comes from the REQUEST's option interventions — the canonical
 * D-U source — never from the response's own `zero_reason` stamp, and this spec
 * deliberately does not import `src/lib/driver-order.ts`. An assertion that
 * imports the module it checks proves only that the module agrees with itself.
 *
 * ## ⛔ WHAT THIS SLICE DOES NOT DO (amendment §4.4)
 *
 * The lever DEMOTION stays. `applyLeverAwareImportanceOrder` still pushes
 * option-controlled levers to the back, and this slice does not un-demote them:
 * today the demotion is the only thing keeping a producer-zeroed lever off
 * rank 1, and ranking levers truthfully must wait for CEE's permission (S4) and
 * the UI's consumption (S6). The `ADDITIVITY`/`§4.4` block at the foot pins
 * that the demotion is still in force.
 *
 * Fixture: `tests/fixtures/isl-v2-live-20260707/` — the 2026-07-07 live
 * capture, pinned by content, kept separate from anything tracking live (trap
 * 12b: a control pinned to "current" decays into a tautology the first time
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
 * of lever identity, never the response's own `zero_reason` stamp.
 */
const LEVER_IDS: ReadonlySet<string> = new Set(
  requestA.options.flatMap((o: any) => Object.keys(o.interventions ?? {})),
);

/**
 * The DECLARED canonical ordering rule, re-implemented independently of
 * `src/lib/driver-order.ts`: a STABLE partition over the producer's emitted
 * assembly order placing every non-lever ahead of every lever.
 */
function canonicalOrderByRule(rows: any[]): string[] {
  const nonLevers = rows.filter((f) => !LEVER_IDS.has(f.factor_id)).map((f) => f.factor_id);
  const levers = rows.filter((f) => LEVER_IDS.has(f.factor_id)).map((f) => f.factor_id);
  return [...nonLevers, ...levers];
}

describe('/v2/run — the five #1-surfaces PROJECT ranked_factor_ids[0] (fixture isl-v2-live-20260707)', () => {
  let app: FastifyInstance;
  let body: any;
  let factors: any[];
  let order: any;
  /** The ONE answer every surface below must give. Derived, not hard-coded. */
  let canonicalTopId: string;
  let canonicalTopRow: any;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    // Explicit, never inherited from NODE_ENV — the facts leg below is one of
    // the five surfaces and must not silently vanish (design §5 gate note).
    process.env.ENABLE_FACTS_ASSEMBLY = '1';
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
    canonicalTopId = order.ranked_factor_ids[0];
    canonicalTopRow = factors.find((f) => f.factor_id === canonicalTopId);
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------
  // POSITIVE CONTROLS — trap 13. Every assertion below must be able to SEE
  // a disagreement before it is allowed to assert agreement.
  // ---------------------------------------------------------------------
  it('positive control: the canonical order exists, is lever-aware, and its #1 is NOT the raw influence argmax', () => {
    expect(order, 'driver_order must be emitted').toBeDefined();
    expect(order.basis).toBe('graph_structural');
    expect(order.ranked_factor_ids).toEqual(canonicalOrderByRule(factors));
    expect(canonicalTopRow, 'ranked_factor_ids[0] must name a real emitted row').toBeDefined();

    // ⭐ THE WHOLE POINT. If the canonical #1 were also the raw influence
    // argmax, every assertion below would hold for the wrong reason and this
    // spec would be vacuous — it would pass against the pre-S1b code.
    const rawArgmax = [...factors]
      .sort((a, b) => (b.influence_score ?? -Infinity) - (a.influence_score ?? -Infinity))[0];
    expect(
      rawArgmax.factor_id,
      'raw influence argmax equals the canonical #1 — this spec cannot detect the defect it exists for',
    ).not.toBe(canonicalTopId);
    expect(LEVER_IDS.has(rawArgmax.factor_id), 'the raw argmax is the option-pinned lever').toBe(true);
    expect(LEVER_IDS.has(canonicalTopId), 'the canonical #1 is NOT a lever').toBe(false);
  });

  it('positive control: the lever the old crowns named is the one this response ZEROES', () => {
    const lever = factors.find((f) => f.factor_id !== canonicalTopId && LEVER_IDS.has(f.factor_id));
    expect(lever).toBeDefined();
    expect(lever.sensitivity_score).toBe(0);
    expect(lever.elasticity).toBe(0);
    expect(lever.zero_reason).toBe('intervention_override');
    // …and it still carries the biggest structural influence, which is exactly
    // why an influence-argmax crown lands on it.
    expect(lever.influence_score).toBeGreaterThan(canonicalTopRow.influence_score);
  });

  // ---------------------------------------------------------------------
  // ⭐ THE LAW — all five name ranked_factor_ids[0]
  // ---------------------------------------------------------------------
  it("⭐ SURFACE 1/5 — driver_label 'biggest' names ranked_factor_ids[0]", () => {
    const biggest = factors.filter((f) => f.driver_label === 'biggest');
    expect(biggest, "exactly one row may carry 'biggest'").toHaveLength(1);
    expect(biggest[0].factor_id).toBe(canonicalTopId);
    // …and therefore never the producer-zeroed lever.
    expect(LEVER_IDS.has(biggest[0].factor_id)).toBe(false);
  });

  it('⭐ SURFACE 2/5 — m1_coaching.key_drivers[0] names ranked_factor_ids[0]', () => {
    const kd = body.m1_coaching?.key_drivers ?? [];
    expect(kd.length, 'key_drivers must be populated for this fixture').toBeGreaterThan(0);
    expect(kd[0].rank).toBe(1);
    expect(kd[0].factor_id).toBe(canonicalTopId);
  });

  it('⭐ SURFACE 2/5 (whole list) — key_drivers is the canonical order truncated, not a second sort', () => {
    const kd = body.m1_coaching?.key_drivers ?? [];
    expect(kd.map((d: any) => d.factor_id)).toEqual(order.ranked_factor_ids.slice(0, kd.length));
    kd.forEach((d: any, i: number) => expect(d.rank).toBe(i + 1));
  });

  it('⭐ SURFACE 3/5 — dominant_factor, when emitted, names ranked_factor_ids[0] (and here its own gate suppresses it)', () => {
    if (body.dominant_factor !== undefined) {
      expect(body.dominant_factor.factor_id).toBe(canonicalTopId);
    } else {
      // Absence must be the GATE's doing, not a silent drop. The canonical #1
      // fails the >0.5 influence floor on this capture — assert that, so the
      // branch is named rather than assumed (the F-D3 leg in
      // tests/factor-dominance-projection.unit.test.ts covers the emitting side).
      expect(canonicalTopRow.influence_score).toBeLessThanOrEqual(0.5);
    }
  });

  it('⭐ SURFACE 4/5 — decision_brief.top_drivers[0] names ranked_factor_ids[0]', () => {
    const top = body.decision_brief?.top_drivers?.[0];
    expect(top, 'top_drivers must be populated for this fixture').toBeDefined();
    expect(top.factor_label).toBe(canonicalTopRow.factor_label);
  });

  it('⭐ SURFACE 4/5 (whole list) — top_drivers follows the canonical order over non-levers, not a second |elasticity| sort', () => {
    const labels = (body.decision_brief?.top_drivers ?? []).map((d: any) => d.factor_label);
    const expected = order.ranked_factor_ids
      .filter((id: string) => !LEVER_IDS.has(id))
      .map((id: string) => factors.find((f) => f.factor_id === id))
      .filter((f: any) => f.elasticity !== undefined && f.elasticity !== null)
      .map((f: any) => f.factor_label);
    expect(labels).toEqual(expected.slice(0, labels.length));
  });

  it('⭐ SURFACE 5/5 — the facts-path importance_rank 1 names ranked_factor_ids[0]', () => {
    const facts = (body.fact_objects ?? []).filter(
      (f: any) => f.data?.type === 'factor_sensitivity',
    );
    expect(facts.length, 'fact_objects must carry factor_sensitivity facts').toBeGreaterThan(0);
    const rank1 = facts.filter((f: any) => f.data.importance_rank === 1);
    expect(rank1, 'exactly one fact may hold importance_rank 1').toHaveLength(1);
    expect(rank1[0].data.node_id).toBe(canonicalTopId);
  });

  it('⭐ SURFACE 5/5 — the facts-path rank is SOURCED from the canonical rank, not re-derived positionally', () => {
    const facts = (body.fact_objects ?? []).filter(
      (f: any) => f.data?.type === 'factor_sensitivity',
    );
    for (const fact of facts) {
      const row = factors.find((f) => f.factor_id === fact.data.node_id);
      expect(row, `fact ${fact.data.node_id} must name an emitted row`).toBeDefined();
      expect(
        fact.data.importance_rank,
        `${fact.data.node_id}: facts rank disagrees with factor_sensitivity[].importance_rank`,
      ).toBe(row.importance_rank);
    }
  });

  // ---------------------------------------------------------------------
  // ⭐ THE SINGLE ASSERTION §8-S1 ASKS FOR — stated once, over all five
  // ---------------------------------------------------------------------
  it('⭐ ALL FIVE #1-naming surfaces present in this payload name the SAME factor', () => {
    const named: Record<string, string | undefined> = {
      "driver_label 'biggest'": factors.find((f) => f.driver_label === 'biggest')?.factor_id,
      'm1_coaching.key_drivers[0]': body.m1_coaching?.key_drivers?.[0]?.factor_id,
      dominant_factor: body.dominant_factor?.factor_id,
      'decision_brief.top_drivers[0]': (() => {
        const label = body.decision_brief?.top_drivers?.[0]?.factor_label;
        return label === undefined
          ? undefined
          : factors.find((f) => f.factor_label === label)?.factor_id;
      })(),
      'fact_objects importance_rank 1': (body.fact_objects ?? []).find(
        (f: any) => f.data?.type === 'factor_sensitivity' && f.data.importance_rank === 1,
      )?.data?.node_id,
    };
    // A surface absent from this payload is not a disagreement — but at least
    // four must be PRESENT or this assertion is testing almost nothing.
    const present = Object.entries(named).filter(([, v]) => v !== undefined);
    expect(present.length, `only ${present.length} of 5 surfaces present`).toBeGreaterThanOrEqual(4);
    for (const [surface, id] of present) {
      expect(id, `${surface} does not name the canonical #1`).toBe(canonicalTopId);
    }
  });

  // ---------------------------------------------------------------------
  // ⛔ §4.4 — the lever demotion is UNCHANGED by this slice
  // ---------------------------------------------------------------------
  it('§4.4: levers are still DEMOTED (not un-demoted, not removed) — the order still ranks every non-lever first', () => {
    const positions = order.ranked_factor_ids.map((id: string) => LEVER_IDS.has(id));
    expect(positions.indexOf(true)).toBeGreaterThan(positions.lastIndexOf(false));
    expect(order.lever_policy).toBe('du_union');
    expect(order.lever_ids.length).toBeGreaterThan(0);
    // MARKED, not hidden: every lever is still IN the emitted array.
    for (const id of order.lever_ids) expect(order.ranked_factor_ids).toContain(id);
  });

  it('§4.4: influence_rank/influence_score still carry the raw graph order — no re-sort was introduced', () => {
    const top = factors.find((f) => f.influence_rank === 1);
    expect(LEVER_IDS.has(top.factor_id)).toBe(true);
    expect(top.influence_score).toBe(1);
  });
});
