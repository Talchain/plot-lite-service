/**
 * R13, the rendered residual (AI Quality #72 5872888088, served eh4 on PLoT 4abcb1e): on a near tie the executive
 * summary still named a leader: `decision_brief.headline` = "Continue as now currently leads, but the outcome is
 * highly uncertain." That string is RENDERED. The UI results section reads `m1_coaching.executive_summary`
 * (`useResultsSectionData.ts:2804-2841`) and the brief's `headline` resolves to it. CEE drops the brief member only on
 * withheld turns.
 *
 * The rule (the same as #398's `headline_banded`): when the top-two gap is inside NEAR_TIE_THRESHOLD (the one `near_tie`
 * publishes), no leader is named: the decision statement reads "Too close to call: X and Y.", and no qualifier says an
 * option "leads" or is "favoured". A gap at or above the threshold is said exactly as before (contrast).
 */
import { describe, it, expect } from 'vitest';
import { generateExecutiveSummary } from '../../src/coaching/executive-summary.js';
import type { CoachingInputs, EngineGraphV3 } from '../../src/coaching/types.js';
import type { KeyDriver } from '../../src/coaching/key-drivers.js';
import type { HeadlineType, Readiness } from '../../src/coaching/types.js';

const graph = (): EngineGraphV3 => ({
  nodes: [{ id: 'goal', kind: 'goal', label: 'Goal' }, { id: 'f1', kind: 'factor', label: 'Cost' }],
  edges: [{ from: 'f1', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
});

function inputs(top: number, second: number, robust = false): CoachingInputs {
  return {
    graph: graph(),
    options: [
      { id: 'continue', label: 'Continue as now', winProbability: top, outcomeMean: 100, outcomeP10: 90, outcomeP90: 110 },
      { id: 'juniors', label: 'Four junior engineers', winProbability: second, outcomeMean: 98, outcomeP10: 88, outcomeP90: 108 },
    ],
    factorSensitivity: [{ node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.5, influence_score: 0.5, confidence: 0.9, direction: 'positive', zero_reason: undefined }],
    fragileEdges: [],
    robustness: robust ? { level: 'high', recommendationStability: 0.9, isRobust: true } : { level: 'low', recommendationStability: 0.4, isRobust: false },
  } as unknown as CoachingInputs;
}
const drivers: KeyDriver[] = [{ factor_id: 'f1', factor_label: 'Cost', influence_score: 0.5, normalised_impact: 1, impact_display: 'Very High', direction: 'positive', rank: 1 }];
const LEADER_WORDS = /\bleads?\b|\bahead\b|\bfavours? this option\b|\bprovisional lead\b|\btop option\b/i;

describe('R13 — the executive summary names no leader on a near tie', () => {
  const cases: Array<[HeadlineType, Readiness]> = [
    ['high_uncertainty', 'close_call'], // eh4: "Continue as now currently leads, but the outcome is highly uncertain."
    ['close_call', 'close_call'],       // "X edges ahead by N points."
    ['clear_winner', 'ready'],           // a tone path that says "leads by N points"
    ['moderate_winner', 'ready'],
  ];
  for (const [headlineType, readiness] of cases) {
    it(`RED (${headlineType} / ${readiness}), eh4 gap 0.0175: "Too close to call: X and Y.", and no leader word anywhere`, () => {
      const s = generateExecutiveSummary(inputs(0.44, 0.4225), readiness, headlineType, drivers, []);
      expect(s.decision_statement).toBe('Too close to call: Continue as now and Four junior engineers.');
      expect(s.summary.startsWith('Too close to call: Continue as now and Four junior engineers.')).toBe(true);
      expect(s.summary.match(LEADER_WORDS)?.[0] ?? null).toBeNull();
    });
  }

  it('CONTRAST: a gap of 0.12 keeps the existing statement (the leader is named)', () => {
    const s = generateExecutiveSummary(inputs(0.56, 0.44), 'close_call', 'close_call', drivers, []);
    expect(s.decision_statement).toBe('Continue as now edges ahead by 12 points.');
  });
});
