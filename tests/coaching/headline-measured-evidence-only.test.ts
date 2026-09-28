/**
 * ⛔ "HIGHLY UNCERTAIN" AND "GATHER EVIDENCE ON X" ONLY ON MEASURED EVIDENCE (AI Quality ruling
 * olumi-programme-docs #72 5866850180; MG as PLoT owner, DL re-route 5867659507).
 *
 * Served journey A (DL acceptance-f-runs pj-20260928T07… and T08…): 4 of 6 Run turns read "£59 currently leads,
 * but the outcome is highly uncertain … Gather evidence on Pro paying subscribers before deciding" with the
 * leader at 0.849 and decision EVPI 5.2e-6; AIQ's P1 (product evaluated): £59 wins 100% of draws, every
 * factor_evppi 0, yet "Gather evidence on Other MRR growth before deciding". Both came from coaching
 * heuristics (impact × (1 − confidence)), never from the MEASURED value of information.
 *
 * SPEC. "Highly uncertain" only when the leader's win share is < 0.6 or the top two are a near tie.
 * "Gather evidence on X" (readiness, next action, summary, story headline) only when X's factor_evppi row is
 * `status: 'resolved'`. Otherwise the Run reads by the ordinary rules. eng-hiring-4 (EVPPI resolved) keeps
 * its advice.
 */
import { describe, it, expect } from 'vitest';
import { detectHeadlineType, generateHeadlines } from '../../src/coaching/headlines.js';
import { computeReadiness, generateNextActions } from '../../src/coaching/next-actions.js';
import { generateExecutiveSummary } from '../../src/coaching/executive-summary.js';
import { getThresholds } from '../../src/coaching/thresholds.js';
import type { CoachingInputs, EngineGraphV3, EvidenceGap } from '../../src/coaching/types.js';

const graph = (): EngineGraphV3 => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'MRR' },
    { id: 'other_growth', kind: 'factor', label: 'Other MRR growth' },
    { id: 'subscribers', kind: 'factor', label: 'Pro paying subscribers' },
  ],
  edges: [
    { from: 'other_growth', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'subscribers', to: 'goal', strength: { mean: 0.4, std: 0.1 } },
  ],
});

/** Heuristic swing risk well above both thresholds: impact 0.9 × (1 − 0.1) = 0.81 > 0.30. */
const inputs = (lead: number, second: number, resolved: string[] | undefined): CoachingInputs => ({
  graph: graph(),
  options: [
    { id: 'opt59', label: '£59', winProbability: lead, outcomeMean: 100, outcomeP10: 90, outcomeP90: 110 },
    { id: 'opt49', label: '£49', winProbability: second, outcomeMean: 80, outcomeP10: 70, outcomeP90: 90 },
  ],
  factorSensitivity: [
    { node_id: 'other_growth', label: 'Other MRR growth', importance_rank: 1, elasticity: 0.9, influence_score: 0.9, confidence: 0.1, direction: 'positive', zero_reason: undefined },
    { node_id: 'subscribers', label: 'Pro paying subscribers', importance_rank: 2, elasticity: 0.8, influence_score: 0.8, confidence: 0.1, direction: 'positive', zero_reason: undefined },
  ],
  fragileEdges: [],
  robustness: { level: 'high', recommendationStability: 0.9, isRobust: true },
  ...(resolved !== undefined ? { resolvedEvppiFactorIds: new Set(resolved) } : {}),
});

const gap = (factor_id: string, factor_label: string, voi: number): EvidenceGap => ({
  factor_id, factor_label, voi_score: voi, confidence: 0.1, confidence_display: '10%',
  confidence_defaulted: false, influence: 0.9, influence_display: '90%', suggestion: '', notes: [],
});
const GAPS = [gap('other_growth', 'Other MRR growth', 0.8), gap('subscribers', 'Pro paying subscribers', 0.7)];

describe('"highly uncertain" only when the result is (AIQ 5866850180)', () => {
  it('RED P1 (served): the leader wins 100%, nothing measured → not high_uncertainty, and no story headline says "uncertain"', () => {
    const i = inputs(1, 0, []);
    expect(detectHeadlineType(i)).toBe('clear_winner');
    expect(generateHeadlines(i).opt59 ?? '').not.toMatch(/uncertain/i);
  });

  it('RED served A02: the leader at 0.849 → not high_uncertainty', () => {
    expect(detectHeadlineType(inputs(0.849, 0.151, []))).not.toBe('high_uncertainty');
  });

  it('CONTROL: the leader below 0.6 keeps high_uncertainty', () => {
    expect(detectHeadlineType(inputs(0.55, 0.45, []))).toBe('high_uncertainty');
  });

  it('CONTROL: a near tie (gap < 0.10) keeps high_uncertainty even with the leader at 0.62', () => {
    expect(detectHeadlineType(inputs(0.62, 0.55, []))).toBe('high_uncertainty');
  });
});

describe('"Gather evidence on X" only when X\'s EVPPI was measured (AIQ 5866850180)', () => {
  const t = getThresholds();

  it('RED P1: every EVPPI below resolution → readiness is not needs_evidence, and no action or summary names a factor', () => {
    const i = inputs(1, 0, []);
    expect(computeReadiness('clear_winner', [], GAPS, t, i)).toBe('ready');
    const actions = generateNextActions(i, 'clear_winner', [], GAPS);
    expect(actions.map((a) => a.action).join(' | ')).not.toMatch(/Gather evidence on/);
    const summary = generateExecutiveSummary(i, 'needs_evidence', 'needs_evidence', [], GAPS);
    expect(summary.summary).not.toMatch(/Gather evidence on Other MRR growth/);
    expect(summary.summary).not.toMatch(/Key uncertainty: Other MRR growth/);
  });

  it('RED: the needs_evidence story headline never names an unmeasured factor', () => {
    const i = { ...inputs(0.7, 0.3, []), robustness: { level: 'high', recommendationStability: undefined, isRobust: true } } as CoachingInputs;
    expect(detectHeadlineType(i)).toBe('needs_evidence');
    const h = generateHeadlines(i).opt59 ?? '';
    expect(h).not.toMatch(/Other MRR growth|Pro paying subscribers/);
  });

  it('CONTROL eng-hiring-4: a factor measured above resolution keeps its advice everywhere', () => {
    const i = inputs(1, 0, ['other_growth']);
    expect(computeReadiness('clear_winner', [], GAPS, t, i)).toBe('needs_evidence');
    const actions = generateNextActions(i, 'clear_winner', [], GAPS);
    expect(actions.map((a) => a.action)).toContain('Gather evidence on Other MRR growth');
    const summary = generateExecutiveSummary(i, 'needs_evidence', 'clear_winner', [], GAPS);
    expect(summary.summary).toMatch(/Gather evidence on Other MRR growth before deciding\./);
  });

  it('only the measured factor is named: the top heuristic gap unmeasured, the second measured → the story headline names the second', () => {
    const i = { ...inputs(0.7, 0.3, ['subscribers']), robustness: { level: 'high', recommendationStability: undefined, isRobust: true } } as CoachingInputs;
    expect(generateHeadlines(i).opt59 ?? '').toMatch(/Pro paying subscribers/);
  });

  it('the same pick everywhere: the top gap unmeasured, the second measured → the next action and the summary name the second', () => {
    const i = { ...inputs(0.7, 0.3, ['subscribers']), robustness: { level: 'high', recommendationStability: undefined, isRobust: true } } as CoachingInputs;
    const actions = generateNextActions(i, 'needs_evidence', [], GAPS);
    expect(actions[0]).toMatchObject({ priority: 2, action: 'Gather evidence on Pro paying subscribers', target_id: 'subscribers' });
    const summary = generateExecutiveSummary(i, 'needs_evidence', 'needs_evidence', [], GAPS);
    expect(summary.summary).toMatch(/Key uncertainty: Pro paying subscribers .* Gather evidence on Pro paying subscribers before deciding\./);
    expect(summary.summary).not.toMatch(/Other MRR growth/);
  });

  it('RED (CONTROL route diff): needs_evidence with nothing measured → an action that names no factor, never the "Unable to generate" apology', () => {
    const i = { ...inputs(0.7, 0.3, []), robustness: { level: 'high', recommendationStability: undefined, isRobust: true } } as CoachingInputs;
    const actions = generateNextActions(i, 'needs_evidence', [], GAPS);
    expect(actions[0]).toEqual({
      priority: 2,
      action: 'Review the key assumptions before acting on £59',
      rationale: 'No measured evidence says learning any one factor would change which option leads',
      target_type: 'option', target_id: 'opt59', target_label: '£59',
    });
    expect(JSON.stringify(actions)).not.toMatch(/Unable to generate|Other MRR growth|Pro paying subscribers/);
  });
});

/**
 * DL verdict on #389: the `resolved` gate must be pinned END TO END — through `generateM1Coaching` with real ISL
 * `factor_evppi` rows, never an injected set — so a mutant that licenses on `evppi > 0` dies.
 */
describe('the measured gate, end to end through generateM1Coaching with real factor_evppi rows', async () => {
  const { generateM1Coaching } = await import('../../src/coaching/m1-coaching.js');
  const G = {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'other_growth', kind: 'factor', label: 'Other MRR growth', category: 'external' },
      { id: 'subscribers', kind: 'factor', label: 'Pro paying subscribers', category: 'external' },
    ],
    edges: [
      { from: 'other_growth', to: 'goal', strength: { mean: 0.6, std: 0.2 } },
      { from: 'subscribers', to: 'goal', strength: { mean: 0.5, std: 0.2 } },
    ],
  } as never;
  const OPTS = [
    { id: 'opt59', label: '£59', winProbability: 1, expectedOutcome: 120 },
    { id: 'opt49', label: '£49', winProbability: 0, expectedOutcome: 80 },
    { id: 'sq', label: 'Status Quo', winProbability: 0, expectedOutcome: 70 },
  ] as never;
  const isl = (factor_evppi: unknown) => ({
    options: [
      { id: 'opt59', label: '£59', win_probability: 1, outcome: { mean: 120, p10: 100, p90: 140 } },
      { id: 'opt49', label: '£49', win_probability: 0, outcome: { mean: 80, p10: 60, p90: 100 } },
      { id: 'sq', label: 'Status Quo', win_probability: 0, outcome: { mean: 70, p10: 50, p90: 90 } },
    ],
    factor_sensitivity: [
      { node_id: 'other_growth', label: 'Other MRR growth', importance_rank: 1, elasticity: 0.9, influence_score: 0.9, confidence: 0.1, direction: 'positive' },
      { node_id: 'subscribers', label: 'Pro paying subscribers', importance_rank: 2, elasticity: 0.8, influence_score: 0.8, confidence: 0.1, direction: 'positive' },
    ],
    robustness: { recommendation_stability: 0.9, fragile_edges: [] },
    ...(factor_evppi === undefined ? {} : { factor_evppi }),
  });
  /** Every place coaching could advise gathering evidence on a factor, joined. */
  const advice = (c: Record<string, unknown> | null): string => JSON.stringify([
    (c as { next_actions?: unknown })?.next_actions, (c as { executive_summary?: unknown })?.executive_summary,
    (c as { story_headlines?: unknown })?.story_headlines,
    ((c as { evidence_gaps?: { suggestion?: string }[] })?.evidence_gaps ?? []).map((g) => g.suggestion),
  ]);
  const NAMED = /[Gg]ather (?:evidence|data) on "?Other MRR growth/;

  it('RED: a below_resolution row with evppi > 0 names nothing (the `evppi > 0` mutant dies here)', () => {
    const c = generateM1Coaching(G, OPTS, isl([{ factor_id: 'other_growth', evppi: 0.5, status: 'below_resolution' }]));
    expect(c).not.toBeNull();
    expect(advice(c as never)).not.toMatch(NAMED);
  });

  it('a resolved row names its factor (the eng-hiring-4 shape, bound to ISL\'s status)', () => {
    const c = generateM1Coaching(G, OPTS, isl([{ factor_id: 'other_growth', evppi: 0.5, status: 'resolved' }]));
    expect(advice(c as never)).toMatch(NAMED);
  });

  it('factor_evppi absent: no factor is named (absence is not a measurement)', () => {
    const c = generateM1Coaching(G, OPTS, isl(undefined));
    expect(advice(c as never)).not.toMatch(/[Gg]ather (?:evidence|data) on "?(?:Other MRR growth|Pro paying subscribers)/);
  });
});
