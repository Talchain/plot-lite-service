/**
 * Post-analysis wording honesty — scenario replay tests.
 *
 * Two end-to-end fixtures matching the workstream brief:
 *   - Marketing: moderate lead, low robustness, fragile edges + evidence gaps.
 *   - Tech Lead: strong lead but with a low-confidence top driver / evidence
 *     gap. Confident copy may appear if every gate is clean, but the bare
 *     imperative "Proceed with implementation" never does.
 */

import { describe, it, expect } from 'vitest';
import { generateExecutiveSummary } from '../../src/coaching/executive-summary.js';
import { generateNextActions } from '../../src/coaching/next-actions.js';
import type { CoachingInputs, EngineGraphV3, EvidenceGap } from '../../src/coaching/types.js';
import type { KeyDriver } from '../../src/coaching/key-drivers.js';

const minimalGraph = (): EngineGraphV3 => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'f_brand', kind: 'factor', label: 'Brand awareness' },
    { id: 'f_cost', kind: 'factor', label: 'Campaign cost' },
  ],
  edges: [
    { from: 'f_brand', to: 'goal', strength: { mean: 0.7, std: 0.2 } },
    { from: 'f_cost', to: 'goal', strength: { mean: -0.5, std: 0.15 } },
  ],
});

const evidenceGap = (factor_id: string, factor_label: string, voi: number, confidence = 0.4): EvidenceGap => ({
  factor_id,
  factor_label,
  voi_score: voi,
  confidence,
  confidence_display: `${Math.round(confidence * 100)}%`,
  confidence_defaulted: false,
  influence: 0.8,
  influence_display: '80%',
  suggestion: '',
  notes: [],
});

function collectAllUserFacingText(execSummary: ReturnType<typeof generateExecutiveSummary>, actions: ReturnType<typeof generateNextActions>): string {
  return [
    execSummary.summary,
    execSummary.decision_statement,
    execSummary.key_qualifier,
    execSummary.action_implication,
    ...actions.flatMap((a) => [a.action, a.rationale]),
  ].join(' | ');
}

const BANNED_PHRASES = [
  'ready to proceed',
  'Proceed with implementation',
  'robust and ready',
  'clear leading option',
];

function expectNoBannedPhrasing(text: string) {
  for (const phrase of BANNED_PHRASES) {
    expect(text.toLowerCase()).not.toContain(phrase.toLowerCase());
  }
  expect(text).not.toMatch(/\bwinner\b/i);
}

describe('Scenario A — Marketing (moderate lead, low robustness, fragile edges + evidence gaps)', () => {
  const marketingInputs: CoachingInputs = {
    graph: minimalGraph(),
    options: [
      { id: 'opt_paid', label: 'Paid Acquisition', winProbability: 0.62, outcomeMean: 110, outcomeP10: 80, outcomeP90: 140 },
      { id: 'opt_organic', label: 'Organic Growth', winProbability: 0.38, outcomeMean: 90, outcomeP10: 60, outcomeP90: 120 },
    ],
    factorSensitivity: [
      { node_id: 'f_brand', label: 'Brand awareness', importance_rank: 1, elasticity: 0.6, influence_score: 0.6, confidence: 0.35, direction: 'positive', zero_reason: undefined },
      { node_id: 'f_cost', label: 'Campaign cost', importance_rank: 2, elasticity: -0.4, influence_score: 0.4, confidence: 0.4, direction: 'negative', zero_reason: undefined },
    ],
    fragileEdges: [
      {
        edgeId: 'f_brand→goal', fromId: 'f_brand', toId: 'goal', fromLabel: 'Brand awareness',
        toLabel: 'Revenue', displayLabel: 'Brand awareness → Revenue', switchProb: 0.32,
        altWinnerId: 'opt_organic', altWinnerLabel: 'Organic Growth',
      },
    ],
    robustness: { level: 'low', recommendationStability: 0.55, isRobust: false },
  };

  const keyDrivers: KeyDriver[] = [
    { factor_id: 'f_brand', factor_label: 'Brand awareness', influence_score: 0.6, normalised_impact: 1, impact_display: 'Very High', direction: 'positive', rank: 1 },
    { factor_id: 'f_cost', factor_label: 'Campaign cost', influence_score: 0.4, normalised_impact: 0.67, impact_display: 'High', direction: 'negative', rank: 2 },
  ];

  const gaps = [
    evidenceGap('f_brand', 'Brand awareness', 0.65, 0.35),
    evidenceGap('f_cost', 'Campaign cost', 0.5, 0.4),
  ];

  it('executive summary contains no banned phrasing and tempers the lead', () => {
    const summary = generateExecutiveSummary(marketingInputs, 'ready', 'moderate_winner', keyDrivers, gaps);
    expectNoBannedPhrasing(summary.summary);
    expect(summary.summary.toLowerCase()).not.toContain('robust');
    expect(summary.summary).toContain('currently leads');
  });

  it('next actions: no Priority 5 bare imperative; rationale surfaces the active concern', () => {
    const actions = generateNextActions(marketingInputs, 'moderate_winner', [], gaps);
    const all = collectAllUserFacingText(generateExecutiveSummary(marketingInputs, 'ready', 'moderate_winner', keyDrivers, gaps), actions);
    expectNoBannedPhrasing(all);
    const priority5 = actions.find((a) => a.priority === 7);
    if (priority5) {
      expect(priority5.action.toLowerCase()).not.toMatch(/^proceed with/);
      expect(priority5.rationale.toLowerCase()).not.toContain('decision is robust');
    }
  });
});

describe('Scenario B — Tech Lead (strong lead, low-confidence drivers / evidence gaps)', () => {
  const techLeadInputs: CoachingInputs = {
    graph: minimalGraph(),
    options: [
      { id: 'opt_a', label: 'Tech Lead Path', winProbability: 0.85, outcomeMean: 130, outcomeP10: 110, outcomeP90: 150 },
      { id: 'opt_b', label: 'IC Path', winProbability: 0.15, outcomeMean: 90, outcomeP10: 70, outcomeP90: 110 },
    ],
    factorSensitivity: [
      // Strong lead, but the top driver has low confidence — confident tone must NOT fire.
      { node_id: 'f_brand', label: 'Career fit', importance_rank: 1, elasticity: 0.6, influence_score: 0.6, confidence: 0.4, direction: 'positive', zero_reason: undefined },
    ],
    fragileEdges: [],
    robustness: { level: 'high', recommendationStability: 0.88, isRobust: true },
  };

  const keyDrivers: KeyDriver[] = [
    { factor_id: 'f_brand', factor_label: 'Career fit', influence_score: 0.6, normalised_impact: 1, impact_display: 'Very High', direction: 'positive', rank: 1 },
  ];

  const gaps = [evidenceGap('f_brand', 'Career fit', 0.5, 0.4)];

  it('strong-lead summary may use "strong current lead" wording but never the bare imperative', () => {
    const summary = generateExecutiveSummary(techLeadInputs, 'ready', 'clear_winner', keyDrivers, gaps);
    expectNoBannedPhrasing(summary.summary);
    expect(summary.action_implication).not.toBe('Proceed with implementation.');
  });

  it('with low-confidence top driver, copy is tempered (not confident)', () => {
    const summary = generateExecutiveSummary(techLeadInputs, 'ready', 'clear_winner', keyDrivers, gaps);
    // Low driver confidence + evidence gap of 1 (below threshold) ⇒ at least one hard reason fires
    // ⇒ tempered.
    expect(summary.summary).toContain('currently leads');
  });

  it('all-clean Tech Lead variant: confident copy permitted', () => {
    const inputs: CoachingInputs = {
      ...techLeadInputs,
      factorSensitivity: [{
        node_id: 'f_brand', label: 'Career fit', importance_rank: 1, elasticity: 0.6, influence_score: 0.6,
        confidence: 0.9, direction: 'positive', zero_reason: undefined,
      }],
    };
    const summary = generateExecutiveSummary(inputs, 'ready', 'clear_winner', keyDrivers, []);
    expectNoBannedPhrasing(summary.summary);
    expect(summary.summary).toContain('strong current lead');
    expect(summary.action_implication).toContain('reasonable to move forward');
  });
});
