/**
 * D2-tone: Readiness-tone classifier unit tests.
 *
 * Each tone gate is exercised in isolation, multi-severe-gate caution is
 * verified, and the missing-data policy is checked.
 */

import { describe, it, expect } from 'vitest';
import { deriveReadinessTone, type ReadinessToneReason } from '../../src/coaching/readiness-tone.js';
import type { CoachingInputs, EngineGraphV3 } from '../../src/coaching/types.js';
import { getThresholds, DEFAULT_THRESHOLDS } from '../../src/coaching/thresholds.js';
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
      node_id: 'f1',
      label: 'Cost',
      importance_rank: 1,
      elasticity: 0.5,
      influence_score: 0.5,
      confidence: 0.9,
      direction: 'positive',
      zero_reason: undefined,
    },
  ],
  fragileEdges: [],
  robustness: { level: 'high', recommendationStability: 0.9, isRobust: true },
  ...overrides,
});

const cleanKeyDrivers = (): KeyDriver[] => [
  { factor_id: 'f1', factor_label: 'Cost', influence_score: 0.5, normalised_impact: 1, impact_display: 'Very High', direction: 'positive', rank: 1 },
];

describe('deriveReadinessTone', () => {
  it('returns confident with no reasons when every gate is clean', () => {
    const inputs = cleanInputs();
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.tone).toBe('confident');
    expect(result.reasons).toEqual([]);
  });

  it('flags NOT_ROBUST when robustness.isRobust is false', () => {
    const inputs = cleanInputs({ robustness: { level: 'high', recommendationStability: 0.9, isRobust: false } });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.reasons).toContain('NOT_ROBUST');
    expect(result.tone).not.toBe('confident');
  });

  it('flags LOW_ROBUSTNESS when robustness.level is moderate', () => {
    const inputs = cleanInputs({ robustness: { level: 'moderate', recommendationStability: 0.9, isRobust: true } });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.reasons).toContain('LOW_ROBUSTNESS');
    expect(result.tone).toBe('tempered');
  });

  it('flags LOW_ROBUSTNESS when robustness.level is low', () => {
    const inputs = cleanInputs({ robustness: { level: 'low', recommendationStability: 0.9, isRobust: true } });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.reasons).toContain('LOW_ROBUSTNESS');
  });

  it('flags LOW_STABILITY when stability is below the confident threshold', () => {
    const inputs = cleanInputs({ robustness: { level: 'high', recommendationStability: 0.6, isRobust: true } });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.reasons).toContain('LOW_STABILITY');
  });

  it('flags MATERIAL_FRAGILE_EDGE when a fragile edge exceeds the switch-probability ceiling', () => {
    const inputs = cleanInputs({
      fragileEdges: [{
        edgeId: 'e1', fromId: 'f1', toId: 'goal', fromLabel: 'Cost', toLabel: 'Goal',
        displayLabel: 'Cost → Goal', switchProb: 0.35, altWinnerId: 'opt2', altWinnerLabel: 'Option B',
      }],
    });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.reasons).toContain('MATERIAL_FRAGILE_EDGE');
  });

  it('does NOT flag fragile edges at-or-below the threshold', () => {
    const inputs = cleanInputs({
      fragileEdges: [{
        edgeId: 'e1', fromId: 'f1', toId: 'goal', fromLabel: 'Cost', toLabel: 'Goal',
        displayLabel: 'Cost → Goal', switchProb: DEFAULT_THRESHOLDS.action_fragile_edge_threshold,
        altWinnerId: 'opt2', altWinnerLabel: 'Option B',
      }],
    });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.reasons).not.toContain('MATERIAL_FRAGILE_EDGE');
  });

  it('flags EVIDENCE_GAPS when evidence-gap count meets the readiness threshold', () => {
    const inputs = cleanInputs();
    const evidenceGaps = [
      { factor_id: 'f1', factor_label: 'Cost', voi_score: 0.5, confidence: 0.4, confidence_display: '40%', confidence_defaulted: false, influence: 1, influence_display: '100%', suggestion: '', notes: [] },
      { factor_id: 'f2', factor_label: 'Other', voi_score: 0.3, confidence: 0.5, confidence_display: '50%', confidence_defaulted: false, influence: 0.5, influence_display: '50%', suggestion: '', notes: [] },
    ];
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), evidenceGaps, getThresholds());
    expect(result.reasons).toContain('EVIDENCE_GAPS');
  });

  it('flags LOW_DRIVER_CONFIDENCE when the top driver has confidence at or below the ceiling', () => {
    const inputs = cleanInputs({
      factorSensitivity: [{
        node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.5, influence_score: 0.5,
        confidence: 0.3, direction: 'positive', zero_reason: undefined,
      }],
    });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.reasons).toContain('LOW_DRIVER_CONFIDENCE');
  });

  it('flags NEAR_TIE when leading margin is below the close-call delta', () => {
    const inputs = cleanInputs({
      options: [
        { id: 'opt1', label: 'Option A', winProbability: 0.52, outcomeMean: 100, outcomeP10: 90, outcomeP90: 110 },
        { id: 'opt2', label: 'Option B', winProbability: 0.48, outcomeMean: 98, outcomeP10: 88, outcomeP90: 108 },
      ],
    });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.reasons).toContain('NEAR_TIE');
  });

  it('escalates to caution when two or more hard reasons fire', () => {
    const inputs = cleanInputs({
      robustness: { level: 'low', recommendationStability: 0.6, isRobust: false },
      fragileEdges: [{
        edgeId: 'e1', fromId: 'f1', toId: 'goal', fromLabel: 'Cost', toLabel: 'Goal',
        displayLabel: 'Cost → Goal', switchProb: 0.4, altWinnerId: 'opt2', altWinnerLabel: 'Option B',
      }],
    });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.tone).toBe('caution');
    const expectedHard: ReadinessToneReason[] = ['NOT_ROBUST', 'LOW_ROBUSTNESS', 'LOW_STABILITY', 'MATERIAL_FRAGILE_EDGE'];
    for (const r of expectedHard) {
      expect(result.reasons).toContain(r);
    }
  });

  it('returns tempered (not caution) when exactly one hard reason fires', () => {
    const inputs = cleanInputs({
      fragileEdges: [{
        edgeId: 'e1', fromId: 'f1', toId: 'goal', fromLabel: 'Cost', toLabel: 'Goal',
        displayLabel: 'Cost → Goal', switchProb: 0.35, altWinnerId: 'opt2', altWinnerLabel: 'Option B',
      }],
    });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.tone).toBe('tempered');
    expect(result.reasons).toEqual(['MATERIAL_FRAGILE_EDGE']);
  });

  it('does not block confident when an optional signal is missing and everything else is clean', () => {
    const inputs = cleanInputs({
      robustness: { level: undefined, recommendationStability: 0.9, isRobust: true },
    });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.tone).toBe('confident');
    expect(result.reasons).toEqual([]);
  });

  it('adds INSUFFICIENT_SIGNALS when an optional signal is missing AND another weakness exists', () => {
    const inputs = cleanInputs({
      robustness: { level: undefined, recommendationStability: 0.6, isRobust: true },
    });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.reasons).toContain('LOW_STABILITY');
    expect(result.reasons).toContain('INSUFFICIENT_SIGNALS');
    expect(result.tone).toBe('tempered');
  });

  it('does not flag LOW_DRIVER_CONFIDENCE when driver confidence is unavailable', () => {
    const inputs = cleanInputs({
      factorSensitivity: [{
        node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.5, influence_score: 0.5,
        confidence: undefined, direction: 'positive', zero_reason: undefined,
      }],
    });
    const result = deriveReadinessTone(inputs, 'ready', 'clear_winner', cleanKeyDrivers(), [], getThresholds());
    expect(result.reasons).not.toContain('LOW_DRIVER_CONFIDENCE');
  });
});
