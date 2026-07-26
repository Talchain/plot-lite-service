/**
 * Regression pin: malformed `sequential_metadata.stages[]` must not 500.
 *
 * DEFECT (reproduced against staging build 04f6dbac, and offline here):
 * `validateSequentialGraph` iterated `stage.decisions` and
 * `stage.resolved_uncertainties` with no undefined guard. `StageDefinition`
 * types both as required `string[]`, but the routes cast the request body
 * (`req.body as SequentialAnalysisRequest`) with NO runtime validation of
 * `sequential_metadata`, so any client omitting those arrays reached
 * `for...of undefined` and crashed the handler:
 *
 *   POST /v1/analysis/sequential  -> 500 INTERNAL "Something went wrong"
 *   POST /v1/analysis/policy-tree -> 500 INTERNAL "Something went wrong"
 *
 * The analysis itself never needed those arrays — both routes derive stages
 * from `node.stage`. So the correct behaviour is a successful 200 carrying a
 * typed, actionable validation issue naming the field that was ignored, not a
 * rejection and certainly not a crash.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerSequentialAnalysisRoute } from '../src/routes/v1/analysis-sequential.js';
import { registerPolicyTreeRoute } from '../src/routes/v1/analysis-policy-tree.js';
import { validateSequentialGraph, getMaxStage } from '../src/util/sequential-validation.js';

/**
 * The prior lane's exact staging probe payload. Its stages carry
 * `decision_node_id`/`timing` and NEITHER `decisions` NOR
 * `resolved_uncertainties`.
 */
function malformedStagePayload() {
  return {
    graph: {
      nodes: [
        { id: 'd1', label: 'Launch pilot', kind: 'decision', stage: 0 },
        { id: 'o1a', label: 'Pilot one region', kind: 'option', stage: 0, value: 60 },
        { id: 'o1b', label: 'Pilot nationwide', kind: 'option', stage: 0, value: 40 },
        { id: 'f1', label: 'Market response', kind: 'factor', stage: 0, value: 50 },
        { id: 'd2', label: 'Scale or hold', kind: 'decision', stage: 1 },
        { id: 'o2a', label: 'Scale up', kind: 'option', stage: 1, value: 70 },
        { id: 'o2b', label: 'Hold', kind: 'option', stage: 1, value: 30 },
        { id: 'out', label: '12-month profit', kind: 'outcome', stage: 1, value: 100 },
      ],
      edges: [
        { from: 'o1a', to: 'f1', weight: 0.6 },
        { from: 'o1b', to: 'f1', weight: 0.4 },
        { from: 'f1', to: 'out', weight: 0.5 },
        { from: 'o2a', to: 'out', weight: 0.7 },
        { from: 'o2b', to: 'out', weight: 0.3 },
      ],
      sequential_metadata: {
        is_sequential: true,
        stages: [
          { index: 0, label: 'Launch pilot', decision_node_id: 'd1', timing: 'now' },
          { index: 1, label: 'Scale or hold', decision_node_id: 'd2', timing: 'next' },
        ],
      },
    },
    discount_factor: 0.95,
    outcome_node: 'out',
  };
}

/** Same graph, with the contract-declared stage fields present. */
function wellFormedStagePayload() {
  const p = malformedStagePayload();
  p.graph.sequential_metadata.stages = [
    { index: 0, label: 'Launch pilot', decisions: ['d1'], resolved_uncertainties: ['f1'] },
    { index: 1, label: 'Scale or hold', decisions: ['d2'], resolved_uncertainties: [] },
  ] as any;
  return p;
}

describe('validateSequentialGraph — malformed stage definitions must not throw', () => {
  it('does not throw when a stage omits decisions / resolved_uncertainties', () => {
    const graph = malformedStagePayload().graph as any;

    // RED before the fix: throws TypeError "stage.decisions is not iterable".
    expect(() => validateSequentialGraph(graph)).not.toThrow();

    const result = validateSequentialGraph(graph);

    // The omission is surfaced, not silently swallowed.
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('MISSING_STAGE_ID_LIST');

    // Actionable: the issue names the stage and the exact field that was ignored.
    const issue = result.issues.find((i) => i.code === 'MISSING_STAGE_ID_LIST')!;
    expect(issue.severity).toBe('warning');
    expect(issue.message).toContain('decisions');

    // A missing optional-in-practice list is not fatal — analysis uses node.stage.
    expect(result.valid).toBe(true);
    expect(result.stage_count).toBe(2);
  });

  it('does not throw when stages is not an array', () => {
    const graph = malformedStagePayload().graph as any;
    graph.sequential_metadata.stages = 'not-an-array';

    expect(() => validateSequentialGraph(graph)).not.toThrow();
    const result = validateSequentialGraph(graph);
    expect(result.issues.map((i) => i.code)).toContain('INVALID_SEQUENTIAL_METADATA');
    expect(result.valid).toBe(false); // genuinely malformed -> route returns typed 400
  });

  it('does not throw when a stage entry is null or not an object', () => {
    const graph = malformedStagePayload().graph as any;
    graph.sequential_metadata.stages = [null, 42, { index: 0, label: 'ok', decisions: [], resolved_uncertainties: [] }];

    expect(() => validateSequentialGraph(graph)).not.toThrow();
    const result = validateSequentialGraph(graph);
    expect(result.issues.map((i) => i.code)).toContain('INVALID_STAGE_DEFINITION');
  });

  it('does not throw when a stage id list is present but the wrong type', () => {
    const graph = malformedStagePayload().graph as any;
    graph.sequential_metadata.stages = [
      { index: 0, label: 'Launch', decisions: 'd1', resolved_uncertainties: { a: 1 } },
    ];

    expect(() => validateSequentialGraph(graph)).not.toThrow();
    const result = validateSequentialGraph(graph);
    expect(result.issues.map((i) => i.code)).toContain('INVALID_STAGE_ID_LIST');
  });

  it('getMaxStage does not throw on malformed stages', () => {
    const graph = malformedStagePayload().graph as any;
    graph.sequential_metadata.stages = [null, { index: 3 }, 'x'];
    expect(() => getMaxStage(graph)).not.toThrow();
    expect(getMaxStage(graph)).toBe(3);
  });

  it('still validates a well-formed sequential graph with no issues', () => {
    // Guards must not swallow the real validation behaviour.
    const result = validateSequentialGraph(wellFormedStagePayload().graph as any);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.stage_count).toBe(2);
  });
});

describe('POST /v1/analysis/sequential — malformed stages return 200, not 500', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerSequentialAnalysisRoute(app);
    await registerPolicyTreeRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    process.env.ENABLE_SEQUENTIAL_ANALYSIS = '1';
    delete process.env.ISL_SEQUENTIAL_ENABLE;
    delete process.env.ISL_POLICY_TREE_ENABLE;
    delete process.env.ISL_ENABLE;
  });

  it('sequential: returns 200 for stages missing decisions[] (was 500 INTERNAL)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/sequential',
      payload: malformedStagePayload(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schema).toBe('sequential_analysis.v1');

    // The ignored field is reported back to the caller, typed and actionable.
    const codes = body.validation.issues.map((i: any) => i.code);
    expect(codes).toContain('MISSING_STAGE_ID_LIST');
  });

  it('policy-tree: returns 200 for stages missing decisions[] (was 500 INTERNAL)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/policy-tree',
      payload: malformedStagePayload(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schema).toBe('policy_tree.v1');
    expect(body.tree.nodes.length).toBeGreaterThan(1);
  });

  it('sequential: genuinely malformed stages get a typed 400, never a 500', async () => {
    const payload = malformedStagePayload() as any;
    payload.graph.sequential_metadata.stages = 'not-an-array';

    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/sequential',
      payload,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    // Typed and actionable, not "Something went wrong".
    expect(body.code).toBe('INVALID_SEQUENTIAL_METADATA');
    expect(body.error.type).toBe('BAD_INPUT');
    expect(body.message).toContain('stages must be an array');
    expect(body.message).not.toContain('Something went wrong');
  });

  it('policy-tree: genuinely malformed stages get a typed 400, never a 500', async () => {
    // sequential-validation.ts documents this route as "Full validation, blocks
    // on error -> 400 BAD_INPUT"; the route previously discarded `validation`.
    const payload = malformedStagePayload() as any;
    payload.graph.sequential_metadata.stages = 'not-an-array';

    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/policy-tree',
      payload,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe('INVALID_SEQUENTIAL_METADATA');
    expect(body.error.type).toBe('BAD_INPUT');
  });

  /**
   * POSITIVE CONTROL for the local fallback at analysis-sequential.ts:356.
   *
   * A fallback that never executes is guarantee theatre. This proves it runs
   * AND that what it produces is non-empty — an assertion that it merely
   * "returned an object" would pass even if the fallback computed nothing.
   */
  it('local fallback executes and produces non-vacuous content when ISL is off', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/sequential',
      payload: wellFormedStagePayload(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.provenance).toBe('plot_fallback');
    expect(body.analysis.stage_decisions.length).toBeGreaterThan(0);
    expect(body.analysis.strategy_summary).toContain('Optimal strategy');
    expect(body.analysis.strategy_summary).not.toBe('No sequential decisions found');
    for (const d of body.analysis.stage_decisions) {
      expect(typeof d.expected_value).toBe('number');
      expect(Number.isFinite(d.expected_value)).toBe(true);
      expect(d.optimal_option_id).toBeTruthy();
    }
  });
});
