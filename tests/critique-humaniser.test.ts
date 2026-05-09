/**
 * Tests for critique-humaniser.ts
 *
 * Coverage:
 * 1. Every code in the template map with a mock graph containing labelled nodes
 * 2. Debug bundle fixtures (verbatim from olumi-debug-9941186e)
 * 3. Fallback for unknown codes
 * 4. Missing affected_node_ids
 * 5. Node ID with no label in graph (must use humanised ID, not raw ID)
 * 6. Banned-pattern regression guard
 * 7. Template coverage (all known codes have templates)
 */

import { describe, it, expect } from 'vitest';
import {
  humaniseCritique,
  addUserMessages,
  humaniseId,
  resolveNodeLabel,
  TEMPLATE_MAP,
  BANNED_PATTERN,
  getKnownCodes,
} from '../src/critique-humaniser.js';
import type { CritiqueV3, EngineGraphV3 } from '../src/types/engine-v3.js';
import { BLOCKER_CODES, CONSTRAINT_WARNING_CODES, INLINE_CRITIQUE_CODES } from '../src/types/engine-v3.js';
import type { GraphForLabels } from '../src/critique-humaniser.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Mock graph with labelled nodes for testing. */
const mockGraph: GraphForLabels = {
  nodes: [
    { id: 'fac_customer_churn', label: 'Customer Churn', kind: 'factor' },
    { id: 'fac_revenue', label: 'Revenue Growth', kind: 'factor' },
    { id: 'fac_cost', label: 'Operating Cost', kind: 'factor' },
    { id: 'goal_mid_market', label: 'Mid-Market Growth', kind: 'goal' },
    { id: 'opt_acquire_competitor', label: 'Acquire Competitor', kind: 'option' },
    { id: 'opt_build_product', label: 'Build Product', kind: 'option' },
  ],
};

const mockOptions: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'opt_acquire_competitor', label: 'Acquire Competitor' },
  { id: 'opt_build_product', label: 'Build Product' },
];

/** Factory for test critiques. */
function makeCritique(overrides: Partial<CritiqueV3> & { code: string }): CritiqueV3 {
  return {
    id: 'test-id',
    severity: 'warning',
    message: 'internal message',
    source: 'validation',
    blocks_analysis: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. humaniseId
// ---------------------------------------------------------------------------

describe('humaniseId', () => {
  it('strips fac_ prefix and title-cases', () => {
    expect(humaniseId('fac_customer_churn')).toBe('Customer Churn');
  });

  it('strips opt_ prefix', () => {
    expect(humaniseId('opt_acquire_competitor')).toBe('Acquire Competitor');
  });

  it('strips goal_ prefix', () => {
    expect(humaniseId('goal_mid_market')).toBe('Mid Market');
  });

  it('strips constraint_fac_ prefix', () => {
    expect(humaniseId('constraint_fac_customer_churn_max')).toBe('Customer Churn Max');
  });

  it('strips constraint_ prefix', () => {
    expect(humaniseId('constraint_revenue_min')).toBe('Revenue Min');
  });

  it('handles IDs with no prefix', () => {
    expect(humaniseId('some_node')).toBe('Some Node');
  });
});

// ---------------------------------------------------------------------------
// 2. resolveNodeLabel
// ---------------------------------------------------------------------------

describe('resolveNodeLabel', () => {
  it('returns label from graph when node found', () => {
    expect(resolveNodeLabel('fac_customer_churn', mockGraph)).toBe('Customer Churn');
  });

  it('falls back to humanised ID when node has no label', () => {
    const graph: GraphForLabels = { nodes: [{ id: 'fac_xyz', kind: 'factor' }] };
    expect(resolveNodeLabel('fac_xyz', graph)).toBe('Xyz');
  });

  it('falls back to humanised ID when node not in graph', () => {
    expect(resolveNodeLabel('fac_unknown_thing', mockGraph)).toBe('Unknown Thing');
  });

  it('returns "unknown" for undefined nodeId', () => {
    expect(resolveNodeLabel(undefined, mockGraph)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// 3. Template tests — every code in the template map
// ---------------------------------------------------------------------------

describe('humaniseCritique — template map', () => {
  // --- Blockers ---

  it('MISSING_GOAL_NODE', () => {
    const msg = humaniseCritique(makeCritique({ code: 'MISSING_GOAL_NODE' }), mockGraph);
    expect(msg).toBe('No goal defined. Add a goal to your model before running analysis.');
  });

  it('GOAL_NODE_NOT_IN_GRAPH', () => {
    const msg = humaniseCritique(makeCritique({ code: 'GOAL_NODE_NOT_IN_GRAPH' }), mockGraph);
    expect(msg).toBe("The selected goal doesn't exist in the model. Choose an existing node as your goal.");
  });

  it('GOAL_NODE_NOT_CAUSAL resolves node kind from graph', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'GOAL_NODE_NOT_CAUSAL', affected_node_ids: ['opt_acquire_competitor'] }),
      mockGraph,
    );
    expect(msg).toContain('option node');
    expect(msg).toContain("can't be used as an analysis target");
  });

  it('NO_OPTIONS', () => {
    const msg = humaniseCritique(makeCritique({ code: 'NO_OPTIONS' }), mockGraph);
    expect(msg).toBe('At least 2 options are needed to compare. Add more options to your model.');
  });

  it('TOO_MANY_OPTIONS', () => {
    const msg = humaniseCritique(makeCritique({ code: 'TOO_MANY_OPTIONS' }), mockGraph);
    expect(msg).toContain('Too many options');
  });

  it('EMPTY_INTERVENTIONS resolves option label', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'EMPTY_INTERVENTIONS', affected_option_ids: ['opt_build_product'] }),
      mockGraph,
      mockOptions,
    );
    expect(msg).toContain('Build Product');
    expect(msg).toContain('no effects defined');
  });

  it('INVALID_INTERVENTION_TARGET resolves option label', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'INVALID_INTERVENTION_TARGET', affected_option_ids: ['opt_acquire_competitor'] }),
      mockGraph,
      mockOptions,
    );
    expect(msg).toContain('Acquire Competitor');
    expect(msg).toContain("doesn't exist in the model");
  });

  it('INVALID_INTERVENTION_VALUE resolves option label', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'INVALID_INTERVENTION_VALUE', affected_option_ids: ['opt_build_product'] }),
      mockGraph,
      mockOptions,
    );
    expect(msg).toContain('Build Product');
    expect(msg).toContain('invalid effect value');
  });

  it('NO_PATH_TO_GOAL resolves goal label from affected_node_ids', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'NO_PATH_TO_GOAL', affected_node_ids: ['goal_mid_market'] }),
      mockGraph,
    );
    expect(msg).toContain('Mid-Market Growth');
    expect(msg).toContain('No path connects');
  });

  it('NO_PATH_TO_GOAL falls back to "the goal" when affected_node_ids missing', () => {
    const msg = humaniseCritique(makeCritique({ code: 'NO_PATH_TO_GOAL' }), mockGraph);
    expect(msg).toContain('the goal');
    expect(msg).toContain('No path connects');
  });

  it('GRAPH_TOO_LARGE', () => {
    const msg = humaniseCritique(makeCritique({ code: 'GRAPH_TOO_LARGE' }), mockGraph);
    expect(msg).toContain('size limit');
  });

  it('GRAPH_CYCLE_DETECTED', () => {
    const msg = humaniseCritique(makeCritique({ code: 'GRAPH_CYCLE_DETECTED' }), mockGraph);
    expect(msg).toBe('Your model contains a circular dependency. Models must flow in one direction.');
  });

  it('IDENTICAL_OPTIONS', () => {
    const msg = humaniseCritique(makeCritique({ code: 'IDENTICAL_OPTIONS' }), mockGraph);
    expect(msg).toContain('identical effects');
  });

  it('IDENTICAL_OPTIONS_DEDUPED', () => {
    const msg = humaniseCritique(makeCritique({ code: 'IDENTICAL_OPTIONS_DEDUPED' }), mockGraph);
    expect(msg).toContain('merged');
  });

  it('INVALID_NODE_ID_PATTERN', () => {
    const msg = humaniseCritique(makeCritique({ code: 'INVALID_NODE_ID_PATTERN' }), mockGraph);
    expect(msg).toContain('invalid identifier');
  });

  it('INVALID_EDGE_ENDPOINT', () => {
    const msg = humaniseCritique(makeCritique({ code: 'INVALID_EDGE_ENDPOINT' }), mockGraph);
    expect(msg).toContain("doesn't exist in the model");
  });

  it('DUPLICATE_NODE_IDS', () => {
    const msg = humaniseCritique(makeCritique({ code: 'DUPLICATE_NODE_IDS' }), mockGraph);
    expect(msg).toContain('unique ID');
  });

  it('IDENTIFIABILITY_ISSUE', () => {
    const msg = humaniseCritique(makeCritique({ code: 'IDENTIFIABILITY_ISSUE' }), mockGraph);
    expect(msg).toContain('cannot be identified');
  });

  it('ISL_CANNOT_IDENTIFY', () => {
    const msg = humaniseCritique(makeCritique({ code: 'ISL_CANNOT_IDENTIFY' }), mockGraph);
    expect(msg).toContain('cannot isolate the causal effect');
  });

  it('NORMALIZATION_ERROR', () => {
    const msg = humaniseCritique(makeCritique({ code: 'NORMALIZATION_ERROR' }), mockGraph);
    expect(msg).toContain('could not be normalised');
  });

  it('ISL_REQUEST_INVALID', () => {
    const msg = humaniseCritique(makeCritique({ code: 'ISL_REQUEST_INVALID' }), mockGraph);
    expect(msg).toContain('rejected by the inference engine');
  });

  // --- Constraint Blockers ---

  it('CONSTRAINT_TARGET_NOT_FOUND', () => {
    const msg = humaniseCritique(makeCritique({ code: 'CONSTRAINT_TARGET_NOT_FOUND' }), mockGraph);
    expect(msg).toContain("doesn't exist in the model");
  });

  it('CONSTRAINT_TARGET_NOT_IN_INFERENCE', () => {
    const msg = humaniseCritique(makeCritique({ code: 'CONSTRAINT_TARGET_NOT_IN_INFERENCE' }), mockGraph);
    expect(msg).toContain("can't be constrained");
  });

  it('CONSTRAINT_INVALID_OPERATOR', () => {
    const msg = humaniseCritique(makeCritique({ code: 'CONSTRAINT_INVALID_OPERATOR' }), mockGraph);
    expect(msg).toContain('unrecognised comparison');
  });

  it('CONSTRAINT_DUPLICATE_ID', () => {
    const msg = humaniseCritique(makeCritique({ code: 'CONSTRAINT_DUPLICATE_ID' }), mockGraph);
    expect(msg).toContain('Duplicate constraint');
  });

  // --- Errors ---

  it('ISL_CALL_FAILED', () => {
    const msg = humaniseCritique(makeCritique({ code: 'ISL_CALL_FAILED' }), mockGraph);
    expect(msg).toContain('encountered an error');
  });

  it('ISL_ERROR', () => {
    const msg = humaniseCritique(makeCritique({ code: 'ISL_ERROR' }), mockGraph);
    expect(msg).toContain('encountered an error');
  });

  it('OPTION_ID_MISMATCH resolves option label', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'OPTION_ID_MISMATCH', affected_option_ids: ['opt_acquire_competitor'] }),
      mockGraph,
      mockOptions,
    );
    expect(msg).toContain('Acquire Competitor');
    expect(msg).toContain("doesn't match");
  });

  it('INVALID_EXISTS_PROBABILITY resolves edge node labels', () => {
    const msg = humaniseCritique(
      makeCritique({
        code: 'INVALID_EXISTS_PROBABILITY',
        affected_node_ids: ['fac_customer_churn', 'fac_revenue'],
      }),
      mockGraph,
    );
    expect(msg).toContain('Customer Churn');
    expect(msg).toContain('Revenue Growth');
    expect(msg).toContain('invalid probability');
  });

  it('INVALID_STRENGTH_STD resolves edge node labels', () => {
    const msg = humaniseCritique(
      makeCritique({
        code: 'INVALID_STRENGTH_STD',
        affected_node_ids: ['fac_customer_churn', 'fac_cost'],
      }),
      mockGraph,
    );
    expect(msg).toContain('Customer Churn');
    expect(msg).toContain('Operating Cost');
    expect(msg).toContain('invalid uncertainty');
  });

  // --- Warnings ---

  it('CONSTRAINT_VALUE_OUTSIDE_RANGE resolves factor label', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'CONSTRAINT_VALUE_OUTSIDE_RANGE', affected_node_ids: ['fac_customer_churn'] }),
      mockGraph,
    );
    expect(msg).toContain('Customer Churn');
    expect(msg).toContain('outside the expected range');
  });

  it('CONSTRAINT_OUT_OF_DOMAIN resolves factor label', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'CONSTRAINT_OUT_OF_DOMAIN', affected_node_ids: ['fac_revenue'] }),
      mockGraph,
    );
    expect(msg).toContain('Revenue Growth');
    expect(msg).toContain('outside the expected range');
  });

  it('CONSTRAINT_DUPLICATE_TARGET', () => {
    const msg = humaniseCritique(makeCritique({ code: 'CONSTRAINT_DUPLICATE_TARGET' }), mockGraph);
    expect(msg).toContain('stricter constraint');
  });

  it('CONSTRAINT_TARGET_NO_OBSERVED_VALUE resolves factor label', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'CONSTRAINT_TARGET_NO_OBSERVED_VALUE', affected_node_ids: ['fac_customer_churn'] }),
      mockGraph,
    );
    expect(msg).toContain('Customer Churn');
    expect(msg).toContain('no baseline value');
  });

  it('SCALE_MISMATCH_WARNING', () => {
    const msg = humaniseCritique(makeCritique({ code: 'SCALE_MISMATCH_WARNING' }), mockGraph);
    expect(msg).toContain('wide range');
  });

  it('INVALID_BIDIRECTED_EDGE', () => {
    const msg = humaniseCritique(makeCritique({ code: 'INVALID_BIDIRECTED_EDGE' }), mockGraph);
    expect(msg).toContain('non-factor nodes');
  });

  it('IDENTIFIABILITY_WARNING', () => {
    const msg = humaniseCritique(makeCritique({ code: 'IDENTIFIABILITY_WARNING' }), mockGraph);
    expect(msg).toContain('not be identifiable');
  });

  it('UNMEASURED_CONFOUNDING_WARNING', () => {
    const msg = humaniseCritique(makeCritique({ code: 'UNMEASURED_CONFOUNDING_WARNING' }), mockGraph);
    expect(msg).toContain('Unmeasured confounding');
  });

  it('ISL_EMPTY_RESULTS', () => {
    const msg = humaniseCritique(makeCritique({ code: 'ISL_EMPTY_RESULTS' }), mockGraph);
    expect(msg).toContain('returned no results');
  });

  it('STRENGTH_OUT_OF_RANGE resolves edge labels', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'STRENGTH_OUT_OF_RANGE', affected_node_ids: ['fac_customer_churn', 'fac_revenue'] }),
      mockGraph,
    );
    expect(msg).toContain('Customer Churn');
    expect(msg).toContain('Revenue Growth');
    expect(msg).toContain('unusually strong effect');
  });

  it('NO_COEFFICIENT_VARIATION', () => {
    const msg = humaniseCritique(makeCritique({ code: 'NO_COEFFICIENT_VARIATION' }), mockGraph);
    expect(msg).toContain('same strength');
  });

  it('MISSING_FACTOR_VALUE resolves factor label', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'MISSING_FACTOR_VALUE', affected_node_ids: ['fac_cost'] }),
      mockGraph,
    );
    expect(msg).toContain('Operating Cost');
    expect(msg).toContain('no baseline value');
  });

  // --- Info ---

  it('CONSTRAINT_MISSING_RANGE resolves factor label', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'CONSTRAINT_MISSING_RANGE', affected_node_ids: ['fac_customer_churn'] }),
      mockGraph,
    );
    expect(msg).toContain('Customer Churn');
    expect(msg).toContain('cannot be range-checked');
  });

  it('CONSTRAINT_FILTERED_TEMPORAL derives count from affected_node_ids', () => {
    const msg = humaniseCritique(
      makeCritique({
        code: 'CONSTRAINT_FILTERED_TEMPORAL',
        message: '2 temporal constraint(s) filtered before analysis: [c1, c2].',
        affected_node_ids: ['fac_customer_churn', 'fac_revenue'],
      }),
      mockGraph,
    );
    expect(msg).toContain('2 time-based constraint(s)');
    expect(msg).toContain('excluded from analysis');
  });

  it('NORMALIZATION_WARNING resolves from affected_node_ids', () => {
    const msg = humaniseCritique(
      makeCritique({
        code: 'NORMALIZATION_WARNING',
        affected_node_ids: ['opt_acquire_competitor'],
        message: 'Node opt_acquire_competitor is an option and was excluded.',
      }),
      mockGraph,
    );
    expect(msg).toContain('Acquire Competitor');
    expect(msg).toContain('option');
  });

  it('NORMALIZATION_WARNING falls back to message regex extraction', () => {
    const msg = humaniseCritique(
      makeCritique({
        code: 'NORMALIZATION_WARNING',
        affected_node_ids: [],
        message: 'Node opt_acquire_competitor was excluded from analysis.',
      }),
      mockGraph,
    );
    expect(msg).toContain('Acquire Competitor');
  });

  it('ISL_NOT_ENABLED', () => {
    const msg = humaniseCritique(makeCritique({ code: 'ISL_NOT_ENABLED' }), mockGraph);
    expect(msg).toContain('not currently available');
  });

  it('GOAL_THRESHOLD_SUPERSEDED', () => {
    const msg = humaniseCritique(makeCritique({ code: 'GOAL_THRESHOLD_SUPERSEDED' }), mockGraph);
    expect(msg).toContain('Constraints take precedence');
  });

  it('INCONSISTENT_EFFECT_DIRECTION resolves edge labels', () => {
    const msg = humaniseCritique(
      makeCritique({
        code: 'INCONSISTENT_EFFECT_DIRECTION',
        affected_node_ids: ['fac_revenue', 'fac_cost'],
      }),
      mockGraph,
    );
    expect(msg).toContain('Revenue Growth');
    expect(msg).toContain('Operating Cost');
    expect(msg).toContain('conflicting direction');
  });

  it('INTERVENTION_EXTENDS_RANGE resolves both option and factor', () => {
    const msg = humaniseCritique(
      makeCritique({
        code: 'INTERVENTION_EXTENDS_RANGE',
        affected_option_ids: ['opt_build_product'],
        affected_node_ids: ['fac_revenue'],
      }),
      mockGraph,
      mockOptions,
    );
    expect(msg).toContain('Build Product');
    expect(msg).toContain('Revenue Growth');
    expect(msg).toContain('beyond its observed range');
  });

  // --- Forward-compatibility codes ---

  it('GRAPH_HAS_CYCLE', () => {
    const msg = humaniseCritique(makeCritique({ code: 'GRAPH_HAS_CYCLE' }), mockGraph);
    expect(msg).toBe('Your model contains a circular dependency. Models must flow in one direction.');
  });

  it('MISSING_OUTCOME_OR_RISK', () => {
    const msg = humaniseCritique(makeCritique({ code: 'MISSING_OUTCOME_OR_RISK' }), mockGraph);
    expect(msg).toContain('No outcome or risk');
  });

  it('POC_NODE_LIMIT', () => {
    const msg = humaniseCritique(makeCritique({ code: 'POC_NODE_LIMIT' }), mockGraph);
    expect(msg).toContain('50-factor limit');
  });

  it('POC_EDGE_LIMIT', () => {
    const msg = humaniseCritique(makeCritique({ code: 'POC_EDGE_LIMIT' }), mockGraph);
    expect(msg).toContain('100-connection limit');
  });

  it('POC_CONSTRAINT_LIMIT', () => {
    const msg = humaniseCritique(makeCritique({ code: 'POC_CONSTRAINT_LIMIT' }), mockGraph);
    expect(msg).toContain('20-constraint limit');
  });

  it('NOMINAL_INTERVENTION_NOT_SUPPORTED uses factor-framed copy with a single consistent reframe path', () => {
    // The route-level integration test in v2-run.categorical.integration.test.ts
    // exercises this critique through the live /v2/run handler (audit C1-A;
    // brief implementation requirement #7 — wire the dead test path).
    //
    // Copy is factor-framed (does NOT front the option label) per the
    // post-merge review: prior copy "UK targets a categorical factor..."
    // read as if UK were the factor. New copy describes the encoding
    // problem and gives one reframe path.
    const msg = humaniseCritique(
      makeCritique({ code: 'NOMINAL_INTERVENTION_NOT_SUPPORTED', affected_option_ids: ['opt_build_product'] }),
      mockGraph,
      mockOptions,
    );
    // Must NOT front any option label — the copy describes the factor.
    expect(msg).not.toMatch(/^Build Product/);
    expect(msg).not.toMatch(/^[A-Z][a-z]+ targets/);
    // Identifies the encoding problem.
    expect(msg.toLowerCase()).toContain('numeric scale');
    expect(msg.toLowerCase()).toContain('unordered categor');
    // Single consistent reframe path — no "reframe as a numeric estimate"
    // contradiction with the binary-indicator instruction.
    expect(msg).not.toContain('numeric estimate');
    expect(msg).toContain('binary factor per category');
    expect(msg.toLowerCase()).toContain('exactly one to 1');
  });

  // Categorical-blocker family: post-merge review P1 #1 hardening — copy is
  // generic, label-free. Identifiers stay structural on `affected_*_ids`.
  // Rationale: in CEE-driven flows the LLM may set a factor or option label
  // to the category name verbatim ("UK" instead of "Region"), in which case
  // echoing labels via resolveNodeLabel/resolveOptionLabel would leak the
  // same content the brief forbids in `message`/`user_message`.

  it('CATEGORICAL_DECOMPOSED is generic and does NOT echo factor labels', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'CATEGORICAL_DECOMPOSED', affected_node_ids: ['fac_market_uk', 'fac_market_us'] }),
      { nodes: [
        { id: 'fac_market_uk', label: 'UK' },           // label = category name (worst case)
        { id: 'fac_market_us', label: 'US' },
      ] },
    );
    // Conveys the structural fact …
    expect(msg.toLowerCase()).toContain('one-hot');
    expect(msg.toLowerCase()).toContain('mutually exclusive');
    // … without echoing labels (which could be category names).
    expect(msg).not.toContain('UK');
    expect(msg).not.toContain('US');
    expect(msg).not.toContain('Market UK');
    expect(msg).not.toContain('Market US');
    expect(msg).not.toContain('fac_market');
  });

  it('ONE_HOT_MUTEX_VIOLATION is generic and does NOT echo option labels', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'ONE_HOT_MUTEX_VIOLATION', affected_option_ids: ['opt_violation'] }),
      mockGraph,
      [{ id: 'opt_violation', label: 'UK' }],            // worst case: option label = category name
    );
    expect(msg.toLowerCase()).toContain('mutual exclusivity');
    expect(msg.toLowerCase()).toContain('exactly one');
    expect(msg).not.toContain('UK');
    expect(msg).not.toContain('Violation');
    expect(msg).not.toContain('opt_violation');
  });

  it('ONE_HOT_GROUPING_INCONSISTENT is generic and does NOT echo factor labels', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'ONE_HOT_GROUPING_INCONSISTENT', affected_node_ids: ['fac_market'] }),
      { nodes: [{ id: 'fac_market', label: 'UK' }] },    // worst case
    );
    expect(msg.toLowerCase()).toContain('inconsistent');
    expect(msg.toLowerCase()).toContain('group');
    expect(msg).not.toContain('UK');
    expect(msg).not.toContain('Market');
    expect(msg).not.toContain('fac_market');
    expect(msg).not.toContain('categorical_group_id');
  });

  it('STRIPPED_FIELD_WARNING is generic and does NOT echo factor labels or internal field names', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'STRIPPED_FIELD_WARNING', affected_node_ids: ['fac_flag'] }),
      { nodes: [{ id: 'fac_flag', label: 'UK' }] },      // worst case
    );
    expect(msg.toLowerCase()).toContain('metadata');
    expect(msg.toLowerCase()).toContain('stripped');
    // No factor label
    expect(msg).not.toContain('UK');
    expect(msg).not.toContain('Flag');
    expect(msg).not.toContain('fac_flag');
    // No internal field names (P1 #2 — same hardening applies at the route)
    expect(msg).not.toContain('value_type');
    expect(msg).not.toContain('encoding_map');
    expect(msg).not.toContain('raw_value');
  });
});

// ---------------------------------------------------------------------------
// 4. Debug bundle fixture tests (verbatim from olumi-debug-9941186e)
// ---------------------------------------------------------------------------

describe('debug bundle fixtures', () => {
  it('CONSTRAINT_TARGET_NO_OBSERVED_VALUE from debug bundle', () => {
    const critique = makeCritique({
      code: 'CONSTRAINT_TARGET_NO_OBSERVED_VALUE',
      severity: 'warning',
      message: 'Constraint "constraint_fac_customer_churn_max" targets factor node "fac_customer_churn" which has no observed_state.value. ISL will default to intercept=0, which may produce misleading probability results.',
      affected_node_ids: ['fac_customer_churn'],
    });

    const msg = humaniseCritique(critique, mockGraph);
    expect(msg).toBe('The constraint on Customer Churn has no baseline value. Results may be unreliable without an estimate.');
    expect(BANNED_PATTERN.test(msg)).toBe(false);
  });

  it('CONSTRAINT_MISSING_RANGE from debug bundle', () => {
    const critique = makeCritique({
      code: 'CONSTRAINT_MISSING_RANGE',
      severity: 'info',
      message: 'Constraint "constraint_fac_customer_churn_max" target node "fac_customer_churn" has no derivable range. Constraint value will be compared as-is by ISL.',
      affected_node_ids: ['fac_customer_churn'],
    });

    const msg = humaniseCritique(critique, mockGraph);
    expect(msg).toBe('The constraint on Customer Churn cannot be range-checked. The constraint value will be used as-is.');
    expect(BANNED_PATTERN.test(msg)).toBe(false);
  });

  it('CONSTRAINT_FILTERED_TEMPORAL from debug bundle', () => {
    const critique = makeCritique({
      code: 'CONSTRAINT_FILTERED_TEMPORAL',
      severity: 'info',
      message: '1 temporal constraint(s) filtered before analysis: [goal_mid_market_deadline]. Temporal constraints cannot be evaluated on a static causal graph.',
      affected_node_ids: ['goal_mid_market'],
    });

    const msg = humaniseCritique(critique, mockGraph);
    expect(msg).toBe('1 time-based constraint(s) were excluded from analysis. Static models cannot evaluate deadlines.');
    expect(BANNED_PATTERN.test(msg)).toBe(false);
  });

  it('NORMALIZATION_WARNING from debug bundle (regex fallback)', () => {
    const critique = makeCritique({
      code: 'NORMALIZATION_WARNING',
      severity: 'info',
      message: 'Node opt_acquire_competitor (kind=option) excluded from factor analysis.',
      affected_node_ids: [],
    });

    const msg = humaniseCritique(critique, mockGraph);
    expect(msg).toContain('Acquire Competitor');
    expect(BANNED_PATTERN.test(msg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Fallback for unknown codes
// ---------------------------------------------------------------------------

describe('fallback for unknown codes', () => {
  it('uses fallback template for FUTURE_CODE_XYZ', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'FUTURE_CODE_XYZ' }),
      mockGraph,
    );
    expect(msg).toBe('An issue was detected in your model (FUTURE_CODE_XYZ). Check the advanced details for more information.');
  });

  it('uses fallback template for empty code', () => {
    const msg = humaniseCritique(
      makeCritique({ code: '' }),
      mockGraph,
    );
    expect(msg).toContain('An issue was detected');
  });
});

// ---------------------------------------------------------------------------
// 6. Missing affected_node_ids
// ---------------------------------------------------------------------------

describe('missing affected_node_ids', () => {
  it('handles undefined affected_node_ids gracefully', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'CONSTRAINT_TARGET_NO_OBSERVED_VALUE', affected_node_ids: undefined }),
      mockGraph,
    );
    expect(msg).toContain('unknown');
    expect(msg).toContain('no baseline value');
    expect(BANNED_PATTERN.test(msg)).toBe(false);
  });

  it('handles empty affected_node_ids array', () => {
    const msg = humaniseCritique(
      makeCritique({ code: 'CONSTRAINT_MISSING_RANGE', affected_node_ids: [] }),
      mockGraph,
    );
    expect(msg).toContain('unknown');
    expect(BANNED_PATTERN.test(msg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Node ID with no label in graph (must use humanised ID, not raw ID)
// ---------------------------------------------------------------------------

describe('node ID with no label in graph', () => {
  it('humanises fac_ prefixed ID when node not in graph', () => {
    const msg = humaniseCritique(
      makeCritique({
        code: 'CONSTRAINT_TARGET_NO_OBSERVED_VALUE',
        affected_node_ids: ['fac_employee_satisfaction'],
      }),
      mockGraph,
    );
    expect(msg).toContain('Employee Satisfaction');
    expect(msg).not.toContain('fac_employee_satisfaction');
    expect(BANNED_PATTERN.test(msg)).toBe(false);
  });

  it('humanises opt_ prefixed ID when option not in graph or options array', () => {
    const msg = humaniseCritique(
      makeCritique({
        code: 'EMPTY_INTERVENTIONS',
        affected_option_ids: ['opt_hire_engineers'],
      }),
      mockGraph,
    );
    expect(msg).toContain('Hire Engineers');
    expect(msg).not.toContain('opt_hire_engineers');
    expect(BANNED_PATTERN.test(msg)).toBe(false);
  });

  it('humanises goal_ prefixed ID for NO_PATH_TO_GOAL with unlabelled goal', () => {
    const graphNoLabel: GraphForLabels = {
      nodes: [{ id: 'goal_profit', kind: 'goal' }],
    };
    const msg = humaniseCritique(
      makeCritique({ code: 'NO_PATH_TO_GOAL', affected_node_ids: ['goal_profit'] }),
      graphNoLabel,
    );
    expect(msg).toContain('Profit');
    expect(msg).not.toContain('goal_profit');
    expect(BANNED_PATTERN.test(msg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Banned-pattern regression guard
// ---------------------------------------------------------------------------

describe('banned-pattern regression guard', () => {
  const ALL_CODES = Object.keys(TEMPLATE_MAP);

  it.each(ALL_CODES)('user_message for code %s must not contain banned patterns', (code) => {
    const critique = makeCritique({
      code,
      affected_node_ids: ['fac_customer_churn', 'fac_revenue'],
      affected_option_ids: ['opt_acquire_competitor'],
      message: `Constraint "constraint_fac_customer_churn_max" targets factor node "fac_customer_churn" which has no observed_state.value. ISL will default to intercept=0.`,
    });

    const msg = humaniseCritique(critique, mockGraph, mockOptions);
    expect(BANNED_PATTERN.test(msg)).toBe(false);
  });

  it('banned pattern matches known internal patterns', () => {
    expect(BANNED_PATTERN.test('fac_customer_churn')).toBe(true);
    expect(BANNED_PATTERN.test('opt_acquire_competitor')).toBe(true);
    expect(BANNED_PATTERN.test('goal_mid_market')).toBe(true);
    expect(BANNED_PATTERN.test('constraint_fac_something')).toBe(true);
    expect(BANNED_PATTERN.test('observed_state.value')).toBe(true);
    expect(BANNED_PATTERN.test('intercept=0')).toBe(true);
  });

  it('banned pattern does not match humanised labels', () => {
    expect(BANNED_PATTERN.test('Customer Churn')).toBe(false);
    expect(BANNED_PATTERN.test('Acquire Competitor')).toBe(false);
    expect(BANNED_PATTERN.test('Mid-Market Growth')).toBe(false);
  });

  it('debug bundle critiques must not leak banned patterns', () => {
    // Exact critiques from olumi-debug-9941186e
    const debugCritiques: CritiqueV3[] = [
      {
        id: 'dbg-1',
        code: 'CONSTRAINT_TARGET_NO_OBSERVED_VALUE',
        severity: 'warning',
        message: 'Constraint "constraint_fac_customer_churn_max" targets factor node "fac_customer_churn" which has no observed_state.value. ISL will default to intercept=0, which may produce misleading probability results.',
        source: 'validation',
        affected_node_ids: ['fac_customer_churn'],
        blocks_analysis: false,
      },
      {
        id: 'dbg-2',
        code: 'CONSTRAINT_MISSING_RANGE',
        severity: 'info',
        message: 'Constraint "constraint_fac_customer_churn_max" target node "fac_customer_churn" has no derivable range.',
        source: 'validation',
        affected_node_ids: ['fac_customer_churn'],
        blocks_analysis: false,
      },
      {
        id: 'dbg-3',
        code: 'CONSTRAINT_FILTERED_TEMPORAL',
        severity: 'info',
        message: '1 temporal constraint(s) filtered before analysis: [goal_mid_market_deadline].',
        source: 'validation',
        affected_node_ids: ['goal_mid_market'],
        blocks_analysis: false,
      },
      {
        id: 'dbg-4',
        code: 'NORMALIZATION_WARNING',
        severity: 'info',
        message: 'Node opt_acquire_competitor (kind=option) excluded from factor analysis.',
        source: 'validation',
        blocks_analysis: false,
      },
    ];

    const results = addUserMessages(debugCritiques, mockGraph, mockOptions);
    for (const c of results) {
      expect(c.user_message).toBeDefined();
      expect(c.user_message!.length).toBeGreaterThan(0);
      expect(BANNED_PATTERN.test(c.user_message!)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Template coverage test
// ---------------------------------------------------------------------------

describe('template coverage', () => {
  /**
   * All critique codes emitted anywhere in the codebase.
   * Sourced from engine-v3.ts typed arrays — NOT hardcoded.
   * Adding a new code to any source array will cause this test to fail
   * if the template map doesn't have a corresponding entry.
   */
  const CODEBASE_CODES: readonly string[] = [
    ...BLOCKER_CODES,
    ...CONSTRAINT_WARNING_CODES,
    ...INLINE_CRITIQUE_CODES,
  ];

  it('every codebase code has a template entry', () => {
    const knownCodes = new Set(getKnownCodes());
    const missing = CODEBASE_CODES.filter((code) => !knownCodes.has(code));
    expect(missing).toEqual([]);
  });

  it('all known codes produce non-empty user_message', () => {
    const allCodes = getKnownCodes();
    for (const code of allCodes) {
      const msg = humaniseCritique(
        makeCritique({ code, affected_node_ids: ['fac_customer_churn'] }),
        mockGraph,
      );
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. addUserMessages batch function
// ---------------------------------------------------------------------------

describe('addUserMessages', () => {
  it('adds user_message to each critique', () => {
    const critiques: CritiqueV3[] = [
      makeCritique({ code: 'MISSING_GOAL_NODE' }),
      makeCritique({ code: 'NO_OPTIONS' }),
    ];

    const result = addUserMessages(critiques, mockGraph);
    expect(result).toHaveLength(2);
    expect(result[0].user_message).toBe('No goal defined. Add a goal to your model before running analysis.');
    expect(result[1].user_message).toBe('At least 2 options are needed to compare. Add more options to your model.');
  });

  it('preserves original critique fields', () => {
    const original = makeCritique({
      code: 'MISSING_GOAL_NODE',
      message: 'internal debug message',
      severity: 'blocker',
    });

    const [result] = addUserMessages([original], mockGraph);
    expect(result.message).toBe('internal debug message');
    expect(result.severity).toBe('blocker');
    expect(result.code).toBe('MISSING_GOAL_NODE');
    expect(result.user_message).toBeDefined();
  });

  it('does not mutate input array', () => {
    const critiques: CritiqueV3[] = [makeCritique({ code: 'NO_OPTIONS' })];
    const result = addUserMessages(critiques, mockGraph);
    expect(result).not.toBe(critiques);
    expect((critiques[0] as any).user_message).toBeUndefined();
  });

  it('works with empty graph', () => {
    const result = addUserMessages(
      [makeCritique({ code: 'MISSING_GOAL_NODE' })],
    );
    expect(result[0].user_message).toBe('No goal defined. Add a goal to your model before running analysis.');
  });

  it('works with empty array', () => {
    expect(addUserMessages([], mockGraph)).toEqual([]);
  });
});
