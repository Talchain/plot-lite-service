/** Complete objective comparison does not require an inapplicable max-only metric. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import captured from './fixtures/objective-status-applicability.json';

let selected = captured.cases[0];
let mutate: (response: any) => void = () => {};
let allIneligible = false;
const service = {
  isEnabled: () => true,
  isAvailable: async () => true,
  async callAnalysisEndpoint(_endpoint: string, request: any) {
    const response: any = { ...structuredClone(selected.response), request_id: request.request_id };
    if (allIneligible) {
      for (const option of response.options) {
        option.constraint_analysis = {
          constraints: request.goal_constraints.map((c: any) => ({ ...c, threshold: c.value, prob_satisfied: 0 })),
          joint_probability: 0,
        };
      }
    }
    mutate(response);
    return { error: null, data: response };
  },
};
vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => service, islService: service };
});
const { createServer } = await import('../src/createServer.js');

describe('objective capability applicability on the complete PLoT route', () => {
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
  beforeEach(() => { selected = captured.cases[0]; mutate = () => {}; allIneligible = false; });
  async function run(input: any = structuredClone(selected.input)) {
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload: input });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  it.each(captured.cases)('keeps the actual complete $name comparison computed', async (entry) => {
    selected = entry;
    const body = await run();
    expect(body.analysis_status).toBe('computed');
    expect(body.option_comparison_status).toBe('computed');
    expect(body.drivers_status).toBe('computed');
    expect(body.robustness_status).toBe('unavailable');
    expect(body.robustness.display_verdict).toBe('not_assessed');
    expect(body.approximate).toBe(false);
    expect(body.inference_warnings.some((w: any) => w.code === 'OBJECTIVE_METRICS_UNAVAILABLE')).toBe(true);
    // The actual ISL row is a zero-sensitivity intervention override, not a failure.
    expect(entry.response.factor_sensitivity[0]).toMatchObject({
      sensitivity_score: 0, zero_reason: 'intervention_override',
    });
  });

  it('uses typed applicability, independent of warning prose', async () => {
    mutate = r => { r.inference_warnings.find((w: any) => w.code === 'OBJECTIVE_METRICS_UNAVAILABLE').detail.message = 'Different wording'; };
    expect((await run()).analysis_status).toBe('computed');
  });

  it('accepts optional driver carriers being absent', async () => {
    mutate = r => { delete r.factor_sensitivity[0].elasticity; delete r.factor_sensitivity[0].importance_rank; };
    expect((await run()).analysis_status).toBe('computed');
  });

  it('keeps a complete dense tie computed without naming a winner', async () => {
    mutate = r => {
      r.objective_ranking.ranked_options = ['high', 'low', 'middle'].map(option_id => ({ option_id, rank: 1, win_probability: 1 / 3 }));
      r.options.forEach((o: any) => { o.win_probability = 1 / 3; });
    };
    const body = await run();
    expect(body.analysis_status).toBe('computed');
    expect(body.robustness.recommended_option_id).toBeUndefined();
  });

  it('keeps complete computation separate from all options breaching stated limits', async () => {
    allIneligible = true;
    const input: any = structuredClone(selected.input);
    Object.assign(input.graph.nodes[1].observed_state, { raw_value: 50, cap: 100, unit: '%' });
    input.goal_constraints = [{ constraint_id: 'limit', node_id: 'goal', operator: '<=', value: 20, unit: '%', value_frame: 'level' }];
    const body = await run(input);
    expect(body.analysis_status).toBe('computed');
    expect(body.robustness.recommended_option_id).toBeUndefined();
    expect(body.robustness.recommended_option_compliance).toBe('no_eligible_option');
  });

  it.each([
    ['upstream partial', (r: any) => { r.analysis_status = 'partial'; }],
    ['missing upstream status', (r: any) => { delete r.analysis_status; }],
    ['foreign receipt', (r: any) => { r.request_id = 'another-run'; }],
    ['partial option', (r: any) => { r.options[0].status = 'partial'; }],
    ['failed option', (r: any) => { r.options[0].status = 'failed'; }],
    ['missing ranking', (r: any) => { delete r.objective_ranking; }],
    ['withheld ranking', (r: any) => { r.objective_ranking = { direction: 'minimise', attested: true, status: 'withheld', ranked_options: [] }; }],
    ['wrong objective', (r: any) => { r.objective_ranking.direction = 'maximise'; }],
    ['mismatched share', (r: any) => { r.options[0].win_probability = .5; }],
    ['foreign complete comparison', (r: any) => { r.options[0].id = 'alien'; r.objective_ranking.ranked_options.find((o: any) => o.option_id === 'low').option_id = 'alien'; }],
    ['failed drivers', (r: any) => { r.factor_sensitivity_status = 'error'; }],
    ['suppressed drivers', (r: any) => { r.factor_sensitivity_status = 'suppressed'; }],
    ['missing driver status', (r: any) => { delete r.factor_sensitivity_status; }],
    ['missing raw driver data', (r: any) => { delete r.factor_sensitivity; }],
    ['empty raw driver data', (r: any) => { r.factor_sensitivity = []; }],
    ['foreign raw driver', (r: any) => { r.factor_sensitivity[0].node_id = 'alien'; }],
    ['duplicate raw driver', (r: any) => { r.factor_sensitivity.push(structuredClone(r.factor_sensitivity[0])); }],
    ['invalid driver score', (r: any) => { r.factor_sensitivity[0].sensitivity_score = NaN; }],
    ['out-of-domain driver score', (r: any) => { r.factor_sensitivity[0].sensitivity_score = 2; }],
    ['invalid optional driver rank', (r: any) => { r.factor_sensitivity[0].importance_rank = 1.5; }],
    ['invalid optional driver importance', (r: any) => { r.factor_sensitivity[0].importance_score = 2; }],
    ['missing applicability disclosure', (r: any) => { r.inference_warnings = []; }],
    ['wrong disclosed field', (r: any) => { r.inference_warnings.find((w: any) => w.code === 'OBJECTIVE_METRICS_UNAVAILABLE').field = 'other'; }],
    ['robustness not deliberately suppressed', (r: any) => { r.inference_warnings.find((w: any) => w.code === 'OBJECTIVE_METRICS_UNAVAILABLE').detail.suppressed_fields = ['downside']; }],
    ['robustness error', (r: any) => { r.robustness_status = 'error'; }],
  ] as const)('does not promote %s despite usable graph-derived driver rows', async (_name, change) => {
    mutate = change;
    expect((await run()).analysis_status).toBe('partial');
  });

  it('does not promote missing option outcomes', async () => {
    mutate = r => { delete r.options[0].outcome; };
    expect((await run()).analysis_status).toBe('failed');
  });

  it('does not reinterpret generic maximise robustness absence', async () => {
    const input: any = structuredClone(selected.input);
    input.graph.nodes[1].goal_direction = 'maximise';
    mutate = r => { r.objective_ranking.direction = 'maximise'; };
    expect((await run(input)).analysis_status).toBe('partial');
  });
});
