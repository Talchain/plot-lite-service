import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import witness from './fixtures/objective-constraint-frame-witness.json';
import frameCases from './fixtures/objective-constraint-frame-refusals.json';
import {
  collectResolvedConstraintFrameIds,
  detectUnanchoredSampleFrameTargets,
  detectUnitMismatchedConstraintTargets,
  detectUnreliableConstraintTargets,
} from '../src/lib/constraint-reliability.js';

const clone = <T>(value: T): T => structuredClone(value);

describe('request-bound ISL constraint-frame result adoption', () => {
  it.each(frameCases.cases)('preserves actual producer frame verdict: $name', (entry) => {
    expect(entry.status_code).toBe(200);
    const request: any = clone(entry.request);
    const result: any = clone(entry.response);
    expect([...collectResolvedConstraintFrameIds(request, result)]).toEqual(entry.expected_resolved_ids);
    if (entry.name !== 'positive') {
      expect(result.options.every((o: any) => o.constraint_analysis === undefined)).toBe(true);
      expect(result.inference_warnings.some((w: any) =>
        w.code === 'CONSTRAINT_NOT_CONVERTIBLE' || w.code === 'CONSTRAINT_FRAME_UNSPECIFIED')).toBe(true);
    }
  });

  it('accepts the actual complete level result without inventing a node delta stamp', () => {
    const request: any = clone(witness.request);
    const result: any = clone(witness.response);
    const resolved = collectResolvedConstraintFrameIds(request, result);
    expect([...resolved]).toEqual(['budget']);
    const args = [request.goal_constraints, request.graph.nodes,
      new Set(['goal']), request.options, undefined] as const;
    expect(detectUnanchoredSampleFrameTargets(...args)).toEqual([
      { constraint_id: 'budget', node_id: 'goal', reasons: ['sample_frame_unanchored'] },
    ]);
    expect(detectUnanchoredSampleFrameTargets(...args, resolved)).toEqual([]);
    // Scale and unit guards are independent; frame evidence cannot open them.
    expect(detectUnreliableConstraintTargets(request.goal_constraints,
      new Map([['budget', { source: 'default', min: 0, max: 1 }]]), {}).length).toBe(1);
    expect(detectUnitMismatchedConstraintTargets(request.goal_constraints,
      new Map([['budget', { unit_mismatch: { constraint_unit: 'count', scale_unit: '%' } }]])).length).toBe(1);
  });

  it.each([
    ['foreign request', (_q: any, r: any) => { r.request_id = 'another-run'; }],
    ['absent request receipt', (q: any) => { delete q.request_id; }],
    ['failed envelope', (_q: any, r: any) => { r.analysis_status = 'failed'; }],
    ['absent envelope status', (_q: any, r: any) => { delete r.analysis_status; }],
    ['missing option result', (_q: any, r: any) => { r.options.pop(); }],
    ['foreign option', (_q: any, r: any) => { r.options[0].id = 'alien'; }],
    ['duplicate option', (_q: any, r: any) => { r.options[0].id = r.options[1].id; }],
    ['duplicate admitted option', (q: any) => { q.options[0].id = q.options[1].id; }],
    ['conflicting option aliases', (_q: any, r: any) => { r.options[0].option_id = 'alien'; }],
    ['failed option', (_q: any, r: any) => { r.options[0].status = 'failed'; }],
    ['foreign constraint', (_q: any, r: any) => { r.options[0].constraint_analysis.constraints[0].constraint_id = 'alien'; }],
    ['duplicate forwarded constraint', (q: any) => { q.goal_constraints.push(clone(q.goal_constraints[0])); }],
    ['duplicate returned constraint', (_q: any, r: any) => {
      r.options[0].constraint_analysis.constraints.push(clone(r.options[0].constraint_analysis.constraints[0]));
    }],
    ['wrong target node', (_q: any, r: any) => { r.options[0].constraint_analysis.constraints[0].node_id = 'driver'; }],
    ['wrong operator', (_q: any, r: any) => { r.options[0].constraint_analysis.constraints[0].operator = '>='; }],
    ['wrong threshold', (_q: any, r: any) => { r.options[0].constraint_analysis.constraints[0].threshold = 20; }],
    ['conflicting value alias', (_q: any, r: any) => { r.options[0].constraint_analysis.constraints[0].value = 20; }],
    ['non-finite probability', (_q: any, r: any) => { r.options[0].constraint_analysis.constraints[0].prob_satisfied = NaN; }],
    ['probability outside domain', (_q: any, r: any) => { r.options[0].constraint_analysis.constraints[0].prob_satisfied = 1.01; }],
    ['missing joint', (_q: any, r: any) => { delete r.options[0].constraint_analysis.joint_probability; }],
    ['missing frame', (q: any) => { delete q.goal_constraints[0].value_frame; }],
    ['unresolved warning', (_q: any, r: any) => { r.inference_warnings.push({ code: 'CONSTRAINT_NOT_CONVERTIBLE' }); }],
    ['unspecified critique', (_q: any, r: any) => { r.critiques.push({ code: 'CONSTRAINT_FRAME_UNSPECIFIED' }); }],
  ] as const)('refuses to borrow frame authority with %s', (_name, mutate) => {
    const request: any = clone(witness.request);
    const result: any = clone(witness.response);
    mutate(request, result);
    expect([...collectResolvedConstraintFrameIds(request, result)]).toEqual([]);
  });

  it('joins multiple constraints by identity and refuses duplicate rows at the same count', () => {
    const request: any = clone(witness.request);
    const result: any = clone(witness.response);
    request.goal_constraints.push({ ...clone(request.goal_constraints[0]), constraint_id: 'second_limit' });
    for (const option of result.options) {
      option.constraint_analysis.constraints.unshift({
        ...clone(option.constraint_analysis.constraints[0]), constraint_id: 'second_limit',
      });
    }
    expect([...collectResolvedConstraintFrameIds(request, result)]).toEqual(['budget', 'second_limit']);
    result.options[0].constraint_analysis.constraints[0].constraint_id = 'budget';
    expect([...collectResolvedConstraintFrameIds(request, result)]).toEqual([]);
  });
});

let capturedRequest: any;
const service = {
  isEnabled: () => true,
  isAvailable: async () => true,
  async callAnalysisEndpoint(_endpoint: string, body: any) {
    capturedRequest = clone(body);
    // Replay the captured result under this actual transport request receipt.
    return { error: null, data: { ...clone(witness.response), request_id: body.request_id } };
  },
};
vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => service, islService: service };
});
const { createServer } = await import('../src/createServer.js');

describe('actual ISL level-result replay through the PLoT route', () => {
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

  it('licenses Low with its own zero raw share after the raw leader breaches the stated ceiling', async () => {
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload: clone(witness.input) });
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json();
    expect(capturedRequest.goal_constraints).toEqual(witness.request.goal_constraints);
    expect(capturedRequest.graph.nodes.find((n: any) => n.id === 'goal')).not.toHaveProperty('goal_threshold_frame');
    expect(result.option_comparison.find((o: any) => o.option_id === 'low')).toMatchObject({
      constraint_probabilities: { budget: 0.81 }, constraints_decision_grade: true,
    });
    expect(result.option_comparison.find((o: any) => o.option_id === 'high')).toMatchObject({
      constraint_probabilities: { budget: 0 }, constraints_decision_grade: true,
    });
    expect(result.objective_ranking).toEqual(witness.response.objective_ranking);
    expect(result.robustness.recommended_option_id).toBe('low');
    expect(result.robustness.recommended_option_compliance).toBe('uncertain');
    expect(result.decision_brief.analysis_summary).toMatchObject({ leading_option: 'Low', win_probability: 0 });
    expect(result.decision_brief).not.toHaveProperty('headline_banded');
  });
});
