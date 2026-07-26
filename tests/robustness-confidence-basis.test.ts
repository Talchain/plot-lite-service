/**
 * ROADMAP 1.211 — `confidence` recalibration after ISL PR #114.
 *
 * WHAT CHANGED IN ISL (verified in the merged source at ISL staging 7d144c7,
 * not inferred from the PR prose):
 *
 *   robustness_analyzer_v2.py:4522  recommendation_stability = option_wins[winner] / n_samples
 *   robustness_analyzer_v2.py:4584  confidence = _stability_confidence_figure(stability, n)
 *   robustness_analyzer_v2.py:2739  return recommendation_stability   <- bare, unmodified
 *   robustness_analyzer_v2.py:4596  confidence_basis = "recommendation_stability_uncalibrated"
 *
 * It WAS `min(0.99, stability * (1 - 1/sqrt(n_samples)))`. The shrinkage and the
 * 0.99 cap are withdrawn, so the served value is strictly HIGHER and can now
 * reach exactly 1.0, which the cap previously made unreachable.
 *
 * WHAT THIS MEANS FOR PLoT — two things, and the second is the important one.
 *
 * 1. NO THRESHOLD LOOSENS. ISL's PR flagged "a gate at routes/v2/run.ts:4202"
 *    becoming more permissive. There is no such gate at this tip, at that line
 *    or any other: `robustness.confidence` is read in exactly two places, a
 *    prob01() validity guard and a `!== undefined` presence check, and
 *    robustness-display-verdict.ts carries an explicit invariant that
 *    confidence is NEVER a verdict input. The one indirect path
 *    (confidence -> `score` fallback -> `robustness_score`) is compared against
 *    no number anywhere, and the single behavioural branch on robustness
 *    (`overall_robustness === 'fragile'`) reads `label`/`level`, never `score`.
 *    The tests below PIN that, so if anyone later adds a magnitude threshold
 *    they have to confront these semantics deliberately.
 *
 * 2. PLoT's OWN HONESTY SUPPRESSION IS DEFEATED BY THE PASSTHROUGH.
 *    routes/v2/run.ts deliberately does NOT emit `recommendation_stability`,
 *    documented there as `option_wins[winner]/n_samples` — "the leader's
 *    win_probability relabelled, zero independent information", verified
 *    byte-identical in live captures, and called "a fabricated second
 *    statistic". Post-#114 `confidence` IS that exact quantity. So PLoT
 *    suppresses the number under its honest name and re-publishes it under a
 *    name that implies calibration — which ISL's own field description now
 *    denies outright ("NOT A CONFIDENCE LEVEL").
 *
 * The fix is disclosure, not suppression (doctrine D-5, and ISL deliberately
 * kept the slot because three repos read it): PLoT consumes and forwards
 * `confidence_basis` so a consumer can branch on the semantics instead of
 * inferring them, and can tell a post-#114 payload from a legacy one.
 */
import { describe, it, expect } from 'vitest';
import { prob01 } from '../src/routes/v2/numeric-egress-guards.js';
import { adaptRobustnessAnalysisResponse } from '../src/integrations/isl/adapters/robustness-analysis.js';
import {
  CONFIDENCE_BASIS_STABILITY_UNCALIBRATED,
  resolveConfidenceBasis,
} from '../src/integrations/isl/confidence-basis.js';

describe('confidence_basis — distinguishing post-#114 payloads from legacy ones', () => {
  it('recognises the ISL marker verbatim', () => {
    // The exact literal ISL emits (Literal[...] in response_v2.py:660 and
    // robustness_v2.py:1540). A typo here would silently classify every live
    // payload as legacy, so it is pinned against the source string.
    expect(CONFIDENCE_BASIS_STABILITY_UNCALIBRATED).toBe(
      'recommendation_stability_uncalibrated'
    );
  });

  it('classifies a post-#114 payload by its marker, not by guessing from the value', () => {
    const basis = resolveConfidenceBasis({
      confidence: 0.97,
      confidence_basis: 'recommendation_stability_uncalibrated',
    });

    expect(basis).toBe('recommendation_stability_uncalibrated');
  });

  it('classifies a legacy payload as UNKNOWN rather than assuming the new semantics', () => {
    // A pre-#114 ISL still in flight sends no marker. Its 0.97 meant
    // min(0.99, stability * (1 - 1/sqrt(n))) — a different quantity from a
    // post-#114 0.97. PLoT must not silently treat them as the same thing.
    const basis = resolveConfidenceBasis({ confidence: 0.97 });

    expect(basis).toBe('unknown_legacy');
  });

  it('does NOT infer the basis from the value being high, low, or exactly 1', () => {
    // 1.0 was unreachable under the old 0.99 cap, so it is tempting to treat it
    // as proof of a post-#114 payload. That inference is exactly what the
    // marker exists to replace.
    for (const confidence of [0, 0.5, 0.99, 1]) {
      expect(resolveConfidenceBasis({ confidence })).toBe('unknown_legacy');
    }
  });

  it('rejects an unrecognised marker rather than trusting it', () => {
    expect(
      resolveConfidenceBasis({ confidence: 0.5, confidence_basis: 'something_new' })
    ).toBe('unknown_legacy');
  });
});

describe('the emission boundary, pinned in BOTH directions', () => {
  // The only real suppression boundary on this field is the prob01 validity
  // guard: a value inside [0,1] publishes, anything else is withheld. Pinned
  // both ways so neither half can regress unnoticed.

  it('PUBLISHES values inside the valid range — including the newly reachable 1.0', () => {
    expect(prob01(0)).toBe(0);
    expect(prob01(0.5)).toBe(0.5);
    expect(prob01(0.968)).toBe(0.968);
    // Reachable only post-#114: the old formula capped at 0.99.
    expect(prob01(1)).toBe(1);
  });

  it('SUPPRESSES values outside it, and every non-finite form', () => {
    expect(prob01(1.0000001)).toBeUndefined();
    expect(prob01(-0.0001)).toBeUndefined();
    expect(prob01(NaN)).toBeUndefined();
    expect(prob01(Infinity)).toBeUndefined();
    expect(prob01(null)).toBeUndefined();
    expect(prob01(undefined)).toBeUndefined();
    expect(prob01('0.9')).toBeUndefined();
  });

  it('the raised value does NOT cross the boundary — the change cannot flip suppression', () => {
    // For every stability fraction, old <= new and both stay inside [0,1], so
    // no input exists for which #114 turns a withheld value into a published
    // one. This is the "nothing loosens" claim, made checkable.
    for (const stability of [0, 0.1, 0.5, 0.9, 0.99, 1]) {
      const legacy = Math.min(0.99, stability * (1 - 1 / Math.sqrt(1000)));
      const current = stability;

      expect(current).toBeGreaterThanOrEqual(legacy);
      expect(prob01(legacy) !== undefined).toBe(prob01(current) !== undefined);
    }
  });
});

describe('no magnitude threshold consumes robustness.confidence', () => {
  // Regression pin for finding (1). The confidence -> score fallback is live
  // (/v1/run -> analyseRobustness -> this adapter), so if a threshold on
  // robustness_score is ever introduced, it inherits confidence's semantics.

  it('confidence still back-fills the V1 score slot when score is absent', () => {
    const result = adaptRobustnessAnalysisResponse(
      {
        robustness: {
          confidence: 0.97,
          confidence_basis: 'recommendation_stability_uncalibrated',
          level: 'high',
          fragile_edges: [],
          robust_edges: [],
        },
      } as never,
      100,
      'available',
      'available'
    );

    expect(result.robustness_score).toBe(0.97);
  });

  it('the robustness LABEL is derived from level, never from the confidence-fed score', () => {
    // This is what stops the raised value moving a verdict: `label` comes from
    // `level`, so a confidence of 0.97 under level 'low' must still read 'fragile'.
    const result = adaptRobustnessAnalysisResponse(
      {
        robustness: {
          confidence: 0.97,
          confidence_basis: 'recommendation_stability_uncalibrated',
          level: 'low',
          fragile_edges: [],
          robust_edges: [],
        },
      } as never,
      100,
      'available',
      'available'
    );

    expect(result.robustness_score).toBe(0.97);
    expect(result.overall_robustness).toBe('fragile');
  });

  it('an explicit score still wins over confidence — the fallback is a fallback', () => {
    const result = adaptRobustnessAnalysisResponse(
      {
        robustness: {
          score: 0.2,
          confidence: 0.97,
          confidence_basis: 'recommendation_stability_uncalibrated',
          level: 'high',
          fragile_edges: [],
          robust_edges: [],
        },
      } as never,
      100,
      'available',
      'available'
    );

    expect(result.robustness_score).toBe(0.2);
  });
});
