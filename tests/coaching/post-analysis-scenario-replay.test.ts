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
import { assembleBrief, type BriefAssemblyInput } from '../../src/assembly/decision-brief.js';
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

  it('with low-confidence top driver and a high-VoI gap, copy is not confident', () => {
    const summary = generateExecutiveSummary(techLeadInputs, 'ready', 'clear_winner', keyDrivers, gaps);
    // LOW_DRIVER_CONFIDENCE + EVIDENCE_GAPS (single gap, VoI 0.5 > 0.4 threshold)
    // ⇒ two hard reasons ⇒ caution. Both tempered and caution decision_statements
    // contain "currently leads", so we assert on that shared substring.
    expect(summary.summary).toContain('currently leads');
    expect(summary.summary).not.toContain('strong current lead');
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

// ===========================================================================
// Scenario C — Staging-derived near-tie (PR #174 tone gate + driver direction)
//
// Mirrors the latest staging debug bundle for build b8b05a5:
//   - Hire One Tech Lead ≈ 48.475% vs Hire Two Developers ≈ 48.425% (near-tie).
//   - robustness.level = very_low, isRobust = false, recommendationStability ≈ 0.48475.
//   - Multiple fragile edges; evidence gaps include Annual Salary Cost and
//     Team Technical Maturity.
//   - factor_sensitivity for Annual Salary Cost has direction = negative.
//
// Locks in two things simultaneously:
//   1. PR #174 tone gate: executive_summary, decision_brief.headline and
//      next_actions use cautious near-tie wording; banned phrases stay out.
//   2. Driver-direction projection bug fix: decision_brief.top_drivers
//      preserves direction = negative for Annual Salary Cost even though the
//      production-shape `elasticity` arrives as an unsigned magnitude (mirrors
//      computeFactorSensitivityFromGraph's normalised_influence output).
// ===========================================================================
describe('Scenario C — Staging-derived near-tie (PR #174 + driver direction projection)', () => {
  const tieGraph = (): EngineGraphV3 => ({
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Engineering capacity' },
      { id: 'f_salary', kind: 'factor', label: 'Annual Salary Cost' },
      { id: 'f_maturity', kind: 'factor', label: 'Team Technical Maturity' },
    ],
    edges: [
      { from: 'f_salary', to: 'goal', strength: { mean: -0.6, std: 0.2 } },
      { from: 'f_maturity', to: 'goal', strength: { mean: 0.55, std: 0.2 } },
    ],
  });

  const nearTieInputs: CoachingInputs = {
    graph: tieGraph(),
    options: [
      { id: 'opt_one_lead', label: 'Hire One Tech Lead', winProbability: 0.48475, outcomeMean: 100, outcomeP10: 70, outcomeP90: 130 },
      { id: 'opt_two_devs', label: 'Hire Two Developers', winProbability: 0.48425, outcomeMean: 99, outcomeP10: 69, outcomeP90: 129 },
    ],
    factorSensitivity: [
      // Production shape: elasticity is the unsigned magnitude (graph path emits
      // normalised_influence, ISL path emits null). The signed signal lives on
      // the `direction` field — that's the source decision_brief.top_drivers
      // must honour.
      { node_id: 'f_salary', label: 'Annual Salary Cost', importance_rank: 1, elasticity: 0.78, influence_score: 0.78, confidence: 0.35, direction: 'negative', zero_reason: undefined },
      { node_id: 'f_maturity', label: 'Team Technical Maturity', importance_rank: 2, elasticity: 0.6, influence_score: 0.6, confidence: 0.4, direction: 'positive', zero_reason: undefined },
    ],
    fragileEdges: [
      {
        edgeId: 'f_salary→goal', fromId: 'f_salary', toId: 'goal', fromLabel: 'Annual Salary Cost',
        toLabel: 'Engineering capacity', displayLabel: 'Annual Salary Cost → Engineering capacity', switchProb: 0.34,
        altWinnerId: 'opt_two_devs', altWinnerLabel: 'Hire Two Developers',
      },
      {
        edgeId: 'f_maturity→goal', fromId: 'f_maturity', toId: 'goal', fromLabel: 'Team Technical Maturity',
        toLabel: 'Engineering capacity', displayLabel: 'Team Technical Maturity → Engineering capacity', switchProb: 0.28,
        altWinnerId: 'opt_two_devs', altWinnerLabel: 'Hire Two Developers',
      },
    ],
    robustness: { level: 'very_low', recommendationStability: 0.48475, isRobust: false },
  };

  const nearTieKeyDrivers: KeyDriver[] = [
    { factor_id: 'f_salary', factor_label: 'Annual Salary Cost', influence_score: 0.78, normalised_impact: 1, impact_display: 'Very High', direction: 'negative', rank: 1 },
    { factor_id: 'f_maturity', factor_label: 'Team Technical Maturity', influence_score: 0.6, normalised_impact: 0.77, impact_display: 'High', direction: 'positive', rank: 2 },
  ];

  const nearTieGaps: EvidenceGap[] = [
    evidenceGap('f_salary', 'Annual Salary Cost', 0.62, 0.35),
    evidenceGap('f_maturity', 'Team Technical Maturity', 0.55, 0.4),
  ];

  it('m1_coaching.key_drivers preserves direction = negative for Annual Salary Cost (input contract)', () => {
    const salary = nearTieKeyDrivers.find((d) => d.factor_id === 'f_salary');
    expect(salary?.direction).toBe('negative');
  });

  it('factor_sensitivity preserves direction = negative for Annual Salary Cost (input contract)', () => {
    const salary = nearTieInputs.factorSensitivity.find((f) => f.node_id === 'f_salary');
    expect(salary?.direction).toBe('negative');
  });

  it('executive summary uses cautious near-tie wording; no banned phrases', () => {
    const summary = generateExecutiveSummary(nearTieInputs, 'close_call', 'close_call', nearTieKeyDrivers, nearTieGaps);
    expectNoBannedPhrasing(summary.summary);
    expect(summary.summary).toContain('Hire One Tech Lead edges ahead');
    // Was `toContain('recommendation stability')`, which pinned a leak: the
    // summary carried the WITHHELD figure ("the 59% recommendation stability
    // indicates…"). The quantity is not published as a field, so it may not be
    // published as prose either — see the `recommendationStability` doc in
    // src/coaching/types.ts. What must survive is the CAUTION this test is
    // actually about, so assert that instead of the figure.
    expect(summary.summary).toMatch(/within model uncertainty|could shift with new information/i);
    expect(summary.summary).not.toMatch(/\d+\s*%[^.!?]{0,60}recommendation stability/i);
    expect(summary.action_implication.toLowerCase()).not.toMatch(/^proceed with/);
    expect(summary.summary.toLowerCase()).not.toContain('robust and ready');
  });

  it('next_actions surface validation / tie-breaker guidance and no bare imperative', () => {
    const summary = generateExecutiveSummary(nearTieInputs, 'close_call', 'close_call', nearTieKeyDrivers, nearTieGaps);
    const actions = generateNextActions(nearTieInputs, 'close_call', [], nearTieGaps);
    const all = collectAllUserFacingText(summary, actions);
    expectNoBannedPhrasing(all);
    // Tie-breaker or evidence-gathering guidance must appear somewhere in the
    // combined surface (action_implication or a next_action rationale).
    expect(all.toLowerCase()).toMatch(/tie-?breaker|gather additional evidence|gather evidence/);
    // No priority should emit the bare "Proceed with implementation" imperative
    // under close_call readiness.
    for (const a of actions) {
      expect(a.action).not.toBe('Proceed with implementation.');
      expect(a.action.toLowerCase()).not.toMatch(/^proceed with implementation/);
    }
  });

  it('decision_brief.top_drivers preserves direction = negative for Annual Salary Cost', () => {
    // Build BriefAssemblyInput in production shape: elasticity is unsigned
    // magnitude, direction carries the signed signal.
    const briefInput: BriefAssemblyInput = {
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [
        { option_id: 'opt_one_lead', option_label: 'Hire One Tech Lead', id: 'opt_one_lead', label: 'Hire One Tech Lead', win_probability: 0.48475 },
        { option_id: 'opt_two_devs', option_label: 'Hire Two Developers', id: 'opt_two_devs', label: 'Hire Two Developers', win_probability: 0.48425 },
      ] as any,
      factor_sensitivity: [
        { factor_id: 'f_salary', factor_label: 'Annual Salary Cost', elasticity: 0.78, direction: 'negative', sensitivity_score: 0.78 },
        { factor_id: 'f_maturity', factor_label: 'Team Technical Maturity', elasticity: 0.6, direction: 'positive', sensitivity_score: 0.6 },
      ] as any,
      robustness: { level: 'very_low', fragile_edges: [], robust_edges: [] } as any,
      meta: { seed_used: '1' },
    } as any;

    const brief = assembleBrief(briefInput);
    expect(brief).not.toBeNull();

    const salary = brief!.top_drivers.find((d) => d.factor_label === 'Annual Salary Cost');
    expect(salary).toBeDefined();
    expect(salary!.direction).toBe('negative');
    expect(salary!.sensitivity).toBeCloseTo(0.78, 5);

    const maturity = brief!.top_drivers.find((d) => d.factor_label === 'Team Technical Maturity');
    expect(maturity!.direction).toBe('positive');
    expect(maturity!.sensitivity).toBeCloseTo(0.6, 5);
  });

  it('decision_brief.headline uses cautious near-tie wording (no banned phrasing)', () => {
    const summary = generateExecutiveSummary(nearTieInputs, 'close_call', 'close_call', nearTieKeyDrivers, nearTieGaps);

    const briefInput: BriefAssemblyInput = {
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [
        { option_id: 'opt_one_lead', option_label: 'Hire One Tech Lead', id: 'opt_one_lead', label: 'Hire One Tech Lead', win_probability: 0.48475 },
        { option_id: 'opt_two_devs', option_label: 'Hire Two Developers', id: 'opt_two_devs', label: 'Hire Two Developers', win_probability: 0.48425 },
      ] as any,
      factor_sensitivity: [
        { factor_id: 'f_salary', factor_label: 'Annual Salary Cost', elasticity: 0.78, direction: 'negative', sensitivity_score: 0.78 },
      ] as any,
      robustness: { level: 'very_low', fragile_edges: [], robust_edges: [] } as any,
      m1_coaching: {
        executive_summary: {
          summary: summary.summary,
          decision_statement: summary.decision_statement,
          key_qualifier: summary.key_qualifier,
          action_implication: summary.action_implication,
        },
      } as any,
      meta: { seed_used: '1' },
    } as any;

    const brief = assembleBrief(briefInput);
    expect(brief).not.toBeNull();
    expectNoBannedPhrasing(brief!.headline);
    expect(brief!.headline.toLowerCase()).not.toContain('robust and ready');
    expect(brief!.headline.toLowerCase()).not.toContain('ready to proceed');
    // Headline must include cautious near-tie wording sourced from the
    // PR #174-gated executive_summary.
    expect(brief!.headline).toContain('edges ahead');
  });
});
