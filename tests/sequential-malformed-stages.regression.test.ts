/**
 * Regression pin: `validateSequentialGraph` must be TOTAL on malformed
 * `sequential_metadata.stages[]`.
 *
 * DEFECT (reproduced against staging build 04f6dbac, and offline here):
 * `validateSequentialGraph` iterated `stage.decisions` and
 * `stage.resolved_uncertainties` with no undefined guard. `StageDefinition`
 * types both as required `string[]`, but callers cast the request body with NO
 * runtime validation of `sequential_metadata`, so any client omitting those
 * arrays reached `for...of undefined` and crashed the handler with a TypeError
 * surfacing as an opaque 500 "Something went wrong".
 *
 * SCOPE NOTE (26 Jul 2026): this defect was originally found on
 * /v1/analysis/sequential and /v1/analysis/policy-tree, and this file
 * originally also pinned those routes' HTTP behaviour. Both routes have since
 * been deleted as vacuous, and those route-level cases were deleted with them —
 * they tested deleted behaviour. The validator itself is NOT deleted: it is
 * still consumed by /v1/analysis/conditional-recommend and /v1/explain/policy,
 * which pass the same untrusted, uncast metadata. The totality requirement
 * therefore stands on its own, and these unit tests are what pin it.
 */

import { describe, it, expect } from 'vitest';
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
    expect(result.valid).toBe(false); // genuinely malformed -> consumers return typed 400
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
