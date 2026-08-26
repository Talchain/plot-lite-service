/**
 * Byte-identity pin for /v2/run on a WELL-FORMED live V2 envelope (lane 29,
 * docs/enrichment-v1/PLOT-V2-READ-FIX-SPEC.md).
 *
 * Drives /v2/run with the raw live staging capture
 * (tests/fixtures/isl-v2-live-20260707, ISL build 9a22a1a) and compares the
 * response — after masking ONLY the documented volatile fields — against the
 * checked-in golden JSON, byte-for-byte (string equality of the serialised
 * normalised body, so key-order changes are caught too).
 *
 * The golden was generated on staging base 524c488 BEFORE the lane 29 code
 * changes, so this test proves the lane's fixes leave well-formed V2
 * responses byte-identical apart from the spec-mandated additive evidence
 * stamps, which the normaliser strips before comparison:
 *   _meta.evidence.isl_wire_generation_ok   (lane 29, spec §2.1)
 *   _meta.evidence.enrichment_contract_ok   (A3 lane 1, enrichment guard)
 * Nothing else may change.
 *
 * Volatile fields masked (all environment/clock/RNG-dependent, never
 * wire-shape): request ids + request_id_chain values, per-request latency
 * fields, PLoT build stamps, critique UUIDs.
 *
 * Regenerate deliberately (never to paper over a diff you can't explain):
 *   UPDATE_GOLDEN=1 npx vitest run tests/isl-v2-golden-response.pin.test.ts
 *
 * REGENERATED once for F3 (ISL #103 / D-23.15). This capture predates the ISL
 * rename and still carries the removed top-level `factor_evpi[]`. Removing the
 * dead counterfactual consumer changed EXACTLY two factor_sensitivity entries
 * (fac_hiring_cost, fac_team_maturity): the counterfactual-only
 * `evpi_status:"below_resolution"` stamp is gone and the now-always-run
 * heuristic instead emits `evpi_percentage_points:0` + `evpi_method:"heuristic"`
 * (their VOI is 0; win-prob spread 0.184 > 0). The derived `response_content_hash`
 * follows. Nothing else moved. Against LIVE ISL (which emits no `factor_evpi`)
 * this is unchanged behaviour — the stale fixture merely stopped exercising the
 * dead branch. The exact diff is pinned by the assertion below.
 *
 * REGENERATED again for FAMILY-4 SLICE 0 (2026-07-27). `routes/v2/run.ts` fed
 * `fs.elasticity ?? 0` into the FactObject field named `sensitivity_score`, and
 * `facts/mapper.ts` synthesised a third name (`importance_score`) for the same
 * number — so this golden itself carried TWO values under one name:
 * `fac_hiring_cost` at -0.175 in `factor_sensitivity[]` and +0.4971042471042471
 * in `fact_objects[].data`. The regeneration changes EXACTLY 10 lines, all
 * inside `fact_objects[].data` of the four factor_sensitivity facts:
 *   - `sensitivity_score` now carries the real quantity (fac_hiring_cost
 *     0.4971042471042471 → -0.175; fac_team_maturity 0.39045780474351904 →
 *     0.13745631067961164; the two levers were 0 either way)
 *   - `importance_score` is GONE (4 lines) — never on `factor_sensitivity[]`,
 *     never in `FactorSensitivityResultV3`, synthesised here alone
 *   - the 4 derived `content_hash` values follow
 * `factor_sensitivity[]`, `elasticity`, `_meta.response_hash` and
 * `response_content_hash` are UNCHANGED (`fact_objects` is excluded from
 * `response_hash`). The behavioural pin lives in
 * tests/facts-sensitivity-score-identity.fixture.test.ts; the assertion below
 * makes this regeneration non-silent.
 *
 * REGENERATED again for ROADMAP 2.160 (2026-07-30) — a FABRICATION REMOVAL.
 * `normalizeRobustEdge` used to stamp `switch_probability: 1` onto every
 * string-format robust edge. That value was never measured: a bare "from->to"
 * string carries no probability, and `1` is the MAXIMUM of the fragility scale
 * (higher = more fragile), so absent data was being rendered as maximally
 * fragile. It could not be removed until now because @talchain/schemas declared
 * the field REQUIRED up to 0.22.0; 0.28.0 relaxed it to `z.number().optional()`
 * (citing plot-lite-service#278) and this repo is re-pinned to vendored 0.30.0.
 *
 * The regeneration changes EXACTLY 5 lines, and every one is accounted for:
 *   - 4 × `"switch_probability": 1` REMOVED, one per robust edge in
 *     `robustness.robust_edges[]` (the same 4 paths the earlier lane measured
 *     when it attempted the omission and hit the schema wall)
 *   - `_meta.response_content_hash` follows: rch_v2:685c70b9bb0ec52d →
 *     rch_v2:58e58bd5f6821f80
 * `_meta.response_hash` is UNCHANGED at 60e3ac213554be4f (it canonicalises the
 * REQUEST), and nothing else in the body moved — verified by diffing the
 * regenerated golden against the committed one (12 diff lines total, all above).
 * The behavioural pins live in tests/gates/numeric-safety-deep-scan.test.ts §D3
 * (previously skipped, now LIVE) and tests/isl-adapters.test.ts.
 *
 * REGENERATED again for ROADMAP 2.1024 (2026-08-13) — THE HASH VERSION BUMP.
 * `response_hash` is now computed from the EFFECTIVE ISL REQUEST rather than a
 * parallel semantic projection of the inbound request, and `HASH_VERSION` moved
 * 7 → 8. A version bump invalidates every prior hash BY DESIGN, so this golden's
 * hash had to move; that is the change being pinned, not a surprise.
 *
 * The regeneration changes EXACTLY 14 lines, and every one is accounted for:
 *   - `_meta.hash_version` 7 → 8
 *   - `response_hash` 60e3ac213554be4f → 0745a6e63dc5d0d0, in all FOUR places it
 *     is echoed (top-level `response_hash`, `graph_hash`, the nested
 *     `decision_brief` copy, and `_meta.response_hash`) — they agree, which is
 *     itself the point: one hash, echoed, not four independently computed
 *   - `brief_id` follows (it is derived from the response hash, hence
 *     deterministic — this golden would be flaky otherwise)
 *   - `_meta.response_content_hash` follows: rch_v2:290b87b5111e9d8a →
 *     rch_v2:b5462664775055c7
 * NOTHING ELSE moved: no analysis quantity, no option row, no factor entry — the
 * canonicalisation changed, the computation did not. Verified by diffing the
 * regenerated golden against the committed one (14 diff lines total, all above).
 *
 * ⚠ The `60e3ac213554be4f` values in the 2.160 paragraph above are HISTORY and
 * are deliberately left alone — they record what was true at that regeneration.
 * A bulk find-and-replace across this header would falsify the record.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isl-v2-live-20260707',
);
const GOLDEN_PATH = join(FIXTURE_DIR, 'plot-v2-run.golden.json');

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

const MASK = '__VOLATILE__';

/**
 * Key names that are clock/RNG/environment-dependent WHEREVER they appear
 * (request ids echo the per-request UUID; fact_id hashes include it;
 * timestamps/latencies are wall-clock; build stamps are per-checkout).
 * None of them is wire-shape: the KEYS still pin (a masked key that
 * disappears or moves still fails the byte comparison).
 */
const VOLATILE_KEYS = new Set([
  'request_id', 'requestId', 'isl_request_id', 'fact_id',
  'timestamp', 'computed_at', 'created_at',
  'processing_time_ms', 'latency_ms', 'normalization_ms', 'validation_ms',
  'isl_ms', 'cee_ms', 'duration_ms',
  'build', 'plot_build',
  'ui', 'plot', 'isl', 'isl_echoed', // request_id_chain values
]);

// `id` is masked ONLY when it is a per-request random UUID (critiques use
// randomUUID()); deterministic ids (options, nodes) stay pinned by value.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mask the documented volatile fields IN PLACE (key order preserved — the
 * comparison is on the serialised string). Deterministic load-bearing
 * counterparts (meta.computed_at passthrough, _meta.evidence.isl_build,
 * response_hash stability) are pinned by explicit assertions below instead.
 */
function normalise(node: any): any {
  if (Array.isArray(node)) {
    for (const item of node) normalise(item);
    return node;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (VOLATILE_KEYS.has(k) && (typeof v === 'string' || typeof v === 'number')) {
        node[k] = MASK;
      } else if (k === 'id' && typeof v === 'string' && UUID_RE.test(v)) {
        node[k] = MASK;
      } else {
        normalise(v);
      }
    }
  }
  return node;
}

/** Strip the spec-mandated additive evidence stamps so the golden generated
 * on pre-lane base 524c488 pins everything else:
 *   - lane 29 (spec §2.1): isl_wire_generation_ok
 *   - A3 lane 1 (enrichment producer guard): enrichment_contract_ok — same
 *     additive-evidence-stamp class; its VALUE surface is pinned by
 *     tests/enrichment-egress-guard.route.test.ts, not by this byte pin. */
function stripAdditiveEvidenceStamps(body: any): any {
  if (body?._meta?.evidence) {
    delete body._meta.evidence.isl_wire_generation_ok;
    delete body._meta.evidence.enrichment_contract_ok;
  }
  return body;
}

describe('/v2/run golden byte-identity pin (well-formed V2 envelope, build 9a22a1a)', () => {
  let app: FastifyInstance;
  let rawBody: any;
  let normalisedText: string;

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
    rawBody = JSON.parse(res.body);
    normalisedText = JSON.stringify(
      normalise(stripAdditiveEvidenceStamps(JSON.parse(res.body))),
      null,
      2,
    );
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('matches the checked-in golden byte-for-byte after masking volatile fields', () => {
    if (!existsSync(GOLDEN_PATH) && process.env.UPDATE_GOLDEN !== '1') {
      throw new Error(
        `Golden file missing at ${GOLDEN_PATH} — a lost/deleted golden must not silently regenerate. ` +
        'Restore it from git, or intentionally regenerate with UPDATE_GOLDEN=1.'
      );
    }
    if (process.env.UPDATE_GOLDEN === '1') {
      writeFileSync(GOLDEN_PATH, normalisedText + '\n');
    }
    const golden = readFileSync(GOLDEN_PATH, 'utf8').replace(/\n$/, '');
    expect(normalisedText).toBe(golden);
  });

  // Deterministic counterparts of masked keys — pinned by value so the
  // masking cannot hide a regression in the fields that carry meaning.
  it('meta.computed_at is the ISL wire timestamp (getIslComputedAt passthrough), not PLoT clock', () => {
    expect(rawBody.meta.computed_at).toBe(capturePlain.timestamp);
    expect(rawBody.meta.computed_at).toBe('2026-07-07T11:14:19.368321Z');
  });

  it('_meta.evidence.isl_build passes through the wire build verbatim', () => {
    expect(rawBody._meta.evidence.isl_build).toBe('9a22a1a');
  });

  it('response_hash is deterministic (unmasked in the golden, so also pinned byte-for-byte)', () => {
    expect(typeof rawBody._meta.response_hash).toBe('string');
    expect(rawBody._meta.response_hash.length).toBeGreaterThan(0);
  });

  // F3 (ISL #103 / D-23.15): explicit pin of the ONLY response-content change vs
  // the pre-F3 golden, so the deliberate regeneration is not silent. The removed
  // counterfactual consumer used to stamp these two non-lever factors
  // `evpi_status:"below_resolution"` off the stale fixture's `factor_evpi`; the
  // heuristic (the live path) now emits a non-negative, method-tagged value.
  it('F3 surface change: the two non-lever factors carry heuristic EVPI, never the withdrawn counterfactual below_resolution', () => {
    for (const id of ['fac_hiring_cost', 'fac_team_maturity']) {
      const f = (rawBody.factor_sensitivity as any[]).find((x) => x.factor_id === id);
      expect(f, id).toBeDefined();
      expect(f, id).not.toHaveProperty('evpi_status');
      expect(f.evpi_method, id).toBe('heuristic');
      expect(f.evpi_percentage_points, id).toBeGreaterThanOrEqual(0);
    }
    // And no factor anywhere is labelled counterfactual (the path is removed).
    expect(
      (rawBody.factor_sensitivity as any[]).some((f) => f.evpi_method === 'counterfactual'),
    ).toBe(false);
  });

  // FAMILY-4 SLICE 0 (2026-07-27): explicit pin of the ONLY response-content
  // change vs the pre-slice golden, so this deliberate regeneration is not
  // silent either. Same discipline as the F3 pin above.
  it('slice-0 surface change: fact_objects carry the REAL sensitivity_score, no synthesised importance_score, and nothing else moved', () => {
    const factData = (rawBody.fact_objects as any[])
      .filter((o) => o?.data?.type === 'factor_sensitivity')
      .map((o) => o.data);
    expect(factData).toHaveLength(4);

    for (const d of factData) {
      // The synthesised third name is gone from the whole body.
      expect(d, d.node_id).not.toHaveProperty('importance_score');
      // sensitivity_score is the producer's own value, forwarded verbatim.
      const row = (rawBody.factor_sensitivity as any[]).find((f) => f.factor_id === d.node_id);
      expect(d.sensitivity_score, d.node_id).toBe(row.sensitivity_score);
      // elasticity is a DIFFERENT quantity and is likewise forwarded verbatim.
      expect(d.elasticity, d.node_id).toBe(row.elasticity);
    }
    expect(JSON.stringify(rawBody)).not.toContain('"importance_score"');

    // The two factors whose numbers actually moved, pinned by value.
    const byId = Object.fromEntries(factData.map((d) => [d.node_id, d]));
    expect(byId.fac_hiring_cost.sensitivity_score).toBe(-0.175);
    expect(byId.fac_hiring_cost.elasticity).toBe(0.4971042471042471);
    expect(byId.fac_team_maturity.sensitivity_score).toBe(0.13745631067961164);
    expect(byId.fac_team_maturity.elasticity).toBe(0.39045780474351904);

    // Unmoved: fact_objects is excluded from response_hash, so the derived
    // response hash is byte-identical to the pre-slice golden. Pinned by
    // value here so a future change that quietly pulls fact_objects INTO the
    // hash cannot pass as "just a regeneration".
    //
    // ⚠ The `response_content_hash` pin that used to sit here has MOVED to the
    // S1 block below, with a new value. It is a hash of the public semantic
    // surface, so slice S1's additive `driver_order` legitimately changes it —
    // and leaving a stale value here would have read as "S1 changed something
    // it should not have" rather than "S1 added a field, deliberately".
    expect(rawBody.response_hash).toBe('0745a6e63dc5d0d0');
    expect(rawBody._meta.response_hash).toBe('0745a6e63dc5d0d0');
  });

  // FAMILY-4 SLICE S1 (2026-07-27): explicit pin of the ONLY response-content
  // change vs the pre-S1 golden — the additive `driver_order` object. Same
  // discipline as the F3 and slice-0 pins above: a regeneration that is named
  // is a regeneration that can be reviewed.
  it('S1 surface change: driver_order is emitted, self-consistent, and response_hash is UNMOVED', () => {
    const order = rawBody.driver_order;
    expect(order, 'driver_order must be emitted alongside factor_sensitivity').toBeDefined();
    expect(order.version).toBe(1);
    expect(order.basis).toBe('graph_structural');
    expect(order.species).toBe('single');
    expect(order.lever_policy).toBe('du_union');
    // The order IS the array — pinned against the golden's own rows, so a
    // future change that re-orders one without the other cannot regenerate
    // quietly.
    expect(order.ranked_factor_ids).toEqual(
      (rawBody.factor_sensitivity as any[]).map((f) => f.factor_id),
    );
    expect(order.ranked_factor_ids).toEqual([
      'fac_hiring_cost',
      'fac_team_maturity',
      'fac_tech_lead',
      'fac_dev_headcount',
    ]);
    expect(order.lever_ids).toEqual(['fac_tech_lead', 'fac_dev_headcount']);
    // ⭐ S1b PIN FLIP. At S1 this read `{ top_pair_separable: null, method:
    // null }` — correct then, because `true` was unreachable by construction.
    // Paul ratified a PROVISIONAL default on 2026-07-28, so the top pair of
    // this fixture is now DECIDED. Re-derived from the golden's own rows below
    // so the pin cannot drift from the data it describes.
    const [a, b] = (rawBody.factor_sensitivity as any[]).map((f) => f.influence_score);
    expect((a - b) / a).toBeGreaterThanOrEqual(0.1);
    expect(order.separability).toEqual({
      top_pair_separable: true,
      method: 'relative_gap_0.10_provisional',
    });
    // ⛔ A verdict must never arrive without the method that produced it (T3),
    // and the method must keep saying `provisional` until Neil's statistic
    // lands — a consumer that reads it as ratified is making a claim this
    // producer has not made.
    expect(order.separability.method).toContain('provisional');
    expect(order.rank_stability).toEqual({
      max_rank_flip_rate: 0.3,
      min_attribution_stability: 'negligible',
    });

    // ⭐ ADDITIVITY, pinned by value: `response_hash` canonicalises the
    // REQUEST, so an added response field must NOT move it. If this ever
    // flips, an "additive" slice has changed the UI freshness token.
    expect(rawBody.response_hash).toBe('0745a6e63dc5d0d0');
    // `response_content_hash` hashes the public semantic surface and therefore
    // SHOULD move when that surface changes. Re-pinned each time so the next
    // content change is also forced to be deliberate:
    //   S1     rch_v2:67bdba00c5e65476
    //   S1b    rch_v2:685c70b9bb0ec52d  (which factor three crowns name)
    //   2.160  rch_v2:58e58bd5f6821f80  (4 fabricated switch_probability values
    //                                    REMOVED from robust_edges — see the
    //                                    regeneration note in the file header)
    //   2.228-F3 rch_v2:c5b3a998f5d0db5d (flip_thresholds[] emptied on THIS
    //                                    fixture: its ISL envelope predates
    //                                    PR #117 and carries no
    //                                    `factor_flip_values`, and the
    //                                    bisection probe that used to
    //                                    manufacture rows here is retired.
    //                                    The rows it produced were
    //                                    `flip_value: null` under a
    //                                    `no_effect_within_bounds` label the
    //                                    probe never established, so this is
    //                                    a false attestation LEAVING the
    //                                    wire, not a capability lost. On an
    //                                    ISL build that does emit the block,
    //                                    rows return with real values — see
    //                                    tests/v2-run.isl-factor-flips.contract.test.ts)
    //   2.581  rch_v2:290b87b5111e9d8a (outcome.percentiles_source now reaches
    //                                    egress. The golden diff for this change
    //                                    is EXACTLY one appended key per option,
    //                                    value "samples", taken verbatim from the
    //                                    ISL capture this fixture replays — a
    //                                    field ISL has always sent and PLoT's
    //                                    option_comparison builder silently
    //                                    dropped. `response_hash` is UNMOVED (it
    //                                    canonicalises the REQUEST); only this
    //                                    content hash moves, which is the
    //                                    correct direction for an additive
    //                                    surface change.)
    //  2.1024  rch_v2:b5462664775055c7 (HASH_VERSION 7 → 8: `response_hash` is
    //                                    now derived from the EFFECTIVE ISL
    //                                    REQUEST rather than a parallel
    //                                    projection of the inbound one. ⚠ NOTE
    //                                    THE DIRECTION IS DIFFERENT FROM EVERY
    //                                    ROW ABOVE: here `response_hash` DOES
    //                                    move — that is the change — while no
    //                                    analysis quantity moves at all. The
    //                                    content hash follows only because it
    //                                    covers `_meta`, which carries both
    //                                    `hash_version` and `response_hash`.
    //                                    No option row, factor entry or
    //                                    probability changed; the
    //                                    canonicalisation changed, the
    //                                    computation did not.)
    //  prose-  rch_v2:5876bbda16001f63 (the WITHHELD `recommendation_stability`
    //  leak                             figure stopped being published as
    //                                   coaching PROSE. PLoT already omits the
    //                                   FIELD (run.ts:3411-3422) because ISL
    //                                   derives it as option_wins[winner]/
    //                                   n_samples — the leader's win_probability
    //                                   relabelled — yet three builders printed
    //                                   it as "N% recommendation stability", so a
    //                                   user read a figure with no field to check
    //                                   it against. The golden diff is EXACTLY
    //                                   three prose lines on THIS fixture
    //                                   (executive_summary.summary,
    //                                   .key_qualifier, decision_brief.headline,
    //                                   all "the 59% recommendation stability
    //                                   indicates…" → "the outcome is within
    //                                   model uncertainty, so the ranking could
    //                                   shift with new information") plus this
    //                                   derived hash. `response_hash` is UNMOVED
    //                                   (the REQUEST did not change). No option
    //                                   row, factor entry, probability or
    //                                   readiness classification moved — the
    //                                   qualitative claims and their weights are
    //                                   untouched; only the figure is gone. This
    //                                   fixture's 0.59025 sits mid-band, so it
    //                                   carries no readiness_signals stability
    //                                   entry to change.)
    //  crown-  rch_v2:742449aa4074527d (CROWN ELIGIBILITY, step 5: the crown now
    //  elig                             carries a producer-owned compliance
    //                                   verdict against the user's stated
    //                                   limits. The golden diff on THIS fixture
    //                                   is EXACTLY two appended keys on
    //                                   `robustness` —
    //                                   `recommended_option_compliance` and its
    //                                   `_reason` — plus this derived hash.
    //                                   ⭐ THE VALUE HERE IS `not_applicable`,
    //                                   AND THAT IS THE POINT: this capture
    //                                   states NO goal constraints, so the
    //                                   common case is pinned unchanged on a
    //                                   REAL captured payload — the crown, every
    //                                   option row, every probability and the
    //                                   near-tie verdict are all untouched.
    //                                   `response_hash` is UNMOVED (the REQUEST
    //                                   did not change); only this content hash
    //                                   moves, which is the correct direction
    //                                   for an additive surface change.)
    //  join-   rch_v2:bd87f4af4460baf4 (JOIN KEY: `decision_brief`
    //  key                              `.defaulted_assumptions[]` factor-scoped
    //                                   rows now carry `factor_id`, the
    //                                   producer's own id — already in scope in
    //                                   the emitting loop and already used as
    //                                   the label fallback, then dropped. A
    //                                   consumer previously had to join a row to
    //                                   a graph node BY LABEL, which breaks on
    //                                   rename, on duplicate labels, and on
    //                                   every label a consumer's raw-identifier
    //                                   guard withholds. The golden diff on this
    //                                   fixture is EXACTLY one appended key on
    //                                   one row (`fac_team_maturity`) plus this
    //                                   derived hash — verified by regenerating
    //                                   against the pristine golden and
    //                                   diffing. Run-level `default_disclosure`
    //                                   rows deliberately do NOT gain the key:
    //                                   they have no factor, and an invented id
    //                                   there would be a fabricated join target.
    //                                   `response_hash` is UNMOVED (the REQUEST
    //                                   did not change) and no option row,
    //                                   probability, factor entry or label
    //                                   moved.)
    //  fsci-1- rch_v2:46811083e96c4b1e (FactorScience slice 1, 2026-08-26 — a
    //  basis                            SEPARATION, and the only content-hash
    //                                   move here that REMOVES keys.
    //                                   `elasticity_std` and `stability_method`
    //                                   no longer ride a GRAPH-basis
    //                                   `factor_sensitivity[]` row: they are
    //                                   bootstrap statistics about ISL's
    //                                   Monte-Carlo elasticity, while the row's
    //                                   own `elasticity` is PLoT's graph
    //                                   path-product. Both keep their honest
    //                                   home in `factor_stability[]`, which this
    //                                   same golden still carries in full — so
    //                                   this is a separation, not a loss.
    //                                   The golden diff is EXACTLY 8 removed
    //                                   lines (two keys off each of 4 factor
    //                                   rows) plus this derived hash — verified
    //                                   by regenerating against the pristine
    //                                   golden and diffing (20 diff lines, all
    //                                   accounted for). No option row,
    //                                   probability, label, factor id or
    //                                   ordering moved.
    //                                   ⭐ TWO of the removed `elasticity_std`
    //                                   values were `0` — the LEVER-suppressed
    //                                   rows. That is this fixture's own
    //                                   evidence that dropping `elasticity_std`
    //                                   from LEVER_SUPPRESSION_FIELDS was
    //                                   required: without it, that set would
    //                                   have been the only thing putting a
    //                                   fabricated zero-valued bootstrap
    //                                   statistic back onto the graph rows the
    //                                   change exists to clean.
    //                                   `response_hash` is UNMOVED (the REQUEST
    //                                   did not change).)
    expect(rawBody._meta.response_content_hash).toBe('rch_v2:46811083e96c4b1e');
  });
});
