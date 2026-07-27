/**
 * ROADMAP 1.278 — Phase 1a++ Intervention Ingress-Shape Guard (POST /v2/run).
 *
 * ============================================================================
 * WHAT WAS ACTUALLY BROKEN (measured on pristine 016393fa, not inferred)
 * ============================================================================
 * The Ajv body schema types `interventions` as `{ type: 'object' }` — the
 * container only, the VALUES unvalidated. Two hand-written shape decisions then
 * disagreed with each other:
 *
 *   - `normalizeInterventions()` DROPPED any entry that was neither a number nor
 *     an object with a `value` key, under the comment
 *     "Skip invalid entries (will be caught by validation)";
 *   - preflight's `INVALID_INTERVENTION_VALUE` check then ran against the
 *     ALREADY-NORMALISED options — the very view the drop had edited.
 *
 * So the comment was false for exactly the entries the drop removed: preflight
 * structurally could not see them. Measured behaviour on the pristine tip:
 *
 *   REQUEST                                 PRISTINE RESULT
 *   {"f": null}                             422 EMPTY_INTERVENTIONS
 *                                             — "does not specify what it
 *                                               changes", which MISDESCRIBES a
 *                                               malformed value as an absent one
 *   {"f": null, "g": 60}                    HTTP 200, analysis_status "failed",
 *                                             PLOT_INTERNAL_ERROR
 *                                             (TypeError "Cannot read properties
 *                                             of null (reading 'value')" thrown
 *                                             inside canonicaliseOption, which
 *                                             reads the RAW body)
 *   {"f": "abc" | [1,2] | {}, "g": 60}      HTTP 200, "failed",
 *                                             PLOT_INTERNAL_ERROR (TypeError
 *                                             "Cannot read properties of
 *                                             undefined (reading 'toFixed')")
 *   {"f": {"value": null}}                  422 INVALID_INTERVENTION_VALUE
 *                                             (preflight CAN see this one — the
 *                                             drop preserves a `value` key)
 *
 * A malformed request must get a malformed-request answer. A 200 carrying an
 * internal error is neither, and it is the shape a client is least able to act
 * on. The guard reads the RAW body — the only view that still contains the
 * dropped entries — and rejects on the SAME `readInterventionValue()` predicate
 * `normalizeInterventions()` now uses, so the two cannot drift apart.
 *
 * ============================================================================
 * TEST LABELS — assigned by what the MUTATION RUN PROVED, not by intent
 * ============================================================================
 *   DEFECT:           went RED when the Phase 1a++ guard was reverted alone.
 *   PIN:              green on pristine too — an existing guard already covered
 *                     that path. Does NOT prove this lane's fix; it pins that
 *                     the fix did not REGRESS behaviour that was already right.
 *   POSITIVE CONTROL: green both ways by design. A control that went red on the
 *                     pristine source would be a broken control.
 *
 * ENVELOPE NOTE: this is a 422 `buildBlockedResponse`, not a 400. The ruling
 * asked for "the same error format the route's other 400s use" — inspected, and
 * /v2/run has exactly ONE 400 (the preValidation unknown-TOP-LEVEL-key filter,
 * which cannot carry per-field structure) against fifteen 422
 * `buildBlockedResponse` rejections, including the direct precedent for this
 * exact defect class on the sibling field (Phase 1b++, `goal_constraints`).
 * `INVALID_INTERVENTION_VALUE` already existed as a 422 blocker code with a
 * humaniser. Matching the house shape was the instruction; 422 IS the house
 * shape here. See the PR body.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// --------------------------------------------------------------------------
// Mocked ISL. `islCallCount` is the instrument for the strongest claim in this
// file: a malformed request must never reach the compute layer at all.
// --------------------------------------------------------------------------
let islCallCount = 0;
let lastIslOptions: unknown = null;

function islPayload(options: Array<{ id: string }>) {
  return {
    options: options.map((o, i) => ({
      option_id: o.id, win_probability: i === 0 ? 0.72 : 0.28, probability_of_goal: 0.6,
      expected_outcome: 0.7, confidence_interval: [0.5, 0.9],
      outcome: { mean: 0.7 - i * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 },
      rank: i + 1,
    })),
    edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2', edge_sensitivity_status: 'available',
    factors: [], factor_sensitivity: [], value_of_information: [],
    factors_provenance: 'unavailable', factor_sensitivity_status: 'skipped_no_factor_values',
    overall_robustness: 'robust', robustness_score: 0.8,
    fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl',
  };
}

const svc = {
  isEnabled: () => true,
  isAvailable: async () => true,
  validateCausal: async () => ({
    status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
    backdoor_paths: [], issues: [], explanation: { summary: 'm', reasoning: 't' }, source: 'isl',
  }),
  analyseSensitivity: async () => ({ overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' }),
  analyseRobustness: async (_g: unknown, _n: string, o: Array<{ id: string }>) => {
    islCallCount++; lastIslOptions = JSON.parse(JSON.stringify(o)); return islPayload(o);
  },
  analyseFactorSensitivity: async () => ({ factors: [], value_of_information: [], robustness_label: 'robust', robustness_score: 0.8, latency_ms: 0, source: 'unavailable' }),
  computeCounterfactual: async () => { throw new Error('not used'); },
  callAnalysisEndpoint: async (_e: string, b: { options?: Array<{ id: string }> }) => {
    islCallCount++; lastIslOptions = JSON.parse(JSON.stringify(b.options ?? []));
    return { data: islPayload(b.options ?? []), error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => svc, islService: svc };
});

const { createServer } = await import('../src/createServer.js');

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'G' },
    { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 100 } },
    { id: 'g', kind: 'factor', label: 'GG', observed_state: { value: 50 } },
  ],
  edges: [
    { from: 'f', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'g', to: 'goal', strength: { mean: 0.4, std: 0.1 } },
  ],
};

let app: FastifyInstance;

async function post(o1Interventions: unknown, o2Interventions: unknown = { f: 80, g: 40 }) {
  islCallCount = 0; lastIslOptions = null;
  const res = await app.inject({
    method: 'POST', url: '/v2/run', headers: { 'content-type': 'application/json' },
    payload: {
      graph: GRAPH,
      options: [
        { id: 'o1', label: 'O1', interventions: o1Interventions },
        { id: 'o2', label: 'O2', interventions: o2Interventions },
      ],
      goal_node_id: 'goal', seed: '42',
    },
  });
  return { res, body: JSON.parse(res.body) as Record<string, unknown> };
}

function critiques(body: Record<string, unknown>) {
  return (body.critiques ?? []) as Array<Record<string, unknown>>;
}

beforeAll(async () => {
  process.env.RATE_LIMIT_ENABLED = '0';
  process.env.CEE_ORCHESTRATOR_ENABLED = '0';
  app = await createServer();
});
afterAll(async () => {
  await app?.close();
  delete process.env.RATE_LIMIT_ENABLED;
  delete process.env.CEE_ORCHESTRATOR_ENABLED;
});

describe('ROADMAP 1.278 · Phase 1a++ intervention ingress-shape guard', () => {
  it('DEFECT: a bare null alongside a valid intervention is REJECTED, not silently dropped', async () => {
    // Pristine: HTTP 200 + analysis_status "failed" + PLOT_INTERNAL_ERROR.
    const { res, body } = await post({ f: null, g: 60 });
    expect(res.statusCode).toBe(422);
    expect(body.analysis_status).toBe('blocked');
    expect(critiques(body).length).toBeGreaterThan(0);
    expect(critiques(body).map(c => c.code)).toContain('INVALID_INTERVENTION_VALUE');
    expect(critiques(body).map(c => c.code)).not.toContain('PLOT_INTERNAL_ERROR');
  });

  it('DEFECT: the malformed request never reaches the compute layer', async () => {
    // The claim that actually matters: PLoT does not answer a question it was
    // not asked. On pristine this ALSO happened to be true for `{f:null,g:60}`
    // (it crashed first) — but only by accident of a TypeError, and it was NOT
    // true for the request as a whole, which still returned HTTP 200.
    const { res } = await post({ f: null, g: 60 });
    expect(res.statusCode).toBe(422);
    expect(islCallCount).toBe(0);
    expect(lastIslOptions).toBeNull();
  });

  it('DEFECT: the 422 names the offending option id AND factor key, in message and structurally', async () => {
    const { body } = await post({ f: null, g: 60 });
    const c = critiques(body).find(x => x.code === 'INVALID_INTERVENTION_VALUE')!;
    expect(c).toBeDefined();
    expect(c.severity).toBe('blocker');
    expect(c.source).toBe('validation');
    expect(c.blocks_analysis).toBe(true);
    // Structural — a consumer must not have to parse prose.
    expect(c.affected_option_ids).toEqual(['o1']);
    expect(c.affected_node_ids).toEqual(['f']);
    // Prose — names both, and says what a valid value looks like.
    expect(String(c.message)).toContain("Option 'o1'");
    expect(String(c.message)).toContain("node 'f'");
    expect(String(c.message)).toContain('finite number');
    // The status_reason carries the precise field path.
    expect(String(body.status_reason)).toContain("options[id=o1].interventions['f']");
  });

  it('DEFECT: every malformed BARE shape is rejected (the shapes the drop made invisible)', async () => {
    for (const bad of ['abc', '', true, false, [1, 2], {}, { source: 'user_specified' }, { value: undefined }]) {
      const { res, body } = await post({ f: bad, g: 60 });
      expect(res.statusCode, `shape ${JSON.stringify(bad)}`).toBe(422);
      expect(critiques(body).map(c => c.code), `shape ${JSON.stringify(bad)}`).toContain('INVALID_INTERVENTION_VALUE');
      expect(islCallCount, `shape ${JSON.stringify(bad)}`).toBe(0);
    }
  });

  it('DEFECT: a lone bare null is no longer MISDESCRIBED as "no interventions"', async () => {
    // Pristine: EMPTY_INTERVENTIONS — "Option 'O1' does not specify what it
    // changes." The caller DID specify `f`; the value was malformed. An honest
    // error names the real fault.
    const { res, body } = await post({ f: null });
    expect(res.statusCode).toBe(422);
    expect(critiques(body).map(c => c.code)).toContain('INVALID_INTERVENTION_VALUE');
    expect(critiques(body).map(c => c.code)).not.toContain('EMPTY_INTERVENTIONS');
  });

  it('PIN: the RICH null shape stays rejected (preflight already caught this one)', async () => {
    // Green on pristine too — preflight could see `{value: null}` because the
    // drop preserves any entry carrying a `value` key. Pinned so that moving
    // the decision to the ingress guard did not lose the rejection.
    const { res, body } = await post({ f: { value: null, source: 'user_specified' } });
    expect(res.statusCode).toBe(422);
    expect(critiques(body).map(c => c.code)).toContain('INVALID_INTERVENTION_VALUE');
    expect(islCallCount).toBe(0);
  });

  it('PIN: a rich non-finite value is rejected on both branches', async () => {
    for (const bad of [{ value: 'abc' }, { value: true }, { value: null }, { value: [1] }]) {
      const { res, body } = await post({ f: bad, g: 60 });
      expect(res.statusCode, JSON.stringify(bad)).toBe(422);
      expect(critiques(body).map(c => c.code), JSON.stringify(bad)).toContain('INVALID_INTERVENTION_VALUE');
    }
  });

  it('POSITIVE CONTROL: a fully valid request is byte-identically unaffected', async () => {
    const { res, body } = await post({ f: 120, g: 60 });
    expect(res.statusCode).toBe(200);
    expect(body.analysis_status).not.toBe('blocked');
    expect(critiques(body).map(c => c.code)).not.toContain('INVALID_INTERVENTION_VALUE');
    expect(islCallCount).toBeGreaterThan(0);
    // The exact normalised interventions handed to the compute layer. If the
    // guard or the shared reader had altered ANY valid value, this is what
    // would move.
    expect(JSON.stringify((lastIslOptions as Array<Record<string, unknown>>).map(o => ({ id: o.id, interventions: o.interventions }))))
      .toBe(JSON.stringify([
        { id: 'o1', interventions: { f: 0.8571428571428571, g: 0.8571428571428571 } },
        { id: 'o2', interventions: { f: 0.14285714285714285, g: 0.14285714285714285 } },
      ]));
  });

  it('POSITIVE CONTROL: valid EDGE values survive — 0, negatives, and the rich shape with extra keys', async () => {
    // 0 is the sharpest arm: a real 0 normalises to the same place the null
    // defect fabricated, so an over-reaching guard would eat it.
    for (const good of [
      { f: 0, g: 60 },
      { f: -50, g: 60 },
      { f: { value: 0, source: 'user_specified' }, g: 60 },
      // Rich object with additional keys — the shape tests/categorical-migration-
      // safety.test.ts sends (`raw_value: '£180,000'`). Unknown keys must remain
      // forward-compatible, per the nested-object convention on this route.
      { f: { value: 180000, raw_value: '£180,000', source: 'user_specified' }, g: 60 },
    ]) {
      const { res, body } = await post(good);
      expect(res.statusCode, JSON.stringify(good)).toBe(200);
      expect(critiques(body).map(c => c.code), JSON.stringify(good)).not.toContain('INVALID_INTERVENTION_VALUE');
    }
  });

  it('POSITIVE CONTROL: an EMPTY interventions map still gets EMPTY_INTERVENTIONS, not the new code', async () => {
    // Proves the guard did not over-reach into the adjacent, correct diagnosis.
    // `{}` genuinely does not specify what the option changes.
    const { res, body } = await post({});
    expect(res.statusCode).toBe(422);
    expect(critiques(body).map(c => c.code)).toContain('EMPTY_INTERVENTIONS');
    expect(critiques(body).map(c => c.code)).not.toContain('INVALID_INTERVENTION_VALUE');
  });
});
