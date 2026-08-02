/**
 * ROADMAP 2.289 — cold/skew admission fallbacks must never silently under-price
 * ISL's v5 cost model.
 *
 * THE DEFECT (Codex-confirmed, term-by-term recomputed): on a COLD admission
 * cache, `getIslComputeAdmission()` returned `{admission: null, skew: false,
 * status: 'warming'}` while refreshing in the background. The /v2/run route
 * derived its fallback posture from `skew` alone, so the warming state took the
 * BENIGN legacy path: full defaulted depth (10,000) against the historical 30M
 * scalar budget — whose safety argument ("S×N×E over-prices the weighted shape,
 * so it never under-reduces") is FALSE for v5.
 *
 * WORKED EXAMPLE (pinned below): N=20, E=40, O=10, U=19 at S=10,000 →
 * legacy scalar 8.0M — under the 10M conservative budget AND the 30M historical
 * budget — while the EXACT v5 weighted cost is 34,930,600 against ISL's live
 * 24M ceiling. PLoT forwarded; ISL refused at its cost guard (robustness.py
 * cost-admission check) — a hard 422 where an honest refusal/downsize belongs.
 *
 * THE FIX, pinned here and at the route (adaptive-n-samples-complexity.test.ts):
 *  (a) the admission cache is WARMABLE at process start (warmIslComputeAdmission,
 *      awaited in main.ts before listen) so production requests plan against the
 *      real advertisement;
 *  (b) a skewed refresh RETAINS the last-known-good admission — weighted pricing
 *      and the structural caps gate stay live through a transient /health outage
 *      instead of dropping to blind scalar arithmetic;
 *  (c) "admission unknown" (warming, or skew with nothing retained) is a
 *      DISTINCT conservative state: the depth-raise is disabled and the cut is
 *      DISCLOSED on the wire (reason `admission_unavailable`) — never the silent
 *      benign-legacy mode;
 *  (d) the false "never under-prices" comment on LEGACY_FALLBACK_SCALAR_BUDGET
 *      is corrected (see sampling.ts; the arithmetic witness lives here).
 *
 * HONESTY NOTE, disclosed rather than implied away: (c) alone does NOT
 * guarantee admission — on this worked example even the capped 4,000-sample
 * fallback prices at 29.4M > 24M. The guarantee comes from (a)+(b) making the
 * no-advertisement state vanishingly rare; (c) makes the residual window
 * disclosed-and-conservative instead of silent-and-full-depth.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  estimateWeightedCostV5,
  planSampleDepth,
  LEGACY_FALLBACK_SCALAR_BUDGET,
  ISL_COMPLEXITY_BUDGET_DEFAULT,
  LEGACY_BASE_N_SAMPLES,
  ADAPTIVE_N_SAMPLES_FLOOR,
  type DepthPlanInput,
  type WeightedCostRequest,
} from '../src/config/sampling.js';
import {
  __classifyForTest,
  __refreshForTest,
  __resetIslComputeAdmission,
  getIslComputeAdmission,
  warmIslComputeAdmission,
  shouldPlanConservatively,
  type AdmissionResolution,
} from '../src/integrations/isl/compute-admission.js';
import { ISLClient } from '../src/integrations/isl/client.js';
import type {
  ISLComputeAdmission,
  ISLComputeAdmissionWeights,
  ISLComputeAdmissionFormulaParameters,
  ISLHealthResponse,
} from '../src/integrations/isl/types/isl-types.js';

/** The live v5 advertisement (same dated capture as the handshake suite). */
const V5_VERSION = 'v5-factor-flips-2026-08-01';

const LIVE_V5_WEIGHTS = {
  base_per_sample_per_option_per_struct: 1,
  evpi_sample_cap: 2000,
  evpc_coef: 1,
  evppi_full_coef: 1,
  evppi_null_permutations: 16,
  factor_flip_coef: 1,
  influence_walk_pool: 400_000,
  sensitivity_coef: 4,
  evalue_coef: 20,
  bands_coef: 200,
  path_coef: 1,
  max_decomposition_paths: 20_000,
} as unknown as ISLComputeAdmissionWeights;

const LIVE_V5_FORMULA_PARAMETERS: ISLComputeAdmissionFormulaParameters = {
  factor_flips: { max_candidates: 10, stability_seeds: 10 },
  sensitivity: { subsample_cap: 100, subsample_divisor: 10 },
};

function v5Admission(maxCostUnits = 24_000_000): ISLComputeAdmission {
  return {
    max_cost_units: maxCostUnits,
    complexity_formula_version: V5_VERSION,
    weights: { ...LIVE_V5_WEIGHTS },
    caps: {
      max_options: 10,
      max_nodes: 50,
      max_edges: 200,
      max_parameter_uncertainties: 50,
      max_control_candidates: 5,
      max_control_values: 7,
    },
    formula_parameters: {
      factor_flips: { ...LIVE_V5_FORMULA_PARAMETERS.factor_flips! },
      sensitivity: { ...LIVE_V5_FORMULA_PARAMETERS.sensitivity! },
    },
  };
}

/** The 2.289 worked example: N=20, E=40, O=10, U=19, base /v2/run phase flags. */
function workedExample(nSamples: number): WeightedCostRequest {
  return {
    nSamples,
    nodeCount: 20,
    edgeCount: 40,
    optionCount: 10,
    uniqueParamUncertainties: 19,
    includeVoi: true,
    includeSensitivity: true,
    includeEValues: true,
    includePathDecomposition: false,
    includeFactorFlips: true,
    controlGridPoints: 0,
  };
}

function workedExampleInput(): DepthPlanInput {
  return { ...workedExample(10_000), nSamplesExplicit: false };
}

// ===========================================================================
// A. The arithmetic witness — the false comment, killed with numbers.
// ===========================================================================

describe('2.289 worked example — the legacy scalar UNDER-prices v5', () => {
  it('legacy scalar passes BOTH scalar budgets while the exact v5 cost exceeds the live ceiling', () => {
    const scalar = 10_000 * 20 * 40;
    expect(scalar).toBe(8_000_000);
    // Under the conservative fallback budget AND the historical default —
    // the scalar gate admits this request at full depth on every fallback path.
    expect(scalar).toBeLessThanOrEqual(LEGACY_FALLBACK_SCALAR_BUDGET);
    expect(scalar).toBeLessThanOrEqual(ISL_COMPLEXITY_BUDGET_DEFAULT);

    // ...while ISL's REAL v5 gate prices the same request 4.4× higher, over the
    // live 24M ceiling. This pair is the direct counter-example to the old
    // sampling.ts claim that S×N×E "never under-reduces below what the
    // weighted gate would accept".
    const exact = estimateWeightedCostV5(
      workedExample(10_000),
      LIVE_V5_WEIGHTS,
      LIVE_V5_FORMULA_PARAMETERS,
    );
    expect(exact).toBe(34_930_600);
    expect(exact).toBeGreaterThan(24_000_000);
  });

  it('even the CAPPED conservative depth (4,000) still exceeds the live ceiling — only real pricing closes this graph', () => {
    // Disclosed limitation of fix (c): the conservative fallback is honest and
    // loud, but it cannot price what ISL never advertised. 29.4M > 24M.
    const atCap = estimateWeightedCostV5(
      workedExample(LEGACY_BASE_N_SAMPLES),
      LIVE_V5_WEIGHTS,
      LIVE_V5_FORMULA_PARAMETERS,
    );
    expect(atCap).toBe(29_392_600);
    expect(atCap).toBeGreaterThan(24_000_000);
  });

  it('with the REAL advertisement the planner reduces to the maximal admissible depth (the honest outcome)', () => {
    const d = planSampleDepth(workedExampleInput(), v5Admission(), { conservative: false });
    expect(d.kind).toBe('reduced');
    if (d.kind === 'reduced') {
      expect(d.mode).toBe('weighted');
      expect(d.reason).toBe('admission_budget');
      expect(d.nSamples).toBeGreaterThanOrEqual(ADAPTIVE_N_SAMPLES_FLOOR);
      // Maximal + never breaches: fits at the planned depth, breaches at +1.
      const costAt = (s: number) =>
        estimateWeightedCostV5(workedExample(s), LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS);
      expect(costAt(d.nSamples)).toBeLessThanOrEqual(24_000_000);
      expect(costAt(d.nSamples + 1)).toBeGreaterThan(24_000_000);
    }
  });
});

// ===========================================================================
// B. shouldPlanConservatively — the posture is derived from USABILITY, not
//    from `skew` alone (the 2.289 route defect in one function).
// ===========================================================================

describe('shouldPlanConservatively — admission-unknown is conservative, disabled is benign', () => {
  const cases: Array<[string, AdmissionResolution, boolean]> = [
    ['warming (cold cache, ISL configured)', { admission: null, skew: false, status: 'warming' }, true],
    ['genuine skew, nothing retained', { admission: null, skew: true, status: 'unknown_version' }, true],
    ['unreachable, nothing retained', { admission: null, skew: true, status: 'unreachable' }, true],
    [
      'skew WITH a retained admission (fail-safe if weighted planning declines it)',
      {
        admission: v5Admission(),
        skew: true,
        status: 'unreachable',
        retainedAdmissionVersion: V5_VERSION,
      },
      true,
    ],
    ['healthy ok', { admission: v5Admission(), skew: false, status: 'ok' }, false],
    ['ISL not configured', { admission: null, skew: false, status: 'disabled' }, false],
  ];

  it.each(cases)('%s → conservative=%j', (_name, resolution, expected) => {
    void _name;
    expect(shouldPlanConservatively(resolution)).toBe(expected);
  });
});

// ===========================================================================
// C. Retention — a skewed refresh serves the LAST KNOWN GOOD admission.
// ===========================================================================

describe('refresh retention — last-known-good survives a skewed read (fail-loud, not fail-blind)', () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    __resetIslComputeAdmission();
    process.env.ISL_BASE_URL = 'https://isl.test';
    process.env.ISL_API_KEY = 'k';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetIslComputeAdmission();
    process.env = { ...prevEnv };
  });

  function mockHealth(body: unknown | null, ok = true): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (body === null && !ok) throw new Error('ECONNREFUSED');
        return { ok, json: async () => body } as unknown as Response;
      }),
    );
  }

  it('ok → unreachable: the admission is RETAINED, the skew is still named and loud', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockHealth({ status: 'healthy', compute_admission: v5Admission() });
    const first = await __refreshForTest();
    expect(first.status).toBe('ok');

    mockHealth(null, false);
    const second = await __refreshForTest();

    // The live read really is unusable, and says so...
    expect(second.status).toBe('unreachable');
    expect(second.skew).toBe(true);
    // ...but planning keeps the last-known-good advertisement: weighted pricing
    // and the caps gate stay live instead of dropping to blind scalar arithmetic.
    expect(second.admission).not.toBeNull();
    expect(second.admission?.complexity_formula_version).toBe(V5_VERSION);
    expect(second.retainedAdmissionVersion).toBe(V5_VERSION);

    // The alarm names the retention (and stays a skew alarm — the metric and
    // event are asserted in the handshake suite; here the ACTION matters).
    const warned = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('isl_admission_version_skew');
    expect(warned).toContain('retained_last_known_good_admission');
  });

  it('ok → unknown_version: DRIFT does NOT retain — conservative + disclosed fallback (review ruling on #305)', async () => {
    // ⚠ FLIPPED PIN, by explicit review ruling. The first cut of this test
    // pinned retention ACROSS a formula-version change — pinning the exposure
    // IN: live ISL positively declares a cost model PLoT cannot price, and a
    // retained block would serve OBSOLETE pricing at full depth with stale caps
    // and ZERO wire disclosure, healing only via a PLoT code change (ISL
    // redeployed its formula on 1 Aug — drift recurs here). Retention is for
    // the OUTAGE class only (unreadable /health: no advertised version to
    // read); the DRIFT class (a READABLE advertised version PLoT cannot price)
    // takes the conservative, wire-disclosed fallback.
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockHealth({ status: 'healthy', compute_admission: v5Admission() });
    await __refreshForTest();

    mockHealth({
      status: 'healthy',
      compute_admission: { ...v5Admission(), complexity_formula_version: 'v9-future' },
    });
    const r = await __refreshForTest();

    expect(r.status).toBe('unknown_version');
    expect(r.advertisedVersion).toBe('v9-future'); // the live declaration is READABLE → drift
    expect(r.admission).toBeNull(); // NOT retained
    expect(r.retainedAdmissionVersion).toBeUndefined();
  });

  it('ok → unknown_weight_keys: CONTENT drift does not retain either (same class, same reason)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockHealth({ status: 'healthy', compute_admission: v5Admission() });
    await __refreshForTest();

    const grown = v5Admission();
    (grown.weights as unknown as Record<string, unknown>).brand_new_coef = 1;
    mockHealth({ status: 'healthy', compute_admission: grown });
    const r = await __refreshForTest();

    expect(r.status).toBe('unknown_weight_keys');
    expect(r.advertisedVersion).toBe(V5_VERSION); // version readable → drift class
    expect(r.admission).toBeNull();
    expect(r.retainedAdmissionVersion).toBeUndefined();
  });

  it('ACCEPTED EDGE (ruled): garbled weights under a READABLE version land conservative, not retained', async () => {
    // classify() reports this as missing_block WITH advertisedVersion set —
    // the discriminator (advertisedVersion === undefined) therefore excludes
    // it from retention. Conservative is the safe side: we cannot distinguish
    // "transient corruption" from "ISL changed what this version means".
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockHealth({ status: 'healthy', compute_admission: v5Admission() });
    await __refreshForTest();

    const garbled = v5Admission();
    delete (garbled.weights as unknown as Record<string, unknown>).bands_coef;
    mockHealth({ status: 'healthy', compute_admission: garbled });
    const r = await __refreshForTest();

    expect(r.status).toBe('missing_block');
    expect(r.advertisedVersion).toBe(V5_VERSION);
    expect(r.admission).toBeNull();
    expect(r.retainedAdmissionVersion).toBeUndefined();
  });

  it('ok → SHAPELESS payload (no readable version): outage-class, retained', async () => {
    // A /health body whose compute_admission is not even block-shaped (an ISL
    // mid-restart / proxy-error shape) carries NO advertised version — the
    // payload-derived discriminator classes it with unreachable: outage.
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockHealth({ status: 'healthy', compute_admission: v5Admission() });
    await __refreshForTest();

    mockHealth({ status: 'degraded', compute_admission: 42 });
    const r = await __refreshForTest();

    expect(r.status).toBe('missing_block');
    expect(r.advertisedVersion).toBeUndefined(); // nothing readable → outage class
    expect(r.admission).not.toBeNull();
    expect(r.retainedAdmissionVersion).toBe(V5_VERSION);
  });

  it('a LATER healthy read replaces the retained value (retention is a bridge, not a pin)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockHealth({ status: 'healthy', compute_admission: v5Admission(24_000_000) });
    await __refreshForTest();
    mockHealth(null, false);
    await __refreshForTest();
    mockHealth({ status: 'healthy', compute_admission: v5Admission(20_000_000) });
    const healed = await __refreshForTest();

    expect(healed.status).toBe('ok');
    expect(healed.admission?.max_cost_units).toBe(20_000_000);
    expect(healed.retainedAdmissionVersion).toBeUndefined();

    // ...and a NEW outage retains the NEW block, not the original one.
    mockHealth(null, false);
    const secondOutage = await __refreshForTest();
    expect(secondOutage.admission?.max_cost_units).toBe(20_000_000);
  });

  it('with NOTHING ever retained, a skewed refresh still yields a null admission (fail-closed control)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockHealth(null, false);
    const r = await __refreshForTest();
    expect(r.status).toBe('unreachable');
    expect(r.admission).toBeNull();
    expect(r.retainedAdmissionVersion).toBeUndefined();
  });

  it('__resetIslComputeAdmission clears the retained value (test isolation is real)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockHealth({ status: 'healthy', compute_admission: v5Admission() });
    await __refreshForTest();
    __resetIslComputeAdmission();
    mockHealth(null, false);
    const r = await __refreshForTest();
    expect(r.admission).toBeNull();
  });
});

// ===========================================================================
// D. warmIslComputeAdmission — the boot-time warm (fix a).
// ===========================================================================

describe('warmIslComputeAdmission — the cache is warm before the first request', () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetIslComputeAdmission();
    process.env = { ...prevEnv };
  });

  it('configured: one awaited refresh; the NEXT synchronous read is ok with zero network', async () => {
    __resetIslComputeAdmission();
    process.env.ISL_BASE_URL = 'https://isl.test';
    process.env.ISL_API_KEY = 'k';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'healthy', compute_admission: v5Admission() }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const warmed = await warmIslComputeAdmission();
    expect(warmed.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The request path now serves the warmed value synchronously, no refetch.
    const served = getIslComputeAdmission();
    expect(served.status).toBe('ok');
    expect(served.admission?.complexity_formula_version).toBe(V5_VERSION);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('unconfigured: resolves disabled immediately and never touches the network', async () => {
    __resetIslComputeAdmission();
    delete process.env.ISL_BASE_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const warmed = await warmIslComputeAdmission();
    expect(warmed.status).toBe('disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an unreachable ISL warms to a NAMED skew state (boot never wedges on a dead ISL)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    __resetIslComputeAdmission();
    process.env.ISL_BASE_URL = 'https://isl.test';
    process.env.ISL_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const warmed = await warmIslComputeAdmission();
    expect(warmed.status).toBe('unreachable');
    expect(warmed.admission).toBeNull();
  });

  it('fetchHealth bounds the BODY read, not only the headers (a trickling /health cannot wedge the warm)', async () => {
    // Review amendment 2 on #305: the health timeout used to be cleared the
    // moment HEADERS arrived, leaving `response.json()` with no live timer —
    // a pathologically trickling body extended boot toward undici's ~300 s
    // idle default. The timeout must bound the ENTIRE read.
    const client = new ISLClient({
      baseUrl: 'https://isl.test',
      apiKey: 'k',
      timeoutMs: 1_000,
      maxRetries: 0,
      healthCheckTimeoutMs: 50,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: { signal?: AbortSignal } | undefined) => ({
        ok: true,
        // A body that settles ONLY when the caller's timeout signal aborts —
        // the trickling-response shape. If the implementation has dropped the
        // timer by now, this promise never settles.
        json: () =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            const abort = () => reject(new DOMException('aborted', 'AbortError'));
            if (signal?.aborted) return abort();
            signal?.addEventListener('abort', abort);
          }),
      })),
    );

    const outcome = await Promise.race([
      client.fetchHealth().then((r) => ({ settled: r })),
      new Promise((resolve) => setTimeout(() => resolve('BODY_READ_UNBOUNDED'), 500)),
    ]);
    // Post-fix: the 50 ms timer aborts the body read; fetchHealth swallows the
    // AbortError and resolves null well before the 500 ms tripwire.
    expect(outcome).toEqual({ settled: null });
  });
});

// ===========================================================================
// E. Cold-cache semantics — warming is "configured, first read in flight";
//    an unconfigured ISL is 'disabled' from the very first request.
// ===========================================================================

describe('getIslComputeAdmission cold-cache semantics', () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetIslComputeAdmission();
    process.env = { ...prevEnv };
  });

  it('cold + unconfigured → disabled (benign), NOT warming (conservative)', () => {
    __resetIslComputeAdmission();
    delete process.env.ISL_BASE_URL;
    const r = getIslComputeAdmission();
    expect(r.status).toBe('disabled');
    expect(shouldPlanConservatively(r)).toBe(false);
  });

  it('cold + configured → warming, which the route now treats as conservative', () => {
    __resetIslComputeAdmission();
    process.env.ISL_BASE_URL = 'https://isl.test';
    process.env.ISL_API_KEY = 'k';
    // Keep the kicked-off background refresh from touching a real network.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const r = getIslComputeAdmission();
    expect(r.status).toBe('warming');
    expect(shouldPlanConservatively(r)).toBe(true);
  });
});
