/**
 * R3 slice 1 (B2), rung (a) — PLoT carries CEE's `nonlinear_identity` to ISL, verbatim, or refuses.
 *
 * AIQ row R3-3 (ACCEPTANCE-ROWS-R2R3-B5): the declaration reaches ISL — count = 1 per hop. Before this
 * change it was 1 CEE→PLoT and 0 PLoT→ISL (WIRE d65d3a0e): `normaliseNode` and `toISLNode` both rebuild a
 * node from an explicit field list, so the key was silently dropped twice. AIQ #70 5859633012: an unknown
 * `operation` is REJECTED, never dropped (a dropped identity is R3-4's declared-but-not-evaluated case).
 *
 * The request is Paul's own CEE→PLoT capture (`paul-own-a295e4a1-20260927`, sha256 8bc6f257…) with ONE
 * edit: `mrr` declares MRR = price × paying subscribers, as C46's `markProductIdentities` would mint it.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every ISL analysis body, in call order. THE WIRE. */
let islBodies: any[] = [];

/**
 * What the mocked ISL /analyze/v2 call answers next (R3 rung a, DL takeover): `extra` top-level
 * envelope keys merged into the computed body, or a typed `error` (the no-throw contract's shape —
 * a 422 carries ISL's structured critiques). `null` = the plain computed body (every earlier row).
 */
let islNext: null | { extra?: Record<string, unknown>; error?: Record<string, unknown> } = null;

function echoConstraintAnalysis(goalConstraints: any[] | undefined) {
  if (!goalConstraints || goalConstraints.length === 0) return undefined;
  return {
    constraints: goalConstraints.map((c: any) => ({
      constraint_id: c.constraint_id,
      node_id: c.node_id,
      operator: c.operator,
      value: c.value,
      prob_satisfied: 0.8,
      failure_margin_median: 0.01,
      near_miss_fraction: 0.1,
      binding: false,
    })),
    joint_probability: 0.8,
    conditional_probabilities: null,
  };
}

function optionResults(options: any[], goalConstraints?: any[]) {
  const ca = echoConstraintAnalysis(goalConstraints);
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.6 + idx * 0.01, std: 0.1, p10: 0.5, p50: 0.6, p90: 0.7,
      n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    ...(ca && { constraint_analysis: ca }),
  }));
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(graph: any, goalNodeId: string, options: any[], _t?: any, constraints?: any[]) {
    islBodies.push({ graph, goal_node_id: goalNodeId, options, goal_constraints: constraints ?? [] });
    return {
      options: optionResults(options, constraints),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [], factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: unknown }> {
    islBodies.push(body);
    if (islNext?.error) {
      return { data: null, error: islNext.error, latency_ms: 5, isl_echoed_request_id: null } as any;
    }
    return {
      data: {
        options: optionResults(body.options || [], body.goal_constraints),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
        ...(islNext?.extra ?? {}),
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

import { NormalisationError, normaliseNode, readNonlinearIdentity } from '../src/normalisation/graph-normaliser.js';
import { attachIdentityExecutionFrames, toISLNode } from '../src/integrations/isl/translator-v3.js';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/paul-own-a295e4a1-20260927');
const PRODUCT = { operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: true };

function paulRequest(identity?: unknown): any {
  const d = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'cee-to-plot.request.json'), 'utf8'));
  if (identity !== undefined) {
    const mrr = d.graph.nodes.find((n: any) => n.id === 'mrr');
    mrr.nonlinear_identity = identity;
  }
  return d;
}

/**
 * Journey A as served on 28 Sep 02:2xZ (Canonical #72 5862209460; CEE 79b69f8 · PLoT d036ab4 · ISL 742c2c4), the run
 * batch 7 refused with `identity_frame_missing`. The graph (nodes, edges, goal_constraints) is the scenario's served read
 * `7512a0e6-bc54-47c5-b026-bc8c0469a699` VERBATIM (canonical-state/witness-batch7/after-1/05-read.json, sha256
 * fc3c0ef9…), less `operator_as_stated`, which CEE withholds from PLoT. The options are mapped the way Paul's capture
 * shows (raw_value, else value; the baseline holds today's level). The GOAL `mrr` has NO observed level: its only frame
 * is `goal_threshold_cap: 25000`.
 */
function journeyARequest(): any {
  return JSON.parse(readFileSync(resolve(__dirname, 'fixtures/journey-a-7512a0e6-20260928/cee-to-plot.request.json'), 'utf8'));
}

/**
 * ISL's rule 1 for an identity (#187 @6ea5e3a2, robustness_analyzer_v2.py `resolve_identity_plans`, :1553): the node
 * and every participant carry an `execution_frame`, else it is withheld as `identity_frame_missing` (a blocker). Returns
 * the ids that would trip it.
 */
function frameMissing(islBody: any): string[] {
  const byId = new Map<string, any>(islBody.graph.nodes.map((n: any) => [n.id, n]));
  const missing: string[] = [];
  for (const node of islBody.graph.nodes) {
    const identity = node.nonlinear_identity;
    if (!identity) continue;
    for (const id of [node.id, ...identity.factor_ids, ...(identity.addends ?? [])]) {
      if (!byId.get(id)?.execution_frame) missing.push(id);
    }
  }
  return missing;
}

function occurrences(body: unknown): number {
  return (JSON.stringify(body).match(/"nonlinear_identity"/g) ?? []).length;
}

describe('R3-3 unit — normaliseNode / toISLNode carry the declaration or refuse it', () => {
  const node = { id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: PRODUCT } as any;

  it('carries a valid declaration verbatim through BOTH rebuilds', () => {
    const engine = normaliseNode(node);
    expect(engine.nonlinear_identity).toEqual(PRODUCT);
    expect(toISLNode(engine).nonlinear_identity).toEqual(PRODUCT);
  });

  it('a node that declares nothing is byte-identical to before (no key at all)', () => {
    const plain = toISLNode(normaliseNode({ id: 'f', kind: 'factor', label: 'F' } as any));
    expect('nonlinear_identity' in plain).toBe(false);
  });

  it.each([
    [{ ...PRODUCT, operation: 'ratio' }, 'nonlinear_identity.operation'],
    [{ ...PRODUCT, operation: undefined }, 'nonlinear_identity.operation'],
    [{ ...PRODUCT, factor_ids: [] }, 'nonlinear_identity.factor_ids'],
    [{ ...PRODUCT, factor_ids: ['a', 'a'] }, 'nonlinear_identity.factor_ids'],
    [{ ...PRODUCT, factor_ids: ['a', 3] }, 'nonlinear_identity.factor_ids'],
    [{ ...PRODUCT, stated_in_brief: 'yes' }, 'nonlinear_identity.stated_in_brief'],
    ['product', 'nonlinear_identity'],
    [{ ...PRODUCT, addends: [] }, 'nonlinear_identity.addends'],
    [{ ...PRODUCT, addends: ['x', 'x'] }, 'nonlinear_identity.addends'],
    [{ ...PRODUCT, addends: ['pro_plan_price'] }, 'nonlinear_identity.addends'],
    [{ ...PRODUCT, weights: [1, 2] }, 'nonlinear_identity.weights'],
  ])('REFUSES a malformed declaration %j — never drops it (field %s)', (identity, field) => {
    let thrown: unknown;
    try {
      readNonlinearIdentity({ id: 'mrr', nonlinear_identity: identity } as any);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NormalisationError);
    expect((thrown as NormalisationError).field).toBe(field);
  });

  it('declared `addends` are carried verbatim (AIQ 5860087988 item 5, MG rung c) — never dropped', () => {
    const withAddend = { ...PRODUCT, addends: ['other_mrr_growth'] };
    const engine = normaliseNode({ ...node, nonlinear_identity: withAddend });
    expect(engine.nonlinear_identity).toEqual(withAddend);
    expect(toISLNode(engine).nonlinear_identity).toEqual(withAddend);
  });

  it('R3-8 — a participant with no resolvable frame gets none (ISL withholds; PLoT never infers one)', () => {
    const engine = [
      normaliseNode({ ...node, observed_state: { value: 0.6, cap: 125000 } }),
      normaliseNode({ id: 'pro_plan_price', kind: 'factor', label: 'Price', observed_state: { value: 0.245 } } as any),
      normaliseNode({ id: 'pro_paying_subscribers', kind: 'factor', label: 'Subs' } as any),
    ];
    const isl = engine.map(toISLNode);
    attachIdentityExecutionFrames(isl, engine, new Map([['pro_plan_price', 200]]));
    const byId = Object.fromEntries(isl.map((n) => [n.id, n.execution_frame]));
    expect(byId).toEqual({
      mrr: { frame: 125000, carrier: 'cap' },
      pro_plan_price: { frame: 200, carrier: 'scale_frame' },
      pro_paying_subscribers: undefined,
    });
  });

  // Canonical #72 5862209460 (batch 7 refused journey A's Run): the carrier is the GOAL, with no observed level. Its
  // frame is its own goal_threshold_cap, the ruler its normalised levels are already on (goalCapFrame).
  function goalCarrier(
    mrr: Record<string, unknown>,
    goalCaps: ReadonlyMap<string, number>,
    scaleFrames: ReadonlyMap<string, number> = new Map([['pro_paying_subscribers', 2000]]),
  ) {
    const engine = [
      normaliseNode({ ...node, ...mrr } as any),
      normaliseNode({ id: 'pro_plan_price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, cap: 200 } } as any),
      normaliseNode({ id: 'pro_paying_subscribers', kind: 'factor', label: 'Subs' } as any),
    ];
    const isl = engine.map(toISLNode);
    attachIdentityExecutionFrames(isl, engine, scaleFrames, goalCaps);
    return Object.fromEntries(isl.map((n) => [n.id, n.execution_frame]));
  }

  it('R3-8 — a GOAL carrier with no observed level is framed by its goal_threshold_cap, as carrier `cap`', () => {
    expect(goalCarrier({}, new Map([['mrr', 25000]]))).toEqual({
      mrr: { frame: 25000, carrier: 'cap' },
      pro_plan_price: { frame: 200, carrier: 'cap' },
      pro_paying_subscribers: { frame: 2000, carrier: 'scale_frame' },
    });
  });

  it('R3-8 — the goal cap is a FALLBACK: a goal whose own observed frame resolves keeps it', () => {
    expect(goalCarrier({ observed_state: { value: 0.6, cap: 125000 } }, new Map([['mrr', 25000]])).mrr)
      .toEqual({ frame: 125000, carrier: 'cap' });
  });

  it('R3-8 — only a GOAL reads it: a frameless FACTOR participant with a goal cap entry still gets none', () => {
    const frames = goalCarrier({}, new Map([['mrr', 25000], ['pro_paying_subscribers', 999]]), new Map());
    expect(frames.mrr).toEqual({ frame: 25000, carrier: 'cap' });
    expect(frames.pro_paying_subscribers).toBeUndefined();
  });

  it.each([
    ['absent', new Map<string, number>()],
    ['zero', new Map([['mrr', 0]])],
    ['negative', new Map([['mrr', -25000]])],
    ['NaN', new Map([['mrr', Number.NaN]])],
    ['infinite', new Map([['mrr', Number.POSITIVE_INFINITY]])],
  ])('R3-8 — a goal cap that is %s frames nothing (ISL withholds; PLoT never invents one)', (_label, caps) => {
    expect(goalCarrier({}, caps).mrr).toBeUndefined();
  });

  // ⛔ Variant (b) (DL #72 5863297824): an INFERRED identity with a frameless participant is NOT forwarded — the node
  // stays linear, as served before the re-land — and is said. A STATED one is forwarded frameless: ISL refuses (AIQ).
  function framed(identity: Record<string, unknown>, goalCaps: ReadonlyMap<string, number>) {
    const engine = [
      normaliseNode({ ...node, nonlinear_identity: { ...PRODUCT, ...identity } } as any),
      normaliseNode({ id: 'pro_plan_price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, cap: 200 } } as any),
      normaliseNode({ id: 'pro_paying_subscribers', kind: 'factor', label: 'Subs' } as any),
    ];
    const isl = engine.map(toISLNode);
    const notForwarded = attachIdentityExecutionFrames(isl, engine, new Map([['pro_paying_subscribers', 2000]]), goalCaps);
    return { isl, notForwarded, frames: Object.fromEntries(isl.map((n) => [n.id, n.execution_frame])) };
  }

  it('(b) RED: an INFERRED identity whose carrier has no frame is NOT forwarded — no declaration, no frames — and is said', () => {
    const { isl, notForwarded, frames } = framed({ stated_in_brief: false }, new Map());
    expect(isl.find((n) => n.id === 'mrr')).not.toHaveProperty('nonlinear_identity');
    expect(frames).toEqual({ mrr: undefined, pro_plan_price: undefined, pro_paying_subscribers: undefined });
    expect(notForwarded).toEqual([{ node_id: 'mrr', reason: 'inferred_identity_frame_unresolved', frameless_node_ids: ['mrr'] }]);
  });

  it('(b) CONTRAST: a STATED identity with the same frameless carrier IS forwarded (ISL refuses it: AIQ\'s rule)', () => {
    const { isl, notForwarded, frames } = framed({ stated_in_brief: true }, new Map());
    expect(isl.find((n) => n.id === 'mrr')?.nonlinear_identity).toEqual({ ...PRODUCT, stated_in_brief: true });
    expect(frames.mrr).toBeUndefined();
    expect(frames.pro_plan_price).toEqual({ frame: 200, carrier: 'cap' });
    expect(notForwarded).toEqual([]);
  });

  it('(b) CONTRAST: an INFERRED identity the goal cap frames IS forwarded, every participant framed, nothing said', () => {
    const { isl, notForwarded, frames } = framed({ stated_in_brief: false }, new Map([['mrr', 25000]]));
    expect(isl.find((n) => n.id === 'mrr')?.nonlinear_identity).toEqual({ ...PRODUCT, stated_in_brief: false });
    expect(frames).toEqual({
      mrr: { frame: 25000, carrier: 'cap' },
      pro_plan_price: { frame: 200, carrier: 'cap' },
      pro_paying_subscribers: { frame: 2000, carrier: 'scale_frame' },
    });
    expect(notForwarded).toEqual([]);
  });

  it('`sum` is admitted (AIQ 5859633012: CEE widens the carrier to product | sum)', () => {
    expect(readNonlinearIdentity({ id: 't', nonlinear_identity: { ...PRODUCT, operation: 'sum' } } as any)?.operation).toBe('sum');
  });
});

describe("R3-3 route — Paul's request: the declaration reaches ISL exactly once, or the run is refused", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  async function post(payload: any) {
    islBodies = [];
    return fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  it('PRECONDITION — CEE→PLoT carries it once', () => {
    expect(occurrences(paulRequest(PRODUCT))).toBe(1);
  });

  it('PLoT→ISL carries it once, on mrr, verbatim (count = 1 per hop)', async () => {
    const res = await post(paulRequest(PRODUCT));
    expect(res.status).toBe(200);
    expect(islBodies.length).toBeGreaterThan(0);
    for (const body of islBodies) {
      expect(occurrences(body)).toBe(1);
      const mrr = body.graph.nodes.find((n: any) => n.id === 'mrr');
      expect(mrr.nonlinear_identity).toEqual(PRODUCT);
    }
  });

  it('CONTROL — the same request without a declaration sends none (ISL body unchanged)', async () => {
    const res = await post(paulRequest());
    expect(res.status).toBe(200);
    for (const body of islBodies) {
      expect(occurrences(body)).toBe(0);
      expect(JSON.stringify(body)).not.toContain('"execution_frame"');
    }
  });

  it('R3-8 — every identity participant carries the frame PLoT resolved; no other node does', async () => {
    const res = await post(paulRequest({ ...PRODUCT, addends: ['other_mrr_growth'] }));
    expect(res.status).toBe(200);
    expect(islBodies.length).toBeGreaterThan(0);
    for (const body of islBodies) {
      const frames = Object.fromEntries(
        body.graph.nodes.filter((n: any) => n.execution_frame).map((n: any) => [n.id, n.execution_frame]),
      );
      expect(frames).toEqual({
        mrr: { frame: 125000, carrier: 'cap' },
        pro_plan_price: { frame: 200, carrier: 'cap' },
        // Paul's CEE request carries `scale_frame` on these two, which outranks the pair (the same
        // figures the value/raw_value pair gives: 1,500 / 0.15 and 1,000 / 0.02).
        pro_paying_subscribers: { frame: 10000, carrier: 'scale_frame' },
        other_mrr_growth: { frame: 50000, carrier: 'scale_frame' },
      });
    }
  });

  it('PRECONDITION — journey A served: the goal mrr declares the identity, has NO observed level, and a goal_threshold_cap of 25000', () => {
    const mrr = journeyARequest().graph.nodes.find((n: any) => n.id === 'mrr');
    expect(mrr.kind).toBe('goal');
    expect(mrr.nonlinear_identity.factor_ids).toEqual(['pro_plan_price', 'pro_paying_subscribers']);
    expect(mrr.observed_state ?? null).toBeNull();
    expect(mrr.goal_threshold_cap).toBe(25000);
  });

  it('R3-8 — journey A served (7512a0e6): the goal is framed by its goal_threshold_cap, so ISL has no identity_frame_missing', async () => {
    const res = await post(journeyARequest());
    expect(res.status).toBe(200);
    expect(islBodies.length).toBeGreaterThan(0);
    for (const body of islBodies) {
      expect(occurrences(body)).toBe(1);
      const frames = Object.fromEntries(
        body.graph.nodes.filter((n: any) => n.execution_frame).map((n: any) => [n.id, n.execution_frame]),
      );
      expect(frames).toEqual({
        mrr: { frame: 25000, carrier: 'cap' },
        pro_plan_price: { frame: 200, carrier: 'cap' },
        pro_paying_subscribers: { frame: 2000, carrier: 'scale_frame' },
      });
      expect(frameMissing(body)).toEqual([]);
    }
  });

  it('an UNKNOWN KEY is refused too (422): the carrier is rebuilt from known keys, so it would otherwise vanish', async () => {
    const res = await post(paulRequest({ ...PRODUCT, weights: [1, 2] }));
    expect(res.status).toBe(422);
    expect(islBodies.length).toBe(0);
    expect(await res.text()).toContain('nonlinear_identity.weights');
  });

  it('an unknown operation is REFUSED (422, the normalisation-error status), and ISL is never called with it', async () => {
    const res = await post(paulRequest({ ...PRODUCT, operation: 'ratio' }));
    expect(res.status).toBe(422);
    expect(islBodies.length).toBe(0);
    expect(await res.text()).toContain('nonlinear_identity.operation');
  });
});

// =====================================================================================================
// DL takeover (CHANGES_REQUIRED on #379 @ 8382ba86): what ISL says back about the identity reaches CEE.
//
// (1) ISL #187 returns `identity_evaluations` TOP-LEVEL on its V2 envelope; PLoT forwards it VERBATIM
//     at the top level of the /v2/run 200 (CEE persists the whole body as `enrichment` and reads
//     `enrichment.identity_evaluations` — without it CEE cannot tell "evaluated" from "declared").
// (2) ISL's IDENTITY_NOT_EVALUATED critique carries a typed `identity{}`; `mapISLCritiquesToV2` carries
//     it when it validates and drops it when malformed. Entry/identity shapes are ISL #187's
//     (`src/models/identity_evaluation.py`, `robustness_analyzer_v2.identity_blocking_critiques`).
// =====================================================================================================

/** ISL #187 `IdentityEvaluation` rows as its V2 route serialises them (exclude_none: unset ⇒ absent). */
const EVALUATIONS = [
  {
    node_id: 'mrr',
    operation: 'product',
    factor_ids: ['pro_plan_price', 'pro_paying_subscribers'],
    addends: ['other_mrr_growth'],
    stated_in_brief: true,
    evaluated: true,
    level_source: 'stated_level',
    reconciliation: { reconstructed: 74250, stated: 75000, mismatch_share: 0.01 },
  },
  {
    node_id: 'ops_cost',
    operation: 'sum',
    factor_ids: ['staff_cost', 'tooling_cost'],
    addends: [],
    stated_in_brief: false,
    evaluated: false,
    withheld_reason: 'identity_frame_missing',
  },
];

/** The typed identity R&C 5860893532 asks ISL's IDENTITY_NOT_EVALUATED critique to carry. */
const CRITIQUE_IDENTITY = {
  node_id: 'mrr',
  operation: 'product',
  participants: ['pro_plan_price', 'pro_paying_subscribers'],
  withheld_reason: 'identity_inconsistent',
  reconstructed: 50000,
  stated: 75000,
  mismatch_share: 0.3333333333333333,
};

function islCritique(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    code: 'IDENTITY_NOT_EVALUATED',
    severity: 'blocker',
    source: 'validation',
    message: 'mrr is declared as the product of pro_plan_price, pro_paying_subscribers but cannot be computed exactly (identity_inconsistent)',
    suggestion: 'Correct or supply the figure named, then run again: the identity is then evaluated',
    affected_node_ids: ['mrr', 'pro_plan_price', 'pro_paying_subscribers'],
    ...extra,
  };
}

describe('R3 rung (a) unit — readCritiqueIdentity validates ISL\'s critique identity{} or drops it', () => {
  // Imported lazily: a static import of run.ts is hoisted above `mockISLService` and trips the
  // hoisted vi.mock factory (TDZ). createServer loads run.ts the same lazy way.
  let readCritiqueIdentity: (raw: unknown) => unknown;
  beforeAll(async () => {
    ({ readCritiqueIdentity } = await import('../src/routes/v2/run.js'));
  });

  it('a valid identity is carried with every field', () => {
    expect(readCritiqueIdentity(CRITIQUE_IDENTITY)).toEqual(CRITIQUE_IDENTITY);
  });

  it('the numeric optionals are carried only when each is a finite number (the rest of it survives)', () => {
    const { reconstructed: _r, stated: _s, mismatch_share: _m, ...required } = CRITIQUE_IDENTITY;
    expect(readCritiqueIdentity(required)).toEqual(required);
    expect(
      readCritiqueIdentity({ ...required, reconstructed: '50000', stated: null, mismatch_share: Number.POSITIVE_INFINITY }),
    ).toEqual(required);
    expect(readCritiqueIdentity({ ...required, stated: 0 })).toEqual({ ...required, stated: 0 });
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['a string', 'mrr'],
    ['an array', [CRITIQUE_IDENTITY]],
    ['participants not an array', { ...CRITIQUE_IDENTITY, participants: 'pro_plan_price, pro_paying_subscribers' }],
    ['a non-string participant', { ...CRITIQUE_IDENTITY, participants: ['pro_plan_price', 7] }],
    ['node_id missing', { ...CRITIQUE_IDENTITY, node_id: undefined }],
    ['operation not a string', { ...CRITIQUE_IDENTITY, operation: 1 }],
    ['withheld_reason missing', { ...CRITIQUE_IDENTITY, withheld_reason: undefined }],
  ])('DROPS an identity that is %s — never forwards it', (_label, raw) => {
    expect(readCritiqueIdentity(raw)).toBeUndefined();
  });
});

describe('R3 rung (a) route — ISL\'s identity findings reach the /v2/run response verbatim', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  async function post(payload: any) {
    islBodies = [];
    return fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);

  afterAll(async () => { await app?.close(); });
  afterEach(() => { islNext = null; });

  it('(1) a 200 whose ISL response carries identity_evaluations has the SAME array at the top level (deep-equal)', async () => {
    islNext = { extra: { identity_evaluations: EVALUATIONS } };
    const res = await post(paulRequest(PRODUCT));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis_status).not.toBe('blocked');
    expect(body.identity_evaluations).toEqual(EVALUATIONS);
    // The enrichment egress guard (CEE's persisted shape) does not withhold it.
    expect(body._meta?.evidence?.enrichment_contract_withheld ?? []).not.toContain('identity_evaluations');
  });

  it('(1) CONTROL — no identity anywhere: the response has NO identity_evaluations key', async () => {
    const res = await post(paulRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).not.toContain('identity_evaluations');
  });

  it('(1) CONTROL — an identity declared but ISL says nothing: PLoT never mints the key', async () => {
    const res = await post(paulRequest(PRODUCT));
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json())).not.toContain('identity_evaluations');
  });

  it('(2) a 422 whose ISL critique carries identity{} keeps it intact; one without has no key; a malformed one is dropped', async () => {
    islNext = {
      error: {
        code: 'ISL_REJECTED',
        message: 'Validation failed',
        retryable: false,
        status: 422,
        critiques: [
          islCritique('crit-identity', { identity: CRITIQUE_IDENTITY }),
          islCritique('crit-plain'),
          islCritique('crit-malformed', {
            identity: { ...CRITIQUE_IDENTITY, participants: 'pro_plan_price, pro_paying_subscribers' },
          }),
        ],
      },
    };
    const res = await post(paulRequest(PRODUCT));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.analysis_status).toBe('blocked');
    const byId = Object.fromEntries((body.critiques as any[]).map((c) => [c.id, c]));
    expect(byId['crit-identity']?.code).toBe('IDENTITY_NOT_EVALUATED');
    expect(byId['crit-identity'].identity).toEqual(CRITIQUE_IDENTITY);
    expect(byId['crit-plain']).toBeDefined();
    expect('identity' in byId['crit-plain']).toBe(false);
    expect(byId['crit-malformed']).toBeDefined();
    expect('identity' in byId['crit-malformed']).toBe(false);
  });
});
