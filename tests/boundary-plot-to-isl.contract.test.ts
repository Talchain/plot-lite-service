/**
 * PLoT → ISL Boundary Transform Contract Tests (B4.5)
 *
 * Validates that the PLoT→ISL translator correctly applies all declared
 * drops, renames, transforms, and enrichments from the contract.
 *
 * Calls toISLRobustnessRequest() directly — no network, no mocking.
 */

import { describe, it, expect } from 'vitest';
import { PLOT_TO_ISL_CONTRACT } from '../src/contracts/plot-to-isl.contract.js';
import type { BoundaryContract } from '../src/contracts/plot-to-isl.contract.js';
import {
  toISLRobustnessRequest,
  toISLInterventions,
  toISLNode,
} from '../src/integrations/isl/translator-v3.js';
import type { EngineGraphV3, OptionV3, GoalConstraint } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Source fields under contract
// ---------------------------------------------------------------------------

/**
 * The explicit list of source field paths this contract governs.
 * Enforcement only applies within this set.
 */
const SOURCE_FIELDS_UNDER_CONTRACT = [
  // Dropped request-level fields
  'detail_level',
  'idempotency_key',
  'brief',
  // Dropped intervention metadata
  'intervention.source',
  // Renamed fields
  'goal_constraints[].value',
  // Transformed fields
  'options[].interventions (InterventionValueV3)',
  'nodes[].observed_state.value',
  // Enriched fields
  'request_id',
  'analysis_types',
  'parameter_uncertainties[].distribution',
  // Filtered node kinds (runtime NON_CAUSAL_NODE_KINDS = ['option', 'decision'])
  'nodes[kind=option]',
  'nodes[kind=decision]',
];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue', observed_state: { value: 100 } },
    {
      id: 'factor-a', kind: 'factor', label: 'Marketing Spend',
      observed_state: { value: 0.6, std: 0.1 },
    },
    {
      id: 'factor-b', kind: 'factor', label: 'Customer Churn',
      observed_state: { value: 0.5 },
    },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9 },
    { from: 'factor-b', to: 'goal', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.8 },
  ],
};

const OPTIONS: OptionV3[] = [
  {
    id: 'opt1', label: 'Increase Marketing',
    interventions: {
      'factor-a': { value: 0.8, source: 'user_specified' },
    },
  },
  {
    id: 'opt2', label: 'Reduce Churn',
    interventions: {
      'factor-b': { value: 0.3, source: 'brief_extraction' },
    },
  },
];

const GOAL_CONSTRAINTS: GoalConstraint[] = [
  { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 0.7 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PLoT → ISL boundary contract (B4.5)', () => {
  const islRequest = toISLRobustnessRequest(
    GRAPH,
    OPTIONS,
    'goal',
    'req-contract-test',
    1000,
    undefined,       // goalThreshold
    GOAL_CONSTRAINTS,
    'seed-42'
  );

  // ----- Drops -----

  it('all declared drops are absent from ISL request', () => {
    const output = JSON.stringify(islRequest);

    // detail_level, idempotency_key, brief are request-level fields
    // that never reach the translator — they are dropped at the route layer.
    // Verify they are not in the ISL request object.
    expect(islRequest).not.toHaveProperty('detail_level');
    expect(islRequest).not.toHaveProperty('idempotency_key');
    expect(islRequest).not.toHaveProperty('brief');

    // intervention.source must be stripped
    for (const opt of islRequest.options) {
      for (const value of Object.values(opt.interventions)) {
        // Value should be a number, not an object
        expect(typeof value).toBe('number');
      }
    }
  });

  it('intervention.source is stripped during flattening', () => {
    const flattened = toISLInterventions({
      'factor-a': { value: 0.8, source: 'user_specified' },
      'factor-b': { value: 0.3, source: 'brief_extraction' },
    });

    expect(flattened).toEqual({ 'factor-a': 0.8, 'factor-b': 0.3 });
    // Source metadata must not be present
    expect(JSON.stringify(flattened)).not.toContain('source');
    expect(JSON.stringify(flattened)).not.toContain('user_specified');
  });

  // ----- Renames -----

  it('goal_constraints[].value passed through as canonical field (F-20)', () => {
    // Source used value: 0.7
    expect(islRequest.goal_constraints).toBeDefined();
    const c = islRequest.goal_constraints![0];

    // Canonical field "value" present with correct value
    expect(c.value).toBe(0.7);

    // Legacy field "threshold" absent
    expect(c).not.toHaveProperty('threshold');
  });

  // ----- Transforms -----

  it('intervention flatten: InterventionValueV3 → number', () => {
    // Input was { value: 0.8, source: 'user_specified' }, output should be 0.8
    expect(islRequest.options[0].interventions['factor-a']).toBe(0.8);
    expect(islRequest.options[1].interventions['factor-b']).toBe(0.3);
  });

  it('parameter_uncertainties derived from observed_state', () => {
    expect(islRequest.parameter_uncertainties).toBeDefined();
    expect(islRequest.parameter_uncertainties!.length).toBeGreaterThanOrEqual(1);

    // factor-a has observed_state.std=0.1, should appear in PU
    const factorAPU = islRequest.parameter_uncertainties!.find(
      (pu: any) => pu.node_id === 'factor-a'
    );
    expect(factorAPU).toBeDefined();
    expect(factorAPU!.mean).toBe(0.6);
    // Distribution is always 'normal'
    expect(factorAPU!.distribution).toBe('normal');
  });

  // ----- Enriched -----

  it('all enriched fields are present', () => {
    expect(islRequest.request_id).toBe('req-contract-test');
    expect(islRequest.analysis_types).toEqual(['comparison', 'sensitivity', 'robustness']);

    // include_e_values and include_voi always true
    expect(islRequest.include_e_values).toBe(true);
    expect(islRequest.include_voi).toBe(true);

    // parameter_uncertainties[].distribution enriched
    if (islRequest.parameter_uncertainties && islRequest.parameter_uncertainties.length > 0) {
      for (const pu of islRequest.parameter_uncertainties) {
        expect(pu.distribution).toBe('normal');
      }
    }
  });

  // ----- Multi-source transform -----

  it('edge_from + edge_to verified (passthrough at this boundary)', () => {
    // At PLoT→ISL, edges keep from/to names. The composite edge_id is an ISL→UI transform.
    expect(islRequest.graph.edges[0].from).toBe('factor-a');
    expect(islRequest.graph.edges[0].to).toBe('goal');
  });

  // ----- Contract structure -----

  it('contract object has all required keys', () => {
    expect(PLOT_TO_ISL_CONTRACT.name).toBe('plot-to-isl');
    expect(PLOT_TO_ISL_CONTRACT.drops).toBeInstanceOf(Array);
    expect(PLOT_TO_ISL_CONTRACT.renames).toBeInstanceOf(Array);
    expect(PLOT_TO_ISL_CONTRACT.transforms).toBeInstanceOf(Array);
    expect(PLOT_TO_ISL_CONTRACT.enriched).toBeInstanceOf(Array);
    expect(PLOT_TO_ISL_CONTRACT.filtered).toBeInstanceOf(Array);
  });

  // ----- Harness sanity -----

  it('harness validates no undeclared renames in output (F-20: threshold removed)', () => {
    // F-20: value→threshold rename was removed. Verify "threshold" is NOT in output.
    const c = islRequest.goal_constraints![0];
    expect('threshold' in c).toBe(false);
    expect('value' in c).toBe(true);

    // Contract renames array is now empty (no renames at this boundary)
    expect(PLOT_TO_ISL_CONTRACT.renames).toHaveLength(0);
  });

  // ----- No undeclared field disappearance -----

  it('no contracted source field disappeared without declaration', () => {
    // Verify seed is forwarded
    expect(islRequest.seed).toBe('seed-42');

    // Verify goal_node_id is forwarded
    expect(islRequest.goal_node_id).toBe('goal');

    // Verify n_samples is forwarded
    expect(islRequest.n_samples).toBe(1000);

    // Verify constraint_id is forwarded (not dropped)
    expect(islRequest.goal_constraints![0].constraint_id).toBe('c1');
  });
});

// ---------------------------------------------------------------------------
// Golden-path contracts: ISL request boundary (T5a)
// ---------------------------------------------------------------------------

describe('ISL request contract — golden-path (T5a)', () => {
  const GRAPH_WITH_FACTORS: EngineGraphV3 = {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Revenue' },
      { id: 'fac-a', kind: 'factor', label: 'Marketing', observed_state: { value: 0.7 } },
      { id: 'fac-b', kind: 'factor', label: 'Retention', observed_state: { value: 0.4 } },
    ],
    edges: [
      { from: 'fac-a', to: 'goal', strength: { mean: 0.6, std: 0.1 } },
      { from: 'fac-b', to: 'goal', strength: { mean: 0.4, std: 0.1 } },
    ],
  };

  const OPTIONS_GP: OptionV3[] = [
    { id: 'opt1', label: 'Boost Marketing', interventions: { 'fac-a': { value: 0.9, source: 'user_specified' } } },
    { id: 'opt2', label: 'Retain Customers', interventions: { 'fac-b': { value: 0.8, source: 'user_specified' } } },
  ];

  const CONSTRAINTS_GP: GoalConstraint[] = [
    { constraint_id: 'gp-c1', node_id: 'goal', operator: '>=', value: 0.65 },
    { constraint_id: 'gp-c2', node_id: 'fac-a', operator: '>=', value: 0.5, label: 'Min spend' },
  ];

  const req = toISLRobustnessRequest(
    GRAPH_WITH_FACTORS,
    OPTIONS_GP,
    'goal',
    'req-golden',
    500,
    undefined,
    CONSTRAINTS_GP,
    'seed-gp'
  );

  // F-20: goal_constraints[].value is the field sent to ISL — never threshold
  it('F-20: goal_constraints send "value" field, not "threshold"', () => {
    expect(req.goal_constraints).toBeDefined();
    expect(req.goal_constraints!.length).toBe(2);

    for (const c of req.goal_constraints!) {
      expect(c).toHaveProperty('value');
      expect(c).not.toHaveProperty('threshold');
      expect(typeof c.value).toBe('number');
    }

    // Spot-check exact values
    expect(req.goal_constraints![0].value).toBe(0.65);
    expect(req.goal_constraints![1].value).toBe(0.5);
  });

  // Optional label is forwarded; optional weight is absent when not provided
  it('F-20: constraint optional fields forwarded correctly', () => {
    const c1 = req.goal_constraints!.find(c => c.constraint_id === 'gp-c1')!;
    const c2 = req.goal_constraints!.find(c => c.constraint_id === 'gp-c2')!;

    // c1 has no label — must not appear in request
    expect(c1).not.toHaveProperty('label');
    // c2 has label — must be forwarded
    expect(c2.label).toBe('Min spend');

    // Neither has weight — must not appear
    expect(c1).not.toHaveProperty('weight');
    expect(c2).not.toHaveProperty('weight');
  });

  // parameter_uncertainties present when factor nodes have observed_state.value
  it('parameter_uncertainties present when factor nodes have observed_state.value', () => {
    expect(req.parameter_uncertainties).toBeDefined();
    expect(req.parameter_uncertainties!.length).toBeGreaterThanOrEqual(2);

    const puA = req.parameter_uncertainties!.find(p => p.node_id === 'fac-a')!;
    const puB = req.parameter_uncertainties!.find(p => p.node_id === 'fac-b')!;

    expect(puA).toBeDefined();
    expect(puA.distribution).toBe('normal');
    expect(puA.mean).toBe(0.7);
    expect(puA.std).toBeGreaterThan(0);

    expect(puB).toBeDefined();
    expect(puB.distribution).toBe('normal');
    expect(puB.mean).toBe(0.4);
    expect(puB.std).toBeGreaterThan(0);

    // Goal node must NOT get a parameter_uncertainty entry
    const puGoal = req.parameter_uncertainties!.find(p => p.node_id === 'goal');
    expect(puGoal).toBeUndefined();
  });

  // std contract:
  //   - User-supplied observed_state.std is honoured, clamped to [1e-4, 2.0].
  //   - Synthesised defaults (binary / value-based / fallback) are floored at 0.1.
  // The fixture for this `req` uses fac-a (value=0.7, no std) and fac-b (value=0.4, no std),
  // both of which go through default synthesis, so every entry here is >= 0.1.
  it('parameter_uncertainties std respects bounds (defaults floored at 0.1; absolute bounds [1e-4, 2.0])', () => {
    expect(req.parameter_uncertainties).toBeDefined();
    for (const pu of req.parameter_uncertainties!) {
      // Default synthesis path → floor at 0.1.
      expect(pu.std).toBeGreaterThanOrEqual(0.1);
      // Absolute upper bound for all paths.
      expect(pu.std).toBeLessThanOrEqual(2.0);
    }
  });

  it('user-supplied observed_state.std below 0.1 is preserved (not silently widened)', () => {
    // Separate fixture: small user-supplied std must propagate to ISL as-is.
    const graphWithSmallStd: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 100 } },
        { id: 'fac-small', kind: 'factor', label: 'Small Std', observed_state: { value: 0.6, std: 0.001 } },
      ],
      edges: [
        { from: 'fac-small', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    };
    const reqSmall = toISLRobustnessRequest(
      graphWithSmallStd,
      [{ id: 'o1', label: 'O1', interventions: { 'fac-small': { value: 0.5, source: 'user_specified' } } }],
      'goal',
      'req-small-std',
      500
    );
    const pu = reqSmall.parameter_uncertainties!.find((p: any) => p.node_id === 'fac-small');
    expect(pu).toBeDefined();
    // The fix: user-supplied std must NOT be floored to 0.1.
    expect(pu!.std).toBe(0.001);

    // Outbound shape unchanged: exactly one entry (only the factor with an
    // observed_state.value is emitted — the goal node never appears) and each
    // entry has only the four contract fields. Asserts the change is purely
    // additive to `std`, not the entry count or field set.
    expect(reqSmall.parameter_uncertainties!.length).toBe(1);
    for (const entry of reqSmall.parameter_uncertainties!) {
      expect(Object.keys(entry).sort()).toEqual(['distribution', 'mean', 'node_id', 'std']);
    }
  });

  // analysis_types hardcoded to all three required values
  it('analysis_types includes comparison, sensitivity, robustness', () => {
    expect(req.analysis_types).toBeDefined();
    expect(req.analysis_types).toContain('comparison');
    expect(req.analysis_types).toContain('sensitivity');
    expect(req.analysis_types).toContain('robustness');
    expect(req.analysis_types).toHaveLength(3);
  });

  // No parameter_uncertainties when factor nodes have no observed_state
  it('parameter_uncertainties absent when no factor nodes have observed_state', () => {
    const sparseGraph: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Goal' },
        { id: 'fac-x', kind: 'factor', label: 'Factor X' }, // no observed_state
      ],
      edges: [{ from: 'fac-x', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
    };
    const sparseReq = toISLRobustnessRequest(
      sparseGraph,
      [{ id: 'o1', label: 'O1', interventions: { 'fac-x': { value: 0.5, source: 'user_specified' } } },
       { id: 'o2', label: 'O2', interventions: { 'fac-x': { value: 0.3, source: 'user_specified' } } }],
      'goal',
      'req-sparse',
      500
    );
    // Either undefined or empty array — no entries
    const puCount = sparseReq.parameter_uncertainties?.length ?? 0;
    expect(puCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// epsilon_std boundary forwarding
// ---------------------------------------------------------------------------

describe('epsilon_std boundary forwarding', () => {
  it('epsilon_std present on node → survives in ISL request', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'G', epsilon_std: 0.5 },
        { id: 'fac', kind: 'factor', label: 'F', observed_state: { value: 1 }, epsilon_std: 0.3 },
      ],
      edges: [
        { from: 'fac', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9 },
      ],
    };
    const options: OptionV3[] = [
      { id: 'o1', label: 'O1', interventions: { fac: { value: 0.8, source: 'user_specified' } } },
      { id: 'o2', label: 'O2', interventions: { fac: { value: 0.5, source: 'user_specified' } } },
    ];
    const req = toISLRobustnessRequest(graph, options, 'goal', 'req-eps');
    expect(req.graph.nodes.find(n => n.id === 'goal')!.epsilon_std).toBe(0.5);
    expect(req.graph.nodes.find(n => n.id === 'fac')!.epsilon_std).toBe(0.3);
  });

  it('epsilon_std absent → defaults to 0.0', () => {
    const req = toISLRobustnessRequest(GRAPH, OPTIONS, 'goal', 'req-eps-default');
    for (const node of req.graph.nodes) {
      expect(node.epsilon_std).toBe(0.0);
    }
  });

  it('epsilon_std = 0.0 explicit → backward compatible', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'G', epsilon_std: 0.0 },
        { id: 'fac', kind: 'factor', label: 'F', observed_state: { value: 1 }, epsilon_std: 0.0 },
      ],
      edges: [
        { from: 'fac', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9 },
      ],
    };
    const options: OptionV3[] = [
      { id: 'o1', label: 'O1', interventions: { fac: { value: 0.8, source: 'user_specified' } } },
      { id: 'o2', label: 'O2', interventions: { fac: { value: 0.5, source: 'user_specified' } } },
    ];
    const req = toISLRobustnessRequest(graph, options, 'goal', 'req-eps-zero');
    expect(req.graph.nodes[0].epsilon_std).toBe(0.0);
  });

  it('intercept still survives alongside epsilon_std (regression)', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'G', intercept: 1.5, epsilon_std: 0.2 },
        { id: 'fac', kind: 'factor', label: 'F', observed_state: { value: 1 }, intercept: 0.7 },
      ],
      edges: [
        { from: 'fac', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9 },
      ],
    };
    const options: OptionV3[] = [
      { id: 'o1', label: 'O1', interventions: { fac: { value: 0.8, source: 'user_specified' } } },
      { id: 'o2', label: 'O2', interventions: { fac: { value: 0.5, source: 'user_specified' } } },
    ];
    const req = toISLRobustnessRequest(graph, options, 'goal', 'req-eps-intercept');
    expect(req.graph.nodes.find(n => n.id === 'goal')!.intercept).toBe(1.5);
    expect(req.graph.nodes.find(n => n.id === 'goal')!.epsilon_std).toBe(0.2);
    expect(req.graph.nodes.find(n => n.id === 'fac')!.intercept).toBe(0.7);
    expect(req.graph.nodes.find(n => n.id === 'fac')!.epsilon_std).toBe(0.0);
  });

  it('noise_multiplier must NOT appear on translated ISL node (negative boundary)', () => {
    const islNode = toISLNode({
      id: 'fac', kind: 'factor', label: 'F',
      observed_state: { value: 1 }, intercept: 0.5, epsilon_std: 0.1,
    });
    expect(islNode).not.toHaveProperty('noise_multiplier');
  });
});
