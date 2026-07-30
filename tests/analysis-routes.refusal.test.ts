/**
 * The withdrawn analysis routes must answer a typed 501 refusal — and must be
 * instrumented while they do it.
 *
 * TEN routes, THREE findings, one disposition.
 *
 * Seven `/v1/analysis/*` routes were ruled VACUOUS by the authenticity matrix
 * of 2026-07-26: each scored every option against the same shared graph with
 * only a loop-index-derived seed varying, so no option could ever be
 * distinguished from another. They now refuse instead of returning a
 * confident, option-blind answer.
 *
 * `/v1/sensitivity` and `/v1/score` were ruled FABRICATING by the numerics
 * science review of the same date, and independently re-verified here before
 * withdrawal. Those two are the worse case: a vacuous route returns nothing
 * useful, whereas these returned plausible numbers stamped
 * `inference_mode: 'model_based'` — a provenance claim for an inference that
 * never ran, which a caller has no way to detect.
 *
 * `/v1/counterfactual` was withdrawn 2026-07-30 (ROADMAP 2.105) as a
 * FABRICATION TRAP — the third finding, and the sharpest of the three. Its
 * estimate was placeholder arithmetic over two request fields
 * (`intervention.from_value * 100` / `intervention.to_value * 95`, both
 * self-commented `// Placeholder`) with `graph` never read, and it shipped behind
 * FOUR layers of real machinery: a model card asserting ceteris paribus and no
 * spillover, a confidence badge built from hard-coded `identifiable: true` /
 * `in_linear_range: true` literals (so pinned near its ceiling on every path), a
 * determinism stamp that held only because the output was a constant function of
 * the input, and `explain_delta` attributions computed over the placeholder
 * values. Where /v1/score fabricated a number, this fabricated the number AND the
 * evidence that the number was trustworthy.
 *
 * Assertions here are on the FULL HTTP ENVELOPE — status, headers and the
 * complete error.v1 body — not on handler internals. That is the contract an
 * integrator actually sees, and it is what a route test should pin.
 *
 * The refusal is deliberately UNCONDITIONAL: it precedes body validation, so a
 * malformed request gets the same 501 as a well-formed one. Returning 400 for
 * a bad body would imply that a good body would have been answered, which is
 * precisely the false impression this change exists to remove. The
 * "well-formed request" case below is the one that matters most — it is the
 * request that used to produce a plausible number.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';
import {
  getRouteCallerSnapshot,
  resetRouteCallerTelemetry,
} from '../src/observability/routeCallerTelemetry.js';

/** The seven VACUOUS routes, each with a request that was well-formed for it. */
const VACUOUS: Array<{ route: string; payload: Record<string, unknown> }> = [
  {
    route: '/v1/analysis/dominance',
    payload: {
      seed: 4242,
      graph: {
        nodes: [
          { id: 'optA', label: 'A', kind: 'option', value: 10 },
          { id: 'optB', label: 'B', kind: 'option', value: 20 },
          { id: 'outcome', label: 'O', kind: 'outcome', value: 100 },
        ],
        edges: [
          { from: 'optA', to: 'outcome', weight: 0.5, belief: 0.9 },
          { from: 'optB', to: 'outcome', weight: 0.5, belief: 0.9 },
        ],
      },
    },
  },
  {
    route: '/v1/analysis/pareto',
    payload: {
      seed: 4242,
      graph: {
        nodes: [
          { id: 'optA', label: 'A', kind: 'option', value: 10 },
          { id: 'optB', label: 'B', kind: 'option', value: 20 },
          { id: 'outcome', label: 'O', kind: 'outcome', value: 100 },
        ],
        edges: [{ from: 'optA', to: 'outcome', weight: 0.5 }],
      },
    },
  },
  {
    route: '/v1/analysis/multi-criteria',
    payload: {
      seed: 4242,
      criteria: [{ outcome_node: 'outcome', weight: 1 }],
      graph: {
        nodes: [
          { id: 'optA', label: 'A', kind: 'option', value: 10 },
          { id: 'optB', label: 'B', kind: 'option', value: 20 },
          { id: 'outcome', label: 'O', kind: 'outcome', value: 100 },
        ],
        edges: [{ from: 'optA', to: 'outcome', weight: 0.5 }],
      },
    },
  },
  {
    route: '/v1/analysis/risk-adjust',
    payload: {
      seed: 4242,
      risk_type: 'linear',
      risk_coefficient: 0.5,
      graph: {
        nodes: [
          { id: 'optA', label: 'A', kind: 'option', value: 10 },
          { id: 'optB', label: 'B', kind: 'option', value: 20 },
          { id: 'outcome', label: 'O', kind: 'outcome', value: 100 },
        ],
        edges: [{ from: 'optA', to: 'outcome', weight: 0.5 }],
      },
    },
  },
  {
    route: '/v1/analysis/thresholds',
    payload: {
      seed: 4242,
      sweeps: [{ node_id: 'driver', parameter: 'value', values: [1, 50] }],
      graph: {
        nodes: [
          { id: 'optA', label: 'A', kind: 'option', value: 10 },
          { id: 'optB', label: 'B', kind: 'option', value: 20 },
          { id: 'driver', label: 'D', kind: 'factor', value: 5 },
          { id: 'outcome', label: 'O', kind: 'outcome', value: 100 },
        ],
        edges: [{ from: 'driver', to: 'outcome', weight: 0.2 }],
      },
    },
  },
  {
    route: '/v1/analysis/conditional-recommend',
    payload: {
      seed: 4242,
      conditions: [],
      graph: {
        nodes: [
          { id: 'optA', label: 'A', kind: 'option', value: 10 },
          { id: 'optB', label: 'B', kind: 'option', value: 20 },
          { id: 'outcome', label: 'O', kind: 'outcome', value: 100 },
        ],
        edges: [{ from: 'optA', to: 'outcome', weight: 0.5 }],
      },
    },
  },
  {
    route: '/v1/analysis/optimise',
    payload: {
      seed: 4242,
      decision_variable: 'driver',
      search_range: [0, 100],
      objective_node: 'outcome',
      grid_points: 20,
      graph: {
        nodes: [
          { id: 'driver', label: 'D', kind: 'factor', value: 5 },
          { id: 'outcome', label: 'O', kind: 'outcome', value: 100 },
        ],
        edges: [{ from: 'driver', to: 'outcome', weight: 0.2 }],
      },
    },
  },
];

/**
 * The two FABRICATING routes (numerics science review 2026-07-26). Different
 * finding, same disposition: /v1/sensitivity's tornado was a closed-form
 * function of the seed and each node's own value with `graph.edges` never read,
 * and /v1/score's utilities were a function of the seed and the node's ARRAY
 * INDEX with a constant 0.8-wide band. Both stamped
 * `inference_mode: 'model_based'` on output no inference produced.
 */
const FABRICATING: Array<{ route: string; payload: Record<string, unknown> }> = [
  {
    route: '/v1/sensitivity',
    payload: {
      seed: 4242,
      graph: {
        nodes: [
          { id: 'driver', label: 'D', value: 0.4 },
          { id: 'outcome', label: 'O', value: 0.6 },
        ],
        edges: [{ from: 'driver', to: 'outcome', weight: 0.5, belief: 0.9 }],
      },
    },
  },
  {
    route: '/v1/score',
    payload: {
      seed: 4242,
      graph: {
        nodes: [
          { id: 'optA', label: 'A', kind: 'option' },
          { id: 'optB', label: 'B', kind: 'option' },
        ],
        edges: [],
      },
      utilities: { type: 'linear', weights: { optA: 0.5, optB: 0.5 } },
    },
  },
];

/**
 * The FABRICATION-TRAP route (ROADMAP 2.105). The payload below is the one that
 * matters: perfectly well-formed, and exactly the shape that used to come back as
 * a confident counterfactual estimate with a near-ceiling confidence badge.
 */
const PLACEHOLDER: Array<{ route: string; payload: Record<string, unknown> }> = [
  {
    route: '/v1/counterfactual',
    payload: {
      seed: 4242,
      graph: {
        nodes: [
          { id: 'price', label: 'Price', value: 10 },
          { id: 'revenue', label: 'Revenue', value: 100 },
        ],
        edges: [{ from: 'price', to: 'revenue', weight: 0.5, belief: 0.9 }],
      },
      intervention: { node_id: 'price', from_value: 10, to_value: 12 },
      outcome_node: 'revenue',
    },
  },
];

const VACUOUS_REASON =
  'route computed no option-discriminating output; see authenticity matrix 2026-07-26';
const FABRICATING_REASON =
  'route published seed-derived numerics not computed from the request graph; see numerics science review 2026-07-26';
const PLACEHOLDER_REASON =
  'route published placeholder arithmetic over request inputs, not a computed estimate — no model was evaluated and the graph was never read; see ROADMAP 2.105';

/** All three groups, for the cross-cutting checks. */
const WITHDRAWN = [
  ...VACUOUS.map((c) => ({ ...c, reason: VACUOUS_REASON })),
  ...FABRICATING.map((c) => ({ ...c, reason: FABRICATING_REASON })),
  ...PLACEHOLDER.map((c) => ({ ...c, reason: PLACEHOLDER_REASON })),
];

let app: FastifyInstance;

const prevAuth = process.env.AUTH_ENABLED;
const prevSecret = process.env.TOKEN_HMAC_SECRET;

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.TOKEN_HMAC_SECRET =
    process.env.TOKEN_HMAC_SECRET ||
    'abc123456789012345678901234567890123456789012345678901234567890123';
  app = await createServer({});
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED;
  else process.env.AUTH_ENABLED = prevAuth;
  if (prevSecret === undefined) delete process.env.TOKEN_HMAC_SECRET;
  else process.env.TOKEN_HMAC_SECRET = prevSecret;
});

beforeEach(() => {
  resetRouteCallerTelemetry();
});

describe.each(WITHDRAWN)('$route — withdrawn', ({ route, payload, reason }) => {
  it('returns 501 with a JSON content type for a WELL-FORMED request', async () => {
    const res = await app.inject({ method: 'POST', url: route, payload });

    expect(res.statusCode).toBe(501);
    expect(String(res.headers['content-type'])).toContain('application/json');
  });

  it('returns the full error.v1 envelope with the exact typed refusal fields', async () => {
    const res = await app.inject({ method: 'POST', url: route, payload });
    const body = res.json();

    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('ANALYSIS_UNAVAILABLE');
    expect(body.reason).toBe(reason);
    expect(body.retryable).toBe(false);
    expect(body.source).toBe('plot');
    expect(typeof body.request_id).toBe('string');
    expect(body.request_id.length).toBeGreaterThan(0);
  });

  it('publishes NO numbers — no scores, no distributions, no ranking', async () => {
    const res = await app.inject({ method: 'POST', url: route, payload });
    const raw = res.body;

    for (const leak of [
      'option_results',
      'distribution',
      'pareto_optimal',
      'dominance_relationships',
      'recommendation',
      'optimal_value',
      'adjusted_rank',
      'provenance',
      'plot_fallback',
      'p50',
      'tornado',
      'evaluations',
      'inference_mode',
      'utility',
      // ROADMAP 2.105 — the four credibility layers /v1/counterfactual used to
      // ship around its placeholder estimate. `model_card` and `confidence` are
      // the load-bearing ones: they are what made the fabricated number read as
      // a measured one.
      'model_card',
      'confidence',
      'explain_delta',
      'identifiability',
      'adjustment_set',
      'baseline',
      'counterfactual.v1',
    ]) {
      expect(raw).not.toContain(leak);
    }
  });

  it('refuses a MALFORMED request identically — no input is valid for a withdrawn capability', async () => {
    const res = await app.inject({ method: 'POST', url: route, payload: {} });

    expect(res.statusCode).toBe(501);
    expect(res.json().code).toBe('ANALYSIS_UNAVAILABLE');
  });

  it('records the caller in the telemetry evidence', async () => {
    await app.inject({
      method: 'POST',
      url: route,
      headers: { origin: 'https://caller.test', 'user-agent': 'probe/1' },
      payload,
    });

    const s = getRouteCallerSnapshot();
    expect(s.refused_routes.by_route[route]).toBe(1);
    expect(s.refused_total).toBe(1);
    expect(s.refused_routes.callers.join(' ')).toContain('o:https://caller.test');
  });
});

describe('cross-cutting', () => {
  it('POSITIVE CONTROL: a surviving route on the same app still answers 200', async () => {
    // Without this, a server that 501'd everything would pass every assertion
    // above. /v1/limits is a live, unrelated route.
    const res = await app.inject({ method: 'GET', url: '/v1/limits' });

    expect(res.statusCode).toBe(200);
    expect(res.json().code).not.toBe('ANALYSIS_UNAVAILABLE');
  });

  it('all ten withdrawn routes are still MOUNTED — a 404 would destroy the evidence', async () => {
    for (const { route, payload } of WITHDRAWN) {
      const res = await app.inject({ method: 'POST', url: route, payload });
      expect(res.statusCode, `${route} must be 501, not 404`).toBe(501);
    }
  });

  it('the refusal is cheap — it does no inference', async () => {
    const t0 = Date.now();
    for (const { route, payload } of WITHDRAWN) {
      await app.inject({ method: 'POST', url: route, payload });
    }
    // The pre-change thresholds route alone ran 2 sweeps x 2 options of Monte
    // Carlo. Ten refusals must be trivially fast.
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
