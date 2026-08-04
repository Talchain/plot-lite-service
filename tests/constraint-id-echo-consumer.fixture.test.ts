/**
 * Contract step-2 slice 6b — PLoT CONSUMER half: read ISL's echoed constraint_id.
 *
 * ISL @0316098b (PR #115, deployed to isl-staging and health-confirmed) echoes
 * `constraint_id` verbatim on every element of
 * `options[].constraint_analysis.constraints[]`. PLoT has always SENT the field;
 * ISL dropped it at parse until 6b, so PLoT RECONSTRUCTED identity from the
 * response ordinal. This suite pins that PLoT now prefers the echo, at BOTH
 * mapping sites, without losing the reconstruction during the overlap window.
 *
 * ── WHAT THE DISCRIMINATING CASE ACTUALLY IS (this was re-derived, not assumed) ─
 * The brief proposed "ISL returns constraint_ids that disagree with positional
 * order (e.g. reversed)". A plain reversal DOES NOT DISCRIMINATE here, and it is
 * worth being precise about why, because a test that cannot tell ID-reading from
 * positional-reading is the vacuity trap this programme keeps finding.
 *
 * The pre-6b ladder had TWO reconstruction tiers, not one: positional, and then
 * a (node_id, operator) SCAN. Under a pure reversal the positional guard fails
 * and the scan recovers the correct id. Old and new code agree — green, and
 * proving nothing.
 *
 * The case the scan cannot resolve is two constraints sharing (node_id,
 * operator). But that shape CANNOT REACH ISL through /v2/run at all:
 * `mergeConstraints` (normalisation/constraint-compiler.ts) deduplicates on
 * exactly `${node_id}:${operator}`, keeping the stricter threshold. So the
 * forwarded set is unique on that key by construction. See the unit suite below,
 * which pins the resolver's behaviour on that shape anyway — the resolver must
 * not depend on an upstream invariant for its own correctness.
 *
 * What IS reachable, and what this route suite therefore uses, is an ISL whose
 * echoed (node_id, operator) does not line up with what PLoT sent. Then BOTH
 * reconstruction tiers miss and the old code fell through to the synthetic
 * `${node_id}_${operator}` key — an identity NOBODY RATIFIED. That synthetic key
 * is the direct cause of the zero-overlap condition CEE's `identity_unresolved`
 * verdict exists for: the keys PLoT emits are not the constraint IDs the caller
 * knows. Reading the echo replaces a fabricated key with the ratified one.
 *
 * ⚠ HONEST SCOPE. Because dedup guarantees (node_id, operator) uniqueness and
 * ISL echoes both fields faithfully, the pre-6b reconstruction was already
 * CORRECT for every input reachable through /v2/run today. This slice removes a
 * dependency on an invariant PLoT cannot enforce; it does not fix a mispairing
 * observed in production. Do not claim otherwise.
 *
 * ── THE `null` SHAPE IS MEASURED, NOT ASSUMED ────────────────────────────────
 * The brief specified "omitted, not null, when unsupplied (exclude_none=True)".
 * FALSE against the deployed service. A live probe (two constraints, no ids
 * supplied) returned `"constraint_id": null` — key PRESENT, value null —
 * alongside `"failure_margin_median": null` and `"near_miss_fraction": null`.
 * `exclude_none=True` is applied at the route (src/api/robustness.py:1389) but
 * does not reach inside this object. Both shapes are pinned as separate
 * controls, and nothing here asserts key-absence.
 *
 * MUTATION-CHECKED in a worktree OUTSIDE the repo root (trap 9c), measured:
 *   - delete the tier-1 echo read  → 8 of 15 red (both route DISAGREEMENT cases,
 *     the per-option and cross-block ones, the `value` pairing, and the unit
 *     disagreement/verbatim cases). All 7 fallback controls stay GREEN.
 *   - delete the tier-2/3 fallback → 7 of 15 red (both route CONTROLS, plus the
 *     undefined / null / empty-string / mixed unit controls). The route
 *     disagreement cases stay GREEN.
 * TWO tests are red under BOTH mutations — the reversed-order unit case and the
 * MIXED-response case — and that is deliberate, not sloppiness: each asserts the
 * echo tier AND the reconstruction tier within one test (the reversed case
 * additionally re-runs with the echo stripped, to prove the reconstruction
 * really does return the wrong order rather than merely asserting it). The
 * remaining 6 and 5 are exclusive to one mutation each, so the two halves are
 * independently pinned rather than jointly satisfied by a single code path.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resolveConstraintIds } from '../src/routes/v2/constraint-identity.js';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const ID_ALPHA = 'c_alpha';
const ID_BETA = 'c_beta';

/** DISTINCT probabilities — this is what makes a mispairing observable at all. */
const PROB_ALPHA = 0.11;
const PROB_BETA = 0.87;

/** Raw user-unit thresholds (PLoT normalises these before forwarding). */
const VALUE_ALPHA = 20;
const VALUE_BETA = 30;

const NODE_ALPHA = 'goal_growth';
const NODE_BETA = 'fac_spend';

/**
 * How the ISL mock labels the constraints it returns.
 *  - 'echo-unmatchable' : ids echoed correctly, but node_id does NOT match what
 *                         PLoT sent — both reconstruction tiers miss, so the old
 *                         code fell through to a synthetic non-ratified key.
 *  - 'omitted'          : pre-6b ISL — key absent entirely, targets faithful.
 *  - 'null'             : deployed ISL, no ids supplied — key present and null.
 *  - 'echo-in-order'    : echo present and agreeing with position.
 */
type EchoMode = 'echo-unmatchable' | 'omitted' | 'null' | 'echo-in-order';
let echoMode: EchoMode = 'echo-in-order';

/** The node ids ISL reports under 'echo-unmatchable' — matched by nothing PLoT sent. */
const DRIFTED_NODE_A = 'isl_internal_0';
const DRIFTED_NODE_B = 'isl_internal_1';

/** The synthetic keys the pre-6b fallback minted for those drifted targets. */
const SYNTHETIC_A = `${DRIFTED_NODE_A}_>=`;
const SYNTHETIC_B = `${DRIFTED_NODE_B}_>=`;

/**
 * Build ISL's `constraint_analysis.constraints[]` for one option.
 *
 * `sent` is what PLoT forwarded, in PLoT's order. Each result carries the
 * probability that genuinely belongs to that constraint, so the (id ↔
 * probability) pairing on the wire is always internally correct. What varies is
 * whether the id is READABLE and whether the target fields are matchable.
 */
function buildIslConstraints(sent: any[]) {
  return sent.map((c: any, i: number) => {
    const trueId = i === 0 ? ID_ALPHA : ID_BETA;
    const prob = i === 0 ? PROB_ALPHA : PROB_BETA;

    if (echoMode === 'echo-unmatchable') {
      return {
        constraint_id: trueId,
        node_id: i === 0 ? DRIFTED_NODE_A : DRIFTED_NODE_B,
        operator: c.operator,
        threshold: c.value,
        prob_satisfied: prob,
      };
    }

    const base = {
      node_id: c.node_id,
      operator: c.operator,
      threshold: c.value,
      prob_satisfied: prob,
    };
    if (echoMode === 'omitted') return base;
    if (echoMode === 'null') return { ...base, constraint_id: null };
    return { ...base, constraint_id: trueId };
  });
}

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
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    const options = body.options || [];
    const goalConstraints = body.goal_constraints || [];

    const constraintAnalysis = goalConstraints.length > 0
      ? {
          constraint_analysis: {
            joint_probability: 0.5,
            constraints: buildIslConstraints(goalConstraints),
          },
        }
      : {};

    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: {
            mean: 0.7 + idx * 0.05, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9,
            n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
          },
          win_probability: idx === 0 ? 0.6 : 0.4,
          rank: idx + 1,
          ...constraintAnalysis,
        })),
        factor_sensitivity: [],
        robustness: { label: 'moderate', score: 0.6, fragile_edges: [], robust_edges: [] },
        inference_warnings: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

// ---------------------------------------------------------------------------
// Request fixture — two constraints on DIFFERENT nodes (dedup forbids sharing a
// (node_id, operator) key), each target carrying an explicit range so the
// constraint block is decision-grade and actually delivers.
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    {
      id: NODE_ALPHA, kind: 'goal', goal_threshold_frame: 'delta', label: 'Net revenue change',
      observed_state: { value: 50 }, state_space: { range: { min: 0, max: 100 } },
    },
    {
      id: NODE_BETA, kind: 'factor', label: 'Marketing spend',
      observed_state: { value: 40 }, state_space: { range: { min: 0, max: 100 } },
    },
  ],
  edges: [{ from: NODE_BETA, to: NODE_ALPHA, strength: { mean: 0.5, std: 0.1 } }],
};

const OPTIONS = [
  { id: 'opt_a', label: 'Increase spend', interventions: { [NODE_BETA]: 80 } },
  { id: 'opt_b', label: 'Hold steady', interventions: { [NODE_BETA]: 30 } },
];

const GOAL_CONSTRAINTS = [
  { constraint_id: ID_ALPHA, node_id: NODE_ALPHA, operator: '>=', value: VALUE_ALPHA },
  { constraint_id: ID_BETA, node_id: NODE_BETA, operator: '>=', value: VALUE_BETA },
];

async function run(app: FastifyInstance) {
  const res = await app.inject({
    method: 'POST',
    url: '/v2/run',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: NODE_ALPHA,
      seed: 'constraint-id-echo-consumer',
      goal_constraints: GOAL_CONSTRAINTS,
    }),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
}

/** constraint_id → probability, from the TOP-LEVEL block (buildConstraintFields). */
function topLevelPairing(body: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of body.constraint_results ?? []) out[r.constraint_id] = r.probability;
  return out;
}

const RATIFIED_PAIRING = { [ID_ALPHA]: PROB_ALPHA, [ID_BETA]: PROB_BETA };

// ===========================================================================
// UNIT — the resolver's own contract, including shapes the route cannot reach
// ===========================================================================

describe('resolveConstraintIds: the echo outranks every reconstruction tier', () => {
  const sent = [
    { constraint_id: ID_ALPHA, node_id: NODE_ALPHA, operator: '>=' },
    { constraint_id: ID_BETA, node_id: NODE_BETA, operator: '>=' },
  ];

  it('DISAGREEMENT: two constraints sharing (node_id, operator), echoed in REVERSED order', () => {
    // The one shape neither reconstruction tier can resolve: identical targets,
    // so ordinal is the ONLY thing distinguishing them and the (node_id,
    // operator) scan returns the first match for both. /v2/run cannot produce
    // this today (mergeConstraints dedupes on exactly this key), but the
    // resolver must not BORROW that guarantee — an upstream invariant is not a
    // correctness argument for a downstream reader.
    const sameTarget = [
      { constraint_id: ID_ALPHA, node_id: NODE_ALPHA, operator: '>=' },
      { constraint_id: ID_BETA, node_id: NODE_ALPHA, operator: '>=' },
    ];
    const islReversed = [
      { constraint_id: ID_BETA, node_id: NODE_ALPHA, operator: '>=' },
      { constraint_id: ID_ALPHA, node_id: NODE_ALPHA, operator: '>=' },
    ];

    expect(resolveConstraintIds(islReversed, sameTarget)).toEqual([ID_BETA, ID_ALPHA]);

    // Pin the positional answer BY NAME so a regression reads as "we went back
    // to reconstructing" rather than merely "an array changed".
    expect(resolveConstraintIds(islReversed, sameTarget)).not.toEqual([ID_ALPHA, ID_BETA]);

    // ...and prove the claim above is true rather than asserted: with the echo
    // stripped, the reconstruction really does return the wrong order.
    const stripped = islReversed.map(({ node_id, operator }) => ({ node_id, operator }));
    expect(resolveConstraintIds(stripped, sameTarget)).toEqual([ID_ALPHA, ID_BETA]);
  });

  it('DISAGREEMENT: unmatchable targets resolve to the ratified id, not a synthetic key', () => {
    const drifted = [
      { constraint_id: ID_ALPHA, node_id: DRIFTED_NODE_A, operator: '>=' },
      { constraint_id: ID_BETA, node_id: DRIFTED_NODE_B, operator: '>=' },
    ];
    expect(resolveConstraintIds(drifted, sent)).toEqual([ID_ALPHA, ID_BETA]);

    // Without the echo the same input mints keys nobody ratified.
    const stripped = drifted.map(({ node_id, operator }) => ({ node_id, operator }));
    expect(resolveConstraintIds(stripped, sent)).toEqual([SYNTHETIC_A, SYNTHETIC_B]);
  });

  it('CONTROL: `undefined` echo (pre-6b ISL) falls back to the reconstruction', () => {
    const isl = [
      { node_id: NODE_ALPHA, operator: '>=' },
      { node_id: NODE_BETA, operator: '>=' },
    ];
    expect(resolveConstraintIds(isl, sent)).toEqual([ID_ALPHA, ID_BETA]);
  });

  it('CONTROL: `null` echo (deployed ISL, no ids supplied) falls back to the reconstruction', () => {
    // The measured live shape. A reader that only handled `undefined` would key
    // results on the string "null"; this is what forbids that.
    const isl = [
      { constraint_id: null, node_id: NODE_ALPHA, operator: '>=' },
      { constraint_id: null, node_id: NODE_BETA, operator: '>=' },
    ];
    expect(resolveConstraintIds(isl, sent)).toEqual([ID_ALPHA, ID_BETA]);
    expect(resolveConstraintIds(isl, sent)).not.toContain('null');
  });

  it('CONTROL: an empty-string echo is not accepted as a key', () => {
    // An empty string is a legal JSON value but a useless Record key —
    // indistinguishable downstream from a missing one. Falls through to the
    // reconstruction rather than being propagated.
    const isl = [
      { constraint_id: '', node_id: NODE_ALPHA, operator: '>=' },
      { constraint_id: '', node_id: NODE_BETA, operator: '>=' },
    ];
    expect(resolveConstraintIds(isl, sent)).toEqual([ID_ALPHA, ID_BETA]);
  });

  it('CONTROL: a MIXED response (one id echoed, one absent) resolves each element independently', () => {
    // Per-element, not all-or-nothing: the tier is chosen per constraint.
    const isl = [
      { constraint_id: ID_BETA, node_id: DRIFTED_NODE_A, operator: '>=' },
      { node_id: NODE_BETA, operator: '>=' },
    ];
    expect(resolveConstraintIds(isl, sent)).toEqual([ID_BETA, ID_BETA]);
  });

  it('CONTROL: no goal constraints at all — synthetic key, never a crash', () => {
    const isl = [{ node_id: NODE_ALPHA, operator: '>=' }];
    expect(resolveConstraintIds(isl, undefined)).toEqual([`${NODE_ALPHA}_>=`]);
  });

  it('the echo is taken VERBATIM — no trim, no case-fold, no re-derivation', () => {
    const odd = '  C_Alpha/v2 ';
    const isl = [{ constraint_id: odd, node_id: NODE_ALPHA, operator: '>=' }];
    expect(resolveConstraintIds(isl, sent)).toEqual([odd]);
  });
});

// ===========================================================================
// ROUTE — both mapping sites, end to end through /v2/run
// ===========================================================================

describe('slice 6b consumer: /v2/run honours the echo at both mapping sites', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    echoMode = 'echo-in-order';
  });

  it('DISAGREEMENT (top-level): unmatchable ISL targets still key results by the RATIFIED id', async () => {
    echoMode = 'echo-unmatchable';
    try {
      const body = await run(app);

      expect(body.constraints_status).toBe('computed');
      expect(body.constraint_results).toHaveLength(2);

      expect(topLevelPairing(body)).toEqual(RATIFIED_PAIRING);

      // The pre-6b answer, pinned by name: synthetic keys the caller never
      // ratified — the zero-overlap condition itself.
      expect(topLevelPairing(body)).not.toEqual({
        [SYNTHETIC_A]: PROB_ALPHA,
        [SYNTHETIC_B]: PROB_BETA,
      });
      for (const r of body.constraint_results) {
        expect(r.constraint_id).not.toMatch(/^isl_internal_/);
      }
    } finally {
      echoMode = 'echo-in-order';
    }
  });

  it('DISAGREEMENT (per-option): constraint_probabilities on EVERY option keys by the ratified id', async () => {
    echoMode = 'echo-unmatchable';
    try {
      const body = await run(app);

      // A SECOND, independent mapping site in run.ts. Before this slice it
      // carried its own byte-identical copy of the ladder; fixing only the
      // top-level site would leave one response keying two blocks two ways.
      expect(body.option_comparison).toHaveLength(2);
      for (const opt of body.option_comparison) {
        expect(opt.constraint_probabilities, opt.option_id).toEqual(RATIFIED_PAIRING);
      }
    } finally {
      echoMode = 'echo-in-order';
    }
  });

  it('DISAGREEMENT: the two blocks agree with EACH OTHER (no split identity in one response)', async () => {
    echoMode = 'echo-unmatchable';
    try {
      const body = await run(app);
      const top = topLevelPairing(body);
      expect(Object.keys(top)).toHaveLength(2);
      for (const opt of body.option_comparison) {
        expect(opt.constraint_probabilities, opt.option_id).toEqual(top);
      }
    } finally {
      echoMode = 'echo-in-order';
    }
  });

  it('CONTROL (echo OMITTED — pre-6b ISL): still maps correctly via the fallback', async () => {
    echoMode = 'omitted';
    try {
      const body = await run(app);

      expect(body.constraints_status).toBe('computed');
      expect(topLevelPairing(body)).toEqual(RATIFIED_PAIRING);
      for (const opt of body.option_comparison) {
        expect(opt.constraint_probabilities, opt.option_id).toEqual(RATIFIED_PAIRING);
      }
    } finally {
      echoMode = 'echo-in-order';
    }
  });

  it('CONTROL (echo NULL — the measured live shape): still maps correctly via the fallback', async () => {
    echoMode = 'null';
    try {
      const body = await run(app);

      expect(body.constraints_status).toBe('computed');
      expect(topLevelPairing(body)).toEqual(RATIFIED_PAIRING);
      for (const opt of body.option_comparison) {
        expect(opt.constraint_probabilities, opt.option_id).toEqual(RATIFIED_PAIRING);
      }
      // Never the literal string "null" as a key.
      expect(Object.keys(topLevelPairing(body))).not.toContain('null');
    } finally {
      echoMode = 'echo-in-order';
    }
  });

  it('REGRESSION PIN (echo present, in order, targets faithful): output unchanged', async () => {
    echoMode = 'echo-in-order';
    const body = await run(app);

    expect(body.constraints_status).toBe('computed');
    expect(topLevelPairing(body)).toEqual(RATIFIED_PAIRING);
  });

  it('each result\'s user-unit `value` belongs to the constraint its id names', async () => {
    echoMode = 'echo-unmatchable';
    try {
      const body = await run(app);

      // buildConstraintFields looks the original constraint back up BY the
      // resolved id to recover the raw user-unit value. Under the pre-6b
      // synthetic key that lookup missed entirely and the result fell back to
      // ISL's NORMALISED threshold — so a wrong id corrupted `value` too, not
      // just the key.
      const byId = new Map<string, any>(
        (body.constraint_results ?? []).map((r: any) => [r.constraint_id, r]),
      );
      expect(byId.get(ID_ALPHA)?.value).toBe(VALUE_ALPHA);
      expect(byId.get(ID_ALPHA)?.probability).toBe(PROB_ALPHA);
      expect(byId.get(ID_BETA)?.value).toBe(VALUE_BETA);
      expect(byId.get(ID_BETA)?.probability).toBe(PROB_BETA);
    } finally {
      echoMode = 'echo-in-order';
    }
  });
});
