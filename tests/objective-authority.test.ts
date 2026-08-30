/** Producer → PLoT → brief authority: raw leader breaches, permitted identity wins. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { licenseObjectiveComparison } from '../src/lib/objective-recommendation.js';
import { assembleBrief } from '../src/assembly/decision-brief.js';

const COMPUTED = {
  direction: 'maximise', attested: true, status: 'computed',
  ranked_options: [
    { option_id: 'expensive', rank: 1, win_probability: 0.8 },
    { option_id: 'affordable', rank: 2, win_probability: 0.2 },
  ],
};
const WITHHELD = {
  attested: false, status: 'withheld', withheld_reason: 'goal_direction_absent', ranked_options: [],
};
let ranking: any = COMPUTED;
let capturedRequest: any;
let includeShares = true;
let allCompliant = false;
let aliasResponseIds = false;
const service = {
  isEnabled: () => true,
  isAvailable: async () => true,
  async callAnalysisEndpoint(_endpoint: string, body: any) {
    capturedRequest = structuredClone(body);
    if (body.goal_direction === 'target' &&
        (body.goal_threshold === undefined || body.goal_threshold_frame === undefined)) {
      // ISL request validation: missing target configuration is a typed 422,
      // whereas a valid configuration with unresolved sample context withholds.
      return { data: null, error: {
        status: 422, code: 'VALIDATION_ERROR', message: 'Target requires a threshold and frame',
        critiques: [{ code: 'VALIDATION_ERROR', severity: 'error',
          message: 'Target requires a threshold and frame', source: 'validation' }],
      } };
    }
    return { error: null, data: {
      ...(ranking !== undefined ? { objective_ranking: ranking } : {}),
      options: body.options.map((option: any) => ({
        option_id: aliasResponseIds ? `alien_${option.id}` : option.id, status: 'computed',
        ...(includeShares ? { win_probability: option.id === 'expensive' ? 0.8 : 0.2 } : {}),
        // Deliberately opposite marginal means: they cannot decide objective rank.
        outcome: { mean: option.id === 'expensive' ? 0.2 : 0.8, std: 0.1,
          p10: 0.1, p50: 0.5, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1 },
        constraint_analysis: {
          constraints: [{ constraint_id: 'budget', node_id: 'cost', operator: '<=',
            value: 50000, prob_satisfied: allCompliant || option.id === 'affordable' ? 1 : 0 }],
          joint_probability: allCompliant || option.id === 'affordable' ? 1 : 0,
        },
      })),
      edges: [], factors: [], value_of_information: [],
      overall_robustness: 'robust', robustness_score: 0.8, fragile_edges: [], robust_edges: [],
    } };
  },
};
vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => service, islService: service };
});
const { createServer } = await import('../src/createServer.js');

function payload(direction: unknown = 'maximise') {
  return {
    graph: {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Minimise cost in 12 months',
          ...(direction === undefined ? {} : { goal_direction: direction }),
          observed_state: { value: 0.4, baseline: 0.3 } },
        { id: 'cost', kind: 'factor', label: 'Cost', observed_state: { value: 40000, cap: 60000, unit: '£' } },
      ],
      edges: [{ from: 'cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } }],
    },
    options: [
      { id: 'expensive', label: 'Expensive', interventions: { cost: 55000 } },
      { id: 'affordable', label: 'Affordable', interventions: { cost: 38000 } },
    ],
    goal_node_id: 'goal', seed: '42',
    goal_constraints: [{ constraint_id: 'budget', node_id: 'cost', operator: '<=', value: 50000, label: 'Budget', unit: '£' }],
  };
}

describe('objective authority on the complete /v2/run boundary', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.BRIEF_DECISION_RECORD_SUMMARY_ENABLE = '1';
    app = await createServer(); await app.ready();
  });
  afterAll(async () => {
    await app.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    delete process.env.BRIEF_DECISION_RECORD_SUMMARY_ENABLE;
  });
  beforeEach(() => { ranking = structuredClone(COMPUTED); includeShares = true; allCompliant = false; aliasResponseIds = false; capturedRequest = undefined; });
  async function run(input: any) {
    const result = await app.inject({ method: 'POST', url: '/v2/run', payload: input });
    expect(result.statusCode, result.body).toBe(200);
    return result.json();
  }

  it('pairs the eligible .2 share with Affordable without re-crowning the .8 raw leader', async () => {
    const result = await run(payload());
    expect(capturedRequest.goal_direction).toBe('maximise'); // explicit value beats label wording
    expect(result.objective_ranking).toEqual(COMPUTED);
    expect(result.robustness.recommended_option_id).toBe('affordable');
    expect(result.robustness.recommended_option_compliance).toBe('compliant');
    expect(result.option_comparison.find((o: any) => o.option_id === 'expensive').constraint_probabilities.budget).toBe(0);
    expect(result.decision_brief.analysis_summary).toMatchObject({ leading_option: 'Affordable', win_probability: 0.2, goal_fit: 1 });
    expect(result.decision_brief.headline_banded).toBeUndefined(); // only one eligible; no invented comparison gap
    expect(result.decision_brief.headline).toBe('Analysis complete');
    expect(result.decision_brief.options.map((o: any) => [o.option_id, o.rank, o.win_probability])).toEqual([
      ['expensive', 1, 0.8], ['affordable', 2, 0.2],
    ]);
  });

  it.each([undefined, WITHHELD])('withholds all winner claims without producer objective truth (%j)', async (value) => {
    ranking = value;
    const input = payload(); delete (input.graph.nodes[0] as any).goal_direction;
    const result = await run(input);
    expect(capturedRequest).not.toHaveProperty('goal_direction');
    expect(result.robustness).not.toHaveProperty('recommended_option_id');
    expect(result.robustness).not.toHaveProperty('near_tie');
    expect(result.decision_brief.options).toEqual([]);
    expect(result.decision_brief).not.toHaveProperty('analysis_summary');
    expect(result.decision_brief).not.toHaveProperty('headline_banded');
    expect(result.decision_brief.headline).toBe('Analysis complete');
    expect(result.option_comparison[0].outcome.mean).toBeDefined(); // descriptive results survive
  });

  it('preserves the new withheld wire with absent per-option shares', async () => {
    ranking = WITHHELD; includeShares = false;
    const input = payload(); delete (input.graph.nodes[0] as any).goal_direction;
    const result = await run(input);
    expect(result.objective_ranking).toEqual(WITHHELD);
    expect(result.option_comparison.every((o: any) => !('win_probability' in o))).toBe(true);
    expect(result.robustness).not.toHaveProperty('recommended_option_id');
  });

  it('does not infer objective direction from labels or another node', async () => {
    const input = payload();
    delete (input.graph.nodes[0] as any).goal_direction;
    (input.graph.nodes[1] as any).goal_direction = 'maximise';
    const result = await run(input);
    expect(capturedRequest).not.toHaveProperty('goal_direction');
    expect(result.robustness).not.toHaveProperty('recommended_option_id');
  });

  it.each(['minimize', null, 42])('rejects malformed selected-goal direction %j before calling ISL', async (direction) => {
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload: payload(direction) });
    expect(response.statusCode).toBe(422);
    expect(response.json().critiques.some((c: any) => c.code === 'INVALID_GOAL_DIRECTION')).toBe(true);
    expect(capturedRequest).toBeUndefined();
  });

  it('forwards target and its existing explicit sample frame without a new target value', async () => {
    ranking = { direction: 'target', attested: true, status: 'withheld',
      withheld_reason: 'target_not_resolvable_in_sample_frame', ranked_options: [] };
    const input = payload('target');
    Object.assign(input.graph.nodes[0], { goal_threshold: 0.6, goal_threshold_frame: 'delta' });
    await run(input);
    expect(capturedRequest).toMatchObject({ goal_direction: 'target', goal_threshold: 0.6, goal_threshold_frame: 'delta' });
    expect(capturedRequest).not.toHaveProperty('target_value');
    expect(capturedRequest.goal_constraints.some((c: any) => c.constraint_id === 'budget')).toBe(true);
  });

  it('preserves the typed rejection for malformed target-frame configuration', async () => {
    const input = payload('target');
    Object.assign(input.graph.nodes[0], { goal_threshold: 0.6, goal_threshold_frame: 'guess' });
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload: input });
    expect(capturedRequest.goal_threshold).toBe(0.6);
    expect(capturedRequest).not.toHaveProperty('goal_threshold_frame');
    expect(response.statusCode).toBe(422);
    expect(response.json().critiques.some((c: any) => c.code === 'VALIDATION_ERROR')).toBe(true);
    expect(response.json().robustness?.recommended_option_id).toBeUndefined();
  });

  it('omits ambiguous brief goal_fit for target without deleting raw threshold attainment', async () => {
    ranking = { ...COMPUTED, direction: 'target' };
    const input = payload('target');
    Object.assign(input.graph.nodes[0], { goal_threshold: 0.6, goal_threshold_frame: 'delta' });
    const result = await run(input);
    expect(result.decision_brief.analysis_summary).toMatchObject({ leading_option: 'Affordable', win_probability: 0.2 });
    expect(result.decision_brief.analysis_summary).not.toHaveProperty('goal_fit');
    expect(result.option_comparison.find((o: any) => o.option_id === 'affordable').probability_of_joint_goal).toBe(1);
  });

  it('changes response identity when the canonical objective changes and rejects a mismatched producer objective', async () => {
    const max = await run(payload('maximise'));
    const min = await run(payload('minimise'));
    expect(capturedRequest.goal_direction).toBe('minimise');
    expect(min.response_hash).not.toBe(max.response_hash);
    expect(min.robustness).not.toHaveProperty('recommended_option_id');
    ranking = { ...COMPUTED, direction: 'minimise' };
    const matching = await run(payload('minimise'));
    expect(matching.robustness.recommended_option_id).toBe('affordable');
  });

  it('refuses a response that consistently renames ranked and comparison IDs outside the admitted set', async () => {
    aliasResponseIds = true;
    ranking.ranked_options = ranking.ranked_options.map((o: any) => ({ ...o, option_id: `alien_${o.option_id}` }));
    const result = await run(payload());
    expect(result.objective_ranking).toEqual(ranking); // producer evidence retained
    expect(result.robustness).not.toHaveProperty('recommended_option_id');
    expect(result.robustness).not.toHaveProperty('near_tie');
    expect(result.decision_brief.options).toEqual([]);
    expect(result.decision_brief).not.toHaveProperty('analysis_summary');
  });

  it('preserves explicit maximise parity when both candidates satisfy their limits', async () => {
    allCompliant = true;
    const result = await run(payload());
    expect(result.robustness.recommended_option_id).toBe('expensive');
    expect(result.decision_brief.analysis_summary).toMatchObject({ leading_option: 'Expensive', win_probability: 0.8 });
    expect(result.decision_brief.headline_banded.text).toContain('Expensive');
  });
});

describe('objective projection refusal and ties', () => {
  const candidates = [
    { option_id: 'a', option_label: 'A', status: 'computed', win_probability: 0.5 },
    { option_id: 'b', option_label: 'B', status: 'computed', win_probability: 0.5 },
  ];
  const admitted = [{ id: 'a' }, { id: 'b' }];
  const tied = { direction: 'maximise', attested: true, status: 'computed', ranked_options: [
    { option_id: 'a', rank: 1, win_probability: 0.5 }, { option_id: 'b', rank: 1, win_probability: 0.5 },
  ] };
  it('keeps equal ranks without choosing alphabetically or attaching a comparative headline', () => {
    const licensed = licenseObjectiveComparison(tied, candidates, admitted, 'maximise');
    expect(licensed.attested).toBe(true);
    expect(licensed.recommendation).toBeUndefined();
    const brief = assembleBrief({ analysis_status: 'computed', critiques: [], option_comparison: candidates as any,
      licensed_comparison: licensed, robustness: { fragile_edges: [], robust_edges: [] }, meta: { seed_used: '42' } });
    expect(brief!.options.map((o) => o.rank)).toEqual([1, 1]);
    expect(brief!.headline_banded).toBeUndefined();
  });
  it('rejects a mismatched identity/share join even when the order looks plausible', () => {
    const changed = [{ ...candidates[0], win_probability: 0.6 }, candidates[1]];
    expect(licenseObjectiveComparison(tied, changed, admitted, 'maximise').attested).toBe(false);
  });
  it('refuses extra raw options, missing admitted identity, and duplicate admitted IDs', () => {
    const extra = [...candidates, { option_id: 'extra', win_probability: 0 }];
    expect(licenseObjectiveComparison(tied, extra, admitted, 'maximise').attested).toBe(false);
    expect(licenseObjectiveComparison(tied, candidates, undefined, 'maximise').attested).toBe(false);
    expect(licenseObjectiveComparison(tied, candidates, [{ id: 'a' }, { id: 'a' }], 'maximise').attested).toBe(false);
  });

  it('does not mistake all-zero missing information for a tied ranking', () => {
    const zeros = candidates.map((o) => ({ ...o, win_probability: 0 }));
    const invalid = { ...tied, ranked_options: tied.ranked_options.map((o) => ({ ...o, win_probability: 0 })) };
    expect(licenseObjectiveComparison(invalid, zeros, admitted, 'maximise').attested).toBe(false);
  });
});
