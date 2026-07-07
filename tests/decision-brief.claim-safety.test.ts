/**
 * Decision Brief claim-safe surfaces (Lane PLoT-R3, roadmap 2.7 producer leg)
 *
 * Covers the ADDITIVE provisional_doctrine_v0 surfaces on DecisionBriefV1:
 *   - headline_banded: UI-SEM-060 gap-band wording matrix
 *     ('very close' / 'slightly ahead' / 'clearly ahead' — the strongest
 *     claim ONLY when robustness is established);
 *   - defaulted_assumptions: value_defaulted factors (pinned levers
 *     excluded) + DEFAULT-coded inference-warning disclosures;
 *   - robustness_caveat: honest is_robust/level wording (absence stated);
 *   - warning_codes: warning-severity echo;
 *   - forbidden-wording tripwire: no 'EVPI' / 'expected value' anywhere in
 *     an assembled brief;
 *   - flag gate: '0' suppresses every new surface (golden byte-identity).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';

afterEach(() => {
  delete process.env.BRIEF_CLAIM_SAFE_SURFACES_ENABLE;
});

/** Two-option input with a configurable gap and robustness signal. */
function makeInput(overrides: {
  topWin?: number;
  secondWin?: number;
  robustness?: Record<string, unknown>;
  factor_sensitivity?: unknown[];
  inference_warnings?: Array<{ code: string; message: string; severity: 'info' | 'warning' }>;
  option_comparison?: unknown[];
} = {}): BriefAssemblyInput {
  const topWin = overrides.topWin ?? 0.6;
  const secondWin = overrides.secondWin ?? 0.4;
  return {
    analysis_status: 'computed',
    critiques: [],
    option_comparison: (overrides.option_comparison ?? [
      { option_id: 'opt_a', option_label: 'Keep price', id: 'opt_a', label: 'Keep price', win_probability: topWin },
      { option_id: 'opt_b', option_label: 'Raise price', id: 'opt_b', label: 'Raise price', win_probability: secondWin },
    ]) as any[],
    robustness: (overrides.robustness ?? { level: 'moderate', fragile_edges: [], robust_edges: [] }) as any,
    factor_sensitivity: overrides.factor_sensitivity as any,
    inference_warnings: overrides.inference_warnings as any,
    meta: { seed_used: '42' },
  };
}

// =============================================================================
// Band wording matrix (UI-SEM-060 gap bands, provisional_doctrine_v0)
// =============================================================================

describe('headline_banded — band matrix', () => {
  it('gap < 0.10 → very_close (never a lead claim)', () => {
    const brief = assembleBrief(makeInput({ topWin: 0.52, secondWin: 0.48 }))!;
    expect(brief.headline_banded).toBeDefined();
    expect(brief.headline_banded!.band).toBe('very_close');
    expect(brief.headline_banded!.text).toContain('very close');
    expect(brief.headline_banded!.text).not.toContain('clearly ahead');
    expect(brief.headline_banded!.text).not.toContain('slightly ahead');
    expect(brief.headline_banded!.win_probability_gap).toBeCloseTo(0.04, 10);
    expect(brief.headline_banded!.doctrine).toBe('provisional_doctrine_v0');
  });

  it('0.10 <= gap < 0.25 → slightly_ahead regardless of robustness', () => {
    const brief = assembleBrief(makeInput({
      topWin: 0.575, secondWin: 0.425,
      robustness: { is_robust: true, level: 'high', fragile_edges: [], robust_edges: [] },
    }))!;
    expect(brief.headline_banded!.band).toBe('slightly_ahead');
    expect(brief.headline_banded!.text).toContain('slightly ahead');
    expect(brief.headline_banded!.robustness_gated).toBe(false);
  });

  it('gap >= 0.25 AND is_robust true → clearly_ahead', () => {
    const brief = assembleBrief(makeInput({
      topWin: 0.65, secondWin: 0.35,
      robustness: { is_robust: true, fragile_edges: [], robust_edges: [] },
    }))!;
    expect(brief.headline_banded!.band).toBe('clearly_ahead');
    expect(brief.headline_banded!.text).toBe('Keep price is clearly ahead.');
    expect(brief.headline_banded!.robustness_gated).toBe(false);
  });

  it('gap >= 0.25 AND level high (no explicit is_robust) → clearly_ahead', () => {
    const brief = assembleBrief(makeInput({
      topWin: 0.65, secondWin: 0.35,
      robustness: { level: 'high', fragile_edges: [], robust_edges: [] },
    }))!;
    expect(brief.headline_banded!.band).toBe('clearly_ahead');
  });

  it('CLAIM SAFETY: gap >= 0.25 but robustness NOT established → downgraded to slightly_ahead with robustness_gated', () => {
    const cases: Array<Record<string, unknown>> = [
      { level: 'medium', fragile_edges: [], robust_edges: [] },
      { level: 'low', fragile_edges: [], robust_edges: [] },
      { is_robust: false, level: 'high', fragile_edges: [], robust_edges: [] }, // explicit false beats level
      { fragile_edges: [], robust_edges: [] },                                  // no signal at all
    ];
    for (const robustness of cases) {
      const brief = assembleBrief(makeInput({ topWin: 0.7, secondWin: 0.3, robustness }))!;
      expect(brief.headline_banded!.band).toBe('slightly_ahead');
      expect(brief.headline_banded!.robustness_gated).toBe(true);
      expect(brief.headline_banded!.text).not.toContain('clearly ahead');
    }
  });

  it('single ranked option → no headline_banded (no comparative claim without a comparison)', () => {
    const brief = assembleBrief(makeInput({
      option_comparison: [
        { option_id: 'opt_a', option_label: 'Only option', id: 'opt_a', label: 'Only option', win_probability: 0.9 },
      ],
    }))!;
    expect(brief.headline_banded).toBeUndefined();
  });

  it('band boundaries: gap exactly 0.10 → slightly_ahead; exactly 0.25 + robust → clearly_ahead', () => {
    // 0.2 − 0.1 === 0.1 exactly in IEEE-754 doubles (0.55 − 0.45 is NOT),
    // so this pins the >= boundary without float drift.
    const atNearTie = assembleBrief(makeInput({ topWin: 0.2, secondWin: 0.1 }))!;
    expect(atNearTie.headline_banded!.band).toBe('slightly_ahead');

    const atClear = assembleBrief(makeInput({
      topWin: 0.625, secondWin: 0.375,
      robustness: { is_robust: true, fragile_edges: [], robust_edges: [] },
    }))!;
    expect(atClear.headline_banded!.band).toBe('clearly_ahead');
  });
});

// =============================================================================
// Defaulted assumptions (value_defaulted + DEFAULT disclosures)
// =============================================================================

describe('defaulted_assumptions', () => {
  it('includes value_defaulted factors with claim-safe wording', () => {
    const brief = assembleBrief(makeInput({
      factor_sensitivity: [
        { factor_id: 'f1', factor_label: 'Market Size', elasticity: 0.5, value_defaulted: true },
        { factor_id: 'f2', factor_label: 'Churn', elasticity: 0.3 }, // absent value_defaulted → excluded
        { factor_id: 'f3', factor_label: 'Costs', elasticity: 0.2, value_defaulted: false },
      ],
    }))!;
    expect(brief.defaulted_assumptions).toHaveLength(1);
    expect(brief.defaulted_assumptions![0]).toMatchObject({
      factor_label: 'Market Size',
      source: 'value_defaulted',
      doctrine: 'provisional_doctrine_v0',
    });
    expect(brief.defaulted_assumptions![0].note).toContain('Market Size');
    expect(brief.defaulted_assumptions![0].note).toContain('default');
  });

  it('CLAIM SAFETY: intervention-pinned levers NEVER appear in defaulted_assumptions', () => {
    const brief = assembleBrief(makeInput({
      factor_sensitivity: [
        { factor_id: 'lever', factor_label: 'Price', elasticity: 0.9, value_defaulted: true, zero_reason: 'intervention_override' },
        { factor_id: 'f1', factor_label: 'Market Size', elasticity: 0.5, value_defaulted: true },
      ],
    }))!;
    const labels = brief.defaulted_assumptions!.map((a) => a.factor_label);
    expect(labels).toEqual(['Market Size']);
    expect(JSON.stringify(brief.defaulted_assumptions)).not.toContain('Price');
  });

  it('echoes DEFAULT-coded inference warnings as run-level disclosures (deduped by code)', () => {
    const brief = assembleBrief(makeInput({
      inference_warnings: [
        { code: 'ROOT_NODE_DEFAULT_VALUE', message: 'Root node used a default value', severity: 'info' },
        { code: 'ROOT_NODE_DEFAULT_VALUE', message: 'Root node used a default value (dup)', severity: 'info' },
        { code: 'EDGE_SENSITIVITY_UNAVAILABLE', message: 'Not default-related', severity: 'info' },
      ],
    }))!;
    const disclosures = brief.defaulted_assumptions!.filter((a) => a.source === 'default_disclosure');
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]).toMatchObject({
      factor_label: null,
      code: 'ROOT_NODE_DEFAULT_VALUE',
      note: 'Root node used a default value',
    });
  });

  it('is [] when nothing was defaulted', () => {
    const brief = assembleBrief(makeInput({}))!;
    expect(brief.defaulted_assumptions).toEqual([]);
  });
});

// =============================================================================
// Robustness caveat (honest wording, absence stated)
// =============================================================================

describe('robustness_caveat', () => {
  it('is_robust true → held-up wording with no-guarantee qualifier (basis is_robust)', () => {
    const brief = assembleBrief(makeInput({
      robustness: { is_robust: true, fragile_edges: [], robust_edges: [] },
    }))!;
    expect(brief.robustness_caveat!.basis).toBe('is_robust');
    expect(brief.robustness_caveat!.text).toContain('held up');
    expect(brief.robustness_caveat!.text).toContain('not a guarantee');
  });

  it('is_robust false → did-not-pass wording (never softened)', () => {
    const brief = assembleBrief(makeInput({
      robustness: { is_robust: false, fragile_edges: [], robust_edges: [] },
    }))!;
    expect(brief.robustness_caveat!.basis).toBe('is_robust');
    expect(brief.robustness_caveat!.text).toContain('did not pass');
  });

  it('level medium → moderately-stable wording (basis level)', () => {
    const brief = assembleBrief(makeInput({
      robustness: { level: 'medium', fragile_edges: [], robust_edges: [] },
    }))!;
    expect(brief.robustness_caveat!.basis).toBe('level');
    expect(brief.robustness_caveat!.text).toContain('moderately stable');
  });

  it('level low / very_low → fragile wording', () => {
    for (const level of ['low', 'very_low']) {
      const brief = assembleBrief(makeInput({
        robustness: { level, fragile_edges: [], robust_edges: [] },
      }))!;
      expect(brief.robustness_caveat!.text).toContain('fragile');
    }
  });

  it('HONESTY: no is_robust and no level → says robustness was not assessed (basis absent)', () => {
    const brief = assembleBrief(makeInput({
      robustness: { fragile_edges: [], robust_edges: [] },
    }))!;
    expect(brief.robustness_caveat!.basis).toBe('absent');
    expect(brief.robustness_caveat!.text).toContain('not assessed');
  });
});

// =============================================================================
// Warning codes echo
// =============================================================================

describe('warning_codes', () => {
  it('echoes only warning-severity codes, deduped and sorted', () => {
    const brief = assembleBrief(makeInput({
      inference_warnings: [
        { code: 'CONSTRAINT_TARGET_UNRELIABLE', message: 'x', severity: 'warning' },
        { code: 'AUTO_NOISE_APPLIED', message: 'y', severity: 'warning' },
        { code: 'AUTO_NOISE_APPLIED', message: 'y2', severity: 'warning' },
        { code: 'EDGE_SENSITIVITY_UNAVAILABLE', message: 'z', severity: 'info' },
      ],
    }))!;
    expect(brief.warning_codes).toEqual(['AUTO_NOISE_APPLIED', 'CONSTRAINT_TARGET_UNRELIABLE']);
  });

  it('is [] when the run carried no warning-severity warnings', () => {
    const brief = assembleBrief(makeInput({}))!;
    expect(brief.warning_codes).toEqual([]);
  });
});

// =============================================================================
// Forbidden-wording tripwire + existing claim-safety invariants
// =============================================================================

describe('claim-safety wording invariants', () => {
  it('an assembled brief NEVER contains EVPI or expected-value wording', () => {
    const brief = assembleBrief(makeInput({
      topWin: 0.7, secondWin: 0.3,
      robustness: { is_robust: true, level: 'high', fragile_edges: [], robust_edges: [] },
      factor_sensitivity: [
        { factor_id: 'f1', factor_label: 'Market Size', elasticity: 0.5, value_defaulted: true },
      ],
      inference_warnings: [
        { code: 'ROOT_NODE_DEFAULT_VALUE', message: 'Root node used a default value', severity: 'warning' },
      ],
    }))!;
    const serialised = JSON.stringify(brief);
    expect(serialised).not.toMatch(/EVPI/i);
    expect(serialised).not.toMatch(/expected value/i);
    expect(serialised).not.toMatch(/sensitive to/i);
  });

  it('CLAIM SAFETY: pinned levers stay out of top_drivers and what_would_change with the new surfaces active', () => {
    const brief = assembleBrief(makeInput({
      factor_sensitivity: [
        { factor_id: 'lever', factor_label: 'Price', elasticity: 0.9, zero_reason: 'intervention_override' },
        { factor_id: 'f1', factor_label: 'Market Size', elasticity: 0.5 },
      ],
    }))!;
    expect(brief.top_drivers.map((d) => d.factor_label)).toEqual(['Market Size']);
    expect(brief.what_would_change).toEqual(['Market Size']);
  });
});

// =============================================================================
// Flag gate (golden byte-identity guarantee)
// =============================================================================

describe('BRIEF_CLAIM_SAFE_SURFACES_ENABLE gate', () => {
  it("flag '0' suppresses every claim-safe surface (pre-R3 brief shape)", () => {
    process.env.BRIEF_CLAIM_SAFE_SURFACES_ENABLE = '0';
    const brief = assembleBrief(makeInput({
      factor_sensitivity: [
        { factor_id: 'f1', factor_label: 'Market Size', elasticity: 0.5, value_defaulted: true },
      ],
      inference_warnings: [
        { code: 'CONSTRAINT_TARGET_UNRELIABLE', message: 'x', severity: 'warning' },
      ],
    }))!;
    expect(brief.headline_banded).toBeUndefined();
    expect(brief.defaulted_assumptions).toBeUndefined();
    expect(brief.robustness_caveat).toBeUndefined();
    expect(brief.warning_codes).toBeUndefined();
    expect(Object.keys(brief)).not.toContain('headline_banded');
    expect(Object.keys(brief)).not.toContain('defaulted_assumptions');
    expect(Object.keys(brief)).not.toContain('robustness_caveat');
    expect(Object.keys(brief)).not.toContain('warning_codes');
  });

  it('unset flag (default) emits the surfaces', () => {
    delete process.env.BRIEF_CLAIM_SAFE_SURFACES_ENABLE;
    const brief = assembleBrief(makeInput({}))!;
    expect(brief.headline_banded).toBeDefined();
    expect(brief.robustness_caveat).toBeDefined();
    expect(brief.defaulted_assumptions).toEqual([]);
    expect(brief.warning_codes).toEqual([]);
  });
});
