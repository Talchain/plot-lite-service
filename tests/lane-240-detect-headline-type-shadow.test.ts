/**
 * 2.40 — detectHeadlineType shadow reconciliation (readiness path).
 *
 * MECHANISM (pre-fix): src/coaching/m1-coaching.ts carried a module-local
 * `detectHeadlineType` duplicate (never importing the canonical one from
 * src/coaching/headlines.ts). The duplicate was the one called for the
 * readiness path (m1-coaching.ts:93), and it was RISK-BLIND: it ignored
 * fragile edges and VoI entirely (it could never return 'high_uncertainty'),
 * hardcoded thresholds instead of getThresholds(), and applied none of the
 * A1b/A1c lever filtering. Consequences on the served payload:
 *
 *   1. A genuine (non-lever) fragile edge was suppressed on the readiness
 *      path — headline_type said 'clear_winner' and readiness said 'ready'
 *      while story_headlines (canonical path, SAME payload) simultaneously
 *      said "X could swing the outcome to Y". Overstated readiness +
 *      internally inconsistent coaching.
 *   2. Lever exclusion held only BY ACCIDENT (the duplicate ignored all risk
 *      signals, lever and non-lever alike) — not by the A1b/A1c predicates.
 *
 * FIX: the duplicate is deleted; m1-coaching imports the canonical
 * lever-aware detectHeadlineType. These tests pin:
 *   - RED→GREEN: non-lever fragile edge now downgrades the readiness path
 *     (headline_type high_uncertainty, readiness close_call) — pre-fix this
 *     asserted clear_winner/ready.
 *   - Reconciliation identity: m1_coaching.headline_type === canonical
 *     detectHeadlineType over the same normalised inputs (anti-drift pin).
 *   - Lever-aware guards (A1c fragile-edge arm + A1b VoI arm): an
 *     option-controlled lever must NOT drive high_uncertainty on the
 *     readiness path — now guaranteed by the canonical predicates, not by
 *     accidental risk-blindness.
 */
import { describe, it, expect } from 'vitest';
import { generateM1Coaching } from '../src/coaching/m1-coaching.js';
import { detectHeadlineType } from '../src/coaching/headlines.js';
import { normaliseCoachingInputs } from '../src/coaching/normalise-inputs.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';

const LEVER = 'fac_dev_capacity';
const LEVER_LABEL = 'Additional Developer Capacity';
const NONLEVER = 'fac_time_pressure';
const NONLEVER_LABEL = 'Launch Deadline Pressure';

const makeGraph = (): EngineGraphV3 => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'On-Time Launch' },
    { id: NONLEVER, kind: 'factor', label: NONLEVER_LABEL, category: 'external' },
    { id: LEVER, kind: 'factor', label: LEVER_LABEL, category: 'controllable' },
  ],
  edges: [
    { from: NONLEVER, to: 'goal', strength: { mean: -0.6, std: 0.2 } },
    { from: LEVER, to: 'goal', strength: { mean: 0.7, std: 0.1 } },
  ],
});

// 3 options incl. Status Quo → no NARROW_FRAMING blocker (which would force
// readiness to needs_framing regardless of headline type and mask the
// divergence under test). Winner delta 0.60 + stability 0.90 → clear_winner
// in BOTH implementations absent any risk signal, so any downgrade observed
// below is attributable to the fragile-edge / VoI arms alone.
const makeOptions = (withLeverIntervention: boolean): OptionV3[] => [
  {
    id: 'opt1', label: 'Option A', winProbability: 0.75, expectedOutcome: 120,
    // Request-side truth for interventionTargetIds (normalise-inputs.ts:139)
    ...(withLeverIntervention ? { interventions: { [LEVER]: 1 } } : {}),
  } as OptionV3,
  { id: 'opt2', label: 'Option B', winProbability: 0.15, expectedOutcome: 80 },
  { id: 'opt3', label: 'Status Quo', winProbability: 0.10, expectedOutcome: 70 },
];

// High-confidence non-lever factor: VoI = |elasticity| × (1 − 0.9) = 0.04,
// far below headline_high_uncertainty_voi (0.30) and readiness_high_voi_threshold
// (0.40) — so evidence gaps cannot drive the readiness outcome in these tests.
const nonLeverFactor = () => ({
  node_id: NONLEVER, label: NONLEVER_LABEL, importance_rank: 1,
  elasticity: -0.4, influence_score: 0.6, confidence: 0.9, direction: 'negative',
});

const makeIslResult = (overrides: {
  fragileFrom?: string;
  factorSensitivity?: any[];
}) => ({
  options: [
    { id: 'opt1', label: 'Option A', win_probability: 0.75, outcome: { mean: 120, p10: 100, p90: 140 } },
    { id: 'opt2', label: 'Option B', win_probability: 0.15, outcome: { mean: 80, p10: 60, p90: 100 } },
    { id: 'opt3', label: 'Status Quo', win_probability: 0.10, outcome: { mean: 70, p10: 50, p90: 90 } },
  ],
  factor_sensitivity: overrides.factorSensitivity ?? [nonLeverFactor()],
  robustness: {
    recommendation_stability: 0.9,
    fragile_edges: overrides.fragileFrom
      ? [{
          edge_id: `${overrides.fragileFrom}->goal`,
          from_id: overrides.fragileFrom,
          to_id: 'goal',
          // 0.5 > headline_high_uncertainty_fragile (0.25) → canonical
          // classifier must return high_uncertainty when the edge is non-lever.
          switch_probability: 0.5,
          alternative_winner_id: 'opt2',
        }]
      : [],
  },
});

describe('2.40 — readiness path uses the canonical lever-aware detectHeadlineType', () => {
  it('RED→GREEN: a genuine NON-lever fragile edge downgrades the readiness path (pre-fix: clear_winner/ready while the story headline said "could swing")', () => {
    const coaching = generateM1Coaching(
      makeGraph(), makeOptions(false), makeIslResult({ fragileFrom: NONLEVER })
    );

    expect(coaching).toBeDefined();
    // RED pre-fix: duplicate ignored fragile edges → 'clear_winner'
    expect(coaching!.headline_type).toBe('high_uncertainty');
    // RED pre-fix: 'ready' (computeReadiness maps clear_winner → ready)
    expect(coaching!.readiness).toBe('close_call');
    // The canonical story headline ALREADY said swing-risk pre-fix — this pins
    // that headline_type/readiness and story_headlines now agree on one payload.
    expect(coaching!.story_headlines['opt1']).toContain('could swing the outcome');
    expect(coaching!.story_headlines['opt1']).toContain(NONLEVER_LABEL);
  });

  it('reconciliation identity: m1_coaching.headline_type === canonical detectHeadlineType over the same normalised inputs', () => {
    const graph = makeGraph();
    for (const [options, islResult] of [
      [makeOptions(false), makeIslResult({ fragileFrom: NONLEVER })],
      [makeOptions(true), makeIslResult({ fragileFrom: LEVER })],
      [makeOptions(false), makeIslResult({})],
    ] as const) {
      const coaching = generateM1Coaching(graph, options as OptionV3[], islResult);
      const canonical = detectHeadlineType(
        normaliseCoachingInputs(graph, options as OptionV3[], islResult)
      );
      expect(coaching!.headline_type).toBe(canonical);
    }
  });

  it('lever guard (A1c arm): a lever-SOURCED fragile edge does NOT drive high_uncertainty on the readiness path', () => {
    const coaching = generateM1Coaching(
      makeGraph(), makeOptions(true), makeIslResult({ fragileFrom: LEVER })
    );

    expect(coaching).toBeDefined();
    // Lever edge excluded by isLeverSourcedEdge (interventionTargetIds from
    // options[].interventions) → no qualifying fragile edge → clear_winner.
    expect(coaching!.headline_type).toBe('clear_winner');
    expect(coaching!.readiness).toBe('ready');
    // And the lever is not named as a swing risk anywhere in the story headlines.
    expect(Object.values(coaching!.story_headlines).join(' || ')).not.toContain(LEVER_LABEL);
  });

  it('lever guard (A1b arm): a high-elasticity intervention_override lever does NOT drive high_uncertainty via the VoI arm', () => {
    const coaching = generateM1Coaching(
      makeGraph(), makeOptions(true), makeIslResult({
        factorSensitivity: [
          nonLeverFactor(),
          // Naive VoI would be |0.9| × (1 − 0.2) = 0.72 > 0.30 → without the
          // A1b filter this factor alone would flip the type to high_uncertainty.
          {
            node_id: LEVER, label: LEVER_LABEL, importance_rank: 2,
            elasticity: 0.9, influence_score: 0.9, confidence: 0.2,
            direction: 'positive', zero_reason: 'intervention_override',
          },
        ],
      })
    );

    expect(coaching).toBeDefined();
    expect(coaching!.headline_type).toBe('clear_winner');
    expect(coaching!.readiness).toBe('ready');
  });
});
