/**
 * M1 Coaching Unit Tests
 *
 * Tests all B1-B4 components for determinism, correctness, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { generateM1Coaching } from '../../src/coaching/m1-coaching.js';
import { generateHeadlines, detectHeadlineType } from '../../src/coaching/headlines.js';
import { computeEvidenceGaps } from '../../src/coaching/evidence-gaps.js';
import { generateCritiques } from '../../src/coaching/critiques.js';
import { generateNextActions, computeReadiness } from '../../src/coaching/next-actions.js';
import { normaliseCoachingInputs } from '../../src/coaching/normalise-inputs.js';
import { getThresholds } from '../../src/coaching/thresholds.js';
import type { CoachingInputs, EngineGraphV3, OptionV3 } from '../../src/coaching/types.js';

// Test fixtures
const createMinimalGraph = (): EngineGraphV3 => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'f1', kind: 'factor', label: 'Cost', category: 'controllable' },
    { id: 'f2', kind: 'factor', label: 'Market Risk', category: 'external' },
  ],
  edges: [
    { from: 'f1', to: 'goal', strength: { mean: 0.8, std: 0.1 } },
    { from: 'f2', to: 'goal', strength: { mean: -0.6, std: 0.15 } },
  ],
});

const createMinimalOptions = (): OptionV3[] => [
  { id: 'opt1', label: 'Option A', winProbability: 0.75, expectedOutcome: 120 },
  { id: 'opt2', label: 'Option B', winProbability: 0.25, expectedOutcome: 80 },
];

const createMinimalISLResult = () => ({
  options: [
    {
      id: 'opt1',
      label: 'Option A',
      win_probability: 0.75,
      outcome: { mean: 120, p10: 100, p90: 140 },
    },
    {
      id: 'opt2',
      label: 'Option B',
      win_probability: 0.25,
      outcome: { mean: 80, p10: 60, p90: 100 },
    },
  ],
  factor_sensitivity: [
    {
      node_id: 'f1',
      label: 'Cost',
      importance_rank: 1,
      elasticity: 0.45,
      influence_score: 0.85,
      confidence: 0.6,
      direction: 'positive',
    },
    {
      node_id: 'f2',
      label: 'Market Risk',
      importance_rank: 2,
      elasticity: -0.35,
      influence_score: 0.65,
      confidence: 0.3,
      direction: 'negative',
    },
  ],
  robustness: {
    fragile_edges: [
      {
        edge_id: 'f1→goal',
        from_id: 'f1',
        to_id: 'goal',
        switch_probability: 0.25,
        marginal_switch_probability: 0.25,
        alternative_winner_id: 'opt2',
      },
    ],
    recommendation_stability: 0.75,
  },
});

// =============================================================================
// B1: Story Headlines
// =============================================================================

describe('B1: Story Headlines', () => {
  it('detects "clear_winner" when winProb > 0.70 and delta > 0.30', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: [
        { id: 'opt1', label: 'Option A', winProbability: 0.80, expectedOutcome: 120 },
        { id: 'opt2', label: 'Option B', winProbability: 0.20, expectedOutcome: 80 },
      ],
      factorSensitivity: [
        { node_id: 'f1', label: 'Cost', importance_rank: 1, confidence: 0.8, elasticity: 0.5, influence_score: 0.5 },
      ],
      fragileEdges: [],
      robustness: { recommendationStability: 0.85 },
    };

    const headlineType = detectHeadlineType(inputs);
    expect(headlineType).toBe('clear_winner');

    const headlines = generateHeadlines(inputs);
    expect(headlines['opt1']).toContain('Option A');
    expect(headlines['opt1']).toContain('60');
  });

  it('detects "moderate_winner" when winProb > 0.55 and delta > 0.15', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: [
        { id: 'opt1', label: 'Option A', winProbability: 0.65, expectedOutcome: 110 },
        { id: 'opt2', label: 'Option B', winProbability: 0.35, expectedOutcome: 90 },
      ],
      factorSensitivity: [
        { node_id: 'f1', label: 'Cost', importance_rank: 1, confidence: 0.7, elasticity: 0.4, influence_score: 0.4 },
      ],
      fragileEdges: [],
      robustness: { recommendationStability: 0.60 },
    };

    const headlineType = detectHeadlineType(inputs);
    expect(headlineType).toBe('moderate_winner');
  });

  it('detects "close_call" when delta < 0.10', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: [
        { id: 'opt1', label: 'Option A', winProbability: 0.52, expectedOutcome: 102 },
        { id: 'opt2', label: 'Option B', winProbability: 0.48, expectedOutcome: 98 },
      ],
      factorSensitivity: [
        { node_id: 'f1', label: 'Cost', importance_rank: 1, confidence: 0.6, elasticity: 0.3, influence_score: 0.3 },
      ],
      fragileEdges: [],
      robustness: { recommendationStability: 0.50 },
    };

    const headlineType = detectHeadlineType(inputs);
    expect(headlineType).toBe('close_call');
  });

  it('detects "high_uncertainty" when topGapVoI > 0.30', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [
        { node_id: 'f1', label: 'Cost', importance_rank: 1, confidence: 0.3, elasticity: 0.8, influence_score: 0.8 },
        { node_id: 'f2', label: 'Market Risk', importance_rank: 2, confidence: 0.2, elasticity: 0.7, influence_score: 0.7 },
      ],
      fragileEdges: [],
      robustness: { recommendationStability: 0.60 },
    };

    const headlineType = detectHeadlineType(inputs);
    expect(headlineType).toBe('high_uncertainty');
  });

  it('detects "needs_evidence" when no factor sensitivity', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [],
      fragileEdges: [],
      robustness: {},
    };

    const headlineType = detectHeadlineType(inputs);
    expect(headlineType).toBe('needs_evidence');
  });

  it('generates headlines for all options', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: [
        { id: 'opt1', label: 'Option A', winProbability: 0.75, expectedOutcome: 120 },
        { id: 'opt2', label: 'Option B', winProbability: 0.25, expectedOutcome: 80 },
      ],
      factorSensitivity: [],
      fragileEdges: [],
      robustness: { recommendationStability: 0.80 },
    };

    const headlines = generateHeadlines(inputs);
    expect(headlines['opt1']).toBeDefined();
    expect(headlines['opt2']).toBeDefined();
    expect(headlines['opt2']).toContain('Runner-up');
  });
});

// =============================================================================
// B2: Evidence Gaps
// =============================================================================

describe('B2: Evidence Gaps', () => {
  it('computes VoI as normalisedImpact × (1 - confidence)', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [
        {
          node_id: 'f1',
          label: 'Cost',
          importance_rank: 1,
          elasticity: 0.8,
          influence_score: 0.8,
          confidence: 0.5,
        },
        {
          node_id: 'f2',
          label: 'Market Risk',
          importance_rank: 2,
          elasticity: 0.4,
          influence_score: 0.4,
          confidence: 0.9,
        },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const gaps = computeEvidenceGaps(inputs);

    // f1: normalised = 0.8/0.8 = 1.0, VoI = 1.0 × (1 - 0.5) = 0.5
    // f2: normalised = 0.4/0.8 = 0.5, VoI = 0.5 × (1 - 0.9) = 0.05
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0].factor_id).toBe('f1');
    expect(gaps[0].voi_score).toBeCloseTo(0.5, 2);
  });

  it('defaults confidence to 0.5 when undefined', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [
        {
          node_id: 'f1',
          label: 'Cost',
          importance_rank: 1,
          elasticity: 0.6,
          influence_score: 0.6,
          // No confidence field
        },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const gaps = computeEvidenceGaps(inputs);
    expect(gaps[0].confidence).toBe(0.5);
    expect(gaps[0].confidence_defaulted).toBe(true);
    expect(gaps[0].notes[0]).toContain('defaulted to 50%');
  });

  it('filters to top quartile with floor of 3', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: Array.from({ length: 12 }, (_, i) => ({
        node_id: `f${i}`,
        label: `Factor ${i}`,
        importance_rank: i + 1,
        elasticity: 0.5 - i * 0.04,
        influence_score: 0.5 - i * 0.04,
        confidence: 0.3,
      })),
      fragileEdges: [],
      robustness: {},
    };

    const gaps = computeEvidenceGaps(inputs);
    // Top quartile of 12 = ceil(12/4) = 3
    // But filters to confidence < 0.7 and caps at 3
    expect(gaps.length).toBeLessThanOrEqual(3);
  });

  it('returns empty array when factorSensitivity is empty', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [],
      fragileEdges: [],
      robustness: {},
    };

    const gaps = computeEvidenceGaps(inputs);
    expect(gaps).toEqual([]);
  });

  it('includes human-readable displays for influence and confidence', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [
        {
          node_id: 'f1',
          label: 'Cost',
          importance_rank: 1,
          elasticity: 0.75,
          influence_score: 0.75,
          confidence: 0.45,
        },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const gaps = computeEvidenceGaps(inputs);
    expect(gaps[0].influence_display).toBe('100%');
    expect(gaps[0].confidence_display).toBe('45%');
  });
});

// =============================================================================
// B3: Model Critiques
// =============================================================================

describe('B3: Model Critiques', () => {
  it('detects DOMINANT_FACTOR when one factor >= 50% of total elasticity', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [
        {
          node_id: 'f1',
          label: 'Cost',
          importance_rank: 1,
          elasticity: 0.8,
          influence_score: 0.8,
        },
        {
          node_id: 'f2',
          label: 'Market Risk',
          importance_rank: 2,
          elasticity: 0.2,
          influence_score: 0.2,
        },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const critiques = generateCritiques(inputs);
    const dominant = critiques.find((c) => c.type === 'DOMINANT_FACTOR');
    expect(dominant).toBeDefined();
    expect(dominant?.challenge_question).toContain('Cost');
  });

  it('detects MISSING_RISK_PATHWAY when no negative factors', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [
        {
          node_id: 'f1',
          label: 'Cost',
          importance_rank: 1,
          elasticity: 0.5,
          influence_score: 0.5,
          direction: 'positive',
        },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const critiques = generateCritiques(inputs);
    const missingRisk = critiques.find((c) => c.type === 'MISSING_RISK_PATHWAY');
    expect(missingRisk).toBeDefined();
    expect(missingRisk?.challenge_question).toContain('What could go wrong');
  });

  it('does NOT fire MISSING_RISK_PATHWAY when risk node has negative edge to goal (false-positive guard)', () => {
    // Regression test: risk_overhead → goal_productivity with negative edge is a valid
    // risk pathway and must NOT trigger MISSING_RISK_PATHWAY.
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal_productivity', kind: 'goal', label: 'Productivity' },
        { id: 'risk_overhead', kind: 'risk', label: 'Overhead Risk' },
        { id: 'fac_budget', kind: 'factor', label: 'Budget', category: 'controllable' },
      ],
      edges: [
        // Risk node → goal with negative direction — valid risk pathway
        { from: 'risk_overhead', to: 'goal_productivity', strength: { mean: -0.4, std: 0.1 }, effect_direction: 'negative' },
        { from: 'fac_budget', to: 'goal_productivity', strength: { mean: 0.6, std: 0.1 } },
      ],
    };

    const inputs: CoachingInputs = {
      graph,
      options: createMinimalOptions(),
      // factorSensitivity has only the budget factor (ISL may not surface risk nodes here)
      // direction field absent — simulating the ISL gap that was causing the false-positive
      factorSensitivity: [
        {
          node_id: 'fac_budget',
          label: 'Budget',
          importance_rank: 1,
          elasticity: 0.6,
          influence_score: 0.6,
          direction: 'positive',
        },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const critiques = generateCritiques(inputs);
    const missingRisk = critiques.find((c) => c.type === 'MISSING_RISK_PATHWAY');
    expect(missingRisk, 'MISSING_RISK_PATHWAY should NOT fire when risk→goal negative edge exists').toBeUndefined();
  });

  it('does NOT fire MISSING_RISK_PATHWAY when ISL reports negative elasticity (no direction field)', () => {
    // Regression test: ISL sometimes omits direction but negative elasticity implies risk pathway.
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [
        {
          node_id: 'f2',
          label: 'Market Risk',
          importance_rank: 1,
          elasticity: -0.35,  // negative elasticity, no direction field
          influence_score: 0.5,
          direction: undefined,
        },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const critiques = generateCritiques(inputs);
    const missingRisk = critiques.find((c) => c.type === 'MISSING_RISK_PATHWAY');
    expect(missingRisk, 'MISSING_RISK_PATHWAY should NOT fire when elasticity is negative').toBeUndefined();
  });

  it('detects INFLUENTIAL_EXTERNALS when external in top quartile', () => {
    const graph = createMinimalGraph();
    const inputs: CoachingInputs = {
      graph,
      options: createMinimalOptions(),
      factorSensitivity: [
        {
          node_id: 'f2',
          label: 'Market Risk',
          importance_rank: 1,
          elasticity: 0.7,
          influence_score: 0.7,
        },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const critiques = generateCritiques(inputs);
    const influential = critiques.find((c) => c.type === 'INFLUENTIAL_EXTERNALS');
    expect(influential).toBeDefined();
    expect(influential?.challenge_question).toContain('Market Risk');
  });

  it('detects NARROW_FRAMING with <= 2 options and no status quo', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [],
      fragileEdges: [],
      robustness: {},
    };

    const critiques = generateCritiques(inputs);
    const narrow = critiques.find((c) => c.type === 'NARROW_FRAMING');
    expect(narrow).toBeDefined();
    expect(narrow?.challenge_question).toContain('Only 2 options');
  });

  it('detects ANCHORING_RISK when top factors have 0.5 baseline', () => {
    const graph = createMinimalGraph();
    graph.nodes[1] = {
      id: 'f1',
      kind: 'factor',
      label: 'Cost',
      category: 'controllable',
      observed_state: { value: 0.5 },
    };

    const inputs: CoachingInputs = {
      graph,
      options: createMinimalOptions(),
      factorSensitivity: [
        {
          node_id: 'f1',
          label: 'Cost',
          importance_rank: 1,
          elasticity: 0.6,
          influence_score: 0.6,
        },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const critiques = generateCritiques(inputs);
    const anchoring = critiques.find((c) => c.type === 'ANCHORING_RISK');
    expect(anchoring).toBeDefined();
    expect(anchoring?.challenge_question).toContain('0.5 baseline');
  });

  it('detects OVERCONFIDENCE when avgConfidence > 0.85', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [
        {
          node_id: 'f1',
          label: 'Cost',
          importance_rank: 1,
          elasticity: 0.5,
          influence_score: 0.5,
          confidence: 0.9,
        },
        {
          node_id: 'f2',
          label: 'Market Risk',
          importance_rank: 2,
          elasticity: 0.3,
          influence_score: 0.3,
          confidence: 0.95,
        },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const critiques = generateCritiques(inputs);
    const overconfident = critiques.find((c) => c.type === 'OVERCONFIDENCE');
    expect(overconfident).toBeDefined();
    // Average is (0.9 + 0.95) / 2 = 0.925, rounded to 93%
    expect(overconfident?.challenge_question).toContain('93%');
  });
});

// =============================================================================
// B4: Next Actions
// =============================================================================

describe('B4: Next Actions', () => {
  it('computes readiness as "needs_framing" when NARROW_FRAMING critique exists', () => {
    const readiness = computeReadiness(
      'moderate_winner',
      [{ type: 'NARROW_FRAMING', severity: 'blocker', challenge_question: '', suggested_action: '' }],
      [],
      getThresholds()
    );
    expect(readiness).toBe('needs_framing');
  });

  it('computes readiness as "needs_evidence" when high evidence gaps', () => {
    const readiness = computeReadiness(
      'moderate_winner',
      [],
      [
        { factor_id: 'f1', factor_label: 'Cost', voi_score: 0.5, confidence: 0.3, influence: 0.8 },
        { factor_id: 'f2', factor_label: 'Risk', voi_score: 0.4, confidence: 0.4, influence: 0.6 },
      ],
      getThresholds()
    );
    expect(readiness).toBe('needs_evidence');
  });

  it('computes readiness as "close_call" for close_call headline', () => {
    const readiness = computeReadiness('close_call', [], [], getThresholds());
    expect(readiness).toBe('close_call');
  });

  it('computes readiness as "ready" for clear_winner headline', () => {
    const readiness = computeReadiness('clear_winner', [], [], getThresholds());
    expect(readiness).toBe('ready');
  });

  it('generates max 3 actions', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: [
        { id: 'opt1', label: 'Option A', winProbability: 0.52, expectedOutcome: 102 },
        { id: 'opt2', label: 'Option B', winProbability: 0.48, expectedOutcome: 98 },
      ],
      factorSensitivity: [
        {
          node_id: 'f1',
          label: 'Cost',
          importance_rank: 1,
          elasticity: 0.5,
          influence_score: 0.5,
          confidence: 0.3,
        },
      ],
      fragileEdges: [
        {
          edgeId: 'f1→goal',
          fromId: 'f1',
          toId: 'goal',
          fromLabel: 'Cost',
          toLabel: 'Revenue',
          displayLabel: 'Cost → Revenue',
          switchProb: 0.30,
          altWinnerId: 'opt2',
          altWinnerLabel: 'Option B',
        },
      ],
      robustness: { recommendationStability: 0.60 },
    };

    const actions = generateNextActions(
      inputs,
      'close_call',
      [{ type: 'NARROW_FRAMING', severity: 'blocker', challenge_question: '', suggested_action: '' }],
      [{ factor_id: 'f1', factor_label: 'Cost', voi_score: 0.5, confidence: 0.3, influence: 0.8 }]
    );

    expect(actions.length).toBeLessThanOrEqual(3);
  });

  it('prioritizes narrow framing first', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [],
      fragileEdges: [],
      robustness: {},
    };

    const actions = generateNextActions(
      inputs,
      'moderate_winner',
      [{ type: 'NARROW_FRAMING', severity: 'blocker', challenge_question: '', suggested_action: '' }],
      []
    );

    expect(actions[0].priority).toBe(1);
    expect(actions[0].action).toContain('Reconsider framing');
  });

  it('includes required rationale for each action', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: [
        { id: 'opt1', label: 'Option A', winProbability: 0.80, expectedOutcome: 120 },
        { id: 'opt2', label: 'Option B', winProbability: 0.20, expectedOutcome: 80 },
      ],
      factorSensitivity: [],
      fragileEdges: [],
      robustness: { recommendationStability: 0.85 },
    };

    const actions = generateNextActions(inputs, 'clear_winner', [], []);

    actions.forEach((action) => {
      expect(action.rationale).toBeDefined();
      expect(action.rationale.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Input Normalisation
// =============================================================================

describe('normaliseCoachingInputs', () => {
  it('builds human-readable labels from graph nodes', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    const islResult = createMinimalISLResult();

    const inputs = normaliseCoachingInputs(graph, options, islResult);

    expect(inputs.factorSensitivity[0].label).toBe('Cost');
    expect(inputs.factorSensitivity[1].label).toBe('Market Risk');
  });

  it('formats fragile edges as "{fromLabel} → {toLabel}"', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    const islResult = {
      ...createMinimalISLResult(),
      robustness: {
        fragile_edges: [
          {
            edge_id: 'f1-goal',
            from_id: 'f1',
            to_id: 'goal',
            switch_probability: 0.25,
            marginal_switch_probability: 0.25,
            alternative_winner_id: 'opt2',
          },
        ],
      },
    };

    const inputs = normaliseCoachingInputs(graph, options, islResult);

    expect(inputs.fragileEdges[0].displayLabel).toBe('Cost → Revenue');
  });

  it('enriches options with labels and win probabilities', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    const islResult = createMinimalISLResult();

    const inputs = normaliseCoachingInputs(graph, options, islResult);

    expect(inputs.options[0].label).toBe('Option A');
    expect(inputs.options[0].winProbability).toBe(0.75);
  });
});

// =============================================================================
// M1 Orchestrator
// =============================================================================

describe('generateM1Coaching', () => {
  it('returns M1Coaching object with all B1-B4 components', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    const islResult = createMinimalISLResult();

    const coaching = generateM1Coaching(graph, options, islResult);

    expect(coaching).toBeDefined();
    expect(coaching?.story_headlines).toBeDefined();
    expect(coaching?.evidence_gaps).toBeDefined();
    expect(coaching?.model_critiques).toBeDefined();
    expect(coaching?.next_actions).toBeDefined();
    expect(coaching?.computed_at).toBeDefined();
  });

  it('isolates errors in individual components', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    const islResult = {
      // Missing factor_sensitivity will cause error in evidence gaps
      robustness: {},
    };

    const coaching = generateM1Coaching(graph, options, islResult);

    // Should still return object with successful components
    expect(coaching).toBeDefined();
    // Headlines should work (doesn't require factor_sensitivity)
    expect(coaching?.story_headlines).toBeDefined();
  });

  it('returns null when critical errors occur', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    // @ts-ignore - intentionally invalid
    const islResult = null;

    const coaching = generateM1Coaching(graph, options, islResult);

    expect(coaching).toBeNull();
  });

  it('produces identical output for identical inputs (determinism)', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    const islResult = createMinimalISLResult();

    const run1 = generateM1Coaching(graph, options, islResult);
    const run2 = generateM1Coaching(graph, options, islResult);

    // Compare structure (excluding computed_at timestamp)
    expect(run1?.story_headlines).toEqual(run2?.story_headlines);
    expect(run1?.evidence_gaps).toEqual(run2?.evidence_gaps);
    expect(run1?.model_critiques).toEqual(run2?.model_critiques);
    expect(run1?.next_actions).toEqual(run2?.next_actions);
  });

  it('completes within performance budget', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    const islResult = createMinimalISLResult();

    const start = performance.now();
    generateM1Coaching(graph, options, islResult);
    const elapsed = performance.now() - start;

    // < 100ms budget
    expect(elapsed).toBeLessThan(100);
  });
});

// =============================================================================
// Fragility Fallback Behavior (UI Alignment)
// =============================================================================

describe('Fragility Fallback Behavior', () => {
  it('prefers switch_probability over marginal_switch_probability', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    const islResult = {
      ...createMinimalISLResult(),
      robustness: {
        fragile_edges: [
          {
            edge_id: 'f1→goal',
            from_id: 'f1',
            to_id: 'goal',
            switch_probability: 0.35,           // Should use this
            marginal_switch_probability: 0.25,  // Should ignore this
            alternative_winner_id: 'opt2',
          },
        ],
      },
    };

    const inputs = normaliseCoachingInputs(graph, options, islResult);
    expect(inputs.fragileEdges[0].switchProb).toBe(0.35);
  });

  it('falls back to marginal_switch_probability when switch_probability is missing', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    const islResult = {
      ...createMinimalISLResult(),
      robustness: {
        fragile_edges: [
          {
            edge_id: 'f1→goal',
            from_id: 'f1',
            to_id: 'goal',
            // No switch_probability
            marginal_switch_probability: 0.28,
            alternative_winner_id: 'opt2',
          },
        ],
      },
    };

    const inputs = normaliseCoachingInputs(graph, options, islResult);
    expect(inputs.fragileEdges[0].switchProb).toBe(0.28);
  });

  it('defaults to 0 when both probability fields are missing', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    const islResult = {
      ...createMinimalISLResult(),
      robustness: {
        fragile_edges: [
          {
            edge_id: 'f1→goal',
            from_id: 'f1',
            to_id: 'goal',
            // No probability fields
            alternative_winner_id: 'opt2',
          },
        ],
      },
    };

    const inputs = normaliseCoachingInputs(graph, options, islResult);
    expect(inputs.fragileEdges[0].switchProb).toBe(0);
  });

  it('sorts fragile edges by switchProb descending', () => {
    const graph = createMinimalGraph();
    const options = createMinimalOptions();
    const islResult = {
      ...createMinimalISLResult(),
      robustness: {
        fragile_edges: [
          {
            edge_id: 'f1→goal',
            from_id: 'f1',
            to_id: 'goal',
            switch_probability: 0.15,
            alternative_winner_id: 'opt2',
          },
          {
            edge_id: 'f2→goal',
            from_id: 'f2',
            to_id: 'goal',
            switch_probability: 0.40,
            alternative_winner_id: 'opt2',
          },
        ],
      },
    };

    const inputs = normaliseCoachingInputs(graph, options, islResult);
    expect(inputs.fragileEdges[0].switchProb).toBe(0.40);
    expect(inputs.fragileEdges[1].switchProb).toBe(0.15);
  });
});

// =============================================================================
// NextAction Targeting Fields (Canvas Focus CTAs)
// =============================================================================

describe('NextAction Targeting Fields', () => {
  it('populates target_type and target_id for evidence gap actions', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [
        {
          node_id: 'f1',
          label: 'Cost',
          importance_rank: 1,
          elasticity: 0.6,
          influence_score: 0.6,
          confidence: 0.3,
        },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const evidenceGaps = [
      {
        factor_id: 'f1',
        factor_label: 'Cost',
        voi_score: 0.5,
        confidence: 0.3,
        confidence_display: '30%',
        confidence_defaulted: false,
        influence: 0.8,
        influence_display: '80%',
        suggestion: 'Gather data on Cost',
        notes: [],
      },
    ];

    const actions = generateNextActions(inputs, 'needs_evidence', [], evidenceGaps);

    const evidenceAction = actions.find((a) => a.action.includes('Gather evidence'));
    expect(evidenceAction?.target_type).toBe('factor');
    expect(evidenceAction?.target_id).toBe('f1');
    expect(evidenceAction?.target_label).toBe('Cost');
  });

  it('populates target_type and target_id for fragile edge actions', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [],
      fragileEdges: [
        {
          edgeId: 'f1::goal',
          fromId: 'f1',
          toId: 'goal',
          fromLabel: 'Cost',
          toLabel: 'Revenue',
          displayLabel: 'Cost → Revenue',
          switchProb: 0.30,
          altWinnerId: 'opt2',
          altWinnerLabel: 'Option B',
        },
      ],
      robustness: { recommendationStability: 0.60 },
    };

    const actions = generateNextActions(inputs, 'moderate_winner', [], []);

    const fragileAction = actions.find((a) => a.action.includes('Validate the'));
    expect(fragileAction?.target_type).toBe('edge');
    expect(fragileAction?.target_id).toBe('f1::goal');
    expect(fragileAction?.target_label).toBe('Cost → Revenue');
  });

  it('populates target_type and target_id for close_call actions', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: [
        { id: 'opt1', label: 'Option A', winProbability: 0.52, expectedOutcome: 102 },
        { id: 'opt2', label: 'Option B', winProbability: 0.48, expectedOutcome: 98 },
      ],
      factorSensitivity: [],
      fragileEdges: [],
      robustness: { recommendationStability: 0.50 },
    };

    const actions = generateNextActions(inputs, 'close_call', [], []);

    const tieBreaker = actions.find((a) => a.action.includes('tie-breaker'));
    expect(tieBreaker?.target_type).toBe('option');
    expect(tieBreaker?.target_id).toBe('opt1');
    expect(tieBreaker?.target_label).toBe('Option A');
  });

  it('populates target_type and target_id for the ready-branch action', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: [
        { id: 'opt1', label: 'Option A', winProbability: 0.80, expectedOutcome: 120 },
        { id: 'opt2', label: 'Option B', winProbability: 0.20, expectedOutcome: 80 },
      ],
      factorSensitivity: [],
      fragileEdges: [],
      robustness: { recommendationStability: 0.85 },
    };

    const actions = generateNextActions(inputs, 'clear_winner', [], []);

    // Priority 7 is the ready-branch action; wording is tone-gated and may use
    // "Move forward with", "Validate the key assumptions before acting on", etc.
    const readyAction = actions.find((a) => a.priority === 7);
    expect(readyAction?.target_type).toBe('option');
    expect(readyAction?.target_id).toBe('opt1');
    expect(readyAction?.target_label).toBe('Option A');
  });

  it('omits targeting fields for narrow framing actions (no specific target)', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [],
      fragileEdges: [],
      robustness: {},
    };

    const actions = generateNextActions(
      inputs,
      'moderate_winner',
      [{ type: 'NARROW_FRAMING', severity: 'blocker', challenge_question: '', suggested_action: '' }],
      []
    );

    const framingAction = actions.find((a) => a.action.includes('Reconsider framing'));
    expect(framingAction?.target_type).toBeUndefined();
    expect(framingAction?.target_id).toBeUndefined();
    expect(framingAction?.target_label).toBeUndefined();
  });
});

// =============================================================================
// Task 1: Joint Probability Gate
// =============================================================================

describe('Task 1: Joint Probability Gate', () => {
  const createConstrainedGraph = (): EngineGraphV3 => ({
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Revenue', observed_state: { value: 100 } },
      { id: 'f1', kind: 'factor', label: 'Cost', category: 'controllable', observed_state: { value: 500 } },
      { id: 'f2', kind: 'factor', label: 'Market Risk', category: 'external', observed_state: { value: 0.3 } },
    ],
    edges: [
      { from: 'f1', to: 'goal', strength: { mean: 0.8, std: 0.1 } },
      { from: 'f2', to: 'goal', strength: { mean: -0.6, std: 0.15 } },
    ],
  });

  // 3 options including status quo to avoid NARROW_FRAMING
  const optionsWithBaseline: OptionV3[] = [
    { id: 'opt1', label: 'Option A', winProbability: 0.75, expectedOutcome: 120 },
    { id: 'opt2', label: 'Option B', winProbability: 0.15, expectedOutcome: 80 },
    { id: 'opt3', label: 'Status Quo', winProbability: 0.10, expectedOutcome: 70 },
  ];

  const baseGoalConstraints = [
    { constraint_id: 'c1', node_id: 'goal', operator: '>=' as const, value: 100, label: 'Revenue >= 100' },
  ];

  const createISLWithJointProbs = (probs: number[]) => ({
    ...createMinimalISLResult(),
    options: [
      { id: 'opt1', label: 'Option A', win_probability: 0.75, outcome: { mean: 120, p10: 100, p90: 140 },
        constraint_analysis: { joint_probability: probs[0] } },
      { id: 'opt2', label: 'Option B', win_probability: 0.15, outcome: { mean: 80, p10: 60, p90: 100 },
        constraint_analysis: { joint_probability: probs[1] ?? probs[0] } },
      { id: 'opt3', label: 'Status Quo', win_probability: 0.10, outcome: { mean: 70, p10: 50, p90: 90 },
        constraint_analysis: { joint_probability: probs[2] ?? probs[0] } },
    ],
  });

  it('caps readiness to needs_evidence when max joint probability is 0.0', () => {
    const islResult = createISLWithJointProbs([0.0, 0.0, 0.0]);

    const coaching = generateM1Coaching(
      createConstrainedGraph(), optionsWithBaseline, islResult,
      undefined, undefined, undefined, baseGoalConstraints
    );

    expect(coaching).toBeDefined();
    expect(coaching!.readiness).toBe('needs_evidence');
    const feasibilityCritique = coaching!.model_critiques.find(c => c.type === 'GOAL_FEASIBILITY_LOW');
    expect(feasibilityCritique).toBeDefined();
    expect(feasibilityCritique!.severity).toBe('warn');
  });

  it('caps readiness to close_call when max joint probability is 0.15', () => {
    const islResult = {
      ...createISLWithJointProbs([0.15, 0.02, 0.01]),
      // High-confidence factors to avoid evidence gaps triggering needs_evidence
      factor_sensitivity: [
        { node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.45, influence_score: 0.85, confidence: 0.9, direction: 'positive' },
        { node_id: 'f2', label: 'Market Risk', importance_rank: 2, elasticity: -0.35, influence_score: 0.65, confidence: 0.9, direction: 'negative' },
      ],
    };

    const coaching = generateM1Coaching(
      createConstrainedGraph(), optionsWithBaseline, islResult,
      undefined, undefined, undefined, baseGoalConstraints
    );

    expect(coaching).toBeDefined();
    // Base readiness would be 'ready' (clear winner with high confidence), capped to close_call
    expect(coaching!.readiness).toBe('close_call');
  });

  it('does not downgrade readiness when max joint probability is 0.60', () => {
    const islResult = createISLWithJointProbs([0.60, 0.40, 0.30]);

    const coaching = generateM1Coaching(
      createConstrainedGraph(), optionsWithBaseline, islResult,
      undefined, undefined, undefined, baseGoalConstraints
    );

    expect(coaching).toBeDefined();
    const feasibilityCritique = coaching!.model_critiques.find(c => c.type === 'GOAL_FEASIBILITY_LOW');
    expect(feasibilityCritique).toBeUndefined();
  });

  it('has no effect when goal_constraints are absent', () => {
    const islResult = createISLWithJointProbs([0.0, 0.0, 0.0]);

    // No goalConstraints passed — gate should not apply
    const coaching = generateM1Coaching(
      createConstrainedGraph(), optionsWithBaseline, islResult
    );

    expect(coaching).toBeDefined();
    const feasibilityCritique = coaching!.model_critiques.find(c => c.type === 'GOAL_FEASIBILITY_LOW');
    expect(feasibilityCritique).toBeUndefined();
  });

  it('has no effect when MCA data is absent from ISL response', () => {
    // Options without constraint_analysis — use base ISL result + 3 options
    const islResult = {
      ...createMinimalISLResult(),
      options: [
        { id: 'opt1', label: 'Option A', win_probability: 0.75, outcome: { mean: 120, p10: 100, p90: 140 } },
        { id: 'opt2', label: 'Option B', win_probability: 0.15, outcome: { mean: 80, p10: 60, p90: 100 } },
        { id: 'opt3', label: 'Status Quo', win_probability: 0.10, outcome: { mean: 70, p10: 50, p90: 90 } },
      ],
    };

    const coaching = generateM1Coaching(
      createConstrainedGraph(), optionsWithBaseline, islResult,
      undefined, undefined, undefined, baseGoalConstraints
    );

    expect(coaching).toBeDefined();
    const feasibilityCritique = coaching!.model_critiques.find(c => c.type === 'GOAL_FEASIBILITY_LOW');
    expect(feasibilityCritique).toBeUndefined();
  });

  it('does not upgrade readiness that is already lower than cap', () => {
    const islResult = {
      ...createMinimalISLResult(),
      // Force needs_evidence by removing stability
      robustness: {},
      factor_sensitivity: [],
      options: [
        { id: 'opt1', label: 'Option A', win_probability: 0.75, outcome: { mean: 120, p10: 100, p90: 140 },
          constraint_analysis: { joint_probability: 0.15 } },
        { id: 'opt2', label: 'Option B', win_probability: 0.15, outcome: { mean: 80, p10: 60, p90: 100 },
          constraint_analysis: { joint_probability: 0.10 } },
        { id: 'opt3', label: 'Status Quo', win_probability: 0.10, outcome: { mean: 70, p10: 50, p90: 90 },
          constraint_analysis: { joint_probability: 0.05 } },
      ],
    };

    const coaching = generateM1Coaching(
      createConstrainedGraph(), optionsWithBaseline, islResult,
      undefined, undefined, undefined, baseGoalConstraints
    );

    expect(coaching).toBeDefined();
    // Base readiness is needs_evidence (no stability), which is lower than close_call cap
    expect(coaching!.readiness).toBe('needs_evidence');
  });
});

// =============================================================================
// Task 3: Constraint Grounding Check
// =============================================================================

describe('Task 3: Constraint Grounding Check', () => {
  const baseGoalConstraints = [
    { constraint_id: 'c1', node_id: 'f1', operator: '>=' as const, value: 400, label: 'Cost >= 400' },
  ];

  // 3 options including status quo to avoid NARROW_FRAMING
  const optionsWithBaseline: OptionV3[] = [
    { id: 'opt1', label: 'Option A', winProbability: 0.75, expectedOutcome: 120 },
    { id: 'opt2', label: 'Option B', winProbability: 0.15, expectedOutcome: 80 },
    { id: 'opt3', label: 'Status Quo', winProbability: 0.10, expectedOutcome: 70 },
  ];

  const islResultWithBaseline = () => ({
    ...createMinimalISLResult(),
    options: [
      { id: 'opt1', label: 'Option A', win_probability: 0.75, outcome: { mean: 120, p10: 100, p90: 140 } },
      { id: 'opt2', label: 'Option B', win_probability: 0.15, outcome: { mean: 80, p10: 60, p90: 100 } },
      { id: 'opt3', label: 'Status Quo', win_probability: 0.10, outcome: { mean: 70, p10: 50, p90: 90 } },
    ],
  });

  it('emits no critique when constrained node has observed_state.value', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue' },
        { id: 'f1', kind: 'factor', label: 'Cost', category: 'controllable', observed_state: { value: 500 } },
      ],
      edges: [{ from: 'f1', to: 'goal', strength: { mean: 0.8, std: 0.1 } }],
    };

    const coaching = generateM1Coaching(
      graph, optionsWithBaseline, islResultWithBaseline(),
      undefined, undefined, undefined, baseGoalConstraints
    );

    expect(coaching).toBeDefined();
    const ungrounded = coaching!.model_critiques.find(c => c.type === 'CONSTRAINT_UNGROUNDED');
    expect(ungrounded).toBeUndefined();
  });

  it('emits CONSTRAINT_UNGROUNDED when constrained node has observed_state: null', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue' },
        { id: 'f1', kind: 'factor', label: 'Cost', category: 'controllable', observed_state: null as any },
      ],
      edges: [{ from: 'f1', to: 'goal', strength: { mean: 0.8, std: 0.1 } }],
    };

    const coaching = generateM1Coaching(
      graph, optionsWithBaseline, islResultWithBaseline(),
      undefined, undefined, undefined, baseGoalConstraints
    );

    expect(coaching).toBeDefined();
    const ungrounded = coaching!.model_critiques.find(c => c.type === 'CONSTRAINT_UNGROUNDED');
    expect(ungrounded).toBeDefined();
    expect(ungrounded!.severity).toBe('warn');
    expect(ungrounded!.challenge_question).toContain('Cost');
    expect(ungrounded!.targets).toEqual(['f1']);
    expect(coaching!.readiness).toBe('needs_evidence');
  });

  it('emits one critique per ungrounded constraint, caps readiness once', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue' },
        { id: 'f1', kind: 'factor', label: 'Cost', category: 'controllable', observed_state: { value: 500 } },
        { id: 'f2', kind: 'factor', label: 'Market Risk', category: 'external' },
      ],
      edges: [
        { from: 'f1', to: 'goal', strength: { mean: 0.8, std: 0.1 } },
        { from: 'f2', to: 'goal', strength: { mean: -0.6, std: 0.15 } },
      ],
    };

    const constraints = [
      { constraint_id: 'c1', node_id: 'f1', operator: '>=' as const, value: 400 },
      { constraint_id: 'c2', node_id: 'f2', operator: '<=' as const, value: 0.5 },
    ];

    const coaching = generateM1Coaching(
      graph, optionsWithBaseline, islResultWithBaseline(),
      undefined, undefined, undefined, constraints
    );

    expect(coaching).toBeDefined();
    const ungrounded = coaching!.model_critiques.filter(c => c.type === 'CONSTRAINT_UNGROUNDED');
    // f1 has observed_state.value=500 (grounded), f2 has no observed_state (ungrounded)
    expect(ungrounded).toHaveLength(1);
    expect(ungrounded[0].targets).toEqual(['f2']);
  });

  it('skips entirely when no goal_constraints', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue' },
        { id: 'f1', kind: 'factor', label: 'Cost', category: 'controllable' },
      ],
      edges: [{ from: 'f1', to: 'goal', strength: { mean: 0.8, std: 0.1 } }],
    };

    const coaching = generateM1Coaching(
      graph, createMinimalOptions(), createMinimalISLResult()
    );

    expect(coaching).toBeDefined();
    const ungrounded = coaching!.model_critiques.find(c => c.type === 'CONSTRAINT_UNGROUNDED');
    expect(ungrounded).toBeUndefined();
  });
});

// =============================================================================
// Task 4: Severity Triage
// =============================================================================

describe('Task 4: Severity Triage', () => {
  it('DOMINANT_FACTOR has severity warn', () => {
    const graph = createMinimalGraph();
    graph.nodes[1] = { id: 'f1', kind: 'factor', label: 'Cost', category: 'controllable' };

    const inputs: CoachingInputs = {
      graph,
      options: createMinimalOptions(),
      factorSensitivity: [
        { node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.9, influence_score: 0.9, confidence: 0.8 },
        { node_id: 'f2', label: 'Risk', importance_rank: 2, elasticity: 0.1, influence_score: 0.1, confidence: 0.5 },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const critiques = generateCritiques(inputs);
    const dominant = critiques.find(c => c.type === 'DOMINANT_FACTOR');
    expect(dominant?.severity).toBe('warn');
  });

  it('MISSING_RISK_PATHWAY has severity warn', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [
        { node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.5, influence_score: 0.5, direction: 'positive' },
      ],
      fragileEdges: [],
      robustness: {},
    };

    const critiques = generateCritiques(inputs);
    const missing = critiques.find(c => c.type === 'MISSING_RISK_PATHWAY');
    expect(missing?.severity).toBe('warn');
  });

  it('NARROW_FRAMING has severity blocker', () => {
    const inputs: CoachingInputs = {
      graph: createMinimalGraph(),
      options: createMinimalOptions(),
      factorSensitivity: [],
      fragileEdges: [],
      robustness: {},
    };

    const critiques = generateCritiques(inputs);
    const narrow = critiques.find(c => c.type === 'NARROW_FRAMING');
    expect(narrow?.severity).toBe('blocker');
  });

  it('GOAL_FEASIBILITY_LOW from Task 1 has severity warn', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue' },
        { id: 'f1', kind: 'factor', label: 'Cost', category: 'controllable', observed_state: { value: 500 } },
      ],
      edges: [{ from: 'f1', to: 'goal', strength: { mean: 0.8, std: 0.1 } }],
    };

    const islResult = {
      ...createMinimalISLResult(),
      options: [
        { id: 'opt1', label: 'Option A', win_probability: 0.75, outcome: { mean: 120 },
          constraint_analysis: { joint_probability: 0.0 } },
        { id: 'opt2', label: 'Option B', win_probability: 0.25, outcome: { mean: 80 },
          constraint_analysis: { joint_probability: 0.0 } },
      ],
    };

    const coaching = generateM1Coaching(
      graph, createMinimalOptions(), islResult,
      undefined, undefined, undefined,
      [{ constraint_id: 'c1', node_id: 'goal', operator: '>=' as const, value: 100 }]
    );

    const feasibility = coaching!.model_critiques.find(c => c.type === 'GOAL_FEASIBILITY_LOW');
    expect(feasibility?.severity).toBe('warn');
  });

  it('CONSTRAINT_UNGROUNDED from Task 3 has severity warn', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue' },
        { id: 'f1', kind: 'factor', label: 'Cost', category: 'controllable' },
      ],
      edges: [{ from: 'f1', to: 'goal', strength: { mean: 0.8, std: 0.1 } }],
    };

    const coaching = generateM1Coaching(
      graph, createMinimalOptions(), createMinimalISLResult(),
      undefined, undefined, undefined,
      [{ constraint_id: 'c1', node_id: 'f1', operator: '>=' as const, value: 400 }]
    );

    const ungrounded = coaching!.model_critiques.find(c => c.type === 'CONSTRAINT_UNGROUNDED');
    expect(ungrounded?.severity).toBe('warn');
  });
});
