/**
 * Inference-warning copy coverage — the channel `isl-critique-copy-coverage`
 * deliberately scoped OUT.
 *
 * That file's own words: "NOT included, deliberately: ISL's `InferenceWarning`
 * channel (14 further codes, e.g. ROOT_NODE_DEFAULT_VALUE ...). Whether that
 * channel puts a bare code on a user surface is a separate question with a
 * separate owner." This suite is that owner.
 *
 * TWO GUARDS THAT ARE DELIBERATELY NOT REDUNDANT (trap 12d):
 *
 *   1. A DERIVED guard over PLoT's own `INFERENCE_WARNING_CODES`. It IMPORTS
 *      the registry, so a 16th PLoT code minted with no copy REDs on its own,
 *      with no list here to remember to update. Derivation proves AGREEMENT.
 *
 *   2. A hand-written ISL set, declared as the mirror it is. Derivation cannot
 *      prove COMPLETENESS and cannot see a code that lives in another repo, so
 *      the only thing that can notice a SHORT list is a corpus written by hand.
 *      Ship both or a whole defect class goes unobserved.
 */

import { describe, it, expect } from 'vitest';
import {
  INFERENCE_WARNING_COPY,
  humaniseInferenceWarning,
  addInferenceWarningUserMessages,
  getKnownInferenceWarningCodes,
  INFERENCE_WARNING_BUCKET,
  inferenceWarningBucket,
} from '../src/inference-warning-humaniser.js';
import { INFERENCE_WARNING_CODES } from '../src/types/engine-v3.js';
import type { InferenceWarning } from '../src/types/engine-v3.js';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';

/** DERIVED, never mirrored — PLoT's own registry, imported. */
const PLOT_CODES: readonly string[] = Object.values(INFERENCE_WARNING_CODES);

/**
 * ISL-forwarded codes, evidenced INSIDE THIS REPO so the set is not a guess:
 *   ROOT_NODE_DEFAULT_VALUE      tests/fixtures/isl-pinned/isl-openapi.json
 *                                ("no observed value was provided, so it fell
 *                                 back to 0.0"), plus the sampler transcript.
 *   CONSTRAINT_NODE_DEFAULT_BASE captured in inference_warnings AND critiques,
 *   CONSTRAINT_FRAME_UNSPECIFIED captured in inference_warnings,
 *   CONSTRAINT_NOT_CONVERTIBLE   captured in inference_warnings,
 *     all three in tests/fixtures/isl-constraint-value-frame-20260807/.
 * EVPI_UNAVAILABLE is ISL-originated too but already sits in PLoT's registry,
 * so it arrives via PLOT_CODES and is not repeated here.
 */
const ISL_FORWARDED_CODES: readonly string[] = [
  'ROOT_NODE_DEFAULT_VALUE',
  'CONSTRAINT_NODE_DEFAULT_BASE',
  'CONSTRAINT_FRAME_UNSPECIFIED',
  'CONSTRAINT_NOT_CONVERTIBLE',
];

const ALL_COVERED = [...PLOT_CODES, ...ISL_FORWARDED_CODES];

/** SCREAMING_SNAKE with at least one underscore — a leaked machine code. */
const BARE_MACHINE_CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

function warn(code: string, over: Partial<InferenceWarning> = {}): InferenceWarning {
  return { code, message: 'internal debug text', severity: 'warning', ...over };
}

describe('inference-warning copy coverage', () => {
  it('sanity: the derived registry is non-empty and plausible', () => {
    // Without this a registry that silently became empty would make every
    // coverage assertion below pass by iterating nothing.
    expect(PLOT_CODES.length).toBeGreaterThanOrEqual(15);
    expect(ISL_FORWARDED_CODES.length).toBe(4);
    // PIN THE SUITE'S OWN PRECONDITION. RED 4, 5 and 6 iterate the copy map and
    // therefore PASS VACUOUSLY when it is empty — measured: at an emptied map
    // they were green while nine siblings were red. A guard whose silence is
    // indistinguishable from success is a guard agreeing with itself, so the
    // non-emptiness it depends on is asserted here rather than assumed.
    expect(getKnownInferenceWarningCodes().length).toBeGreaterThanOrEqual(ALL_COVERED.length);
  });

  it('RED 1 — every PLoT inference-warning code has copy (DERIVED from the registry)', () => {
    const known = new Set(getKnownInferenceWarningCodes());
    expect(PLOT_CODES.filter((c) => !known.has(c))).toEqual([]);
  });

  it('RED 2 — every ISL-forwarded code evidenced in this repo has copy', () => {
    const known = new Set(getKnownInferenceWarningCodes());
    expect(ISL_FORWARDED_CODES.filter((c) => !known.has(c))).toEqual([]);
  });

  it('RED 3 — every covered code resolves to a NON-EMPTY user_message', () => {
    const empty = ALL_COVERED.filter((c) => {
      const m = humaniseInferenceWarning(c);
      return m === undefined || m.trim().length === 0;
    });
    expect(empty).toEqual([]);
  });

  it('RED 4 — no copy leaks a bare machine code at the user', () => {
    const leaking = ALL_COVERED.filter((c) =>
      BARE_MACHINE_CODE.test(humaniseInferenceWarning(c) ?? ''),
    );
    expect(leaking).toEqual([]);
  });

  it('RED 5 — copy obeys the house style (no markdown, no shouting, no em dashes)', () => {
    const offenders: string[] = [];
    for (const [code, text] of Object.entries(INFERENCE_WARNING_COPY)) {
      if (/[*_`#]/.test(text)) offenders.push(`${code}: markdown`);
      if (text.includes('!')) offenders.push(`${code}: exclamation mark`);
      // Producer-copy ruling, recorded in isl-v2-golden-response.pin.test.ts.
      if (text.includes('—')) offenders.push(`${code}: em dash`);
      // American -ize/-yze spellings. British English is the house standard.
      if (/\b\w+(?:iz|yz)(?:e|es|ed|ing|ation)\b/.test(text)) offenders.push(`${code}: US spelling`);
      if (!/[.]$/.test(text.trim())) offenders.push(`${code}: no full stop`);
    }
    expect(offenders).toEqual([]);
  });

  it('RED 6 — jargon is never printed unexpanded at the user', () => {
    const jargon = /\bEVPI\b|\bepsilon\b|\bvariance\b|ParameterUncertainty|observed_state|p_win_sensitivity|n_samples/;
    const offenders = Object.entries(INFERENCE_WARNING_COPY)
      .filter(([, t]) => jargon.test(t))
      .map(([c]) => c);
    expect(offenders).toEqual([]);
  });

  // =========================================================================
  // The substituted-zero family. Bound BY IDENTITY to each code's own copy, so
  // deleting a DIFFERENT template cannot make these pass or fail (trap 19).
  // =========================================================================

  it('RED 7 — ROOT_NODE_DEFAULT_VALUE says ZERO plainly, and does not call it an estimate', () => {
    const m = humaniseInferenceWarning('ROOT_NODE_DEFAULT_VALUE')!;
    expect(m).toContain('no measured value');
    expect(m).toContain('zero');
    // The whole point of the string: a substituted zero must never be dressed
    // up as an estimate of the real value.
    expect(m).toMatch(/not an estimate/i);
  });

  it('RED 8 — CONSTRAINT_NODE_DEFAULT_BASE says ZERO plainly', () => {
    const m = humaniseInferenceWarning('CONSTRAINT_NODE_DEFAULT_BASE')!;
    expect(m).toContain('no measured starting value');
    expect(m).toContain('zero');
    // ISL is explicit that with every root ancestor carrying data this figure
    // is "model-derived, not a missing-data placeholder", so the copy must NOT
    // call it unreliable. This binds that restraint.
    expect(m).not.toMatch(/unreliable|cannot be trusted/i);
  });

  it('RED 9 — FLIP_THRESHOLDS_UNAVAILABLE does not claim nothing could flip', () => {
    // The producer added this marker precisely to stop "empty" being read as
    // "no factor could change the leading option".
    const m = humaniseInferenceWarning('FLIP_THRESHOLDS_UNAVAILABLE')!;
    expect(m).toMatch(/could not check/i);
    expect(m).toMatch(/does not mean/i);
  });

  it('RED 10 — EVPI_UNAVAILABLE names no cause, because the captured instance is not a timeout', () => {
    // tests/fixtures/isl-constraint-value-frame-20260807/A-control-no-frame
    // carries EVPI_UNAVAILABLE with reason "constraints_not_convertible" at
    // 60ms. Copy asserting a time limit would be false on the only instance
    // this repo has actually captured.
    const m = humaniseInferenceWarning('EVPI_UNAVAILABLE')!;
    expect(m).not.toMatch(/ran out of time|time limit|timed out|too long/i);
  });

  it('RED 14 — every code with copy also has a disclosure bucket (DERIVED)', () => {
    // A consumer rendering these needs to know which are reassurance and which
    // mean a number is compromised. Derived from the copy map, so a code added
    // with copy but no bucket REDs rather than defaulting to a silent guess.
    const missing = getKnownInferenceWarningCodes().filter((c) => inferenceWarningBucket(c) === undefined);
    expect(missing).toEqual([]);
    // ...and no bucket for a code that has no copy.
    const orphan = Object.keys(INFERENCE_WARNING_BUCKET).filter(
      (c) => humaniseInferenceWarning(c) === undefined,
    );
    expect(orphan).toEqual([]);
  });

  it('RED 15 — the two calibration anchors are bucketed as ruled', () => {
    // Bound by IDENTITY to the anchors the coordinator confirmed at the
    // emitting sites, so a later re-bucketing of either has to argue with this.
    expect(inferenceWarningBucket('ROOT_NODE_DEFAULT_VALUE')).toBe('not_your_number');
    expect(inferenceWarningBucket('CONSTRAINT_NODE_DEFAULT_BASE')).toBe('not_your_number');
    expect(inferenceWarningBucket('EDGE_E_VALUE_NON_FINITE_DROPPED')).toBe('expected');
    // Severity CANNOT produce this split: both of these are `info` and they
    // land in different buckets. Pinning it stops anyone "simplifying" the
    // bucket map into a severity lookup.
    expect(inferenceWarningBucket('ROOT_NODE_DEFAULT_VALUE')).not.toBe(
      inferenceWarningBucket('EDGE_E_VALUE_NON_FINITE_DROPPED'),
    );
  });

  // =========================================================================
  // Wire behaviour
  // =========================================================================

  it('RED 11 — addUserMessages attaches copy without touching the diagnostic channel', () => {
    const input: InferenceWarning[] = [
      warn('ROOT_NODE_DEFAULT_VALUE', { severity: 'info', field: 'factor_sensitivity' }),
      warn('EVPI_UNAVAILABLE', { elapsed_ms: 60.6 }),
    ];
    const out = addInferenceWarningUserMessages(input);

    expect(out.map((w) => w.code)).toEqual(['ROOT_NODE_DEFAULT_VALUE', 'EVPI_UNAVAILABLE']);
    for (const w of out) expect(w.message).toBe('internal debug text');
    expect(out[0].severity).toBe('info');
    expect(out[0].field).toBe('factor_sensitivity');
    expect(out[1].elapsed_ms).toBe(60.6);
    // `toBeDefined` FIRST: without it both sides are `undefined` on an empty
    // map and this assertion passes while attaching nothing (measured).
    expect(out[0].user_message).toBeDefined();
    expect(out[1].user_message).toBeDefined();
    expect(out[0].user_message).toBe(humaniseInferenceWarning('ROOT_NODE_DEFAULT_VALUE'));
    expect(out[1].user_message).toBe(humaniseInferenceWarning('EVPI_UNAVAILABLE'));
    // Input not mutated.
    expect((input[0] as InferenceWarning).user_message).toBeUndefined();
  });

  it('RED 12 — a code with no copy gets NO user_message, rather than a vague sentence', () => {
    const out = addInferenceWarningUserMessages([warn('SOME_FUTURE_ISL_CODE_XYZ')]);
    expect(out[0].user_message).toBeUndefined();
    // The diagnostic survives, which is what the advanced details consume.
    expect(out[0].message).toBe('internal debug text');
    expect(out[0].code).toBe('SOME_FUTURE_ISL_CODE_XYZ');
  });

  it('RED 13 — user_message is additive-safe against the real egress envelope', async () => {
    // The change ships a new key on an element the enrichment guard parses. If
    // AnalysisEnrichmentSchema were strict there, every response carrying a
    // warning would raise ENRICHMENT_CONTRACT_MISMATCH. Proven by execution,
    // with a CONTRAST CONTROL that must FAIL so a green result cannot be
    // vacuous (trap 13).
    const { AnalysisEnrichmentSchema } = await import('@talchain/schemas/boundary');
    const humanised = addInferenceWarningUserMessages([warn('ROOT_NODE_DEFAULT_VALUE')]);

    expect(humanised[0].user_message).toBeDefined();
    expect(AnalysisEnrichmentSchema.safeParse({ inference_warnings: humanised }).success).toBe(true);

    // Contrast: a genuinely malformed element MUST be rejected, or the
    // assertion above proves only that the schema accepts everything.
    const bad = AnalysisEnrichmentSchema.safeParse({
      inference_warnings: [{ code: 123, message: 'x', severity: 'warning' }],
    });
    expect(bad.success).toBe(false);
  });
});

// ===========================================================================
// REACHABILITY — the half that decides whether any of this copy is worth
// writing. `user_message` on the wire is a field a consumer must choose to
// render; `decision_brief.defaulted_assumptions[].note` is ALREADY rendered,
// and until now it echoed the producer's engineer prose verbatim.
// ===========================================================================

describe('defaulted_assumptions[].note reaches the user with product copy', () => {
  function makeInput(warnings: InferenceWarning[]): BriefAssemblyInput {
    return {
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [
        { option_id: 'opt_a', option_label: 'Keep price', id: 'opt_a', label: 'Keep price', win_probability: 0.6 },
        { option_id: 'opt_b', option_label: 'Raise price', id: 'opt_b', label: 'Raise price', win_probability: 0.4 },
      ] as any[],
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      inference_warnings: warnings as any,
      meta: { seed_used: '42' },
    } as BriefAssemblyInput;
  }

  /** The exact producer string captured from ISL, never paraphrased. */
  const CAPTURED_ISL_PROSE =
    "Node 'out_throughput' has no ParameterUncertainty — base offset defaulted to 0.0; " +
    'its samples are the forward-propagated composition of its parents';

  it('a humanised warning puts PRODUCT COPY on the note, not the producer prose', () => {
    const humanised = addInferenceWarningUserMessages([
      { code: 'CONSTRAINT_NODE_DEFAULT_BASE', message: CAPTURED_ISL_PROSE, severity: 'warning' },
    ]);
    const brief = assembleBrief(makeInput(humanised))!;

    const rows = (brief.defaulted_assumptions ?? []).filter(
      (r) => (r as Record<string, unknown>).code === 'CONSTRAINT_NODE_DEFAULT_BASE',
    );
    expect(rows, 'bound by code identity, not by position').toHaveLength(1);
    const note = (rows[0] as Record<string, unknown>).note as string;

    expect(note).toBe(humaniseInferenceWarning('CONSTRAINT_NODE_DEFAULT_BASE'));
    // The specific leak this closes.
    expect(note).not.toContain('ParameterUncertainty');
    expect(note).not.toContain('out_throughput');
    expect(note).not.toContain('forward-propagated');
  });

  it('a code with NO copy still falls back to the producer message, so nothing is lost', () => {
    const brief = assembleBrief(
      makeInput([
        { code: 'SOME_FUTURE_DEFAULT_CODE', message: 'raw producer text', severity: 'info' },
      ]),
    )!;
    const rows = (brief.defaulted_assumptions ?? []).filter(
      (r) => (r as Record<string, unknown>).code === 'SOME_FUTURE_DEFAULT_CODE',
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as Record<string, unknown>).note).toBe('raw producer text');
  });
});
