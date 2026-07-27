/**
 * SCIENTIFIC REGRESSION GATE — WP5: Numeric safety + ABSENCE safety
 * ----------------------------------------------------------------------------
 * Proves the public /v2/run response carries no non-finite numbers and no
 * fabricated nulls/strings even when ISL emits NaN / ±Infinity from a
 * degenerate Monte Carlo run.
 *
 * ============================================================================
 * WHY THIS GATE GREW AN ABSENCE DIMENSION (ROADMAP 1.240, this lane)
 * ============================================================================
 * PR #277 fixed three instances of "PLoT fabricates a value or a verdict when
 * upstream data is absent" and — more usefully — named WHY the species kept
 * surviving. One of the two reasons was THIS FILE:
 *
 *     "tests/gates/numeric-safety-deep-scan.test.ts feeds NaN/±Infinity but
 *      never null — the estate's numeric-safety gate is blind to the exact
 *      shape ISL actually sends."
 *
 * That blindness is what made the class structurally invisible. Every `?? 0`,
 * `|| default` and `!== undefined` guard that fabricates on a NULL upstream
 * field passed this gate, because this gate never sent one. The instrument
 * agreed with the code about which shapes exist, so it could only ever confirm
 * what the code already assumed.
 *
 * The extension below feeds THREE DISTINCT ABSENCE SHAPES through the same
 * surfaces this file already exercises with NaN/±Infinity, plus the constraint
 * margins and the validation status where the known instances lived.
 *
 * REACHABILITY OF EACH SHAPE — stated, not assumed:
 *
 *   `null`         WIRE-REACHABLE, and MEASURED on the deployed service. ISL
 *                  sends `constraint_id: null`, `failure_margin_median: null`,
 *                  `near_miss_fraction: null` (captured at the wire by the #276
 *                  lane; recorded in src/integrations/isl/types/isl-types.ts).
 *                  This is the shape that fabricated in production code and it
 *                  is the primary arm of every case below.
 *
 *   missing key    WIRE-REACHABLE. ISL's route serialises with
 *                  `exclude_none=True`, so top-level optional fields are simply
 *                  absent. Reads identically to `undefined` in JS, which is
 *                  exactly why the two were conflated.
 *
 *   `undefined`    NOT wire-reachable — JSON has no `undefined`, so no ISL
 *                  response can carry one. It IS reachable for IN-PROCESS
 *                  callers of the adapters (§D below, and PLoT's own
 *                  intermediate values), so it is exercised at the unit seam
 *                  and deliberately NOT claimed as a wire case.
 *
 * WHAT THIS GATE DOES NOT REACH — stated so the coverage is not over-read:
 *   - The HTTP wire itself. §C stimulates the validation-absent path through
 *     the REAL `createFallbackValidation` adapter, not through a stubbed
 *     socket. The wire → fallback leg (404 / timeout / 5xx / breaker) is
 *     covered by tests/isl-validation-unavailable-no-fabricated-verdict.test.ts,
 *     which stubs global fetch and drives the real ISLClient.
 *   - `/v1/run`'s dev-only sibling surfaces (PlcLab, SandboxV1, PlotShowcase,
 *     EngineAuditPanel) — not traced by this lane.
 *   - `analyseSensitivity` / `analyseFactorSensitivity` /
 *     `computeCounterfactual` and their fallbacks. #277 proved those producers
 *     have ZERO call sites; their `?? 0.5` / `'moderate'` fabrications are the
 *     same species but are queued for deletion as their own slice, so pinning
 *     them here would pin code that is scheduled to disappear.
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

// Numeric-named fields on the option_comparison egress that this lane guards.
// A `null` on any of these is a FABRICATED null (Fastify serialising a non-finite
// ISL number) — the probability-name regex above does NOT match the outcome
// statistics (mean/std/p10/p50/p90/validity_ratio), so they need this explicit set.
const NUMERIC_EGRESS_FIELD =
  /^(mean|std|p10|p50|p90|validity_ratio|win_probability|probability_of_goal|probability_of_joint_goal|prob_satisfied|probability|expected_outcome)$/;

/** Collect dotted paths of every numeric-egress field that is explicitly `null`. */
function findNullNumericFields(obj: unknown, path = '$', acc: string[] = []): string[] {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => findNullNumericFields(v, `${path}[${i}]`, acc));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (v === null && NUMERIC_EGRESS_FIELD.test(k)) acc.push(`${path}.${k}`);
      findNullNumericFields(v, `${path}.${k}`, acc);
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

/**
 * What `validateCausal` returns on the next call. Mutable so §C can swap a
 * genuine ISL verdict for the REAL `createFallbackValidation` output without a
 * second module mock. Default is a genuine 'identifiable' so every pre-existing
 * assertion in this file is unaffected.
 */
let validateFn: () => Promise<any> = async () => ({
  status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
  backdoor_paths: [], issues: [], explanation: { summary: 'm', reasoning: 't' }, source: 'isl',
});

const svc: any = {
  isEnabled: () => true, isAvailable: async () => true,
  validateCausal: async () => validateFn(),
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
  });

  it('denormaliseValue(NaN) SELF-GUARDS to undefined (ROADMAP 1.277) — no longer a bare seam', () => {
    // This assertion used to read `Number.isNaN(denormaliseValue(N, …)) === true`,
    // asserting that denormaliseValue was an unguarded seam like its sibling above.
    // ROADMAP 1.277 deliberately ENDED that: the primitive now finite-checks its
    // input, because the sibling `normaliseValue` shape was letting `null` — which
    // coerces to 0, NOT to NaN — fabricate the range floor as a plausible
    // measurement that no downstream finiteness check could detect.
    //
    // The half that still matters is unchanged and is asserted above:
    // `normaliseValue` remains an unguarded seam, so boundary guards are still
    // required there. Only denormaliseValue moved.
    expect(denormaliseValue(N, { min: 0, max: 1, source: 'default' })).toBeUndefined();
    expect(denormaliseValue(null, { min: 10, max: 20, source: 'default' })).toBeUndefined();
    // Positive control: a real measurement is untouched.
    expect(denormaliseValue(0.5, { min: 0, max: 1, source: 'default' })).toBe(0.5);
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

  it('REGRESSION: no numeric-egress field is a fabricated null (outcome statistics included)', async () => {
    // Catches the gap a probability-name regex misses: outcome mean/std/p10/p50/p90
    // serialised to `null` from a non-finite ISL value.
    const res = await run(app);
    expect(findNullNumericFields(res.json())).toEqual([]);
  });

  it('REGRESSION: a non-finite outcome omits the WHOLE outcome object (never partial nulls)', async () => {
    // The fixture makes every required stat (mean/p10/p50/p90) non-finite, so the
    // entire outcome is omitted (honest absence) rather than emitting null stats.
    const res = await run(app);
    const oc = (res.json().option_comparison ?? []) as any[];
    expect(oc.length).toBeGreaterThan(0);
    for (const o of oc) {
      expect(o.outcome ?? undefined).toBeUndefined();
      expect(o.outcome).not.toBeNull();
    }
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

  it('REGRESSION (Codex round-2): option_comparison_status is NOT "computed" when no option has a usable outcome', async () => {
    // Every option's required outcome is non-finite (omitted) → status must reflect
    // that there is no usable comparison, not report a confident "computed".
    const res = await run(app);
    expect(res.json().option_comparison_status).not.toBe('computed');
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

// ---------------------------------------------------------------------------
// Codex round-2: out-of-RANGE (finite but invalid) option_comparison values.
// Round-1 guarded only non-finite; a finite 1.5 probability still passed.
// ---------------------------------------------------------------------------

describe('numeric-egress gate · out-of-range option_comparison values are omitted', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    payloadFn = (options: any[]) => ({
      options: options.map((o: any, i: number) => ({
        option_id: o.id,
        win_probability: 1.5,        // > 1 → must be OMITTED (impossible probability)
        probability_of_goal: 1.5,    // > 1 → omitted
        expected_outcome: 0.7,
        outcome: { mean: 0.7 - i * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: -5, n_valid_samples: 1000, validity_ratio: 1.5 },
        rank: i + 1,
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2', edge_sensitivity_status: 'available',
      factors: [], factor_sensitivity: [], value_of_information: [],
      factors_provenance: 'unavailable', factor_sensitivity_status: 'skipped_no_factor_values',
      overall_robustness: 'robust', robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl',
    });
    app = await createServer();
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('REGRESSION: win_probability / probability_of_goal > 1 are OMITTED (not emitted as 1.5)', async () => {
    const res = await run(app);
    expect(res.statusCode).toBe(200);
    const oc = (res.json().option_comparison ?? []) as any[];
    expect(oc.length).toBeGreaterThan(0);
    for (const o of oc) {
      expect(o.win_probability ?? undefined).toBeUndefined();
      expect(o.probability_of_goal ?? undefined).toBeUndefined();
    }
  });

  it('REGRESSION: out-of-range validity_ratio (>1) and negative n_samples are omitted; valid stats kept', async () => {
    const res = await run(app);
    const oc = (res.json().option_comparison ?? []) as any[];
    for (const o of oc) {
      expect(o.outcome?.mean).toBeDefined();                         // outcome still emitted (required stats finite)
      expect(o.outcome?.validity_ratio ?? undefined).toBeUndefined(); // 1.5 dropped
      expect(o.outcome?.n_samples ?? undefined).toBeUndefined();      // -5 dropped
      expect(o.outcome?.n_valid_samples).toBe(1000);                  // valid count kept
    }
    // No fabricated null on any numeric-egress field in the raw payload either.
    expect(findNullNumericFields(res.json())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Codex round-3 #2: ONE required outcome quantile invalid (finite mean, NaN p10)
// must omit the WHOLE outcome AND make status not 'computed' — the serialiser and
// the status derivation must use the SAME all-required-stats predicate.
// ---------------------------------------------------------------------------

describe('numeric-egress gate · a single invalid required outcome quantile omits outcome AND degrades status', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    payloadFn = (options: any[]) => ({
      options: options.map((o: any, i: number) => ({
        option_id: o.id,
        win_probability: i === 0 ? 0.7 : 0.3,
        probability_of_goal: 0.6,
        expected_outcome: 0.7,  // legacy/finite — must NOT count toward usability
        // mean/p50/p90 finite but p10 = NaN → a REQUIRED quantile is invalid.
        outcome: { mean: 0.7, std: 0.1, p10: N, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 },
        rank: i + 1,
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2', edge_sensitivity_status: 'available',
      factors: [], factor_sensitivity: [], value_of_information: [],
      factors_provenance: 'unavailable', factor_sensitivity_status: 'skipped_no_factor_values',
      overall_robustness: 'robust', robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl',
    });
    app = await createServer();
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('REGRESSION: finite mean + NaN p10 ⇒ outcome omitted on every option', async () => {
    const res = await run(app);
    expect(res.statusCode).toBe(200);
    const oc = (res.json().option_comparison ?? []) as any[];
    expect(oc.length).toBeGreaterThan(0);
    for (const o of oc) {
      expect(o.outcome ?? undefined).toBeUndefined();   // whole outcome omitted (a required quantile is invalid)
      expect(o.outcome).not.toBeNull();
    }
    expect(findNullNumericFields(res.json())).toEqual([]);
  });

  it('REGRESSION: status is NOT "computed" when the public outcome was omitted (shared predicate)', async () => {
    const res = await run(app);
    // expected_outcome is finite but is NOT emitted in V2, so it must not rescue status.
    expect(res.json().option_comparison_status).not.toBe('computed');
  });
});

// ===========================================================================
// ===========================================================================
//  ABSENCE-SHAPE COVERAGE (ROADMAP 1.240)
//
//  Everything below feeds `null` / missing-key / `undefined` where the blocks
//  above feed NaN / ±Infinity. See the file header for the reachability of
//  each shape and for what this gate does NOT reach.
//
//  RETRO-PROOF. This gate was run against the PRE-#277 tree (c79c63c1) in a
//  throwaway worktree outside the repo root. §B and §C turn RED there on the
//  three defects #277 fixed, which is the evidence that the extension is not
//  vacuous: a gate that would not have caught the KNOWN defects cannot be
//  trusted to catch the next one. Per-block results are recorded in the PR.
// ===========================================================================
// ===========================================================================

/** The three absence shapes, applied to one key of an object. */
const ABSENCE_SHAPES = ['null', 'missing', 'undefined'] as const;
type AbsenceShape = (typeof ABSENCE_SHAPES)[number];

/**
 * Return `{ [key]: <shape> }` — or `{}` for the missing-key shape.
 * Spread into a fixture so one matrix drives all three shapes.
 */
function absent(key: string, shape: AbsenceShape): Record<string, unknown> {
  if (shape === 'missing') return {};
  return { [key]: shape === 'null' ? null : undefined };
}

/**
 * Collect dotted paths of every field named in `keys` that is PRESENT with a
 * number. Used to assert that a field whose upstream was ABSENT did not
 * reappear at egress carrying a plausible substitute (0, 0.5, 1, …).
 *
 * This is the assertion the NaN/Infinity blocks above could not make: a
 * fabricated 0 is finite, in range, and serialises perfectly, so every
 * finiteness and range check passes it through.
 */
function findPresentNumbers(obj: unknown, keys: Set<string>, path = '$', acc: string[] = []): string[] {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => findPresentNumbers(v, keys, `${path}[${i}]`, acc));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (keys.has(k) && typeof v === 'number') acc.push(`${path}.${k}=${v}`);
      findPresentNumbers(v, keys, `${path}.${k}`, acc);
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// §A — /v2/run: the SAME option/outcome fields the NaN fixture exercises,
//      fed the three absence shapes instead.
//
// HONEST NOTE ON WHAT §A PROVES. These particular fields were already guarded
// absence-safely before #277 (`finiteNum` / `prob01` reject null as well as
// NaN), so §A does NOT turn red on the pre-#277 tree. It is not retro-evidence;
// it closes the SHAPE-BLINDNESS on the surface this gate already claimed to
// cover, so a future `?? 0` added to any of these fields fails here instead of
// shipping. §B and §C carry the retro-proof.
// ---------------------------------------------------------------------------

/** Every numeric egress key that must never be fabricated from an absent input. */
const NEVER_FABRICATE = new Set([
  'win_probability', 'probability_of_goal', 'expected_outcome',
  'mean', 'std', 'p10', 'p50', 'p90', 'validity_ratio', 'n_samples', 'n_valid_samples',
]);

function makeAbsencePayload(shape: AbsenceShape) {
  return (options: any[]) => ({
    options: options.map((o: any, i: number) => ({
      option_id: o.id,
      ...absent('win_probability', shape),
      ...absent('probability_of_goal', shape),
      ...absent('expected_outcome', shape),
      ...absent('confidence_interval', shape),
      outcome: {
        ...absent('mean', shape),
        ...absent('std', shape),
        ...absent('p10', shape),
        ...absent('p50', shape),
        ...absent('p90', shape),
        ...absent('n_samples', shape),
        ...absent('n_valid_samples', shape),
        ...absent('validity_ratio', shape),
      },
      rank: i + 1,
    })),
    edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2', edge_sensitivity_status: 'available',
    factors: [], factor_sensitivity: [], value_of_information: [],
    factors_provenance: 'unavailable', factor_sensitivity_status: 'skipped_no_factor_values',
    overall_robustness: 'robust',
    ...absent('robustness_score', shape),
    fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl',
  });
}

for (const shape of ABSENCE_SHAPES) {
  describe(`absence gate §A · /v2/run option outcomes absent as ${shape.toUpperCase()}`, () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      process.env.RATE_LIMIT_ENABLED = '0';
      process.env.CEE_ORCHESTRATOR_ENABLED = '0';
      payloadFn = makeAbsencePayload(shape);
      app = await createServer();
    });
    afterAll(async () => {
      await app?.close();
      delete process.env.RATE_LIMIT_ENABLED;
      delete process.env.CEE_ORCHESTRATOR_ENABLED;
    });

    it('no numeric-egress field is fabricated from an absent upstream value', async () => {
      const res = await run(app);
      expect(res.statusCode).toBe(200);
      const oc = (res.json().option_comparison ?? []) as any[];
      expect(oc.length, 'the gate must actually reach option_comparison').toBeGreaterThan(0);
      // The load-bearing assertion: NOTHING numeric survives from nothing.
      expect(findPresentNumbers(oc, NEVER_FABRICATE)).toEqual([]);
    });

    it('absent is ABSENT, never a fabricated null on a declared-numeric field', async () => {
      const res = await run(app);
      expect(findNullNumericFields(res.json())).toEqual([]);
      expect(findNullProbabilityFields(res.json())).toEqual([]);
      expect(findNonFiniteNumbers(res.json())).toEqual([]);
    });

    it('status honestly reports that nothing usable was computed', async () => {
      const res = await run(app);
      expect(res.json().option_comparison_status).not.toBe('computed');
    });
  });
}

// ---------------------------------------------------------------------------
// §B — /v2/run CONSTRAINT MARGINS. This is Instance B's surface and it is the
//      half of the retro-proof that lives on the numeric side.
//
// Pre-#277 the denormalisation guard was `fmm !== undefined`, so a wire `null`
// walked past it, `null * 60000` evaluated to 0, and `nonNeg(0)` blessed the
// result as a measured zero-margin breach — "this option breaches by exactly
// nothing" — which additionally unlocked `margin_precision: 'exact'`, a
// precision claim about a margin that was never computed.
//
// The scenario mirrors tests/constraint-margin-plumbing.test.ts (and the live
// staging probe it was built from) because the DENORMALISATION is what does the
// fabricating: `fac_cost` carries an explicit cap, so a normalisation range
// exists, so the multiply actually runs. Without the cap the range map is
// absent, the multiply is skipped, and the whole case passes vacuously.
// ---------------------------------------------------------------------------

const CONSTRAINT_GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Programme value', observed_state: { value: 0.4 } },
    { id: 'fac_cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 40000, cap: 60000, unit: '£' } },
  ],
  edges: [{ from: 'fac_cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } }],
};

const CONSTRAINT_OPTIONS = [
  { id: 'opt_under', label: 'Under budget', interventions: { fac_cost: 38000 } },
  { id: 'opt_over', label: 'Over budget', interventions: { fac_cost: 52000 } },
];

const CONSTRAINT_ID = 'c_cost_cap';
const GOAL_CONSTRAINTS = [
  { constraint_id: CONSTRAINT_ID, node_id: 'fac_cost', operator: '<=', value: 50000, label: 'First-year cost cap', unit: '£' },
];

const CONSTRAINT_PAYLOAD = {
  graph: CONSTRAINT_GRAPH,
  options: CONSTRAINT_OPTIONS,
  goal_node_id: 'goal',
  seed: '42',
  goal_constraints: GOAL_CONSTRAINTS,
};

/**
 * ISL robustness payload where `opt_over` breaches and its margin fields take
 * `shape`. `null` here is the LIVE shape (see header). `measured` is the
 * positive control: a genuine 0.03333 must still denormalise to ≈ £2,000.
 */
function makeConstraintPayload(shape: AbsenceShape | 'measured') {
  const marginFields = shape === 'measured'
    ? { failure_margin_median: 0.03333, near_miss_fraction: 1.0 }
    : { ...absent('failure_margin_median', shape), ...absent('near_miss_fraction', shape) };

  return (options: any[]) => ({
    options: options.map((o: any, i: number) => ({
      option_id: o.id,
      win_probability: o.id === 'opt_under' ? 0.7 : 0.3,
      outcome: { mean: 0.7 - i * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 },
      rank: i + 1,
      status: 'computed',
      constraint_analysis: {
        constraints: [
          o.id === 'opt_under'
            // Satisfies: ISL sends no margin at all for it, in the same shape.
            ? { node_id: 'fac_cost', operator: '<=', value: 50000, prob_satisfied: 1.0,
                ...(shape === 'measured' ? {} : { ...absent('failure_margin_median', shape), ...absent('near_miss_fraction', shape) }) }
            // Breaches: prob_satisfied is real, the MARGIN is the variable.
            : { node_id: 'fac_cost', operator: '<=', value: 50000, prob_satisfied: 0.0, ...marginFields },
        ],
        joint_probability: o.id === 'opt_under' ? 1.0 : 0.0,
      },
    })),
    edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2', edge_sensitivity_status: 'available',
    factors: [], factor_sensitivity: [], value_of_information: [],
    factors_provenance: 'unavailable', factor_sensitivity_status: 'skipped_no_factor_values',
    overall_robustness: 'robust', robustness_score: 0.8,
    fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl',
  });
}

async function runConstraints(app: FastifyInstance) {
  const res = await app.inject({
    method: 'POST', url: '/v2/run',
    headers: { 'content-type': 'application/json' },
    payload: CONSTRAINT_PAYLOAD,
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function marginEntry(body: any, optionId: string): any {
  const entry = (body.option_comparison ?? []).find((o: any) => o.option_id === optionId);
  expect(entry, `option_comparison entry for ${optionId}`).toBeDefined();
  return (entry.constraint_margins ?? []).find((m: any) => m.constraint_id === CONSTRAINT_ID);
}

for (const shape of ABSENCE_SHAPES) {
  describe(`absence gate §B · /v2/run constraint margins absent as ${shape.toUpperCase()}`, () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      process.env.RATE_LIMIT_ENABLED = '0';
      process.env.CEE_ORCHESTRATOR_ENABLED = '0';
      payloadFn = makeConstraintPayload(shape);
      app = await createServer();
    });
    afterAll(async () => {
      await app?.close();
      delete process.env.RATE_LIMIT_ENABLED;
      delete process.env.CEE_ORCHESTRATOR_ENABLED;
    });

    it('RETRO-PROOF: an absent margin never denormalises into a measured ZERO breach', async () => {
      const body = await runConstraints(app);
      const over = marginEntry(body, 'opt_over');
      // The entry itself may exist (prob_satisfied IS measured); the MARGIN
      // must not. Pre-#277 this shipped `failure_margin_median: 0`.
      if (over !== undefined) {
        expect(over, 'absent margin must not reappear as a number').not.toHaveProperty('failure_margin_median');
        expect(over).not.toHaveProperty('near_miss_fraction');
        // A precision claim about a margin that was never computed is worse
        // than the margin itself.
        expect(over).not.toHaveProperty('margin_precision');
      }
    });

    it('RETRO-PROOF: no fabricated margin anywhere in the response, at any depth', async () => {
      const body = await runConstraints(app);
      expect(findPresentNumbers(body, new Set(['failure_margin_median', 'near_miss_fraction']))).toEqual([]);
      expect(findNullNumericFields(body)).toEqual([]);
      expect(findNonFiniteNumbers(body)).toEqual([]);
    });

    it('a satisfying option with no margin data carries no fabricated margin either', async () => {
      const body = await runConstraints(app);
      const under = marginEntry(body, 'opt_under');
      if (under !== undefined) {
        expect(under).not.toHaveProperty('failure_margin_median');
        expect(under).not.toHaveProperty('near_miss_fraction');
      }
    });
  });
}

describe('absence gate §B · POSITIVE CONTROL — a genuine margin still flows through unchanged', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    payloadFn = makeConstraintPayload('measured');
    app = await createServer();
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('a measured 0.03333 still denormalises to ≈ £2,000 (over-suppression is an equal failure)', async () => {
    const body = await runConstraints(app);
    const over = marginEntry(body, 'opt_over');
    expect(over, 'the positive control must actually reach constraint_margins — otherwise every §B absence assertion above is vacuous').toBeDefined();
    expect(over.failure_margin_median).toBeCloseTo(2000, 0);
    expect(over.near_miss_fraction).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// §C — /v1/run VALIDATION. The verdict half of the retro-proof.
//
// Two defects #277 fixed live here:
//   C1  createFallbackValidation returned status:'uncertain', which /v1/run
//       rendered as a user-facing critique "ISL validation reports partial
//       identifiability" tagged source:'isl' — a scientific claim about the
//       user's graph attributed to a service that computed nothing.
//   C2  transformValidationToEnrichment computed `identifiable: status ===
//       'identifiable'`, so a non-result serialised as `identifiable: false`
//       into the untyped z.record PLoT→CEE enrichment.
//
// C3 is the same defect reached through a NULL rather than through a missing
// response: `STATUS_MAP[isl.status] || 'uncertain'` manufactured a verdict from
// any undeclared wire value, and `null` is an undeclared wire value.
//
// SEAM. The transport is the module mock; everything from the ISL service
// boundary inwards is real — the real createFallbackValidation, the real
// adaptValidationResponse, the real /v1/run consumer and the real enrichment
// builder. See the header for what this does not cover.
// ---------------------------------------------------------------------------

const { createFallbackValidation, adaptValidationResponse } =
  await import('../../src/integrations/isl/adapters/validation.js');

const V1_PAYLOAD = {
  graph: {
    nodes: [
      { id: 'A', label: 'Input' },
      { id: 'B', label: 'Output' },
      { id: 'C', label: 'Confounder' },
    ],
    edges: [
      { from: 'A', to: 'B', weight: 0.5 },
      { from: 'C', to: 'A', weight: 0.4 },
      { from: 'C', to: 'B', weight: 0.4 },
    ],
  },
  seed: 123,
  outcome_node: 'B',
  detail_level: 'standard',
};

/** Critique codes that assert something ISL COMPUTED about the graph. */
const ISL_VERDICT_CODES = new Set(['ISL_CANNOT_IDENTIFY', 'ISL_UNCERTAIN', 'ISL_ISSUE', 'ISL_FRAGILE']);

async function runV1(app: FastifyInstance) {
  const res = await app.inject({
    method: 'POST', url: '/v1/run',
    headers: { 'content-type': 'application/json' },
    payload: V1_PAYLOAD,
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('absence gate §C1/C3 · an undeclared or absent ISL status is not a verdict (unit)', () => {
  for (const shape of ABSENCE_SHAPES) {
    it(`RETRO-PROOF: adaptValidationResponse with status ${shape.toUpperCase()} degrades to 'unavailable', never 'uncertain'`, () => {
      const isl: any = { robustness: 'high', adjustment_sets: [], minimal_adjustment_set: [], suggestions: [], ...absent('status', shape) };
      const out = adaptValidationResponse(isl);
      // 'uncertain' is ISL's `partially_identifiable` verdict. Producing it
      // from an absent status is manufacturing a scientific claim.
      expect(out.status).not.toBe('uncertain');
      expect(out.status).toBe('unavailable');
    });
  }

  it('RETRO-PROOF: createFallbackValidation is a typed refusal, not a verdict', () => {
    const out = createFallbackValidation('ISL returned 404 (causal_router not mounted)');
    expect(out.status).toBe('unavailable');
    expect(['identifiable', 'uncertain', 'cannot_identify']).not.toContain(out.status);
  });

  it('POSITIVE CONTROL: every status ISL genuinely declares still maps to its real verdict', () => {
    const base = { robustness: 'high', adjustment_sets: [['C']], minimal_adjustment_set: ['C'], suggestions: [] };
    expect(adaptValidationResponse({ ...base, status: 'identifiable' } as any).status).toBe('identifiable');
    expect(adaptValidationResponse({ ...base, status: 'partially_identifiable' } as any).status).toBe('uncertain');
    expect(adaptValidationResponse({ ...base, status: 'not_identifiable' } as any).status).toBe('cannot_identify');
  });
});

describe('absence gate §C1/C2 · /v1/run with NO validation obtained', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    // The REAL fallback adapter is the stimulus: this is exactly what the ISL
    // service returns on a 404 / timeout / 5xx / breaker trip.
    validateFn = async () => createFallbackValidation('ISL unavailable (gate stimulus)');
    payloadFn = makePayload({ nonFinite: false });
    app = await createServer();
  });
  afterAll(async () => {
    await app?.close();
    validateFn = async () => ({
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [], explanation: { summary: 'm', reasoning: 't' }, source: 'isl',
    });
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('RETRO-PROOF C1: no critique attributes an identifiability verdict to ISL', async () => {
    const body = await runV1(app);
    const critiques: any[] = body.result?.critique ?? body.critique ?? [];
    const fabricated = critiques.filter(
      (c) => ISL_VERDICT_CODES.has(c?.code) || (c?.source === 'isl'),
    );
    expect(
      fabricated,
      `a verdict was attributed to ISL although ISL produced nothing: ${JSON.stringify(fabricated)}`,
    ).toEqual([]);
    // And the raw payload must not contain the fabricated sentence.
    expect(JSON.stringify(body)).not.toContain('reports partial identifiability');
  });

  it('C1 corollary: the unknown is stated POSITIVELY, not by silence', async () => {
    // Omitting the critique entirely would leave the user believing
    // identifiability WAS checked and cleared — the same lie by another route.
    const body = await runV1(app);
    const critiques: any[] = body.result?.critique ?? body.critique ?? [];
    const notice = critiques.find((c) => c?.code === 'ISL_VALIDATION_UNAVAILABLE');
    expect(notice, 'the explicit unknown must be present').toBeDefined();
    expect(notice.source, 'PLoT is reporting its OWN inability — never attributed to ISL').toBe('engine');
  });

  it('RETRO-PROOF C2: the enrichment omits causal_validation rather than shipping identifiable:false', async () => {
    const body = await runV1(app);
    const cv = body.enrichment?.causal_validation;
    expect(cv ?? undefined, `enrichment carried a fabricated verdict: ${JSON.stringify(cv)}`).toBeUndefined();
    // Defence in depth: no `identifiable` boolean anywhere in the payload.
    expect(JSON.stringify(body)).not.toContain('"identifiable":false');
  });
});

describe('absence gate §C · POSITIVE CONTROL — a genuine ISL verdict still reaches the user', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    validateFn = async () => adaptValidationResponse({
      status: 'partially_identifiable', robustness: 'high',
      adjustment_sets: [['C']], minimal_adjustment_set: ['C'], suggestions: [],
    } as any);
    payloadFn = makePayload({ nonFinite: false });
    app = await createServer();
  });
  afterAll(async () => {
    await app?.close();
    validateFn = async () => ({
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [], explanation: { summary: 'm', reasoning: 't' }, source: 'isl',
    });
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('a real partially_identifiable verdict IS reported, with source:isl (over-suppression is an equal failure)', async () => {
    const body = await runV1(app);
    const critiques: any[] = body.result?.critique ?? body.critique ?? [];
    const real = critiques.find((c) => c?.code === 'ISL_UNCERTAIN');
    expect(real, 'a genuine ISL verdict must still be surfaced').toBeDefined();
    expect(real.source).toBe('isl');
    // ... and the availability notice must NOT be emitted alongside it.
    expect(critiques.find((c) => c?.code === 'ISL_VALIDATION_UNAVAILABLE')).toBeUndefined();
  });

  it('a real verdict still populates the enrichment block', async () => {
    const body = await runV1(app);
    expect(body.enrichment?.causal_validation).toBeDefined();
    expect(body.enrichment.causal_validation.identifiable).toBe(false); // genuine: partially_identifiable
  });
});

// ---------------------------------------------------------------------------
// §D — THE THREE SIBLINGS #277 REPORTED AND DID NOT FIX (fixed by this lane).
//
// These use `??`, which handles `null` correctly, so they are NOT instances of
// the `!== undefined` bug — they are the broader class: a plausible substitute
// standing in for a measurement that does not exist. They are pinned at the
// UNIT seam because that is the only seam that can carry the `undefined` shape
// (JSON cannot), and because two of the three have no reachable egress reader:
//
//   D1  enrichFactorSensitivity — `?? 0`. `buildRobustnessDataForCee` IS called
//       on the live /v2/run path, but the ONLY consumer of RobustnessDataForCee
//       is buildCeeReviewRequest and it reads `fragile_edges` alone. The
//       fabricated `sensitivity: 0` therefore had ZERO readers and never
//       reached a wire. Fixed anyway — a value with no reader today is a value
//       the next lane wires up believing it is measured — but pinned here
//       rather than at egress, because there is no egress to pin.
//   D2  adaptRobustnessAnalysisResponse — `?? 0.5` score AND the label default,
//       which `mapLevelToLabel(undefined)` turned into a 'moderate' VERDICT.
//       /v1/run only.
//   D3  normalizeRobustEdges — `?? 1`, plus its string-format twin which
//       hardcoded `switch_probability: 1` from a bare "from->to" string.
// ---------------------------------------------------------------------------

const { enrichFactorSensitivity } =
  await import('../../src/integrations/isl/adapters/robustness-enrichment.js');
const { adaptRobustnessAnalysisResponse, normalizeRobustEdges, createFallbackRobustnessAnalysis } =
  await import('../../src/integrations/isl/adapters/robustness-analysis.js');

const D_GRAPH: any = { nodes: [{ id: 'fac_price', label: 'Price' }], edges: [] };

describe('absence gate §D1 · enrichFactorSensitivity never fabricates zero sensitivity', () => {
  for (const shape of ABSENCE_SHAPES) {
    it(`sensitivity is OMITTED when both source fields are ${shape.toUpperCase()}`, () => {
      const factor: any = {
        node_id: 'fac_price',
        ...absent('sensitivity_score', shape),
        ...absent('sensitivity', shape),
      };
      const out = enrichFactorSensitivity(factor, D_GRAPH);
      expect(out, 'absent ≠ "measured to have zero influence"').not.toHaveProperty('sensitivity');
    });
  }

  it('POSITIVE CONTROL: a measured value — including a genuine 0 — flows through unchanged', () => {
    expect(enrichFactorSensitivity({ node_id: 'fac_price', sensitivity_score: 0.42 } as any, D_GRAPH).sensitivity).toBe(0.42);
    expect(enrichFactorSensitivity({ node_id: 'fac_price', sensitivity_score: 0 } as any, D_GRAPH).sensitivity).toBe(0);
    // legacy field still honoured
    expect(enrichFactorSensitivity({ node_id: 'fac_price', sensitivity: 0.7 } as any, D_GRAPH).sensitivity).toBe(0.7);
  });
});

describe('absence gate §D2 · adaptRobustnessAnalysisResponse never fabricates a robustness score or verdict', () => {
  function islResponse(robustness: unknown) {
    return { sensitivity: [], factor_sensitivity: [], robustness } as any;
  }

  for (const shape of ABSENCE_SHAPES) {
    it(`robustness_score and overall_robustness are OMITTED when score/confidence/label/level are ${shape.toUpperCase()}`, () => {
      const robustness: any = {
        ...absent('score', shape), ...absent('confidence', shape),
        ...absent('label', shape), ...absent('level', shape),
        fragile_edges: [], robust_edges: [],
      };
      const out = adaptRobustnessAnalysisResponse(islResponse(robustness), 10, 'available', 'available');
      expect(out, '0.5 is not a measurement').not.toHaveProperty('robustness_score');
      expect(out, "'moderate' is a VERDICT about the user's graph").not.toHaveProperty('overall_robustness');
    });
  }

  it('the robustness object being absent entirely is also not a verdict', () => {
    const out = adaptRobustnessAnalysisResponse(islResponse(undefined), 10, 'available', 'available');
    expect(out).not.toHaveProperty('robustness_score');
    expect(out).not.toHaveProperty('overall_robustness');
  });

  it('RETRO-GUARD: a non-finite score is not published either', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const out = adaptRobustnessAnalysisResponse(
        islResponse({ score: bad, label: 'robust', fragile_edges: [], robust_edges: [] }), 10, 'available', 'available');
      expect(out, `score=${bad}`).not.toHaveProperty('robustness_score');
      expect(out.overall_robustness, 'a real label survives a bad score').toBe('robust');
    }
  });

  it('POSITIVE CONTROL: genuine score/label flow through, and `level` still maps when present', () => {
    const withLabel = adaptRobustnessAnalysisResponse(
      islResponse({ score: 0.82, label: 'fragile', fragile_edges: [], robust_edges: [] }), 10, 'available', 'available');
    expect(withLabel.robustness_score).toBe(0.82);
    expect(withLabel.overall_robustness).toBe('fragile');

    const withLevel = adaptRobustnessAnalysisResponse(
      islResponse({ confidence: 0.4, level: 'low', fragile_edges: [], robust_edges: [] }), 10, 'available', 'available');
    expect(withLevel.robustness_score, 'confidence is the declared fallback SOURCE, not a fabrication').toBe(0.4);
    expect(withLevel.overall_robustness).toBe('fragile');

    // A genuine 0 score is a measurement.
    const zero = adaptRobustnessAnalysisResponse(
      islResponse({ score: 0, label: 'fragile', fragile_edges: [], robust_edges: [] }), 10, 'available', 'available');
    expect(zero).toHaveProperty('robustness_score');
    expect(zero.robustness_score).toBe(0);
  });

  it('the ISL-unavailable fallback states no robustness verdict at all', () => {
    const out = createFallbackRobustnessAnalysis('ISL timeout');
    expect(out).not.toHaveProperty('robustness_score');
    expect(out).not.toHaveProperty('overall_robustness');
    expect(out.source, 'the refusal is carried machine-readably instead').toBe('unavailable');
  });
});

describe('absence gate §D3 · robust edges never fabricate switch_probability', () => {
  for (const shape of ABSENCE_SHAPES) {
    it(`object-format switch_probability is OMITTED when ${shape.toUpperCase()}`, () => {
      const out = normalizeRobustEdges([{ edge_id: 'x->y', ...absent('switch_probability', shape) }] as any);
      expect(out.edges).toHaveLength(1);
      expect(out.edges[0]).not.toHaveProperty('switch_probability');
    });
  }

  // ⚠ BLOCKED ON A CROSS-REPO CONTRACT CHANGE — NOT a doctrine question.
  //
  // The string arm still fabricates `switch_probability: 1`. This lane made it
  // omit, ran the authoritative gate, and MEASURED the consequence: every
  // /v2/run response then fails its own egress contract, because
  // @talchain/schemas (vendored 0.22.0) declares
  // `EnrichmentRobustnessEdgeSchema.switch_probability: z.number()` REQUIRED
  // for robust_edges as well as fragile_edges. The producer-side guard stamps
  // `enrichment_contract_ok: false` and a user-visible
  // ENRICHMENT_CONTRACT_MISMATCH warning on every response (4 issue paths on
  // the golden fixture), and CEE shadow-validates the same body against the
  // same schema.
  //
  // Trading a wrong number for a standing false alarm on a fail-open guard is
  // the broken-alarm trap, so the omission was reverted and the blocker
  // reported instead of quietly fabricating OR quietly breaking the contract.
  //
  // TO UN-SKIP: relax the field in olumi-schemas to `z.number().optional()`
  // (which is what PLoT's own NormalizedEdgeInfoV3 already publishes — the two
  // contracts disagree TODAY, latently, for fragile_edges), release, re-pin the
  // vendored tarball, delete the fabrication in normalizeRobustEdge, un-skip.
  // This test failing after that change is the signal the work landed.
  it.skip('string-format robust edges carry NO switch_probability (a string has no measurement) — BLOCKED: @talchain/schemas requires it', () => {
    const out = normalizeRobustEdges(['a->b', 'c::d']);
    expect(out.edges).toHaveLength(2);
    for (const e of out.edges) expect(e).not.toHaveProperty('switch_probability');
  });

  it('the string-arm fabrication is PINNED as a known defect, so it cannot be forgotten or mistaken for a measurement', () => {
    // This is deliberately an assertion about a value we consider WRONG. It
    // exists so the fabrication is visible in the suite rather than silent, and
    // so removing it (once the schema is relaxed) is a deliberate act.
    const out = normalizeRobustEdges(['a->b']);
    expect(out.edges[0].switch_probability, 'still fabricated — see the blocker above').toBe(1);
  });

  it('POSITIVE CONTROL: a measured object-format switch_probability survives verbatim', () => {
    const out = normalizeRobustEdges([{ edge_id: 'x->y', switch_probability: 0.3 }] as any);
    expect(out.edges[0].switch_probability).toBe(0.3);
    expect(out.edges[0].edge_id).toBe('x->y');
  });
});
