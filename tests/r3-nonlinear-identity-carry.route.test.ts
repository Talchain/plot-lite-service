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
/** Per-call answers, consumed first (variant (c): a 422, then the answer to the ONE retry); then `islNext`. */
let islSeq: Array<{ extra?: Record<string, unknown>; error?: Record<string, unknown> }> = [];

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
    // A copy: PLoT may withdraw a declaration from the same request object before asking again (variant (c)).
    islBodies.push(structuredClone(body));
    const next = islSeq.length > 0 ? islSeq.shift()! : islNext;
    if (next?.error) {
      return { data: null, error: next.error, latency_ms: 5, isl_echoed_request_id: null } as any;
    }
    return {
      data: {
        options: optionResults(body.options || [], body.goal_constraints),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
        ...(next?.extra ?? {}),
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
import { computeResponseContentHash } from '../src/util/response-content-hash.js';

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

// ⭐ Variant (a) (DL #72 5865205478; Canonical ruler gate): an INFERRED product whose carrier is a NON-GOAL OUTCOME with
// no level and no frame, every factor framed, takes the product of its factors' frames as Olumi's derived ruler, carrier
// `cap`, disclosed. Everything else (a goal, a stated identity, a carrier with a level, a frameless factor, addends)
// falls through to today's rules byte-for-byte.
describe('R3 variant (a) — a frameless inferred INTERMEDIATE product carrier takes the product of its factors\' frames', () => {
  const MRR_ID = 'pro_plan_mrr';
  function intermediate(opts: { identity?: Record<string, unknown>; carrier?: Record<string, unknown>; subsFramed?: boolean } = {}) {
    const derived: any[] = [];
    const engine = [
      normaliseNode({ id: MRR_ID, kind: 'outcome', label: 'Pro MRR', ...(opts.carrier ?? {}),
        nonlinear_identity: { ...PRODUCT, stated_in_brief: false, ...(opts.identity ?? {}) } } as any),
      normaliseNode({ id: 'pro_plan_price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, cap: 200 } } as any),
      normaliseNode({ id: 'pro_paying_subscribers', kind: 'factor', label: 'Subs', observed_state: { value: 0.15 } } as any),
      normaliseNode({ id: 'mrr', kind: 'goal', label: 'MRR' } as any),
    ];
    const isl = engine.map(toISLNode);
    const scale = opts.subsFramed === false ? new Map<string, number>() : new Map([['pro_paying_subscribers', 2000]]);
    const notForwarded = attachIdentityExecutionFrames(isl, engine, scale, new Map(), derived);
    return { isl, derived, notForwarded, carrier: isl.find((n) => n.id === MRR_ID)! };
  }

  it('(a) RED: the carrier is framed by price × subscribers frames (200 × 2000), forwarded, and the ruler is disclosed as Olumi\'s', () => {
    const { derived, notForwarded, carrier } = intermediate();
    expect(carrier.nonlinear_identity).toEqual({ ...PRODUCT, stated_in_brief: false });
    expect(carrier.execution_frame).toEqual({ frame: 400000, carrier: 'cap' });
    expect(notForwarded).toEqual([]);
    expect(derived).toEqual([{
      node_id: MRR_ID, frame: 400000, source: 'olumi_derived_product_of_factor_frames',
      factor_frames: [{ node_id: 'pro_plan_price', frame: 200 }, { node_id: 'pro_paying_subscribers', frame: 2000 }],
    }]);
  });

  it('(a) CONTRAST — a STATED identity is untouched: forwarded frameless, no derived ruler (ISL refuses: AIQ\'s rule)', () => {
    const { derived, notForwarded, carrier } = intermediate({ identity: { stated_in_brief: true } });
    expect(carrier.execution_frame).toBeUndefined();
    expect(derived).toEqual([]);
    expect(notForwarded).toEqual([]);
  });

  it('(a) CONTRAST — one frameless FACTOR: no derived ruler; not forwarded, exactly as (b)', () => {
    const { derived, notForwarded, carrier } = intermediate({ subsFramed: false });
    expect(derived).toEqual([]);
    expect(carrier).not.toHaveProperty('nonlinear_identity');
    expect(notForwarded.map((n) => n.node_id)).toEqual([MRR_ID]);
  });

  it('(a) CONTRAST — a carrier WITH a level (no frame): its ruler is not ours to choose; not forwarded, exactly as (b)', () => {
    const { derived, notForwarded } = intermediate({ carrier: { observed_state: { value: 0.3 } } });
    expect(derived).toEqual([]);
    expect(notForwarded.map((n) => n.node_id)).toEqual([MRR_ID]);
  });

  it('(a) CONTRAST — addends: no derived ruler (the product bound is not the carrier\'s bound)', () => {
    const engineAddend = intermediate({ identity: { addends: ['other_mrr'] } });
    expect(engineAddend.derived).toEqual([]);
  });

  it('(a) CONTRAST — a GOAL carrier with no cap is untouched: no derived ruler; not forwarded, exactly as (b)', () => {
    const derived: any[] = [];
    const engine = [
      normaliseNode({ id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: { ...PRODUCT, stated_in_brief: false } } as any),
      normaliseNode({ id: 'pro_plan_price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, cap: 200 } } as any),
      normaliseNode({ id: 'pro_paying_subscribers', kind: 'factor', label: 'Subs', observed_state: { value: 0.15 } } as any),
    ];
    const isl = engine.map(toISLNode);
    const notForwarded = attachIdentityExecutionFrames(isl, engine, new Map([['pro_paying_subscribers', 2000]]), new Map(), derived);
    expect(derived).toEqual([]);
    expect(notForwarded.map((n) => n.node_id)).toEqual(['mrr']);
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

  it('(a) SERVED — DL A15 (pj-20260928T023301Z): the intermediate pro_plan_mrr reaches ISL framed by 200 × 5000, disclosed, nothing withdrawn', async () => {
    const req = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/r3-intermediate-carrier-dl-a15.request.json'), 'utf8'));
    const res = await post(req);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(islBodies.length).toBeGreaterThan(0);
    for (const body of islBodies) {
      const carrier = body.graph.nodes.find((n: any) => n.id === 'pro_plan_mrr');
      expect(carrier.nonlinear_identity?.stated_in_brief).toBe(false);
      expect(carrier.execution_frame).toEqual({ frame: 1000000, carrier: 'cap' });
      expect(frameMissing(body)).toEqual([]);
    }
    expect(out._meta?.identity_derived_frames?.map((d: any) => [d.node_id, d.frame, d.source]))
      .toEqual([['pro_plan_mrr', 1000000, 'olumi_derived_product_of_factor_frames']]);
    expect(out._meta?.identities_not_forwarded).toBeUndefined();
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

// ⛔ VARIANT (c) (DL #72 5864468829, HIGH): since #383, journey C's final Run was refused in 3 of 6 served runs — ISL
// withheld Olumi's INFERRED "MRR = price × subscribers" as `identity_inconsistent` (Olumi's own subscriber estimate
// against the user's stated MRR) and, by its R3 rule, blocked the Run. PLoT now withdraws such an identity and asks ISL
// once more; ISL stays the one judge, and every other refusal stands.
describe('(c) an INFERRED identity ISL finds inconsistent is withdrawn and the Run asked again, once', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const INFERRED = { ...PRODUCT, stated_in_brief: false };
  const reject = (...critiques: unknown[]) => ({ error: { code: 'ISL_REJECTED', message: 'Validation failed', retryable: false, status: 422, critiques } });
  const inconsistent = islCritique('crit-inconsistent', { identity: CRITIQUE_IDENTITY });

  async function post(payload: any) {
    islBodies = [];
    return fetch(`${baseUrl}/v2/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
  afterEach(() => { islNext = null; islSeq = []; });

  it('⭐ RED: inferred + ISL 422 identity_inconsistent → withdrawn, asked ONCE more, the Run computes, and it is said with ISL\'s figures', async () => {
    islSeq = [reject(inconsistent)];
    const res = await post(paulRequest(INFERRED));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis_status).not.toBe('blocked');
    expect(islBodies).toHaveLength(2);
    expect(occurrences(islBodies[0])).toBe(1);
    expect(occurrences(islBodies[1])).toBe(0);
    expect(islBodies[1].graph.nodes.filter((n: any) => n.execution_frame).map((n: any) => n.id)).toEqual([]);
    const { node_id, participants: _p, withheld_reason: _w, operation: _o, ...figures } = CRITIQUE_IDENTITY;
    expect(body._meta?.identities_not_forwarded).toEqual([
      { node_id, reason: 'inferred_identity_inconsistent', frameless_node_ids: [], reconciliation: figures },
    ]);
  });

  it('⭐ RED (verifier FIX_FIRST): a withdrawn variant-(a) carrier takes its Olumi-derived frame out of _meta too — no claim of a frame the retry never sent', async () => {
    const req = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/r3-intermediate-carrier-dl-a15.request.json'), 'utf8'));
    islSeq = [reject(islCritique('crit-a15-operand', {
      affected_node_ids: ['pro_plan_mrr', 'pro_plan_monthly_price', 'pro_paying_subscribers'],
      identity: { node_id: 'pro_plan_mrr', operation: 'product', participants: ['pro_plan_monthly_price', 'pro_paying_subscribers'], withheld_reason: 'identity_operand_missing' },
    }))];
    const res = await post(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(islBodies).toHaveLength(2);
    // Precondition: the first call carried the Olumi-derived frame; the retry carries neither it nor the identity.
    expect(islBodies[0].graph.nodes.find((n: any) => n.id === 'pro_plan_mrr')?.execution_frame).toBeDefined();
    expect(islBodies[1].graph.nodes.find((n: any) => n.id === 'pro_plan_mrr')?.execution_frame).toBeUndefined();
    expect(body._meta?.identities_not_forwarded?.map((w: any) => [w.node_id, w.reason])).toEqual([['pro_plan_mrr', 'inferred_identity_operand_missing']]);
    // The claim goes with the frame: nothing names a derived frame for the withdrawn carrier.
    expect((body._meta?.identity_derived_frames ?? []).map((d: any) => d.node_id)).not.toContain('pro_plan_mrr');
  });

  it('CONTRAST: a STATED identity ISL finds inconsistent keeps ISL\'s refusal — one call, 422 (the user\'s own figures conflict)', async () => {
    islSeq = [reject(inconsistent)];
    const res = await post(paulRequest(PRODUCT));
    expect(res.status).toBe(422);
    expect(islBodies).toHaveLength(1);
  });

  // Superseded by R3-A1 (AIQ RESULT + RULING #72 5867263914): this row pinned "another reason keeps the refusal". An
  // INFERRED identity ISL cannot evaluate for ANY of its reasons is now withdrawn; only a STATED one refuses the Run.
  it('R3-A1: an inferred identity withheld for ANOTHER of ISL\'s reasons is withdrawn too — two calls, 200, named', async () => {
    islSeq = [reject(islCritique('crit-operand', { identity: { ...CRITIQUE_IDENTITY, withheld_reason: 'identity_operand_missing' } }))];
    const res = await post(paulRequest(INFERRED));
    expect(res.status).toBe(200);
    expect(islBodies).toHaveLength(2);
    expect((await res.json())._meta?.identities_not_forwarded)
      .toEqual([{ node_id: 'mrr', reason: 'inferred_identity_operand_missing', frameless_node_ids: [] }]);
  });

  it('CONTRAST: any OTHER blocker beside it keeps the refusal — one call, 422', async () => {
    islSeq = [reject(inconsistent, { id: 'crit-other', code: 'GRAPH_INVALID', severity: 'blocker', message: 'x', affected_node_ids: [] })];
    const res = await post(paulRequest(INFERRED));
    expect(res.status).toBe(422);
    expect(islBodies).toHaveLength(1);
  });

  it('ONCE: when the retry is refused too, that refusal is returned — never a third call', async () => {
    const other = islCritique('crit-after', { code: 'GRAPH_INVALID', identity: undefined });
    islSeq = [reject(inconsistent), reject(other)];
    const res = await post(paulRequest(INFERRED));
    expect(res.status).toBe(422);
    expect(islBodies).toHaveLength(2);
    expect(((await res.json()).critiques as any[]).map((c) => c.id)).toContain('crit-after');
  });
});

// ⛔ R3-A1 (AIQ RESULT + RULING #72 5867263914, HIGH → DL): an INFERRED identity ISL cannot evaluate for ANY reason is
// withdrawn and the Run proceeds additively — not only an inconsistent one (#385). Served on PLoT aac1970 · ISL 14f1a3a
// (Paul's a6ed1bff request, 0 LLM calls): A1of (inferred, operand level MISSING) and A1zf (inferred, operand level ZERO)
// were refused 422 for the whole Run. ONLY a STATED identity refuses the Run. The rows below replay AIQ's served requests
// VERBATIM (tests/fixtures/r3-a1-served-20260928: byte copies of quality-evidence/r3-served-20260928/product/raw) and
// ISL's own 422 critique from each served response (the `source: 'isl'` critique, less the keys PLoT's mapper adds).
describe('R3-A1 — an INFERRED identity ISL cannot evaluate for ANY reason is withdrawn; only a STATED one refuses the Run', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const SERVED_DIR = resolve(__dirname, 'fixtures/r3-a1-served-20260928');
  const served = (file: string): any => JSON.parse(readFileSync(resolve(SERVED_DIR, `${file}.json`), 'utf8'));
  const A1OF = 'A1of-20260928T092621Z';
  const A1O = 'A1o-20260928T092621Z';
  const A1ZF = 'A1zf-20260928T092953Z';
  const A1ZS = 'A1zs-20260928T092953Z';
  const A1IS = 'A1is-20260928T092856Z';
  const A1IF = 'A1if-20260928T092856Z';
  /** ISL's own critiques of a served 422, as ISL sent them (PLoT's mapper adds `source` / `blocks_analysis` / `user_message`). */
  const islCritiquesOf = (row: any): any[] => (row.response.critiques as any[])
    .filter((c) => c.source === 'isl')
    .map(({ source: _s, blocks_analysis: _b, user_message: _u, ...isl }) => isl);
  /** ISL's served 422 for that row, as `callAnalysisEndpoint` hands it to the route (the no-throw contract's shape). */
  const servedReject = (row: any, critiques: any[] = islCritiquesOf(row)) => ({
    error: { code: 'ISL_REJECTED', message: row.response.status_reason, retryable: false, status: 422, critiques },
  });
  /** C0: the SAME request with no identity declared (the ruling's control for "effects byte-identical"). */
  const withoutIdentity = (request: any): any => {
    const c0 = structuredClone(request);
    for (const n of c0.graph.nodes) delete n.nonlinear_identity;
    return c0;
  };
  const withReason = (critique: any, withheld_reason: string) => ({ ...critique, identity: { ...critique.identity, withheld_reason } });

  async function post(payload: any) {
    islBodies = [];
    return fetch(`${baseUrl}/v2/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
  afterEach(() => { islNext = null; islSeq = []; });

  it('PRECONDITION — the served rows: each inferred row is its stated control but for stated_in_brief; ISL named ONE blocker, typed', () => {
    const strip = (r: any) => {
      const c = structuredClone(r.request);
      delete c.request_id;
      for (const n of c.graph.nodes) if (n.nonlinear_identity) delete n.nonlinear_identity.stated_in_brief;
      return c;
    };
    for (const [inferred, stated] of [[A1OF, A1O], [A1ZF, A1ZS], [A1IF, A1IS]]) {
      const i = served(inferred);
      const s = served(stated);
      expect(i.request.graph.nodes.find((n: any) => n.id === 'mrr').nonlinear_identity.stated_in_brief).toBe(false);
      expect(s.request.graph.nodes.find((n: any) => n.id === 'mrr').nonlinear_identity.stated_in_brief).toBe(true);
      expect(strip(i)).toEqual(strip(s));
    }
    const reasons = Object.fromEntries([A1OF, A1O, A1ZF, A1ZS, A1IS].map((f) => {
      const row = served(f);
      expect(row.http_status).toBe(422);
      const blockers = islCritiquesOf(row).filter((c) => c.severity === 'blocker');
      expect(blockers).toHaveLength(1);
      expect(blockers[0].code).toBe('IDENTITY_NOT_EVALUATED');
      expect(blockers[0].identity.node_id).toBe('mrr');
      return [f.split('-')[0], blockers[0].identity.withheld_reason];
    }));
    expect(reasons).toEqual({
      A1of: 'identity_operand_missing', A1o: 'identity_operand_missing',
      A1zf: 'identity_zero_level', A1zs: 'identity_zero_level', A1is: 'identity_inconsistent',
    });
  });

  // ⭐ RED at base (aac1970): 422, one ISL call — #385 withdrew only `identity_inconsistent`.
  for (const [label, file, reason] of [
    ['A1of (inferred, operand level MISSING)', A1OF, 'inferred_identity_operand_missing'],
    ['A1zf (inferred, operand level ZERO)', A1ZF, 'inferred_identity_zero_level'],
  ] as const) {
    it(`⭐ ${label}: 422 → 200 — withdrawn, asked ONCE more, named ${reason}, and the retry is byte-identical to C0`, async () => {
      const row = served(file);
      islSeq = [servedReject(row)];
      const res = await post(row.request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.analysis_status).not.toBe('blocked');
      expect(islBodies).toHaveLength(2);
      expect(occurrences(islBodies[0])).toBe(1);
      expect(occurrences(islBodies[1])).toBe(0);
      expect(JSON.stringify(islBodies[1])).not.toContain('"execution_frame"');
      expect(body._meta?.identities_not_forwarded).toEqual([{ node_id: 'mrr', reason, frameless_node_ids: [] }]);
      const retried = islBodies[1];

      // C0 — the same request with no identity: the Run PLoT asks ISL for after the withdrawal IS C0's, byte for byte.
      const c0 = await post(withoutIdentity(row.request));
      expect(c0.status).toBe(200);
      expect(islBodies).toHaveLength(1);
      expect(JSON.stringify(retried)).toBe(JSON.stringify(islBodies[0]));
      const c0Body = await c0.json();
      expect(c0Body._meta?.identities_not_forwarded).toBeUndefined();
      // Effects: PLoT's own content hash — the public surface less `_meta` and the per-run volatile set (critique UUIDs,
      // timestamps, `fact_objects`) — recomputed here, and the effect blocks themselves, byte for byte.
      expect(computeResponseContentHash(body)).toBe(computeResponseContentHash(c0Body));
      expect(body._meta?.response_content_hash).toBe(c0Body._meta?.response_content_hash);
      for (const block of ['option_comparison', 'factor_sensitivity', 'driver_order', 'edge_sensitivity', 'robustness', 'flip_thresholds', 'constraint_results']) {
        expect(body[block], block).toBeDefined();
        expect(JSON.stringify(body[block]), block).toBe(JSON.stringify(c0Body[block]));
      }
    });
  }

  it('A1if (inferred, INCONSISTENT) — #385\'s row unchanged: withdrawn with ISL\'s own figures, exactly as served', async () => {
    // A1if's first-call 422 never surfaced (#385 withdrew it); ISL's critique for the same graph is A1is's (PRECONDITION).
    islSeq = [servedReject(served(A1IS))];
    const res = await post(served(A1IF).request);
    expect(res.status).toBe(200);
    expect(islBodies).toHaveLength(2);
    expect((await res.json())._meta?.identities_not_forwarded).toEqual(served(A1IF).response._meta.identities_not_forwarded);
    expect(served(A1IF).response._meta.identities_not_forwarded).toEqual([{
      node_id: 'mrr', reason: 'inferred_identity_inconsistent', frameless_node_ids: [],
      reconciliation: { reconstructed: 74500, stated: 93125, mismatch_share: 0.2 },
    }]);
  });

  // CONTROLS — a STATED identity keeps ISL's refusal: one call, 422, ISL's critique carried, nothing withdrawn.
  for (const [label, file] of [
    ['A1o (stated, operand level MISSING)', A1O],
    ['A1zs (stated, operand level ZERO)', A1ZS],
    ['A1is (stated, INCONSISTENT)', A1IS],
  ] as const) {
    it(`CONTROL ${label}: stays 422 — one ISL call, ISL's own critique returned, nothing withdrawn`, async () => {
      const row = served(file);
      islSeq = [servedReject(row)];
      const res = await post(row.request);
      expect(res.status).toBe(422);
      expect(islBodies).toHaveLength(1);
      const body = await res.json();
      const blocker = (body.critiques as any[]).find((c) => c.code === 'IDENTITY_NOT_EVALUATED');
      expect(blocker?.id).toBe(islCritiquesOf(row)[0].id);
      expect(blocker?.identity).toEqual(islCritiquesOf(row)[0].identity);
      expect(body._meta?.identities_not_forwarded).toBeUndefined();
    });
  }

  // "Must not withdraw a STATED identity under ANY reason" — every reason in ISL's enum (14f1a3a identity_evaluation.py).
  for (const reason of ['identity_frame_missing', 'identity_operand_missing', 'identity_zero_level', 'identity_inconsistent']) {
    it(`CONTROL a STATED identity withheld as ${reason} keeps the refusal — one call, 422`, async () => {
      const row = served(A1O);
      islSeq = [servedReject(row, islCritiquesOf(row).map((c) => withReason(c, reason)))];
      const res = await post(row.request);
      expect(res.status).toBe(422);
      expect(islBodies).toHaveLength(1);
      expect(occurrences(islBodies[0])).toBe(1);
    });
  }

  it('ANY reason: an inferred identity ISL withheld as identity_frame_missing is withdrawn too, named inferred_identity_frame_missing', async () => {
    const row = served(A1OF);
    islSeq = [servedReject(row, islCritiquesOf(row).map((c) => withReason(c, 'identity_frame_missing')))];
    const res = await post(row.request);
    expect(res.status).toBe(200);
    expect(islBodies).toHaveLength(2);
    expect((await res.json())._meta?.identities_not_forwarded)
      .toEqual([{ node_id: 'mrr', reason: 'inferred_identity_frame_missing', frameless_node_ids: [] }]);
  });

  // AIQ #72 5869104258 (merge-order condition on ISL #199): ANY ISL withheld reason withdraws an INFERRED identity —
  // matched by shape, not a list — so a reason ISL adds later can never refuse a Run over an identity nobody stated.
  for (const reason of ['identity_scale_out_of_range', 'identity_unknown_future_reason']) {
    it(`⭐ RED (AIQ 5869104258): an inferred identity ISL withholds as "${reason}" is withdrawn and named, 2 calls, 200`, async () => {
      const row = served(A1OF);
      islSeq = [servedReject(row, islCritiquesOf(row).map((c) => withReason(c, reason)))];
      const res = await post(row.request);
      expect(res.status).toBe(200);
      expect(islBodies).toHaveLength(2);
      expect((await res.json())._meta?.identities_not_forwarded)
        .toEqual([{ node_id: 'mrr', reason: `inferred_${reason}`, frameless_node_ids: [] }]);
    });
  }

  it('CONTROL: the same new reason on a STATED identity keeps ISL\'s refusal — 1 call, 422', async () => {
    const row = served(A1OF);
    const request = structuredClone(row.request);
    request.graph.nodes.find((n: any) => n.id === 'mrr').nonlinear_identity.stated_in_brief = true;
    islSeq = [servedReject(row, islCritiquesOf(row).map((c) => withReason(c, 'identity_scale_out_of_range')))];
    const res = await post(request);
    expect(res.status).toBe(422);
    expect(islBodies).toHaveLength(1);
  });

  for (const bad of [undefined, '', 'Identity Scale Out Of Range', 'scale_out_of_range']) {
    it(`CONTRAST: a critique with no ISL-typed reason (${JSON.stringify(bad)}) keeps the refusal — 1 call, 422`, async () => {
      const row = served(A1OF);
      islSeq = [servedReject(row, islCritiquesOf(row).map((c) => withReason(c, bad as string)))];
      const res = await post(row.request);
      expect(res.status).toBe(422);
      expect(islBodies).toHaveLength(1);
    });
  }

  /** A1of plus a SECOND identity, on `pro_paying_subscribers` (monthly_new × monthly_churn — every participant framed). */
  const twoIdentities = (secondStated: boolean): any => {
    const request = structuredClone(served(A1OF).request);
    request.graph.nodes.find((n: any) => n.id === 'pro_paying_subscribers').nonlinear_identity = {
      operation: 'product', factor_ids: ['monthly_new_pro_subscribers', 'monthly_churn'], stated_in_brief: secondStated,
    };
    return request;
  };
  const secondCritique = (withheld_reason: string) => ({
    ...islCritiquesOf(served(A1OF))[0],
    id: 'critique_second_identity',
    affected_node_ids: ['pro_paying_subscribers', 'monthly_new_pro_subscribers', 'monthly_churn'],
    identity: { node_id: 'pro_paying_subscribers', operation: 'product', participants: ['monthly_new_pro_subscribers', 'monthly_churn'], withheld_reason },
  });

  it('PRECONDITION — both identities of the two-identity request reach ISL (every participant framed)', async () => {
    const res = await post(twoIdentities(false));
    expect(res.status).toBe(200);
    expect(occurrences(islBodies[0])).toBe(2);
  });

  it('ONE retry, never a loop: the retry refused over a STILL-declared inferred identity returns that refusal — 2 calls, 422', async () => {
    const row = served(A1OF);
    islSeq = [servedReject(row), servedReject(row, [secondCritique('identity_zero_level')])];
    const res = await post(twoIdentities(false));
    expect(res.status).toBe(422);
    expect(islBodies).toHaveLength(2);
    expect(occurrences(islBodies[1])).toBe(1);
    expect(((await res.json()).critiques as any[]).map((c) => c.id)).toContain('critique_second_identity');
  });

  it('CONTROL: an inferred identity beside a STATED one, both withheld in one 422 — nothing is withdrawn; one call, 422', async () => {
    const row = served(A1OF);
    islSeq = [servedReject(row, [...islCritiquesOf(row), secondCritique('identity_operand_missing')])];
    const res = await post(twoIdentities(true));
    expect(res.status).toBe(422);
    expect(islBodies).toHaveLength(1);
    expect(occurrences(islBodies[0])).toBe(2);
  });
});
