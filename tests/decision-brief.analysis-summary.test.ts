/**
 * decision_brief.analysis_summary — the decision-record capture surface
 * (ROADMAP 3.1, Platform lane; seam ratified by the orchestrator
 * 2026-07-10: leading_option = rank-1 label · win_probability = rank-1 ·
 * goal_fit = leader's probability_of_joint_goal, omitted when absent ·
 * robustness_band = robustness.display_verdict).
 *
 * Flag-gated DEFAULT-OFF behind BRIEF_DECISION_RECORD_SUMMARY_ENABLE:
 * flag off/unset → the field is ABSENT and the brief is byte-identical to
 * pre-lane output (the existing golden-fixture suite is the byte-identity
 * gate; this file pins key absence). The emitted shape must parse under
 * @talchain/schemas 0.15.0 DecisionRecordAnalysisSummarySchema.strict() so
 * CEE's capture hook is a pure copy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockLicensedComparison } from './helpers/objective-fixtures.js';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';
import { DecisionRecordAnalysisSummarySchema } from '@talchain/schemas/boundary';

const FLAG = 'BRIEF_DECISION_RECORD_SUMMARY_ENABLE';
let savedFlag: string | undefined;

beforeEach(() => {
  savedFlag = process.env[FLAG];
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
});

function baseInput(overrides: Partial<BriefAssemblyInput> = {}): BriefAssemblyInput {
  const input: BriefAssemblyInput = {
    analysis_status: 'complete' as any,
    critiques: [] as any,
    option_comparison: [
      {
        option_id: 'opt_a',
        option_label: 'Option A',
        win_probability: 0.66,
        probability_of_joint_goal: 0.41,
      },
      {
        option_id: 'opt_b',
        option_label: 'Option B',
        win_probability: 0.34,
        probability_of_joint_goal: 0.12,
      },
    ] as any,
    robustness: {
      level: 'high',
      is_robust: true,
      display_verdict: 'robust',
      fragile_edges: [],
      robust_edges: [],
    } as any,
    response_hash: 'abcd1234abcd1234',
    meta: { seed_used: '424242' },
    ...overrides,
  };
  input.licensed_comparison = mockLicensedComparison(input.option_comparison!);
  return input;
}

describe('decision_brief.analysis_summary — flag off (default)', () => {
  it('is ABSENT when the flag is unset', () => {
    delete process.env[FLAG];
    const brief = assembleBrief(baseInput());
    expect(brief).not.toBeNull();
    expect(brief).not.toHaveProperty('analysis_summary');
  });

  it('is ABSENT when the flag is explicitly disabled', () => {
    process.env[FLAG] = '0';
    const brief = assembleBrief(baseInput());
    expect(brief).not.toBeNull();
    expect(brief).not.toHaveProperty('analysis_summary');
  });
});

describe('decision_brief.analysis_summary — flag on', () => {
  beforeEach(() => {
    process.env[FLAG] = '1';
  });

  it('emits the ratified seam shape from the rank-1 option', () => {
    const brief = assembleBrief(baseInput());
    expect(brief?.analysis_summary).toEqual({
      leading_option: 'Option A',
      win_probability: 0.66,
      goal_fit: 0.41,
      robustness_band: 'robust',
    });
  });

  it('parses under DecisionRecordAnalysisSummarySchema.strict() — CEE hook is a pure copy', () => {
    const brief = assembleBrief(baseInput());
    const parsed = DecisionRecordAnalysisSummarySchema.safeParse(brief?.analysis_summary);
    expect(
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2),
    ).toBe(true);
  });

  it('OMITS goal_fit when the leader has no probability_of_joint_goal (never invents)', () => {
    const input = baseInput();
    const [leader, runnerUp] = input.option_comparison as any[];
    delete leader.probability_of_joint_goal;
    const brief = assembleBrief({ ...input, option_comparison: [leader, runnerUp] as any });
    expect(brief?.analysis_summary).toBeDefined();
    expect(brief?.analysis_summary).not.toHaveProperty('goal_fit');
    // Still contract-clean without it (optional-forward).
    expect(
      DecisionRecordAnalysisSummarySchema.safeParse(brief?.analysis_summary).success,
    ).toBe(true);
  });

  it('robustness_band mirrors display_verdict verbatim — including not_assessed', () => {
    const brief = assembleBrief(
      baseInput({
        robustness: {
          level: 'high',
          display_verdict: 'not_assessed',
          display_verdict_reason: 'insufficient samples',
          fragile_edges: [],
          robust_edges: [],
        } as any,
      }),
    );
    expect(brief?.analysis_summary?.robustness_band).toBe('not_assessed');
  });

  it('OMITS robustness_band when display_verdict is absent (never derives a substitute)', () => {
    const brief = assembleBrief(
      baseInput({
        robustness: { level: 'high', fragile_edges: [], robust_edges: [] } as any,
      }),
    );
    expect(brief?.analysis_summary).toBeDefined();
    expect(brief?.analysis_summary).not.toHaveProperty('robustness_band');
    expect(
      DecisionRecordAnalysisSummarySchema.safeParse(brief?.analysis_summary).success,
    ).toBe(true);
  });

  it('uses licensed producer identity regardless of option input order', () => {
    const input = baseInput();
    // Reverse input order; assembly must still lead with the higher win_probability.
    input.option_comparison = [...(input.option_comparison as any[])].reverse() as any;
    const brief = assembleBrief(input);
    expect(brief?.analysis_summary?.leading_option).toBe('Option A');
    expect(brief?.analysis_summary?.win_probability).toBe(0.66);
  });
});
