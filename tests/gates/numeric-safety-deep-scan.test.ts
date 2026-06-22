/**
 * SCIENTIFIC REGRESSION GATE — WP5: Numeric safety
 * ----------------------------------------------------------------------------
 * Proves the public /v2/run response carries no non-finite numbers and no
 * fabricated nulls/strings even when ISL emits NaN / ±Infinity from a
 * degenerate Monte Carlo run.
 *
 * IMPORTANT (why we scan the RAW payload, not just parsed JSON): Fastify's
 * serialiser turns NaN / ±Infinity into `null` (or string-interpolates them
 * into narrative text like "Infinity%"). So parsing with res.json() and
 * scanning for NaN finds nothing — the artefact has already mutated. We
 * therefore assert on BOTH (a) the raw serialised string and (b) the parsed
 * structure (absence vs fabricated null).
 *
 * Guards pinned by this gate (additive, backwards-compatible — landed this lane):
 *   - run.ts: option_comparison[].win_probability / probability_of_goal are
 *     OMITTED (honest absence) when ISL returns a non-finite value — never a
 *     fabricated `null` on a declared-numeric probability field.
 *   - src/coaching/headlines.ts: a non-finite winProbability renders an honest
 *     number-free "Runner-up" label, never "Infinity% win probability".
 *
 * Already covered elsewhere (NOT duplicated): sanitiseIslVoi / VOI non-finite
 * rejection (tests/evpi-emission.test.ts, tests/gates/voi-enrichment-pin.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { normaliseValue, denormaliseValue } from '../../src/lib/intervention-normaliser.js';
import { sanitiseIslVoi } from '../../src/lib/evpi-emission.js';

const N = Number.NaN, PI = Number.POSITIVE_INFINITY, NI = Number.NEGATIVE_INFINITY;

// ---------------------------------------------------------------------------
// Reusable deep-scan helpers (no existing helper in the repo to reuse).
// ---------------------------------------------------------------------------

/** Collect dotted paths of every NUMBER that is NaN / ±Infinity anywhere in `obj`. */
function findNonFiniteNumbers(obj: unknown, path = '$', acc: string[] = []): string[] {
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) acc.push(`${path}=${obj}`);
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => findNonFiniteNumbers(v, `${path}[${i}]`, acc));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) findNonFiniteNumbers(v, `${path}.${k}`, acc);
  }
  return acc;
}

/** Collect dotted paths of every probability-named field that is explicitly `null`. */
function findNullProbabilityFields(obj: unknown, path = '$', acc: string[] = []): string[] {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => findNullProbabilityFields(v, `${path}[${i}]`, acc));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (v === null && /probability|prob_|_prob/i.test(k)) acc.push(`${path}.${k}`);
      findNullProbabilityFields(v, `${path}.${k}`, acc);
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Mocked ISL
// ---------------------------------------------------------------------------

function makePayload(opts: { nonFinite: boolean }) {
  return (options: any[]) => ({
    options: options.map((o: any, i: number) => ({
      option_id: o.id,
      win_probability: opts.nonFinite ? (i === 0 ? N : PI) : (i === 0 ? 0.72 : 0.28),
      probability_of_goal: opts.nonFinite ? NI : 0.6,
      expected_outcome: opts.nonFinite ? PI : 0.7,
      confidence_interval: opts.nonFinite ? [N, PI] : [0.5, 0.9],
      outcome: opts.nonFinite
        ? { mean: N, std: PI, p10: NI, p50: N, p90: PI, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 }
        : { mean: 0.7 - i * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 },
      rank: i + 1,
    })),
    edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2', edge_sensitivity_status: 'available',
    factors: [], factor_sensitivity: [], value_of_information: [],
    factors_provenance: 'unavailable', factor_sensitivity_status: 'skipped_no_factor_values',
    overall_robustness: 'robust', robustness_score: opts.nonFinite ? N : 0.8,
    fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl',
  });
}

let payloadFn = makePayload({ nonFinite: true });

const svc: any = {
  isEnabled: () => true, isAvailable: async () => true,
  validateCausal: async () => ({ status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'm', reasoning: 't' }, source: 'isl' }),
  analyseSensitivity: async () => ({ overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' }),
  analyseRobustness: async (_g: any, _n: string, o: any[]) => payloadFn(o),
  analyseFactorSensitivity: async () => ({ factors: [], value_of_information: [], robustness_label: 'robust', robustness_score: 0.8, latency_ms: 0, source: 'unavailable' }),
  computeCounterfactual: async () => { throw new Error('no'); },
  callAnalysisEndpoint: async (_e: string, b: any) => ({ data: payloadFn(b.options || []), error: null }),
};

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const a = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...a, getISLService: () => svc, islService: svc };
});

const { createServer } = await import('../../src/createServer.js');

const GRAPH_PAYLOAD = {
  graph: {
    nodes: [{ id: 'goal', kind: 'goal', label: 'G' }, { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 100 } }],
    edges: [{ from: 'f', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
  },
  options: [{ id: 'opt1', label: 'O1', interventions: { f: 120 } }, { id: 'opt2', label: 'O2', interventions: { f: 80 } }],
  goal_node_id: 'goal', seed: '42',
};

async function run(app: FastifyInstance) {
  const res = await app.inject({ method: 'POST', url: '/v2/run', headers: { 'content-type': 'application/json' }, payload: GRAPH_PAYLOAD });
  return res;
}

// ---------------------------------------------------------------------------
// Unit: the seam and the boundary guard
// ---------------------------------------------------------------------------

describe('WP5 gate · numeric seam + boundary guard (unit)', () => {
  it('normaliseValue(NaN) propagates NaN — the seam non-finite must be caught at boundaries', () => {
    const { normalised } = normaliseValue(N, { min: 0, max: 1, source: 'default' });
    expect(Number.isNaN(normalised)).toBe(true); // documents the seam: arithmetic does not self-guard
    expect(Number.isNaN(denormaliseValue(N, { min: 0, max: 1, source: 'default' }))).toBe(true);
  });

  it('sanitiseIslVoi rejects every non-finite value (NaN/±Infinity → undefined)', () => {
    for (const v of [N, PI, NI, -0.001]) expect(sanitiseIslVoi(v)).toBeUndefined();
    expect(sanitiseIslVoi(0)).toBe(0);   // explicit 0 preserved
    expect(sanitiseIslVoi(0.5)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Integration: non-finite ISL outcomes must not leak anywhere
// ---------------------------------------------------------------------------

describe('WP5 gate · non-finite ISL outcomes do not leak into the public response', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    payloadFn = makePayload({ nonFinite: true });
    app = await createServer();
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('RAW payload contains no "Infinity" / "NaN" token or interpolation (catches narrative leaks)', async () => {
    const res = await run(app);
    expect(res.statusCode).toBe(200);
    expect(res.payload.includes('Infinity')).toBe(false);
    expect(res.payload.includes('NaN')).toBe(false);
  });

  it('parsed response has no non-finite numbers and no fabricated null on probability fields', async () => {
    const res = await run(app);
    const body = res.json();
    expect(findNonFiniteNumbers(body)).toEqual([]);          // none survive parsing as numbers either
    expect(findNullProbabilityFields(body)).toEqual([]);     // honest ABSENCE, never null
  });

  it('REGRESSION: non-finite win_probability / probability_of_goal are OMITTED, not null', async () => {
    const res = await run(app);
    const oc = (res.json().option_comparison ?? []) as any[];
    expect(oc.length).toBeGreaterThan(0);
    for (const o of oc) {
      expect(o.win_probability ?? undefined).toBeUndefined();      // absent, not null
      expect(o.probability_of_goal ?? undefined).toBeUndefined();
      expect(o.win_probability).not.toBeNull();
      expect(o.probability_of_goal).not.toBeNull();
    }
  });

  it('status honestly degrades when outcomes are non-finite (not a confident 200)', async () => {
    const res = await run(app);
    const body = res.json();
    // Either the overall analysis or the robustness sub-status reflects the degradation.
    const degraded = body.analysis_status === 'partial' || body.analysis_status === 'failed'
      || body.robustness_status === 'unavailable';
    expect(degraded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: finite outcomes — probabilities are finite and bounded
// ---------------------------------------------------------------------------

describe('WP5 gate · finite outcomes are finite and within [0,1]', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    payloadFn = makePayload({ nonFinite: false });
    app = await createServer();
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('every public win_probability / probability_of_goal is finite and in [0,1]', async () => {
    const res = await run(app);
    expect(res.statusCode).toBe(200);
    const oc = (res.json().option_comparison ?? []) as any[];
    for (const o of oc) {
      for (const key of ['win_probability', 'probability_of_goal'] as const) {
        if (o[key] !== undefined && o[key] !== null) {
          expect(Number.isFinite(o[key])).toBe(true);
          expect(o[key]).toBeGreaterThanOrEqual(0);
          expect(o[key]).toBeLessThanOrEqual(1);
        }
      }
    }
    // And the whole response is finite.
    expect(findNonFiniteNumbers(res.json())).toEqual([]);
  });
});
