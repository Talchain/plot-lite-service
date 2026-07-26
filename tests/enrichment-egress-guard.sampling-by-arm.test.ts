/**
 * ROADMAP 1.210 — the egress guard's 1-in-16 sample was calibrated for the
 * wrong kind of check.
 *
 * THE DEFECT
 *
 * The sampling rationale (b9f825a, #230, 18 Jul) reads: "A real contract
 * regression is DETERMINISTIC — it breaks the same field on EVERY response — so
 * a 1-in-N sample still surfaces it within N requests."
 *
 * That is true of the SCHEMA-PARSE arm. A type or enum corruption on a typed
 * key is a property of the code, so it breaks every response and 1-in-16
 * catches it within 16 requests.
 *
 * It is false of the STABILITY-BAND arm, which landed AFTERWARDS in 9700d8b
 * (#232, same day; `git merge-base --is-ancestor b9f825a 9700d8b` confirms the
 * ordering). That arm validates PER-RESPONSE ISL PAYLOAD DATA — that
 * band_min <= band_median <= band_max, that endpoints are finite, that width is
 * non-negative. A malformed band arrives in the data for a particular request.
 * It is not a property of the code and it does not repeat. Under 1-in-16 it is
 * caught with probability 1/16, so roughly 15 in 16 malformed bands ship to CEE
 * stamped `enrichment_contract_ok: true`.
 *
 * A guard that says "valid" about a body it never looked at is worse than no
 * guard, for the same reason a circuit breaker that cannot trip is worse than
 * none: it reads as protection that does not exist.
 *
 * THE FIX, AND WHY IT IS A SPLIT RATHER THAN A BLANKET RAISE
 *
 * Measured on this tip (2000 iterations, realistic body):
 *
 *   edge_e_values   band arm      schema arm    band share
 *   10              0.0015 ms     0.2100 ms     0.7%
 *   50              0.0065 ms     0.8652 ms     0.7%
 *   200             0.0250 ms     3.1816 ms     0.8%
 *
 * The arm whose detection sampling BREAKS is also the arm that costs almost
 * nothing, and the expensive arm is the one for which the deterministic
 * argument genuinely holds. So each arm is now sampled according to its own
 * detection semantics: the band sweep runs on EVERY response, the schema parse
 * keeps its 1-in-N.
 *
 * (The brief cited 0.047 ms mean for always-on from #225. This tip does not
 * reproduce that: the full guard is 0.21-3.21 ms and scales with
 * edge_e_values length. That figure is likely from a minimal body, and it is
 * why the split is measured here rather than assumed.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assessEnrichmentContract,
  assessStabilityBands,
  shouldAssessEnrichmentContract,
  __resetEnrichmentGuardSampler,
  DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD,
} from '../src/routes/v2/enrichment-egress-guard.js';

/** A body whose stability band is malformed: median above max (reversed). */
function bodyWithMalformedBand() {
  return {
    edge_e_values: [
      {
        edge_id: 'a->b',
        from_id: 'a',
        to_id: 'b',
        e_value: 0.5,
        flip_direction: 'increase',
        current_mean: 100,
        flip_mean: 120,
        stability: {
          n_seeds: 8,
          n_seeds_flipped: 2,
          band_min: 0.4,
          band_median: 0.9,
          band_max: 0.6,
          band_width: 0.2,
        },
      },
    ],
  };
}

/** The same shape, well-formed. */
function bodyWithValidBand() {
  return {
    edge_e_values: [
      {
        edge_id: 'a->b',
        from_id: 'a',
        to_id: 'b',
        e_value: 0.5,
        flip_direction: 'increase',
        current_mean: 100,
        flip_mean: 120,
        stability: {
          n_seeds: 8,
          n_seeds_flipped: 2,
          band_min: 0.4,
          band_median: 0.5,
          band_max: 0.6,
          band_width: 0.2,
        },
      },
    ],
  };
}

const prevEnv = process.env.ENRICHMENT_GUARD_SAMPLE_N;
const prevNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  __resetEnrichmentGuardSampler();
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.ENRICHMENT_GUARD_SAMPLE_N;
  else process.env.ENRICHMENT_GUARD_SAMPLE_N = prevEnv;
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
  __resetEnrichmentGuardSampler();
});

describe('POSITIVE CONTROL — the band arm can detect the fault at all', () => {
  it('flags a reversed band', () => {
    const issues = assessStabilityBands(bodyWithMalformedBand());

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.path.includes('band_max'))).toBe(true);
  });

  it('passes a well-formed band', () => {
    expect(assessStabilityBands(bodyWithValidBand())).toEqual([]);
  });
});

describe('the data-dependent arm runs on EVERY response, whatever the sample rate', () => {
  it('catches a malformed band on a request the sampler would have skipped', () => {
    // N=16 with the counter at 1 means shouldAssessEnrichmentContract() is
    // false — under the old behaviour this body was never inspected and went
    // out stamped ok:true.
    process.env.ENRICHMENT_GUARD_SAMPLE_N = '16';
    __resetEnrichmentGuardSampler();
    shouldAssessEnrichmentContract(); // consume request 1 (the sampled one)

    expect(shouldAssessEnrichmentContract()).toBe(false); // request 2: skipped

    const assessment = assessEnrichmentContract(bodyWithMalformedBand(), {
      runSchemaParse: false,
    });

    expect(assessment.ok).toBe(false);
    expect(assessment.issue_count).toBeGreaterThan(0);
  });

  it('catches a malformed band across a FULL sampling cycle — every request, not 1 in N', () => {
    process.env.ENRICHMENT_GUARD_SAMPLE_N = String(DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD);
    __resetEnrichmentGuardSampler();

    let caught = 0;
    for (let i = 0; i < DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD; i++) {
      const runSchemaParse = shouldAssessEnrichmentContract();
      const assessment = assessEnrichmentContract(bodyWithMalformedBand(), { runSchemaParse });
      if (!assessment.ok) caught++;
    }

    // Was 1 of 16 before this change. Must now be 16 of 16.
    expect(caught).toBe(DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD);
  });

  it('does not cry wolf — a valid band stays ok on every request of the cycle', () => {
    process.env.ENRICHMENT_GUARD_SAMPLE_N = String(DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD);
    __resetEnrichmentGuardSampler();

    for (let i = 0; i < DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD; i++) {
      const runSchemaParse = shouldAssessEnrichmentContract();
      expect(assessEnrichmentContract(bodyWithValidBand(), { runSchemaParse }).ok).toBe(true);
    }
  });
});

describe('the schema-parse arm keeps its sampling — its faults ARE deterministic', () => {
  it('is skipped when the sampler says so', () => {
    // `analysis_status` must be an enum member; a number is a type corruption
    // the schema arm catches and the band arm cannot see.
    const corrupt = { analysis_status: 12345 };

    const skipped = assessEnrichmentContract(corrupt, { runSchemaParse: false });
    const run = assessEnrichmentContract(corrupt, { runSchemaParse: true });

    // Skipping is what makes the sampling a saving at all.
    expect(skipped.ok).toBe(true);
    // POSITIVE CONTROL: the same body IS caught when the arm runs, so the
    // assertion above is about sampling and not about a blind check.
    expect(run.ok).toBe(false);
  });

  it('defaults to running both arms when no options are passed', () => {
    // Back-compat for every existing caller.
    expect(assessEnrichmentContract({ analysis_status: 12345 }).ok).toBe(false);
    expect(assessEnrichmentContract(bodyWithMalformedBand()).ok).toBe(false);
  });
});

describe('sampler semantics are unchanged', () => {
  it('still assesses request 1, N+1, 2N+1 under an explicit N', () => {
    process.env.ENRICHMENT_GUARD_SAMPLE_N = '4';
    __resetEnrichmentGuardSampler();

    const pattern = Array.from({ length: 8 }, () => shouldAssessEnrichmentContract());

    expect(pattern).toEqual([true, false, false, false, true, false, false, false]);
  });

  it('N=1 assesses every request', () => {
    process.env.ENRICHMENT_GUARD_SAMPLE_N = '1';
    __resetEnrichmentGuardSampler();

    expect([1, 2, 3].map(() => shouldAssessEnrichmentContract())).toEqual([true, true, true]);
  });
});
