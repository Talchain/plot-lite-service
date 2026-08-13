/**
 * ROADMAP 2.1024 — THE FRESHNESS HASH DESCRIBES THE COMPUTATION THAT RAN.
 *
 * THE DEFECT (measured at `b9f6b5a7`). The hash was computed from a PARALLEL
 * SEMANTIC PROJECTION of the inbound request — a hand-maintained field list.
 * Four analysis-changing inputs were missing from it:
 *
 *   1. goal_threshold_frame          (decides whether ISL evaluates the target)
 *   2. goal_constraints[].value_frame(decides whether ISL evaluates constraints)
 *   3. node prior bounds/distribution(the sampled distribution itself)
 *   4. factor_correlations           (the joint sampling structure)
 *
 * Changing ALL FOUR produced a BYTE-IDENTICAL hash while producing a materially
 * different ISL request. A consumer caching on this hash would serve a stale
 * answer and call it fresh. "Unchanged" was a lie.
 *
 * THE FIX is structural, not another field: hash the EFFECTIVE ISL REQUEST. An
 * input that changes what ISL computes must change the ISL request, so it cannot
 * be omitted from a hash derived from it.
 *
 * ⚠ WHY THIS TEST IS AT THE ROUTE. A unit test on `hashRequest` proves only that
 * the function can see a field it was handed. The claim that matters is that the
 * REAL /v2/run path threads the real ISL request into the real hash — so every
 * assertion below reads `_meta.response_hash` off an actual response.
 *
 * ⚠ TRAP-20 DISCIPLINE. A probe that answers "different" for every input is
 * reporting on itself. T3/T4 are the contrast: inputs that MUST NOT change the
 * hash. Discrimination is proven only by the pair.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

let capturedISLRequestBody: any = null;

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
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: {
          mean: 0.2915, std: 0.2048, p10: 0.05, p50: 0.294, p90: 0.555,
          n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
        },
        rank: idx + 1,
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedISLRequestBody = body;
    return {
      data: {
        options: (body.options || []).map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: {
            mean: 0.2915, std: 0.2048, p10: 0.05, p50: 0.294, p90: 0.555,
            n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
          },
          rank: idx + 1,
        })),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../src/createServer.js');

const OPTIONS = [
  { id: 'opt1', label: 'Expand Leeds', interventions: { lever: 0.9 } },
  { id: 'opt2', label: 'Expand Bristol', interventions: { lever: 0.2 } },
];

function baseGraph() {
  return {
    nodes: [
      {
        id: 'goal_arr', kind: 'goal', label: 'Reach 6M ARR',
        observed_state: { value: 0.4, baseline: 0.35, unit: '£' },
        goal_threshold: 0.8, goal_threshold_raw: 6000000, goal_threshold_unit: '£',
      },
      { id: 'lever', kind: 'factor', label: 'Sales headcount', observed_state: { value: 0.5 } },
      { id: 'factor_a_node', kind: 'factor', label: 'Market', observed_state: { value: 0.3 } },
      { id: 'factor_b_node', kind: 'factor', label: 'Churn', observed_state: { value: 0.3 } },
    ],
    edges: [
      { from: 'lever', to: 'goal_arr', strength: { mean: 0.6, std: 0.1 } },
      { from: 'factor_a_node', to: 'goal_arr', strength: { mean: 0.3, std: 0.1 } },
      { from: 'factor_b_node', to: 'goal_arr', strength: { mean: 0.3, std: 0.1 } },
    ],
  };
}

function basePayload(extra: Record<string, unknown> = {}, graphMutator?: (g: any) => void) {
  const graph = baseGraph();
  if (graphMutator) graphMutator(graph);
  return {
    graph,
    options: OPTIONS,
    goal_node_id: 'goal_arr',
    seed: 'hash-v8-21024',
    goal_constraints: [
      { constraint_id: 'c1', node_id: 'goal_arr', operator: '>=', value: 0.8 },
    ],
    ...extra,
  };
}

/** No root `goal_constraints`: the path where the goal frame decides synthesis. */
function noConstraintPayload(extra: Record<string, unknown> = {}, graphMutator?: (g: any) => void) {
  const graph = baseGraph();
  if (graphMutator) graphMutator(graph);
  return { graph, options: OPTIONS, goal_node_id: 'goal_arr', seed: 'hash-v8-21024', ...extra };
}

/** A prior-only EXTERNAL factor — the only shape whose `prior` reaches ISL. */
function priorOnlyPayload(prior: Record<string, unknown>) {
  const graph = baseGraph();
  graph.nodes.push({
    id: 'ext_factor', kind: 'factor', label: 'FX rate',
    category: 'external', prior,
  } as any);
  graph.edges.push({ from: 'ext_factor', to: 'goal_arr', strength: { mean: 0.2, std: 0.1 } });
  return {
    graph, options: OPTIONS, goal_node_id: 'goal_arr', seed: 'hash-v8-21024',
    goal_constraints: [{ constraint_id: 'c1', node_id: 'goal_arr', operator: '>=', value: 0.8 }],
  };
}

describe('ROADMAP 2.1024 — the freshness hash covers every analysis-changing input', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    capturedISLRequestBody = null;
  });

  async function hashOf(payload: Record<string, unknown>) {
    capturedISLRequestBody = null;
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    const h = body?._meta?.response_hash;
    // POSITIVE CONTROL: a missing/empty hash would make every comparison below
    // agree vacuously. Assert we are comparing real values before comparing.
    expect(typeof h, 'response_hash must be a string').toBe('string');
    expect(h.length, 'response_hash must be non-empty').toBeGreaterThan(8);
    return { hash: h as string, isl: capturedISLRequestBody, body };
  }

  // -------------------------------------------------------------------------
  // T0 — PRECONDITION. These runs must actually reach ISL, or the hash would be
  // the `pre_isl` class and this whole file would be testing the wrong path.
  // -------------------------------------------------------------------------
  it('T0 PRECONDITION: the run reaches ISL, so the hash covers an ISL request', async () => {
    const { isl, body } = await hashOf(basePayload());
    expect(isl, 'ISL must have been called').not.toBeNull();
    expect(body._meta.hash_version).toBe(8);
  });

  // -------------------------------------------------------------------------
  // T1 — THE DEFECT, ALL FOUR AT ONCE. This is the audit's load-bearing claim.
  // -------------------------------------------------------------------------
  it('T1 DEFECT: changing all four analysis-changing fields changes the hash', async () => {
    const a = await hashOf(basePayload());
    const b = await hashOf(
      basePayload(
        {
          goal_constraints: [
            { constraint_id: 'c1', node_id: 'goal_arr', operator: '>=', value: 0.8, value_frame: 'delta' },
          ],
          factor_correlations: [{ factor_a: 'factor_a_node', factor_b: 'factor_b_node', rho: 0.85 }],
        },
        (g) => {
          g.nodes[0].goal_threshold_frame = 'delta';
          g.nodes[2].prior = { distribution: 'uniform', range_min: -5, range_max: 5 };
        },
      ),
    );
    expect(b.hash, 'four-field change must not collide').not.toBe(a.hash);
  });

  // -------------------------------------------------------------------------
  // T2 — EACH FIELD ALONE. A single combined assertion could pass on one field
  // doing all the work while the other three stayed invisible.
  // -------------------------------------------------------------------------
  // ⚠ REACHABILITY, MEASURED — NOT ASSUMED. This case must run WITHOUT root
  // `goal_constraints`. With them present the route takes the multi-constraint
  // path, `effectiveGoalThreshold` is undefined, and neither `goal_threshold`
  // NOR its frame reaches ISL at all — so the frame cannot change the
  // computation and the hash is RIGHT to collide. T2a-inert pins exactly that,
  // so this pair states where the field is live and where it is inert instead
  // of implying it is always live. (A fixture outside the producer's reachable
  // domain proves nothing about the wire.)
  it('T2a DEFECT: goal_threshold_frame alone changes the hash (no root constraints)', async () => {
    const a = await hashOf(noConstraintPayload());
    const b = await hashOf(noConstraintPayload({}, (g) => { g.nodes[0].goal_threshold_frame = 'delta'; }));
    // Precondition: the frame really did reach the wire and flip synthesis on.
    expect(a.isl.goal_constraints).toBeUndefined();
    expect(b.isl.goal_constraints[0].value_frame).toBe('delta');
    expect(b.hash).not.toBe(a.hash);
  });

  it('T2a-inert PIN: on the multi-constraint path the frame reaches neither ISL nor the hash', async () => {
    const a = await hashOf(basePayload());
    const b = await hashOf(basePayload({}, (g) => { g.nodes[0].goal_threshold_frame = 'delta'; }));
    // The frame is genuinely absent from the computation on this path...
    expect(a.isl.goal_threshold).toBeUndefined();
    expect(b.isl.goal_threshold_frame).toBeUndefined();
    // ...so an identical hash is the TRUTH, not a collision.
    expect(b.hash).toBe(a.hash);
  });

  it('T2b DEFECT: constraint value_frame alone changes the hash', async () => {
    const a = await hashOf(basePayload());
    const b = await hashOf(basePayload({
      goal_constraints: [
        { constraint_id: 'c1', node_id: 'goal_arr', operator: '>=', value: 0.8, value_frame: 'level' },
      ],
    }));
    expect(b.hash).not.toBe(a.hash);
  });

  // ⚠ REACHABILITY, MEASURED. `prior` feeds `parameter_uncertainties` ONLY for a
  // factor that is `category: 'external'` AND carries no `observed_state.value`
  // — `buildParameterUncertaintiesV3`'s second pass skips any node already
  // handled by the first ("observed_state takes precedence"). A prior on a node
  // WITH an observed value is inert by design; T2c-inert pins that.
  it('T2c DEFECT: a prior-only external factor\'s bounds alone change the hash', async () => {
    const a = await hashOf(priorOnlyPayload({ distribution: 'uniform', range_min: -5, range_max: 5 }));
    const b = await hashOf(priorOnlyPayload({ distribution: 'uniform', range_min: -20, range_max: 40 }));
    // Precondition: the prior really did reach the wire as an uncertainty entry.
    const puA = a.isl.parameter_uncertainties ?? [];
    const puB = b.isl.parameter_uncertainties ?? [];
    expect(JSON.stringify(puA)).not.toBe(JSON.stringify(puB));
    expect(b.hash).not.toBe(a.hash);
  });

  it('T2c-inert PIN: a prior on a node that already has an observed value is inert', async () => {
    const a = await hashOf(basePayload());
    const b = await hashOf(basePayload({}, (g) => {
      g.nodes[2].prior = { distribution: 'uniform', range_min: -5, range_max: 5 };
    }));
    // Byte-identical ISL request (modulo request_id) ⇒ identical hash is correct.
    expect(JSON.stringify(a.isl.parameter_uncertainties)).toBe(
      JSON.stringify(b.isl.parameter_uncertainties),
    );
    expect(b.hash).toBe(a.hash);
  });

  it('T2d DEFECT: factor_correlations alone changes the hash', async () => {
    const a = await hashOf(basePayload());
    const b = await hashOf(basePayload({
      factor_correlations: [{ factor_a: 'factor_a_node', factor_b: 'factor_b_node', rho: 0.85 }],
    }));
    expect(b.hash).not.toBe(a.hash);
  });

  // -------------------------------------------------------------------------
  // T3 — CONTRAST CONTROL / DETERMINISM. Without this, a hash that simply
  // changed on every call would satisfy every assertion above.
  // -------------------------------------------------------------------------
  it('T3 CONTRAST: the same request twice produces the SAME hash', async () => {
    const a = await hashOf(basePayload());
    const b = await hashOf(basePayload());
    expect(b.hash).toBe(a.hash);
  });

  // -------------------------------------------------------------------------
  // T4 — `options` IS AN ORDERED LIST, NOT A SET (ROADMAP 2.1026).
  //
  // ⚠ THIS TEST PREVIOUSLY ASSERTED THE OPPOSITE, AND WAS WRONG. It pinned
  // "reordering options does NOT change the hash" as a guarantee. Measured at
  // this tip, reordering hands ISL a genuinely DIFFERENT reference option —
  // `options[0]` drives edge sensitivity, factor sensitivity and fragile-edge
  // classification, and is disclosed to the user as
  // `sensitivity_reference_option_id`. So the old assertion pinned a BLIND SPOT
  // as a property: it would have gone green forever while the hash reported two
  // different computations as the same one.
  //
  // The precondition below is the load-bearing part — it proves the reorder
  // actually changed what ISL receives, so the hash difference is the code's
  // doing and not the fixture's.
  // -------------------------------------------------------------------------
  it('T4 DEFECT: reordering options DOES change the hash (options[0] is the ISL reference)', async () => {
    const a = await hashOf(basePayload());
    const b = await hashOf(basePayload({ options: [...OPTIONS].reverse() }));

    // Precondition: ISL really did receive a different reference option.
    expect(a.isl.options[0].id).not.toBe(b.isl.options[0].id);
    expect(JSON.stringify(a.isl.options[0].interventions))
      .not.toBe(JSON.stringify(b.isl.options[0].interventions));

    expect(b.hash, 'a different reference option is a different computation').not.toBe(a.hash);
  });

  it('T4-set CONTRAST: reordering goal_constraints does NOT change the hash (a real set)', async () => {
    // Two DIFFERENT target nodes on purpose: two constraints on the same node
    // collapse to one before the wire, and the precondition below caught exactly
    // that when this test was first written against a single node.
    const twoConstraints = [
      { constraint_id: 'c1', node_id: 'goal_arr', operator: '>=', value: 0.8 },
      { constraint_id: 'c2', node_id: 'factor_a_node', operator: '>=', value: 0.3 },
    ];
    const a = await hashOf(basePayload({ goal_constraints: twoConstraints }));
    const b = await hashOf(basePayload({ goal_constraints: [...twoConstraints].reverse() }));
    // Precondition: both really carried two constraints to the wire.
    expect(a.isl.goal_constraints).toHaveLength(2);
    expect(b.isl.goal_constraints).toHaveLength(2);
    expect(b.hash).toBe(a.hash);
  });

  it('T4b CONTRAST: reordering graph nodes does NOT change the hash', async () => {
    const a = await hashOf(basePayload());
    const b = await hashOf(basePayload({}, (g) => { g.nodes.reverse(); }));
    expect(b.hash).toBe(a.hash);
  });

  // -------------------------------------------------------------------------
  // T-superset — THE HASH COVERS THE EFFECTIVE ISL REQUEST *PLUS* THE INBOUND
  // PROJECTION, AND THAT IS DELIBERATE (ROADMAP 2.1027).
  //
  // ⚠ WRITTEN BECAUSE A PROBE REFUTED THIS PR'S OWN DESCRIPTION. "Hashes the
  // effective ISL request rather than a projection" is FALSE as stated — the
  // projection is retained alongside. Two runs whose raw intervention values
  // differ but CLAMP to the same wire value send a byte-identical ISL request
  // and still hash differently.
  //
  // That is correct: this hash keys a RESPONSE, and the response echoes raw
  // pre-normalisation quantities, so identical-wire runs can have different
  // bodies. The property to preserve is directional — anything reaching ISL
  // always moves the hash (no false "unchanged"); something not reaching ISL
  // may also move it (a conservative false "changed", i.e. a cache miss).
  //
  // The precondition is the whole test: it proves the two ISL requests really
  // are byte-identical, so the differing hash can only come from the projection.
  // -------------------------------------------------------------------------
  it('T-superset: identical ISL requests may still hash differently (projection retained)', async () => {
    const clampPayload = (leverA: number) => ({
      graph: {
        nodes: [
          { id: 'goal_arr', kind: 'goal', label: 'g', observed_state: { value: 0.4, baseline: 0.35 } },
          {
            id: 'lever', kind: 'factor', label: 'l',
            observed_state: { value: 15000 },
            state_space: { range: { min: 0, max: 50000 } },
          },
        ],
        edges: [{ from: 'lever', to: 'goal_arr', strength: { mean: 0.6, std: 0.1 } }],
      },
      options: [
        { id: 'opt1', label: 'A', interventions: { lever: { value: leverA, source: 'user_specified' } } },
        { id: 'opt2', label: 'B', interventions: { lever: { value: 10000, source: 'user_specified' } } },
      ],
      goal_node_id: 'goal_arr',
      seed: 'hash-v8-superset',
    });

    // Both clamp to the ceiling, so the WIRE is identical...
    const a = await hashOf(clampPayload(60000));
    const b = await hashOf(clampPayload(90000));

    const strip = (r: any) => JSON.stringify({ ...r, request_id: 0 });
    expect(a.isl.options[0].interventions).toEqual(b.isl.options[0].interventions);
    expect(strip(a.isl), 'PRECONDITION: the ISL requests must be byte-identical')
      .toBe(strip(b.isl));

    // ...yet the raw inputs differ, and the response echoes them, so the hash moves.
    expect(b.hash, 'the retained projection must still discriminate').not.toBe(a.hash);
  });

  // -------------------------------------------------------------------------
  // T5 — THE NON-DETERMINISTIC KEY IS EXCLUDED. `request_id` is a fresh UUID on
  // every call; if it entered the hash, T3 would fail and the hash would be
  // useless as a cache key. T3 already proves this indirectly — this pins the
  // denylist itself so a future edit to it fails loudly here.
  // -------------------------------------------------------------------------
  it('T5 PIN: request_id differs between two identical runs, yet the hash does not', async () => {
    const a = await hashOf(basePayload());
    const b = await hashOf(basePayload());
    expect(a.isl.request_id).not.toBe(b.isl.request_id); // precondition
    expect(a.hash).toBe(b.hash);
  });
});
