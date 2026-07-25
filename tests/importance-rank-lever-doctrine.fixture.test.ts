/**
 * `/v2/run` importance-authority coherence pin (lane PLoT importance-authority,
 * 25 Jul 2026).
 *
 * ## What this pins, and why
 *
 * `/v2/run` publishes FOUR "what matters most" surfaces in one body. Three of
 * them apply PLoT's ratified option-lever doctrine — an option-pinned lever is a
 * DECISION LEVER, not a background uncertainty, so it is excluded from
 * importance/investigation rankings (`src/coaching/evidence-gaps.ts`, the
 * `LEVER_SUPPRESSION_FIELDS` zeroing in `src/lib/factor-influence.ts`, and the
 * EVPI skip in `src/routes/v2/run.ts` whose stated reason is that emitting it
 * would "rank the lever as an investigation priority").
 *
 * `factor_sensitivity[].importance_rank` and the set-aware
 * `driver_label: 'biggest'` crown did NOT apply it. Live-verified on
 * plot-lite-service-staging build 1dd45b6 (== staging tip) with this exact
 * request: `fac_tech_lead` — an `intervention_override` lever published at
 * `sensitivity_score: 0` and `elasticity: 0` — came back `importance_rank: 1`
 * and `driver_label: 'biggest'`, while `decision_brief.top_drivers[0]`,
 * `m1_coaching.evidence_gaps` and the DOMINANT_FACTOR warning in the SAME body
 * all named `fac_hiring_cost`. ISL's own `importance_rank: 1` is also
 * `fac_hiring_cost`.
 *
 * Every assertion below FAILS on the pre-fix build. Mutation-checked by
 * reverting the fix hunks in a throwaway worktree.
 *
 * NOTE ON PRECEDENCE: this is NOT a graph-vs-ISL precedence flip. `influence_score`
 * and `influence_rank` stay byte-identical graph-derived values under their own
 * names; only the ordering of `importance_rank` (and eligibility for the
 * 'biggest' crown) changes, and only for option-controlled levers.
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

/** The option-pinned levers in this fixture, derived from the REQUEST (the
 *  canonical D-U source of lever identity), not from the response. */
const LEVER_IDS: ReadonlySet<string> = new Set(
  requestA.options.flatMap((o: any) => Object.keys(o.interventions ?? {})),
);

describe('/v2/run importance-authority coherence (fixture isl-v2-live-20260707)', () => {
  let app: FastifyInstance;
  let body: any;
  let factors: any[];

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
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------
  // POSITIVE CONTROLS — prove the assertions below can SEE something.
  // Without these, a shape change (empty array, renamed field, levers gone)
  // would make every doctrine assertion vacuously true.
  // ---------------------------------------------------------------------
  it('positive control: the fixture really does carry levers AND non-levers, both with finite influence', () => {
    expect(LEVER_IDS.size).toBeGreaterThan(0);
    expect(factors.length).toBeGreaterThanOrEqual(2);
    const levers = factors.filter((f) => LEVER_IDS.has(f.factor_id));
    const nonLevers = factors.filter((f) => !LEVER_IDS.has(f.factor_id));
    expect(levers.length, 'fixture must contain at least one lever').toBeGreaterThan(0);
    expect(nonLevers.length, 'fixture must contain at least one non-lever').toBeGreaterThan(0);
    // A lever must out-INFLUENCE every non-lever here, or the ranking defect
    // cannot manifest and this whole spec would pass for the wrong reason.
    const maxLeverInfluence = Math.max(...levers.map((f) => f.influence_score ?? -Infinity));
    const maxNonLeverInfluence = Math.max(...nonLevers.map((f) => f.influence_score ?? -Infinity));
    expect(Number.isFinite(maxLeverInfluence)).toBe(true);
    expect(Number.isFinite(maxNonLeverInfluence)).toBe(true);
    expect(
      maxLeverInfluence,
      'a lever must top the raw graph influence order, else the defect cannot fire',
    ).toBeGreaterThan(maxNonLeverInfluence);
    // And that lever must be a genuinely SUPPRESSED one (sensitivity zeroed).
    const topLever = levers.find((f) => f.influence_score === maxLeverInfluence);
    expect(topLever.sensitivity_score).toBe(0);
    expect(topLever.elasticity).toBe(0);
  });

  // ---------------------------------------------------------------------
  // THE DEFECT — RED before the fix
  // ---------------------------------------------------------------------
  it('importance_rank 1 is never an option-controlled lever when a non-lever exists', () => {
    const rank1 = factors.find((f) => f.importance_rank === 1);
    expect(rank1, 'some factor must hold importance_rank 1').toBeDefined();
    expect(
      LEVER_IDS.has(rank1.factor_id),
      `importance_rank 1 went to lever "${rank1.factor_id}" (sensitivity_score ${rank1.sensitivity_score})`,
    ).toBe(false);
  });

  it('importance_rank orders every non-lever ahead of every lever (total order preserved, no gaps, no ties)', () => {
    const ranks = factors.map((f) => f.importance_rank);
    expect(new Set(ranks).size, 'importance_rank must be unique per factor').toBe(factors.length);
    expect([...ranks].sort((a, b) => a - b)).toEqual(
      Array.from({ length: factors.length }, (_, i) => i + 1),
    );
    const worstNonLever = Math.max(
      ...factors.filter((f) => !LEVER_IDS.has(f.factor_id)).map((f) => f.importance_rank),
    );
    const bestLever = Math.min(
      ...factors.filter((f) => LEVER_IDS.has(f.factor_id)).map((f) => f.importance_rank),
    );
    expect(bestLever).toBeGreaterThan(worstNonLever);
  });

  it('NON-REGRESSION: influence_rank/influence_score are untouched graph values (this is not a precedence flip)', () => {
    // The lever still TOPS influence_rank, because it genuinely does top the
    // structural influence order. Only the *importance* claim moved.
    const influenceRank1 = factors.find((f) => f.influence_rank === 1);
    expect(LEVER_IDS.has(influenceRank1.factor_id)).toBe(true);
    expect(influenceRank1.influence_score).toBe(1);
    // And influence_rank is still a dense 1..n over the graph order.
    const iRanks = factors.map((f) => f.influence_rank).sort((a, b) => a - b);
    expect(iRanks).toEqual(Array.from({ length: factors.length }, (_, i) => i + 1));
  });

  // ---------------------------------------------------------------------
  // PINNED DIVERGENCE — deliberately NOT fixed by this lane.
  //
  // `driver_label: 'biggest'` (Doctrine 039 / D-7) is argmax over
  // `influence_score` and is NOT lever-aware, so it disagrees with
  // `importance_rank: 1`. Left alone on purpose: gating it would make the label
  // contradict the number in its own row, its BASIS is already an open doctrine
  // row owned by Neil/UI (src/lib/driver-label.ts), and blast radius is zero —
  // censused 25 Jul at UI 039f479a / CEE f00b8ef6, `driver_label` has NO read
  // site in either consumer.
  //
  // This test exists so the divergence CANNOT drift silently while the ruling is
  // pending: if someone changes either rule, this goes RED and forces a decision.
  // ---------------------------------------------------------------------
  it("PINNED DIVERGENCE: 'biggest' still follows argmax(influence_score) and therefore still lands on the lever", () => {
    const biggest = factors.filter((f) => f.driver_label === 'biggest');
    expect(biggest.length, "exactly one factor carries the 'biggest' crown").toBe(1);
    const maxInfluence = Math.max(...factors.map((f) => f.influence_score));
    expect(biggest[0].influence_score).toBe(maxInfluence);
    // ⚠ The crown IS on a lever, and that lever publishes zero sensitivity.
    expect(LEVER_IDS.has(biggest[0].factor_id)).toBe(true);
    expect(biggest[0].sensitivity_score).toBe(0);
    // ⚠ …and it is NOT the factor this same response ranks importance_rank 1.
    const rank1 = factors.find((f) => f.importance_rank === 1);
    expect(biggest[0].factor_id).not.toBe(rank1.factor_id);
  });

  it('every non-biggest driver_label is still the pure magnitude band over influence_score', () => {
    const maxInfluence = Math.max(...factors.map((f) => f.influence_score));
    for (const f of factors) {
      if (f.influence_score === maxInfluence) continue;
      expect(['strong', 'moderate', 'minor'], f.factor_id).toContain(f.driver_label);
    }
  });

  // ---------------------------------------------------------------------
  // INTERNAL COHERENCE — the same body must not contradict itself
  // ---------------------------------------------------------------------
  it('importance_rank 1 agrees with decision_brief.top_drivers[0] in the SAME response body', () => {
    const rank1 = factors.find((f) => f.importance_rank === 1);
    const topDriver = body.decision_brief?.top_drivers?.[0];
    expect(topDriver, 'decision_brief.top_drivers must be populated for this fixture').toBeDefined();
    expect(rank1.factor_label).toBe(topDriver.factor_label);
  });

  it('importance_rank 1 agrees with the top m1_coaching.evidence_gaps entry (the other lever-aware surface)', () => {
    const rank1 = factors.find((f) => f.importance_rank === 1);
    const gaps = body.m1_coaching?.evidence_gaps ?? [];
    expect(gaps.length, 'evidence_gaps must be populated for this fixture').toBeGreaterThan(0);
    expect(rank1.factor_id).toBe(gaps[0].factor_id);
  });

  // ---------------------------------------------------------------------
  // CROSS-AUTHORITY — on THIS fixture the fix also reconciles PLoT with ISL.
  // Fixture-specific by construction (documented, not a general guarantee).
  // ---------------------------------------------------------------------
  it("PLoT's importance_rank 1 is the same factor as ISL's importance_rank 1 on this capture", () => {
    const islRank1 = (capturePlain.factor_sensitivity as any[]).find((f) => f.importance_rank === 1);
    expect(islRank1?.node_id).toBe('fac_hiring_cost'); // pin the fixture's own premise
    const rank1 = factors.find((f) => f.importance_rank === 1);
    expect(rank1.factor_id).toBe(islRank1.node_id);
  });

  // ---------------------------------------------------------------------
  // FRAGILE-EDGE ORDER — `[0]` must be the MOST fragile edge
  // ---------------------------------------------------------------------
  it('positive control: the raw ISL capture really is NOT fragility-ordered', () => {
    const raw = (capturePlain.robustness?.fragile_edges ?? []) as any[];
    expect(raw.length, 'fixture must carry several fragile edges').toBeGreaterThan(2);
    const probs = raw.map((e) => e.switch_probability);
    expect(probs.every((p) => typeof p === 'number')).toBe(true);
    // If ISL ever starts emitting these sorted, this control fails LOUD and the
    // ordering assertion below becomes vacuous — exactly what we want to be told.
    const alreadySorted = probs.every((p, i) => i === 0 || probs[i - 1] >= p);
    expect(alreadySorted, 'ISL capture is already sorted — the ordering pin is now vacuous').toBe(false);
    expect(probs[0], 'in this capture [0] is NOT the max').toBeLessThan(Math.max(...probs));
  });

  it('robustness.fragile_edges is published most-fragile-first', () => {
    const edges = (body.robustness?.fragile_edges ?? []) as any[];
    expect(edges.length).toBeGreaterThan(2);
    const probs = edges.map((e) => e.switch_probability);
    expect(probs.every((p) => typeof p === 'number')).toBe(true);
    for (let i = 1; i < probs.length; i++) {
      expect(probs[i - 1], `fragile_edges[${i - 1}] must be >= [${i}]`).toBeGreaterThanOrEqual(probs[i]);
    }
    expect(probs[0]).toBe(Math.max(...probs));
    // No edge lost or duplicated by the sort.
    const raw = (capturePlain.robustness.fragile_edges as any[]).map((e) => e.switch_probability);
    expect([...probs].sort()).toEqual([...raw].sort());
  });

  // ---------------------------------------------------------------------
  // DISCLOSURE — a consumer must be able to tell WHICH quantity it holds
  // ---------------------------------------------------------------------
  it('every factor row discloses the basis behind its importance/influence numbers', () => {
    expect(factors.length).toBeGreaterThan(0);
    for (const f of factors) {
      expect(f.importance_basis, f.factor_id).toBe('graph_structural');
    }
  });
});
