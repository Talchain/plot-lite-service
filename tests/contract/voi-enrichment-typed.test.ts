/**
 * ROADMAP 2.160 — the four VOI enrichment keys must be VALIDATED, not forwarded blind.
 *
 * THE DEFECT THIS PINS (measured at the 0.22.0 pin, 2026-07-30):
 * `islEnrichmentPassthrough` (src/routes/v2/run-contract-keys.ts) forwards
 * `correlation_model` / `decision_evpi` / `factor_evppi` / `p_win_sensitivity`
 * verbatim as TOP-LEVEL keys of the /v2/run success body. The egress guard
 * (src/routes/v2/enrichment-egress-guard.ts) parses that whole body against
 * `AnalysisEnrichmentSchema` — but at 0.22.0 that schema did not contain ANY of
 * the four (0 occurrences in the entire tarball), and it is `.passthrough()`.
 * So `decision_evpi: 'NOT-A-NUMBER'` parsed CLEAN and the guard stamped
 * `_meta.evidence.enrichment_contract_ok: true`. The guard's own disclosure
 * field asserted a validation that never happened for these four keys.
 *
 * Measured RED at 0.22.0 — all four `safeParse` calls returned success:true:
 *   typed by schema? correlation_model false / decision_evpi false /
 *   factor_evppi false / p_win_sensitivity false
 *
 * 0.30.0 adopts the family (`AnalysisEnrichmentSchema`: `decision_evpi` is
 * `z.number().nullable().optional()`, `factor_evppi` an array of
 * `EnrichmentFactorEvppiEntrySchema`, and both open-typed members typed as
 * array/object rather than "anything"), so the guard that was already running
 * now actually sees these keys.
 *
 * TWO ARMS, deliberately:
 *  A. STRUCTURAL (derive-don't-mirror, trap 12): every key in the hand-written
 *     `ISL_TOPLEVEL_ENRICHMENT_KEYS` must be a TYPED property of
 *     `AnalysisEnrichmentSchema.shape` — not merely absorbed by `.passthrough()`.
 *     This fails LOUD in BOTH directions: a contract that drops a key, and a
 *     fifth key added to PLoT's forward list that the contract does not type
 *     (which would silently recreate exactly this blind-passthrough defect).
 *  B. BEHAVIOURAL: `assessEnrichmentContract` must actually REPORT a shape
 *     violation on each of the four, at a path naming the offending key.
 *
 * POSITIVE CONTROL (trap 13 — an absence/detection assertion is vacuous until
 * it can see a PRESENCE): a CONFORMANT VOI payload must assess `ok: true`. Without
 * it, arm B would pass just as well if the guard rejected everything.
 */

import { describe, it, expect } from 'vitest';
import { AnalysisEnrichmentSchema } from '@talchain/schemas/boundary';
import { ISL_TOPLEVEL_ENRICHMENT_KEYS } from '../../src/routes/v2/run-contract-keys.js';
import { assessEnrichmentContract } from '../../src/routes/v2/enrichment-egress-guard.js';

/** The typed (non-passthrough) property names of the shared envelope. */
const typedEnvelopeKeys = (): Set<string> =>
  new Set(Object.keys((AnalysisEnrichmentSchema as unknown as { shape: object }).shape));

// ---------------------------------------------------------------------------
// Arm A — structural: the forward list must be contract-TYPED, not passthrough
// ---------------------------------------------------------------------------

describe('VOI enrichment keys are TYPED by the shared envelope (not passthrough-absorbed)', () => {
  it('every ISL_TOPLEVEL_ENRICHMENT_KEYS entry is a typed property of AnalysisEnrichmentSchema', () => {
    const typed = typedEnvelopeKeys();
    const untyped = ISL_TOPLEVEL_ENRICHMENT_KEYS.filter((k) => !typed.has(k));
    // RED at 0.22.0: all four are untyped, so the guard cannot see any shape
    // violation on them and stamps enrichment_contract_ok: true regardless.
    expect(untyped).toEqual([]);
  });

  it('names all four VOI keys explicitly, so shrinking the forward list cannot hide the regression', () => {
    // Arm A above is derived from the runtime constant; if someone "fixed" a
    // failure by DELETING a key from that constant, the derived assertion would
    // go green while the key stopped being forwarded. This literal pins the
    // family the roadmap item is about. The family travels together by design —
    // correlation_model is the discriminator for an absent p_win_sensitivity.
    expect([...ISL_TOPLEVEL_ENRICHMENT_KEYS]).toEqual([
      'correlation_model',
      'decision_evpi',
      'factor_evppi',
      'p_win_sensitivity',
    ]);
    const typed = typedEnvelopeKeys();
    for (const k of ['correlation_model', 'decision_evpi', 'factor_evppi', 'p_win_sensitivity']) {
      expect(typed.has(k), `${k} must be typed by AnalysisEnrichmentSchema`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Arm B — behavioural: the guard reports a violation on each VOI key
// ---------------------------------------------------------------------------

describe('assessEnrichmentContract detects VOI shape violations', () => {
  // Each case is a GROSS type violation — the class that passed silently at 0.22.0.
  const violations: ReadonlyArray<[string, unknown]> = [
    ['decision_evpi', 'NOT-A-NUMBER'],
    ['factor_evppi', 'not-an-array'],
    ['p_win_sensitivity', 42],
    ['correlation_model', 'not-an-object'],
  ];

  for (const [key, badValue] of violations) {
    it(`reports a violation for ${key}`, () => {
      const a = assessEnrichmentContract({ [key]: badValue });
      expect(a.ok, `${key}=${JSON.stringify(badValue)} must NOT assess as conformant`).toBe(false);
      expect(a.issues.map((i) => i.path)).toContain(key);
      // PII discipline (matches the guard's existing contract): the offending
      // VALUE never appears in the assessment, only its path + code.
      expect(JSON.stringify(a)).not.toContain('NOT-A-NUMBER');
    });
  }

  it('reports a violation inside a factor_evppi row (required factor_id missing)', () => {
    const a = assessEnrichmentContract({ factor_evppi: [{ evppi: 1.5 }] });
    expect(a.ok).toBe(false);
    expect(a.issues.map((i) => i.path)).toContain('factor_evppi.0.factor_id');
  });

  // ---- POSITIVE CONTROL (trap 13) ----------------------------------------
  it('POSITIVE CONTROL: a conformant VOI payload assesses ok — the arm above is not rejecting everything', () => {
    const a = assessEnrichmentContract({
      decision_evpi: 12.5,
      factor_evppi: [
        { factor_id: 'f_price', evppi: 3.2, units: 'outcome', status: 'resolved' },
        { factor_id: 'f_demand', evppi: 0.4, status: 'below_resolution' },
      ],
      p_win_sensitivity: [{ factor_id: 'f_price', delta_pp: 1.2 }],
      correlation_model: { suppressed_attributions: ['p_win_sensitivity'] },
    });
    expect(a).toEqual({ ok: true, issues: [], issue_count: 0, withheld_units: [] });
  });

  it('POSITIVE CONTROL: decision_evpi === 0 stays VALID — a measured zero is a real result', () => {
    // The contract is explicit that absence means NOT COMPUTED while 0 means
    // "nothing about this decision is worth learning". A guard "hardened" with a
    // truthiness check would reject the real fact; pin against that.
    const a = assessEnrichmentContract({ decision_evpi: 0 });
    expect(a).toEqual({ ok: true, issues: [], issue_count: 0, withheld_units: [] });
  });

  it('absent VOI keys stay valid — the family is optional, absence is not a violation', () => {
    expect(assessEnrichmentContract({})).toEqual({ ok: true, issues: [], issue_count: 0, withheld_units: [] });
  });

  it('explicit null on the nullable VOI keys stays valid', () => {
    const a = assessEnrichmentContract({
      decision_evpi: null,
      factor_evppi: null,
      p_win_sensitivity: null,
      correlation_model: null,
    });
    expect(a).toEqual({ ok: true, issues: [], issue_count: 0, withheld_units: [] });
  });
});
