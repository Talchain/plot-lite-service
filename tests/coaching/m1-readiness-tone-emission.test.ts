/**
 * Structural emission of `m1_coaching.readiness_tone` and
 * `m1_coaching.readiness_reasons` (coaching_version >= 1.2.0).
 *
 * Covers:
 *   1. Confident emission (no hard reasons, reasons === [])
 *   2. Tempered emission (one hard reason)
 *   3. Caution emission (two hard reasons)
 *   4. Emitted fields exactly match deriveReadinessTone on the same inputs
 *   5. Legacy `m1_coaching.readiness` and `coaching_version` invariants
 *   6. Fallback recomputation when `precomputedTone` is omitted by a direct
 *      unit-test caller of generateExecutiveSummary / generateNextActions
 *
 * NOTE: No mocked-throw safe-failure test. If deriveReadinessTone throws, the
 * existing top-level try/catch in generateM1Coaching nulls the whole
 * m1_coaching block — that is the shared fallback and is unchanged by this PR.
 */

import { describe, it, expect } from 'vitest';
import { generateM1Coaching } from '../../src/coaching/m1-coaching.js';
import { generateExecutiveSummary } from '../../src/coaching/executive-summary.js';
import { generateNextActions } from '../../src/coaching/next-actions.js';
import { normaliseCoachingInputs } from '../../src/coaching/normalise-inputs.js';
import { deriveReadinessTone } from '../../src/coaching/readiness-tone.js';
import { computeKeyDrivers } from '../../src/coaching/key-drivers.js';
import { computeEvidenceGaps } from '../../src/coaching/evidence-gaps.js';
import { getThresholds } from '../../src/coaching/thresholds.js';
import { deriveConfidenceTier } from '../../src/trust/confidence-tier.js';
import type { EngineGraphV3, OptionV3 } from '../../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Fixture builders — each shapes ISL data so the derived tone is predictable.
// ---------------------------------------------------------------------------

const baseGraph = (): EngineGraphV3 => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'f1', kind: 'factor', label: 'Brand awareness', category: 'controllable' },
    { id: 'f2', kind: 'factor', label: 'Market risk', category: 'external' },
  ],
  edges: [
    { from: 'f1', to: 'goal', strength: { mean: 0.7, std: 0.1 } },
    { from: 'f2', to: 'goal', strength: { mean: -0.4, std: 0.1 } },
  ],
});

// Three options (including a baseline) so NARROW_FRAMING does not fire and
// `m1.readiness` can land on 'ready' when the headline_type is clear_winner.
const baseOptions = (): OptionV3[] => [
  { id: 'opt_a', label: 'Option A', winProbability: 0.80, expectedOutcome: 120 },
  { id: 'opt_b', label: 'Option B', winProbability: 0.15, expectedOutcome: 80 },
  { id: 'opt_status_quo', label: 'Status quo', winProbability: 0.05, expectedOutcome: 50 },
];

interface IslOverrides {
  fragileSwitchProb?: number;
  f1Confidence?: number;
  f2Confidence?: number;
  stability?: number;
  robustnessLevel?: 'high' | 'moderate' | 'low' | 'very_low';
  isRobust?: boolean;
  winProbWinner?: number;
  winProbRunnerUp?: number;
}

const islResult = (o: IslOverrides = {}) => ({
  options: [
    {
      id: 'opt_a',
      label: 'Option A',
      win_probability: o.winProbWinner ?? 0.80,
      outcome: { mean: 120, p10: 100, p90: 140 },
    },
    {
      id: 'opt_b',
      label: 'Option B',
      win_probability: o.winProbRunnerUp ?? 0.15,
      outcome: { mean: 80, p10: 60, p90: 100 },
    },
    {
      id: 'opt_status_quo',
      label: 'Status quo',
      win_probability: 0.05,
      outcome: { mean: 50, p10: 40, p90: 60 },
    },
  ],
  factor_sensitivity: [
    {
      node_id: 'f1',
      label: 'Brand awareness',
      importance_rank: 1,
      elasticity: 0.7,
      influence_score: 0.85,
      confidence: o.f1Confidence ?? 0.90,
      direction: 'positive',
    },
    {
      node_id: 'f2',
      label: 'Market risk',
      importance_rank: 2,
      elasticity: -0.3,
      influence_score: 0.40,
      confidence: o.f2Confidence ?? 0.85,
      direction: 'negative',
    },
  ],
  robustness: {
    level: o.robustnessLevel ?? 'high',
    is_robust: o.isRobust ?? true,
    fragile_edges:
      o.fragileSwitchProb !== undefined
        ? [
            {
              edge_id: 'f2→goal',
              from_id: 'f2',
              to_id: 'goal',
              switch_probability: o.fragileSwitchProb,
              marginal_switch_probability: o.fragileSwitchProb,
              alternative_winner_id: 'opt_b',
            },
          ]
        : [],
    recommendation_stability: o.stability ?? 0.90,
  },
});

const baseOptionsForTone = baseOptions;
const baseGraphForTone = baseGraph;

// ---------------------------------------------------------------------------
// 1. Confident emission
// ---------------------------------------------------------------------------

describe('m1_coaching.readiness_tone — confident emission', () => {
  it('emits tone=confident and reasons=[] when no hard reasons fire', () => {
    const m1 = generateM1Coaching(baseGraphForTone(), baseOptionsForTone(), islResult());
    expect(m1).not.toBeNull();
    expect(m1!.readiness_tone).toBe('confident');
    expect(m1!.readiness_reasons).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Tempered emission
// ---------------------------------------------------------------------------

describe('m1_coaching.readiness_tone — tempered emission', () => {
  it('emits tone=tempered with one hard reason (MATERIAL_FRAGILE_EDGE)', () => {
    // Confident base + a single fragile edge with switchProb > 0.20 threshold.
    // All other signals stay clean: high robustness, high stability, high
    // driver confidence, wide margin, no high-VOI gap.
    const m1 = generateM1Coaching(
      baseGraphForTone(),
      baseOptionsForTone(),
      islResult({ fragileSwitchProb: 0.30 }),
    );
    expect(m1).not.toBeNull();
    expect(m1!.readiness_tone).toBe('tempered');
    expect(m1!.readiness_reasons).toContain('MATERIAL_FRAGILE_EDGE');
    // Exactly one hard reason — the classifier may still append
    // INSUFFICIENT_SIGNALS if any optional signal is missing, but that is
    // not a hard reason and so does not push tone to 'caution'.
    expect(m1!.readiness_tone).not.toBe('caution');
  });
});

// ---------------------------------------------------------------------------
// 3. Caution emission
// ---------------------------------------------------------------------------

describe('m1_coaching.readiness_tone — caution emission', () => {
  it('emits tone=caution when two or more hard reasons fire', () => {
    // Two hard reasons:
    //   - MATERIAL_FRAGILE_EDGE  (switch_prob 0.34 > 0.20)
    //   - EVIDENCE_GAPS          (top driver confidence 0.40 inflates VOI
    //                             above the 0.40 threshold; influence 0.85
    //                             yields voi_score ~0.51)
    const m1 = generateM1Coaching(
      baseGraphForTone(),
      baseOptionsForTone(),
      islResult({ fragileSwitchProb: 0.34, f1Confidence: 0.40 }),
    );
    expect(m1).not.toBeNull();
    expect(m1!.readiness_tone).toBe('caution');
    expect(m1!.readiness_reasons).toContain('MATERIAL_FRAGILE_EDGE');
    expect(m1!.readiness_reasons).toContain('EVIDENCE_GAPS');
  });
});

// ---------------------------------------------------------------------------
// 4. Emission matches deriveReadinessTone exactly
// ---------------------------------------------------------------------------

describe('m1_coaching.readiness_tone — matches deriveReadinessTone', () => {
  it('emitted tone+reasons deep-equal an independent deriveReadinessTone call', () => {
    const graph = baseGraphForTone();
    const options = baseOptionsForTone();
    const isl = islResult({ fragileSwitchProb: 0.34, f1Confidence: 0.40 });

    const m1 = generateM1Coaching(graph, options, isl);
    expect(m1).not.toBeNull();

    // Recompute tone independently from the same normalised inputs.
    const inputs = normaliseCoachingInputs(graph, options, isl);
    const evidenceGaps = computeEvidenceGaps(inputs);
    const keyDrivers = computeKeyDrivers(inputs);
    const independent = deriveReadinessTone(
      inputs,
      m1!.readiness,
      m1!.headline_type,
      keyDrivers,
      evidenceGaps,
      getThresholds(),
    );

    expect(m1!.readiness_tone).toBe(independent.tone);
    expect(m1!.readiness_reasons).toEqual(independent.reasons);
  });
});

// ---------------------------------------------------------------------------
// 5. Legacy invariants — readiness and coaching_version
// ---------------------------------------------------------------------------

describe('m1_coaching — legacy field invariants under tone emission', () => {
  it('legacy readiness still resolves to "ready" on a previously-ready fixture', () => {
    const m1 = generateM1Coaching(baseGraphForTone(), baseOptionsForTone(), islResult());
    expect(m1).not.toBeNull();
    expect(m1!.readiness).toBe('ready');
    expect(m1!.headline_type).toBe('clear_winner');
  });

  it('coaching_version is bumped to 1.2.0 for the additive fields', () => {
    const m1 = generateM1Coaching(baseGraphForTone(), baseOptionsForTone(), islResult());
    expect(m1).not.toBeNull();
    expect(m1!.coaching_version).toBe('1.2.0');
  });

  it('confidence_tier derivation from legacy readiness is unchanged ("ready" → "strong")', () => {
    // Confidence-tier preservation invariant: this PR adds readiness_tone /
    // readiness_reasons but must NOT alter the legacy `readiness` →
    // `confidence_tier` mapping consumed by DGAI/UI today (see
    // src/routes/v2/run.ts:2008 and src/trust/confidence-tier.ts).
    const m1 = generateM1Coaching(baseGraphForTone(), baseOptionsForTone(), islResult());
    expect(m1).not.toBeNull();
    expect(m1!.readiness).toBe('ready');
    expect(deriveConfidenceTier(m1!.readiness)).toBe('strong');
  });
});

// ---------------------------------------------------------------------------
// 6. Fallback recomputation for direct callers (unit tests / library users)
// ---------------------------------------------------------------------------

describe('precomputedTone is genuinely optional for direct callers', () => {
  const graph = baseGraphForTone();
  const options = baseOptionsForTone();
  const isl = islResult({ fragileSwitchProb: 0.30 });

  const inputs = normaliseCoachingInputs(graph, options, isl);
  const evidenceGaps = computeEvidenceGaps(inputs);
  const keyDrivers = computeKeyDrivers(inputs);
  const headlineType = 'clear_winner' as const;
  const readiness = 'ready' as const;
  const tone = deriveReadinessTone(inputs, readiness, headlineType, keyDrivers, evidenceGaps, getThresholds());

  it('generateExecutiveSummary produces identical prose with or without precomputedTone', () => {
    const withTone = generateExecutiveSummary(inputs, readiness, headlineType, keyDrivers, evidenceGaps, tone);
    const withoutTone = generateExecutiveSummary(inputs, readiness, headlineType, keyDrivers, evidenceGaps);

    expect(withoutTone).toEqual(withTone);
  });

  it('generateNextActions produces identical actions with or without precomputedTone', () => {
    const withTone = generateNextActions(inputs, headlineType, [], evidenceGaps, tone);
    const withoutTone = generateNextActions(inputs, headlineType, [], evidenceGaps);

    expect(withoutTone).toEqual(withTone);
  });
});
