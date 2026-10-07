/**
 * event_risk.v1 (Science 393023 pilot §4; lane EVENT-RISK, DL 0fd71f, 7 Oct 2026): PLoT carries a risk node's
 * `event_risk` to ISL VERBATIM, refuses a malformed one (422, never drops it), and FAILS CLOSED when ISL does not echo
 * that it applied it (an ISL that drops the key would run "may happen" as "never happens").
 *
 * RED on base 0f21df07: `normaliseNode` and `toISLNode` rebuild nodes from allowlists, so the key reached ISL 0 times
 * (count per hop CEE→PLoT 1, PLoT→ISL 0), and nothing checked an echo.
 *
 * The request is Paul's own CEE→PLoT capture (`paul-own-a295e4a1-20260927`) with ONE edit: its risk node
 * `price_sensitivity` carries an event_risk block. (ISL would refuse this graph's driver parent with a typed 422;
 * the mocked ISL here tests only PLoT's carry and echo.)
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
import { NormalisationError, normaliseNode, readEventRisk } from '../src/normalisation/graph-normaliser.js';
import { toISLNode } from '../src/integrations/isl/translator-v3.js';
import { eventRiskEchoMatches, eventRiskIdsSent } from '../src/integrations/isl/event-risk.js';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/paul-own-a295e4a1-20260927');
const EVENT_RISK = {
  version: 1,
  occurrence: { p_low: 0.05, p_high: 0.15, basis: 'reference' },
  horizon: { months: 12 },
  mitigations: [{ factor_id: 'pro_plan_price', occurrence_reduction: 0.7 }],
};
const ECHO = { event_risks_applied: [{ node_id: 'price_sensitivity', occurrence_used: 0.1, p_low: 0.05, p_high: 0.15, range_width_propagated: false }] };

function paulRequest(eventRisk?: unknown): any {
  const d = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'cee-to-plot.request.json'), 'utf8'));
  if (eventRisk !== undefined) {
    d.graph.nodes.find((n: any) => n.id === 'price_sensitivity').event_risk = eventRisk;
  }
  return d;
}

function occurrences(body: unknown): number {
  return (JSON.stringify(body).match(/"event_risk"/g) ?? []).length;
}

describe('event_risk unit — normaliseNode / toISLNode carry it verbatim or refuse it', () => {
  const risk = { id: 'supplier_fails', kind: 'risk', label: 'Key supplier fails', event_risk: EVENT_RISK } as any;

  it('carries a v1 block verbatim through BOTH rebuilds (a deep copy, never the caller\'s object)', () => {
    const engine = normaliseNode(risk);
    expect(engine.event_risk).toEqual(EVENT_RISK);
    const isl = toISLNode(engine);
    expect(isl.event_risk).toEqual(EVENT_RISK);
    expect(isl.event_risk).not.toBe(EVENT_RISK);
  });

  it('reads it from `data` too, like every other upstream field', () => {
    const engine = normaliseNode({ id: 'r', kind: 'risk', label: 'R', data: { event_risk: EVENT_RISK } } as any);
    expect(engine.event_risk).toEqual(EVENT_RISK);
  });

  it('a node without it is byte-identical to before (no key at all), risk or not', () => {
    for (const kind of ['risk', 'factor']) {
      const plain = toISLNode(normaliseNode({ id: 'n', kind, label: 'N' } as any));
      expect('event_risk' in plain).toBe(false);
    }
  });

  it.each([
    ['not an object', 'x', 'risk', 'event_risk'],
    ['an unknown key', { ...EVENT_RISK, likelihood: 0.1 }, 'risk', 'event_risk.likelihood'],
    ['version 2', { ...EVENT_RISK, version: 2 }, 'risk', 'event_risk.version'],
    ['no occurrence', { ...EVENT_RISK, occurrence: undefined }, 'risk', 'event_risk'],
    ['mitigations not a list', { ...EVENT_RISK, mitigations: { factor_id: 'x' } }, 'risk', 'event_risk.mitigations'],
    ['on a factor node', EVENT_RISK, 'factor', 'event_risk'],
  ])('REFUSES %s — never drops it', (_label, block, kind, field) => {
    let thrown: unknown;
    try {
      readEventRisk({ id: 'n', kind, event_risk: block } as any, kind as string);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NormalisationError);
    expect((thrown as NormalisationError).field).toBe(field);
  });
});

describe('event_risk unit — the echo check', () => {
  it('is vacuous when nothing was sent (legacy requests are never checked)', () => {
    expect(eventRiskEchoMatches([], {})).toBe(true);
    expect(eventRiskEchoMatches([], null)).toBe(true);
  });

  it('passes only when ISL names exactly the risks sent', () => {
    expect(eventRiskEchoMatches(['price_sensitivity'], ECHO)).toBe(true);
    expect(eventRiskEchoMatches(['price_sensitivity'], { _metadata: ECHO })).toBe(true);
    expect(eventRiskEchoMatches(['price_sensitivity'], {})).toBe(false);
    expect(eventRiskEchoMatches(['price_sensitivity'], { event_risks_applied: [] })).toBe(false);
    expect(eventRiskEchoMatches(['a', 'price_sensitivity'], ECHO)).toBe(false);
    expect(eventRiskEchoMatches(['other'], ECHO)).toBe(false);
  });

  it('sent ids are the nodes that carry the key, sorted', () => {
    expect(eventRiskIdsSent([{ id: 'b', event_risk: {} }, { id: 'c' }, { id: 'a', event_risk: {} }])).toEqual(['a', 'b']);
  });
});

describe("event_risk route — Paul's request: the block reaches ISL once, verbatim, or the run is refused", () => {
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
  afterEach(() => { islNext = null; islSeq = []; });

  it('PRECONDITION — CEE→PLoT carries it once', () => {
    expect(occurrences(paulRequest(EVENT_RISK))).toBe(1);
  });

  it('PLoT→ISL carries it once, on price_sensitivity, verbatim; with the echo the run computes', async () => {
    islNext = { extra: ECHO };
    const res = await post(paulRequest(EVENT_RISK));
    expect(res.status).toBe(200);
    expect(islBodies.length).toBeGreaterThan(0);
    for (const body of islBodies) {
      expect(occurrences(body)).toBe(1);
      expect(body.graph.nodes.find((n: any) => n.id === 'price_sensitivity').event_risk).toEqual(EVENT_RISK);
    }
  });

  it('FAILS CLOSED (502 EVENT_RISK_NOT_APPLIED) when ISL does not echo the event it was sent', async () => {
    const res = await post(paulRequest(EVENT_RISK));
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('EVENT_RISK_NOT_APPLIED');
  });

  it('CONTROL — the same request without the block sends none and is never echo-checked', async () => {
    const res = await post(paulRequest());
    expect(res.status).toBe(200);
    for (const body of islBodies) expect(occurrences(body)).toBe(0);
  });

  it('a malformed block is refused at the door (422, the normaliser\'s refusal), never dropped', async () => {
    const res = await post(paulRequest({ ...EVENT_RISK, version: 2 }));
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('event_risk.version');
    expect(islBodies.length).toBe(0);
  });
});
