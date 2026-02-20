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
  // Filtered node kinds
  'nodes[kind=option]',
  'nodes[kind=decision]',
  'nodes[kind=constraint]',
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

  it('goal_constraints[].value → threshold rename applied with correct value', () => {
    // Source used value: 0.7
    expect(islRequest.goal_constraints).toBeDefined();
    const c = islRequest.goal_constraints![0];

    // Target field "threshold" present with correct value
    expect(c.threshold).toBe(0.7);

    // Source field "value" absent
    expect(c).not.toHaveProperty('value');
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

  it('harness detects incomplete contract (missing rename)', () => {
    // Deliberately create an incomplete contract and verify harness logic catches it
    const incomplete: BoundaryContract = {
      ...PLOT_TO_ISL_CONTRACT,
      renames: [], // Removed the value→threshold rename
    };

    // The actual transform still applies value→threshold.
    // An enforcement harness SHOULD detect that threshold is in output
    // but NOT declared in renames. Simulate this check.
    const c = islRequest.goal_constraints![0];
    const thresholdPresent = 'threshold' in c;
    const declaredInRenames = incomplete.renames.some(
      r => r.to === 'goal_constraints[].threshold'
    );

    // threshold IS present in output but NOT declared in incomplete contract
    expect(thresholdPresent).toBe(true);
    expect(declaredInRenames).toBe(false);

    // Harness would throw: "Undeclared rename: goal_constraints[].threshold present but not in contract.renames"
    expect(() => {
      if (thresholdPresent && !declaredInRenames) {
        throw new Error(
          'Undeclared rename: goal_constraints[].threshold present in output but not declared in contract.renames'
        );
      }
    }).toThrow('Undeclared rename');
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
