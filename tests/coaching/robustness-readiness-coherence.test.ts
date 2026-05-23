/**
 * Robustness / readiness coherence regression pin.
 *
 * Documents the *current* semantic tension between three PLoT output surfaces:
 *
 *   - `decision_brief.robustness` (`src/assembly/decision-brief.ts:mapRobustnessLevel`)
 *     is a pure projection of ISL `robustness.level` — graph perturbation
 *     stability only.
 *
 *   - `m1_coaching.readiness` (`src/coaching/next-actions.ts:computeReadiness`)
 *     consumes only `headlineType` + `NARROW_FRAMING` critiques + evidence-gap
 *     count and top VoI. It does NOT consume fragile edges, robustness.level,
 *     low driver confidence, or recommendation_stability directly.
 *
 *   - `deriveReadinessTone` (PR #174, `src/coaching/readiness-tone.ts`)
 *     consumes the broader signal set — fragile edges, robustness level,
 *     stability, driver confidence, near-tie status, evidence gaps — and
 *     gates the executive-summary prose accordingly.
 *
 * Consequence: a brief can carry `robustness: 'robust'` AND `readiness: 'ready'`
 * AND yet produce `caution`-toned executive-summary copy. This is "PR #174's
 * tone gate compensating for narrow readiness semantics, not fixing them" —
 * the headline finding of the scientific-consistency follow-up workstream.
 *
 * This test pins that current behaviour. **Any future change must update it
 * intentionally.** The Priority 1 follow-up (schema-versioned readiness
 * widening) would, when it lands, replace this test with one asserting that
 * `readiness` itself reflects the broader signal set (with DGAI/UI
 * coordination on the enum-to-confidence-tier mapping).
 *
 * See workstream plan and the PR description for the full framing.
 */

import { describe, it, expect } from 'vitest';
import { assembleBrief, type BriefAssemblyInput } from '../../src/assembly/decision-brief.js';
import { computeReadiness } from '../../src/coaching/next-actions.js';
import { generateExecutiveSummary } from '../../src/coaching/executive-summary.js';
import { deriveReadinessTone } from '../../src/coaching/readiness-tone.js';
import { getThresholds } from '../../src/coaching/thresholds.js';
import type { CoachingInputs, EngineGraphV3, EvidenceGap } from '../../src/coaching/types.js';
import type { KeyDriver } from '../../src/coaching/key-drivers.js';

const minimalGraph = (): EngineGraphV3 => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'f_brand', kind: 'factor', label: 'Brand awareness' },
    { id: 'f_cost', kind: 'factor', label: 'Campaign cost' },
  ],
  edges: [
    { from: 'f_brand', to: 'goal', strength: { mean: 0.7, std: 0.1 } },
    { from: 'f_cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } },
  ],
});

const evidenceGap = (factor_id: string, factor_label: string, voi: number, confidence = 0.6): EvidenceGap => ({
  factor_id,
  factor_label,
  voi_score: voi,
  confidence,
  confidence_display: `${Math.round(confidence * 100)}%`,
  confidence_defaulted: false,
  influence: 0.7,
  influence_display: '70%',
  suggestion: '',
  notes: [],
});

describe('Robustness / readiness coherence — known semantic tension', () => {
  // Carefully constructed inputs:
  //   - Clear-winner margin (70% vs 30%) → headlineType = 'clear_winner'.
  //   - robustness.level = 'high', isRobust = true, stability = 0.85
  //     → no NOT_ROBUST, LOW_ROBUSTNESS, or LOW_STABILITY reasons.
  //   - Driver confidence = 0.80 → no LOW_DRIVER_CONFIDENCE.
  //   - Win-prob delta 0.40 → no NEAR_TIE.
  //   - 1 fragile edge with switchProb = 0.34 (> 0.20 threshold)
  //     → triggers MATERIAL_FRAGILE_EDGE (hard reason).
  //   - 1 evidence gap with voi_score = 0.60 (> 0.40 threshold)
  //     → triggers EVIDENCE_GAPS (hard reason).
  //   - 2 hard reasons → tone = 'caution'.
  // Readiness computation (narrow): only 1 evidence gap (< 2-count threshold),
  // headlineType 'clear_winner', no NARROW_FRAMING critique → 'ready'.
  // Robustness projection: level 'high' → 'robust'.
  const coherenceInputs: CoachingInputs = {
    graph: minimalGraph(),
    options: [
      { id: 'opt_a', label: 'Option A', winProbability: 0.7, outcomeMean: 110, outcomeP10: 95, outcomeP90: 125 },
      { id: 'opt_b', label: 'Option B', winProbability: 0.3, outcomeMean: 90, outcomeP10: 75, outcomeP90: 105 },
    ],
    factorSensitivity: [
      { node_id: 'f_brand', label: 'Brand awareness', importance_rank: 1, elasticity: 0.7, influence_score: 0.7, confidence: 0.80, direction: 'positive', zero_reason: undefined },
      { node_id: 'f_cost', label: 'Campaign cost', importance_rank: 2, elasticity: 0.4, influence_score: 0.4, confidence: 0.70, direction: 'negative', zero_reason: undefined },
    ],
    fragileEdges: [
      {
        edgeId: 'f_cost→goal', fromId: 'f_cost', toId: 'goal', fromLabel: 'Campaign cost',
        toLabel: 'Revenue', displayLabel: 'Campaign cost → Revenue', switchProb: 0.34,
        altWinnerId: 'opt_b', altWinnerLabel: 'Option B',
      },
    ],
    robustness: { level: 'high', recommendationStability: 0.85, isRobust: true },
  };

  const coherenceKeyDrivers: KeyDriver[] = [
    { factor_id: 'f_brand', factor_label: 'Brand awareness', influence_score: 0.7, normalised_impact: 1, impact_display: 'Very High', direction: 'positive', rank: 1 },
    { factor_id: 'f_cost', factor_label: 'Campaign cost', influence_score: 0.4, normalised_impact: 0.57, impact_display: 'High', direction: 'negative', rank: 2 },
  ];

  const coherenceGaps: EvidenceGap[] = [
    evidenceGap('f_brand', 'Brand awareness', 0.60, 0.80),
  ];

  it("decision_brief.robustness projects level='high' to 'robust' (status quo)", () => {
    const briefInput: BriefAssemblyInput = {
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [
        { option_id: 'opt_a', option_label: 'Option A', id: 'opt_a', label: 'Option A', win_probability: 0.7 },
        { option_id: 'opt_b', option_label: 'Option B', id: 'opt_b', label: 'Option B', win_probability: 0.3 },
      ] as any,
      robustness: { level: 'high', fragile_edges: [], robust_edges: [] } as any,
      meta: { seed_used: '1' },
    } as any;

    const brief = assembleBrief(briefInput);
    expect(brief).not.toBeNull();
    expect(brief!.robustness).toBe('robust');
  });

  it("m1_coaching.readiness narrow semantics: stays 'ready' despite fragile edges and high-VoI gap", () => {
    const readiness = computeReadiness('clear_winner', [], coherenceGaps, getThresholds());
    expect(readiness).toBe('ready');
  });

  it("deriveReadinessTone (PR #174) returns 'caution' on the same inputs", () => {
    const tone = deriveReadinessTone(
      coherenceInputs,
      'ready',
      'clear_winner',
      coherenceKeyDrivers,
      coherenceGaps,
      getThresholds(),
    );

    expect(tone.tone).toBe('caution');
    expect(tone.reasons).toContain('MATERIAL_FRAGILE_EDGE');
    expect(tone.reasons).toContain('EVIDENCE_GAPS');
    // Robustness signals should NOT fire (level='high', isRobust=true, stability>=0.75)
    expect(tone.reasons).not.toContain('NOT_ROBUST');
    expect(tone.reasons).not.toContain('LOW_ROBUSTNESS');
    expect(tone.reasons).not.toContain('LOW_STABILITY');
    // Driver confidence and near-tie should not fire either.
    expect(tone.reasons).not.toContain('LOW_DRIVER_CONFIDENCE');
    expect(tone.reasons).not.toContain('NEAR_TIE');
  });

  it('executive_summary uses cautious wording despite readiness=ready and robustness=robust', () => {
    const summary = generateExecutiveSummary(coherenceInputs, 'ready', 'clear_winner', coherenceKeyDrivers, coherenceGaps);

    // The PR #174 tone gate must engage: confident "strong current lead"
    // and "reasonable to move forward" copy must NOT appear when tone='caution'.
    expect(summary.summary).not.toContain('strong current lead');
    expect(summary.action_implication).not.toContain('reasonable to move forward');

    // PR #174 banned phrases must remain absent.
    expect(summary.summary.toLowerCase()).not.toContain('ready to proceed');
    expect(summary.summary.toLowerCase()).not.toContain('proceed with implementation');
    expect(summary.summary.toLowerCase()).not.toContain('robust and ready');

    // For clear_winner + caution tone, decision statement uses cautious copy.
    // See executive-summary.ts:83-85.
    expect(summary.decision_statement).toMatch(/not yet strong enough|currently leads/);
  });

  it('structured m1_coaching.readiness_tone surfaces the broad-signal answer (additive, coaching_version 1.2.0)', () => {
    // Same coherenceInputs/Gaps/KeyDrivers as the rest of this suite — assert
    // that the new structured emission carries the broad-signal answer
    // (tone='caution', reasons include MATERIAL_FRAGILE_EDGE + EVIDENCE_GAPS)
    // while legacy readiness stays 'ready'. Documents PR P1 (additive
    // readiness_tone / readiness_reasons) without relaxing the legacy
    // readiness pin above.
    const tone = deriveReadinessTone(
      coherenceInputs,
      'ready',
      'clear_winner',
      coherenceKeyDrivers,
      coherenceGaps,
      getThresholds(),
    );
    expect(tone.tone).toBe('caution');
    expect(tone.reasons).toContain('MATERIAL_FRAGILE_EDGE');
    expect(tone.reasons).toContain('EVIDENCE_GAPS');
  });

  it('the three surfaces disagree by design — robustness=robust + readiness=ready + tone=caution', () => {
    // The headline pin: same inputs, three surfaces, three different "answers".
    // This is the scientific-presentation debt documented in the workstream
    // plan and addressed by the Priority 1 follow-up (schema-versioned
    // readiness widening with DGAI/UI coordination).
    //
    // The brief fixture below carries the same fragile edge present in
    // `coherenceInputs.fragileEdges` so the "same inputs" narrative is
    // literal, not just directional. The outcome is unchanged either way —
    // `mapRobustnessLevel` only reads `level` — but the fixture parity
    // makes the documentary value of the pin honest.
    const briefInput: BriefAssemblyInput = {
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [
        { option_id: 'opt_a', option_label: 'Option A', id: 'opt_a', label: 'Option A', win_probability: 0.7 },
        { option_id: 'opt_b', option_label: 'Option B', id: 'opt_b', label: 'Option B', win_probability: 0.3 },
      ] as any,
      robustness: {
        level: 'high',
        fragile_edges: [
          {
            from_id: 'f_cost',
            to_id: 'goal',
            from_label: 'Campaign cost',
            to_label: 'Revenue',
            switch_probability: 0.34,
          },
        ],
        robust_edges: [],
      } as any,
      meta: { seed_used: '1' },
    } as any;
    const brief = assembleBrief(briefInput);
    const readiness = computeReadiness('clear_winner', [], coherenceGaps, getThresholds());
    const tone = deriveReadinessTone(coherenceInputs, 'ready', 'clear_winner', coherenceKeyDrivers, coherenceGaps, getThresholds());

    expect(brief!.robustness).toBe('robust');       // Graph perturbation stability only.
    expect(readiness).toBe('ready');                // Narrow semantics: framing + gap count.
    expect(tone.tone).toBe('caution');              // Broad signal set — the honest answer.
  });
});
