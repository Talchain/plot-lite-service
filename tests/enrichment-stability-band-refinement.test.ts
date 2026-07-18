/**
 * F12 (Codex deep review, A3 r2) — refined stability-band parse in the egress
 * guard (PLoT-LOCAL interim; the canonical SHARED stability schema is a
 * separate A1 schemas-PR).
 *
 * The shared `EnrichmentEdgeEValueSchema` is `.passthrough()` and does NOT type
 * `edge_e_values[].stability`, so a malformed band (reversed endpoints, negative
 * / non-integer counts, n_seeds_flipped > n_seeds, seed_flip_means length
 * mismatch, negative width) survives `assessEnrichmentContract` and is stamped
 * `enrichment_contract_ok: true`.
 *
 * RED-first: every malformed-band body below asserts `ok === false`; on the
 * current (passthrough-only) code they return `ok === true` (the false-pass) —
 * so each assertion FAILS pre-fix and PASSES post-fix. The valid-band and
 * no-band cases are positive controls that must STILL pass (`ok === true`).
 */

import { describe, it, expect } from 'vitest';
import { assessEnrichmentContract } from '../src/routes/v2/enrichment-egress-guard.js';

// A minimal body the shared schema otherwise accepts (edge outer fields valid);
// only the nested `stability` object varies.
function bodyWithBand(stability: unknown) {
  return {
    edge_e_values: [
      {
        edge_id: 'a::b', from_id: 'a', to_id: 'b',
        e_value: 1.4, flip_direction: 'increase',
        current_mean: 0.5, flip_mean: 0.7,
        stability,
      },
    ],
  };
}

const VALID_BAND = {
  n_seeds: 10,
  n_seeds_flipped: 3,
  band_min: 0.2,
  band_median: 0.5,
  band_max: 0.8,
  band_width: 0.6,
  seed_flip_means: [0.2, null, 0.5, null, 0.8, null, null, null, null, null],
};

describe('F12 — egress guard refines the nested stability band (positive controls)', () => {
  it('a well-formed band still passes (ok:true)', () => {
    expect(assessEnrichmentContract(bodyWithBand(VALID_BAND)).ok).toBe(true);
  });

  it('an absent band still passes (nothing to sweep)', () => {
    const body = { edge_e_values: [{ edge_id: 'a::b', from_id: 'a', to_id: 'b', e_value: 1.4, flip_direction: 'increase', current_mean: 0.5, flip_mean: 0.7 }] };
    expect(assessEnrichmentContract(body).ok).toBe(true);
  });

  it('an n_seeds_flipped==0 band with omitted endpoints still passes', () => {
    expect(assessEnrichmentContract(bodyWithBand({ n_seeds: 10, n_seeds_flipped: 0, seed_flip_means: new Array(10).fill(null) })).ok).toBe(true);
  });
});

describe('F12 — malformed bands are REJECTED (RED-first: ok:true pre-fix)', () => {
  it('reversed band (band_min > band_max)', () => {
    expect(assessEnrichmentContract(bodyWithBand({ ...VALID_BAND, band_min: 0.9, band_max: 0.1 })).ok).toBe(false);
  });

  it('unordered median (band_median outside [min,max])', () => {
    expect(assessEnrichmentContract(bodyWithBand({ ...VALID_BAND, band_median: 0.95 })).ok).toBe(false);
  });

  it('negative count (n_seeds < 0)', () => {
    expect(assessEnrichmentContract(bodyWithBand({ ...VALID_BAND, n_seeds: -1 })).ok).toBe(false);
  });

  it('non-integer count (n_seeds not an integer)', () => {
    expect(assessEnrichmentContract(bodyWithBand({ ...VALID_BAND, n_seeds: 10.5 })).ok).toBe(false);
  });

  it('n_seeds_flipped > n_seeds', () => {
    expect(assessEnrichmentContract(bodyWithBand({ ...VALID_BAND, n_seeds: 3, n_seeds_flipped: 5, seed_flip_means: [0.2, 0.5, 0.8] })).ok).toBe(false);
  });

  it('seed_flip_means length mismatch (count/list inconsistency)', () => {
    expect(assessEnrichmentContract(bodyWithBand({ ...VALID_BAND, seed_flip_means: [0.2, 0.5] })).ok).toBe(false);
  });

  it('negative band_width', () => {
    expect(assessEnrichmentContract(bodyWithBand({ ...VALID_BAND, band_width: -0.1 })).ok).toBe(false);
  });

  it('non-finite endpoint (band_max = Infinity via null in JSON is not number)', () => {
    // A band_max that is not a finite number (e.g. a stringified overflow).
    expect(assessEnrichmentContract(bodyWithBand({ ...VALID_BAND, band_max: 'NaN' as unknown as number })).ok).toBe(false);
  });

  it('reports a stability path + keeps issue_count', () => {
    const a = assessEnrichmentContract(bodyWithBand({ ...VALID_BAND, band_min: 0.9, band_max: 0.1 }));
    expect(a.ok).toBe(false);
    expect(a.issue_count).toBeGreaterThan(0);
    expect(a.issues.some((i) => i.path.startsWith('edge_e_values.0.stability'))).toBe(true);
  });
});
