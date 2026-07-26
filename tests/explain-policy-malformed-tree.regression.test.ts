/**
 * Regression pin: POST /v1/explain/policy must be TOTAL on a malformed
 * `policy_tree` — a typed 400, never a 500.
 *
 * DEFECT (found live on staging build `220739b`, 26 Jul 2026, and reproduced
 * offline here): the route validated only that `policy_tree`,
 * `policy_tree.nodes` and `policy_tree.root_id` were *truthy*, then cast
 * `req.body`. `generateFallbackExplanation` ran
 * `policyTree.nodes.filter((n) => n.children.length === 0)` on the result, so a
 * node without a `children` array — a shape the route's own validation
 * accepted — threw `TypeError: Cannot read properties of undefined (reading
 * 'length')`, surfacing to callers as an opaque 500 "Something went wrong".
 *
 * The live probe's own "well-formed control" 500'd for exactly this reason:
 * `{"policy_tree":{"root_id":"r","depth":2,"nodes":[{"id":"r"}]}}` has no
 * `children` on its single node. Every captured 500 on this route shares that
 * one cause; the payloads below are the captured bytes, verbatim.
 *
 * Same defect class as PR #265, which made `validateSequentialGraph` total for
 * `sequential_metadata`. `policy_tree` was left unhardened, and this route also
 * re-reads `sequential_metadata.stages` directly — on a path #265's validator
 * does not cover (see the `is_sequential: false` cases below).
 *
 * WHAT EACH BLOCK PROVES
 * - "captured live payloads": the exact reported defect, 500 -> typed 400.
 * - "additional throw sites": four further unguarded reads on the same
 *   untrusted body, each 500 before this change.
 * - "throw eliminated without a new refusal": shapes that threw but must not
 *   become refusals — the graph declares itself non-sequential, so stage
 *   labels are cosmetic.
 * - "positive controls": a well-formed request still returns a complete 200,
 *   and a previously-observed 400 code is unchanged.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerExplainPolicyRoute } from '../src/routes/v1/explain-policy.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await registerExplainPolicyRoute(app);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  // The fallback path is the one that crashed; keep CEE off so it is exercised.
  delete process.env.CEE_EXPLAIN_POLICY_ENABLE;
  delete process.env.CEE_ORCHESTRATOR_ENABLED;
});

async function post(payload: unknown) {
  const res = await app.inject({ method: 'POST', url: '/v1/explain/policy', payload: payload as any });
  return { statusCode: res.statusCode, body: JSON.parse(res.payload) };
}

/** A tree that satisfies every field the handler reads. */
function wellFormedTree() {
  return {
    root_id: 'root',
    depth: 1,
    terminal_count: 1,
    policy_summary: 'Launch Now (EV: 100)',
    nodes: [
      { id: 'root', type: 'decision', label: 'Start', stage: 0, expected_value: 100, children: ['d1'] },
      { id: 'd1', type: 'decision', label: 'Launch Now', stage: 0, action: 'launch', expected_value: 100, children: [] },
    ],
  };
}

function wellFormedGraph() {
  return {
    nodes: [
      { id: 'launch', label: 'Launch Decision', kind: 'decision', stage: 0 },
      { id: 'outcome', label: 'Revenue', kind: 'outcome', stage: 1 },
    ],
    edges: [{ from: 'launch', to: 'outcome' }],
    sequential_metadata: {
      is_sequential: true,
      stages: [
        { index: 0, label: 'Launch', decisions: ['launch'], resolved_uncertainties: [] },
        { index: 1, label: 'Outcome', decisions: [], resolved_uncertainties: [] },
      ],
    },
  };
}

/**
 * The captured staging payloads, byte-for-byte from
 * `acceptance-evidence/owed-acceptances-2026-07-26/raw/plot265-P{0,5,6}-*.request.json`.
 * All three carry the same `policy_tree`; they differ only in the
 * `sequential_metadata` shape the prior lane was probing.
 */
const CAPTURED_500S: Array<[string, unknown]> = [
  [
    'P0 — the probe\'s own "well-formed" control',
    { policy_tree: { root_id: 'r', depth: 2, nodes: [{ id: 'r' }] }, graph: { nodes: [{ id: 'n1', stage: 0 }, { id: 'n2', stage: 1 }], edges: [], sequential_metadata: { is_sequential: true, stages: [{ index: 0, decisions: ['n1'], resolved_uncertainties: [] }, { index: 1, decisions: ['n2'], resolved_uncertainties: [] }] } } },
  ],
  [
    'P5 — stages omit their id lists',
    { policy_tree: { root_id: 'r', depth: 2, nodes: [{ id: 'r' }] }, graph: { nodes: [{ id: 'n1', stage: 0 }, { id: 'n2', stage: 1 }], edges: [], sequential_metadata: { is_sequential: true, stages: [{ index: 0 }, { index: 1 }] } } },
  ],
  [
    'P6 — a stage id list is the wrong type',
    { policy_tree: { root_id: 'r', depth: 2, nodes: [{ id: 'r' }] }, graph: { nodes: [{ id: 'n1', stage: 0 }, { id: 'n2', stage: 1 }], edges: [], sequential_metadata: { is_sequential: true, stages: [{ index: 0, decisions: 'n1', resolved_uncertainties: [] }, { index: 1, decisions: ['n2'], resolved_uncertainties: [] }] } } },
  ],
];

describe('POST /v1/explain/policy — captured live 500s become typed 400s', () => {
  /**
   * The captured node `{"id":"r"}` omits all three load-bearing fields
   * (`stage`, `expected_value`, `children`). Only `children` threw at runtime —
   * the other two were read totally — so the reported field here is `stage`,
   * the first the validator rejects on, while the `children` throw is pinned in
   * isolation in the next block. Reporting the first failure per node matches
   * the route's existing one-field-per-envelope style.
   */
  it.each(CAPTURED_500S)('%s', async (_name, payload) => {
    const { statusCode, body } = await post(payload);

    // RED before the fix: 500, TypeError reading 'length' of undefined.
    expect(statusCode).not.toBe(500);
    expect(statusCode).toBe(400);

    // Honest envelope, not a generic BAD_INPUT: names the code, the exact
    // node, and the field that could not be read.
    expect(body.code).toBe('INVALID_POLICY_TREE_NODE');
    expect(body.field).toBe('policy_tree.nodes[0].stage');
    expect(body.message).toContain('nodes[0]');
    expect(body.retryable).toBe(false);
    expect(body.error.type).toBe('BAD_INPUT');
  });

  it('all three captured payloads fail on the same node for the same reason', async () => {
    // They differ only in sequential_metadata; the policy_tree is identical, so
    // a divergent verdict here would mean the tree check is order-dependent.
    const fields = await Promise.all(
      CAPTURED_500S.map(async ([, p]) => (await post(p)).body.field)
    );
    expect(new Set(fields).size).toBe(1);
    expect(fields[0]).toBe('policy_tree.nodes[0].stage');
  });

  it('the captured node still fails once stage and expected_value are supplied — children was the throw', async () => {
    // Walks the captured payload up to well-formed one field at a time. The
    // last thing standing is `children`, i.e. the exact 500 reported live.
    const base = { root_id: 'r', depth: 2, policy_summary: 's' };
    const graph = { nodes: [], edges: [] };

    const afterStage = await post({ policy_tree: { ...base, nodes: [{ id: 'r', stage: 0 }] }, graph });
    expect(afterStage.body.field).toBe('policy_tree.nodes[0].expected_value');

    const afterEv = await post({ policy_tree: { ...base, nodes: [{ id: 'r', stage: 0, expected_value: 1 }] }, graph });
    expect(afterEv.body.field).toBe('policy_tree.nodes[0].children');

    const complete = await post({
      policy_tree: { ...base, nodes: [{ id: 'r', stage: 0, expected_value: 1, children: [] }] },
      graph,
    });
    expect(complete.statusCode).toBe(200);
  });
});

describe('POST /v1/explain/policy — the other unguarded reads of the same untrusted body', () => {
  /**
   * Each entry threw before this change. The first is the reported defect in
   * isolation; the rest are throw sites reachable from the same route with no
   * additional malformation elsewhere in the body.
   */
  const cases: Array<[string, unknown, string, string]> = [
    [
      'a node omits children (the reported defect, isolated)',
      { policy_tree: { root_id: 'r', depth: 1, policy_summary: 's', nodes: [{ id: 'r', type: 'outcome', label: 'R', stage: 0, expected_value: 1 }] }, graph: { nodes: [], edges: [] } },
      'INVALID_POLICY_TREE_NODE',
      'policy_tree.nodes[0].children',
    ],
    [
      'children is present but not an array (silently mis-classified as non-terminal before)',
      { policy_tree: { root_id: 'r', depth: 1, policy_summary: 's', nodes: [{ id: 'r', type: 'outcome', label: 'R', stage: 0, expected_value: 1, children: 'x' }] }, graph: { nodes: [], edges: [] } },
      'INVALID_POLICY_TREE_NODE',
      'policy_tree.nodes[0].children',
    ],
    [
      'nodes is truthy but not an array (nodes.find is not a function)',
      { policy_tree: { root_id: 'r', depth: 1, policy_summary: 's', nodes: { a: 1 } }, graph: { nodes: [], edges: [] } },
      'INVALID_POLICY_TREE',
      'policy_tree.nodes',
    ],
    [
      'a node entry is null (reading id of null)',
      { policy_tree: { root_id: 'r', depth: 1, policy_summary: 's', nodes: [null] }, graph: { nodes: [], edges: [] } },
      'INVALID_POLICY_TREE_NODE',
      'policy_tree.nodes[0]',
    ],
    [
      'a decision node omits expected_value (expected_value.toFixed is not a function)',
      { policy_tree: { root_id: 'r', depth: 1, policy_summary: 's', nodes: [{ id: 'r', type: 'decision', label: 'R', stage: 0, children: [] }] }, graph: { nodes: [], edges: [] } },
      'INVALID_POLICY_TREE_NODE',
      'policy_tree.nodes[0].expected_value',
    ],
    [
      'a node omits stage — the grouping key, and a required response field',
      { policy_tree: { root_id: 'r', depth: 1, policy_summary: 's', nodes: [{ id: 'r', type: 'outcome', label: 'R', expected_value: 1, children: [] }] }, graph: { nodes: [], edges: [] } },
      'INVALID_POLICY_TREE_NODE',
      'policy_tree.nodes[0].stage',
    ],
  ];

  it.each(cases)('%s -> typed 400', async (_name, payload, code, field) => {
    const { statusCode, body } = await post(payload);
    expect(statusCode).not.toBe(500);
    expect(statusCode).toBe(400);
    expect(body.code).toBe(code);
    expect(body.field).toBe(field);
  });

  it('the message names the offending node by id and index, not just the field', async () => {
    const { body } = await post({
      policy_tree: {
        root_id: 'a',
        depth: 1,
        policy_summary: 's',
        nodes: [
          { id: 'a', type: 'decision', label: 'A', stage: 0, expected_value: 1, children: ['b'] },
          { id: 'b', type: 'outcome', label: 'B', stage: 1, expected_value: 2 },
        ],
      },
      graph: { nodes: [], edges: [] },
    });
    expect(body.field).toBe('policy_tree.nodes[1].children');
    expect(body.message).toContain('nodes[1]');
    expect(body.message).toContain('"b"');
  });
});

describe('POST /v1/explain/policy — throws eliminated without inventing a refusal', () => {
  /**
   * `validateSequentialGraph` is total, but it is only reached when the graph
   * declares itself sequential. With `is_sequential: false` the route used to
   * read `sequential_metadata.stages` directly and throw. Stage labels are
   * cosmetic, so these must succeed, not refuse.
   */
  const nonSequential = (stages: unknown) => ({
    policy_tree: {
      root_id: 'r',
      depth: 1,
      policy_summary: 'summary',
      nodes: [{ id: 'r', type: 'decision', label: 'R', stage: 0, expected_value: 5, children: [] }],
    },
    graph: { nodes: [{ id: 'a' }], edges: [], sequential_metadata: { is_sequential: false, stages } },
  });

  it('stages is not an array (was: stages is not iterable)', async () => {
    const { statusCode, body } = await post(nonSequential({ bad: true }));
    expect(statusCode).toBe(200);
    expect(body.schema).toBe('explain_policy.v1');
    // Label unavailable -> falls back to the generated label, not a crash.
    expect(body.explanation.stage_explanations[0].stage_label).toBe('Stage 0');
  });

  it('a stages entry is null (was: reading index of null)', async () => {
    const { statusCode } = await post(nonSequential([null]));
    expect(statusCode).toBe(200);
  });

  it('policy_summary is absent — summary is a string, never the literal "undefined"', async () => {
    // Before: `explanation.summary` was `undefined`, so JSON.stringify dropped
    // a required response field entirely.
    const tree = wellFormedTree() as Record<string, unknown>;
    delete tree.policy_summary;
    const { statusCode, body } = await post({ policy_tree: tree, graph: wellFormedGraph() });

    expect(statusCode).toBe(200);
    expect('summary' in body.explanation).toBe(true);
    expect(typeof body.explanation.summary).toBe('string');
    expect(body.explanation.summary).not.toContain('undefined');
  });

  it('a decision node without a label falls back to its id, not "undefined"', async () => {
    const tree = wellFormedTree();
    delete (tree.nodes[0] as Record<string, unknown>).label;
    delete (tree.nodes[1] as Record<string, unknown>).label;
    delete (tree.nodes[1] as Record<string, unknown>).action;
    const { statusCode, body } = await post({ policy_tree: tree, graph: wellFormedGraph() });

    expect(statusCode).toBe(200);
    expect(JSON.stringify(body.explanation)).not.toContain('undefined');
  });
});

describe('POST /v1/explain/policy — positive controls', () => {
  it('a well-formed request still returns a complete 200 explanation', async () => {
    const { statusCode, body } = await post({ policy_tree: wellFormedTree(), graph: wellFormedGraph() });

    expect(statusCode).toBe(200);
    expect(body.schema).toBe('explain_policy.v1');
    expect(body.provenance).toBe('plot_fallback');

    // Non-vacuous: the explanation carries real, derived content — this is what
    // proves the guards did not turn a working route into a refusal machine.
    expect(body.explanation.summary).toBe(
      'This policy consists of 1 sequential decisions. Launch Now (EV: 100)'
    );
    expect(body.explanation.stage_explanations).toHaveLength(1);
    expect(body.explanation.stage_explanations[0]).toMatchObject({
      stage: 0,
      stage_label: 'Launch',
      key_decision: 'Start',
      rationale: 'Expected value: 100.00',
    });
    expect(body.explanation.assumptions.length).toBeGreaterThan(0);
  });

  it('a tree with no nodes is still accepted (unchanged behaviour)', async () => {
    const { statusCode, body } = await post({
      policy_tree: { root_id: 'root', nodes: [], depth: 0, terminal_count: 0, policy_summary: 'Empty policy' },
      graph: { nodes: [], edges: [] },
    });
    expect(statusCode).toBe(200);
    expect(body.explanation.summary).toBe('Empty policy');
  });

  it('the terminal-node risk finding still fires when it should', async () => {
    // Two terminals, one far below average -> the risks list must say so.
    const { statusCode, body } = await post({
      policy_tree: {
        root_id: 'root',
        depth: 1,
        terminal_count: 2,
        policy_summary: 'Mixed outcomes',
        nodes: [
          { id: 'root', type: 'decision', label: 'Start', stage: 0, expected_value: 50, children: ['hi', 'lo'] },
          { id: 'hi', type: 'outcome', label: 'Good', stage: 1, expected_value: 100, children: [] },
          { id: 'lo', type: 'outcome', label: 'Bad', stage: 1, expected_value: 1, children: [] },
        ],
      },
      graph: { nodes: [], edges: [] },
    });

    expect(statusCode).toBe(200);
    expect(body.explanation.risks.join(' ')).toContain('below-average');
  });

  it('PRESERVATION CONTROL: a graph-side 400 keeps the code it returned before', async () => {
    // #265's own live evidence pins this payload to INVALID_STAGE_DEFINITION.
    // Its policy_tree is malformed too, so this asserts the new validator runs
    // last and never renames a 400 callers already receive.
    // (Not RED-first: this must pass both before and after the change.)
    const { statusCode, body } = await post({
      policy_tree: { root_id: 'r', depth: 2, nodes: [{ id: 'r' }] },
      graph: {
        nodes: [{ id: 'n1', stage: 0 }, { id: 'n2', stage: 1 }],
        edges: [],
        sequential_metadata: { is_sequential: true, stages: [{ decision_node_id: 'n1', timing: 't0' }, { decision_node_id: 'n2', timing: 't1' }] },
      },
    });

    expect(statusCode).toBe(400);
    expect(body.code).toBe('INVALID_STAGE_DEFINITION');
    expect(body.field).toBe('graph.sequential_metadata');
  });

  it('the pre-existing presence checks are unchanged', async () => {
    expect((await post({ graph: { nodes: [], edges: [] } })).statusCode).toBe(400);
    expect(
      (await post({ policy_tree: { root_id: 'root', nodes: [], depth: 0, terminal_count: 0, policy_summary: 'x' } }))
        .statusCode
    ).toBe(400);
  });
});
