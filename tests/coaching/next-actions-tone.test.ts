/**
 * B4 Next Actions — Priority 5 tone-gated wording tests.
 *
 * Confirms the bare imperative "Proceed with {label}" never appears when the
 * tone is not confident, and that the rationale surfaces a reason summary.
 */

import { describe, it, expect } from 'vitest';
import { generateNextActions } from '../../src/coaching/next-actions.js';
import type { CoachingInputs, EngineGraphV3 } from '../../src/coaching/types.js';

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

describe('B4 Next Actions — Priority 5 tone gate', () => {
  it('confident tone: emits a forward-leaning action with a confident rationale', () => {
    const actions = generateNextActions(cleanInputs(), 'clear_winner', [], []);
    const priority5 = actions.find((a) => a.priority === 7);
    expect(priority5).toBeDefined();
    expect(priority5!.action).toContain('Move forward with Option A');
    expect(priority5!.rationale).toContain('strong current lead');
    expect(priority5!.rationale).not.toContain('robust');
    expect(priority5!.action.toLowerCase()).not.toContain('proceed with');
  });

  it('tempered tone (fragile edge above ceiling): action is validation-first', () => {
    const inputs = cleanInputs({
      fragileEdges: [{
        edgeId: 'e1', fromId: 'f1', toId: 'goal', fromLabel: 'Cost', toLabel: 'Goal',
        displayLabel: 'Cost → Goal', switchProb: 0.35, altWinnerId: 'opt2', altWinnerLabel: 'Option B',
      }],
    });
    const actions = generateNextActions(inputs, 'clear_winner', [], []);
    // Priority 3 fragile-edge action fires first; Priority 5 may still be present.
    const priority5 = actions.find((a) => a.priority === 7);
    if (priority5) {
      expect(priority5.action).toContain('Validate the key assumptions');
      expect(priority5.action.toLowerCase()).not.toContain('proceed with');
      expect(priority5.rationale).toContain('currently leads');
      expect(priority5.rationale.toLowerCase()).not.toContain('decision is robust');
    }
  });

  it('caution tone: action and rationale use caution phrasing', () => {
    const inputs = cleanInputs({
      robustness: { level: 'low', recommendationStability: 0.5, isRobust: false },
      fragileEdges: [{
        edgeId: 'e1', fromId: 'f1', toId: 'goal', fromLabel: 'Cost', toLabel: 'Goal',
        displayLabel: 'Cost → Goal', switchProb: 0.4, altWinnerId: 'opt2', altWinnerLabel: 'Option B',
      }],
    });
    const actions = generateNextActions(inputs, 'clear_winner', [], []);
    const priority5 = actions.find((a) => a.priority === 7);
    if (priority5) {
      expect(priority5.action).toContain('Validate the fragile assumptions');
      expect(priority5.action.toLowerCase()).not.toContain('proceed with');
    }
  });

  it('never emits the bare imperative "Proceed with {label}" in tempered or caution tone', () => {
    const scenarios = [
      // tempered: moderate robustness
      cleanInputs({ robustness: { level: 'moderate', recommendationStability: 0.9, isRobust: true } }),
      // tempered: low stability
      cleanInputs({ robustness: { level: 'high', recommendationStability: 0.6, isRobust: true } }),
      // caution: not robust + fragile edge
      cleanInputs({
        robustness: { level: 'low', recommendationStability: 0.5, isRobust: false },
        fragileEdges: [{
          edgeId: 'e1', fromId: 'f1', toId: 'goal', fromLabel: 'Cost', toLabel: 'Goal',
          displayLabel: 'Cost → Goal', switchProb: 0.4, altWinnerId: 'opt2', altWinnerLabel: 'Option B',
        }],
      }),
    ];
    for (const inputs of scenarios) {
      const actions = generateNextActions(inputs, 'clear_winner', [], []);
      const priority5 = actions.find((a) => a.priority === 7);
      if (priority5) {
        expect(priority5.action).not.toMatch(/^Proceed with/);
        expect(priority5.rationale.toLowerCase()).not.toContain('decision is robust');
      }
    }
  });

  it('single high-VoI evidence gap: action is validation-first and rationale uses singular wording', () => {
    const inputs = cleanInputs();
    const gaps = [
      {
        factor_id: 'f1', factor_label: 'Cost', voi_score: 0.6, confidence: 0.4,
        confidence_display: '40%', confidence_defaulted: false, influence: 1,
        influence_display: '100%', suggestion: '', notes: [],
      },
    ];
    const actions = generateNextActions(inputs, 'clear_winner', [], gaps);
    const priority5 = actions.find((a) => a.priority === 7);
    expect(priority5).toBeDefined();
    // Validation-first action, never the bare imperative.
    expect(priority5!.action).toMatch(/Validate the key assumptions before acting on/);
    expect(priority5!.action).not.toMatch(/^Proceed with/);
    expect(priority5!.action).not.toMatch(/^Move forward/);
    // Singular wording — must not falsely claim "multiple evidence gaps".
    expect(priority5!.rationale.toLowerCase()).not.toContain('multiple evidence gaps');
    expect(priority5!.rationale).toContain('a decision-relevant evidence gap remains');
  });

  it('two-plus low-VoI evidence gaps: rationale uses plural wording', () => {
    // Two gaps with VoI below the high-VoI threshold (0.40) keep
    // computeReadiness at 'ready' so Priority 5 fires; the tone classifier
    // still flags EVIDENCE_GAPS via count, so the rationale must use plural.
    const inputs = cleanInputs();
    const gaps = [
      { factor_id: 'f1', factor_label: 'Cost', voi_score: 0.3, confidence: 0.4, confidence_display: '40%', confidence_defaulted: false, influence: 1, influence_display: '100%', suggestion: '', notes: [] },
      { factor_id: 'f2', factor_label: 'Other', voi_score: 0.2, confidence: 0.5, confidence_display: '50%', confidence_defaulted: false, influence: 0.5, influence_display: '50%', suggestion: '', notes: [] },
    ];
    const actions = generateNextActions(inputs, 'clear_winner', [], gaps);
    const priority5 = actions.find((a) => a.priority === 7);
    expect(priority5).toBeDefined();
    expect(priority5!.rationale).toContain('multiple evidence gaps remain');
    expect(priority5!.rationale).not.toContain('a decision-relevant evidence gap remains');
  });

  it('Priority 4 (close call) does not use the word "winner"', () => {
    const inputs = cleanInputs({
      options: [
        { id: 'opt1', label: 'Option A', winProbability: 0.52, outcomeMean: 100, outcomeP10: 90, outcomeP90: 110 },
        { id: 'opt2', label: 'Option B', winProbability: 0.48, outcomeMean: 98, outcomeP10: 88, outcomeP90: 108 },
      ],
    });
    const actions = generateNextActions(inputs, 'close_call', [], []);
    const priority4 = actions.find((a) => a.priority === 4);
    expect(priority4).toBeDefined();
    expect(priority4!.rationale).not.toMatch(/\bwinner\b/i);
  });
});
