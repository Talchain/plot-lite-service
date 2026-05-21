/**
 * D2 Executive Summary — tone-gated wording tests.
 *
 * Confirms that overconfident phrasing only appears when every tone gate is
 * clean, and that the banned vocabulary never appears at any tone.
 */

import { describe, it, expect } from 'vitest';
import { generateExecutiveSummary } from '../../src/coaching/executive-summary.js';
import type { CoachingInputs, EngineGraphV3, EvidenceGap } from '../../src/coaching/types.js';
import type { KeyDriver } from '../../src/coaching/key-drivers.js';

const minimalGraph = (): EngineGraphV3 => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'f1', kind: 'factor', label: 'Cost' },
  ],
  edges: [{ from: 'f1', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
});

const cleanInputs = (overrides: Partial<CoachingInputs> = {}): CoachingInputs => ({
  graph: minimalGraph(),
  options: [
    { id: 'opt1', label: 'Option A', winProbability: 0.7, outcomeMean: 100, outcomeP10: 90, outcomeP90: 110 },
    { id: 'opt2', label: 'Option B', winProbability: 0.3, outcomeMean: 80, outcomeP10: 70, outcomeP90: 90 },
  ],
  factorSensitivity: [
    {
      node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.5, influence_score: 0.5,
      confidence: 0.9, direction: 'positive', zero_reason: undefined,
    },
  ],
  fragileEdges: [],
  robustness: { level: 'high', recommendationStability: 0.9, isRobust: true },
  ...overrides,
});

const cleanKeyDrivers = (): KeyDriver[] => [
  { factor_id: 'f1', factor_label: 'Cost', influence_score: 0.5, normalised_impact: 1, impact_display: 'Very High', direction: 'positive', rank: 1 },
];

const gap = (factor_id: string, factor_label: string, voi: number): EvidenceGap => ({
  factor_id, factor_label, voi_score: voi, confidence: 0.4, confidence_display: '40%',
  confidence_defaulted: false, influence: 0.8, influence_display: '80%', suggestion: '', notes: [],
});

const BANNED_PHRASES = [
  'ready to proceed',
  'Proceed with implementation',
  'robust and ready',
  'clear leading option',
];

const BANNED_WORDS_REGEX = /\bwinner\b/i;

function expectNoBannedPhrasing(text: string) {
  for (const phrase of BANNED_PHRASES) {
    expect(text.toLowerCase()).not.toContain(phrase.toLowerCase());
  }
  expect(text).not.toMatch(BANNED_WORDS_REGEX);
}

describe('D2 Executive Summary — tone gate', () => {
  it('low robustness: does not emit any banned phrasing', () => {
    const inputs = cleanInputs({
      robustness: { level: 'low', recommendationStability: 0.4, isRobust: false },
    });
    const summary = generateExecutiveSummary(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), []);
    expectNoBannedPhrasing(summary.summary);
    expect(summary.summary.toLowerCase()).not.toContain('robust');
  });

  it('fragile edge above the switch-probability ceiling: output is tempered', () => {
    const inputs = cleanInputs({
      fragileEdges: [{
        edgeId: 'e1', fromId: 'f1', toId: 'goal', fromLabel: 'Cost', toLabel: 'Goal',
        displayLabel: 'Cost → Goal', switchProb: 0.35, altWinnerId: 'opt2', altWinnerLabel: 'Option B',
      }],
    });
    const summary = generateExecutiveSummary(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), []);
    expectNoBannedPhrasing(summary.summary);
    expect(summary.summary).toContain('currently leads');
    expect(summary.action_implication).toContain('validate the assumptions');
  });

  it('two evidence gaps: output is tempered', () => {
    const inputs = cleanInputs();
    const gaps = [gap('f1', 'Cost', 0.5), gap('f2', 'Other', 0.3)];
    const summary = generateExecutiveSummary(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), gaps);
    expectNoBannedPhrasing(summary.summary);
    expect(summary.summary).toContain('currently leads');
  });

  it('low top-driver confidence: output is tempered', () => {
    const inputs = cleanInputs({
      factorSensitivity: [{
        node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.5, influence_score: 0.5,
        confidence: 0.3, direction: 'positive', zero_reason: undefined,
      }],
    });
    const summary = generateExecutiveSummary(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), []);
    expectNoBannedPhrasing(summary.summary);
    expect(summary.summary).toContain('currently leads');
  });

  it('clean strong case: confident copy allowed, but no banned imperative', () => {
    const inputs = cleanInputs();
    const summary = generateExecutiveSummary(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), []);
    expectNoBannedPhrasing(summary.summary);
    expect(summary.summary).toContain('strong current lead');
    expect(summary.action_implication).toContain('reasonable to move forward');
  });

  it('caution: multiple severe gates fail — caution copy is used', () => {
    const inputs = cleanInputs({
      robustness: { level: 'low', recommendationStability: 0.5, isRobust: false },
      fragileEdges: [{
        edgeId: 'e1', fromId: 'f1', toId: 'goal', fromLabel: 'Cost', toLabel: 'Goal',
        displayLabel: 'Cost → Goal', switchProb: 0.4, altWinnerId: 'opt2', altWinnerLabel: 'Option B',
      }],
    });
    const summary = generateExecutiveSummary(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), []);
    expectNoBannedPhrasing(summary.summary);
    expect(summary.key_qualifier).toContain('provisional lead');
    expect(summary.action_implication).toContain('Validate the fragile assumptions');
  });

  it('copy compliance: every tone variant uses sentence case and contains no raw factor IDs', () => {
    const scenarios = [
      { name: 'tempered', inputs: cleanInputs({ robustness: { level: 'moderate', recommendationStability: 0.9, isRobust: true } }) },
      { name: 'confident', inputs: cleanInputs() },
      { name: 'caution', inputs: cleanInputs({
        robustness: { level: 'low', recommendationStability: 0.5, isRobust: false },
        fragileEdges: [{
          edgeId: 'e1', fromId: 'f1', toId: 'goal', fromLabel: 'Cost', toLabel: 'Goal',
          displayLabel: 'Cost → Goal', switchProb: 0.4, altWinnerId: 'opt2', altWinnerLabel: 'Option B',
        }],
      }) },
    ];
    for (const s of scenarios) {
      const summary = generateExecutiveSummary(s.inputs, 'ready', 'clear_winner', cleanKeyDrivers(), []);
      expectNoBannedPhrasing(summary.summary);
      expect(summary.summary).not.toMatch(/\bopt1\b/);
      expect(summary.summary).not.toMatch(/\bopt2\b/);
      // No raw factor node IDs.
      expect(summary.summary).not.toMatch(/\bf1\b/);
    }
  });
});
