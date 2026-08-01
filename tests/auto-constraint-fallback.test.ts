/**
 * Auto-Constraint Fallback Tests (P0-3)
 *
 * When goal_constraints[] is empty/absent but goal_threshold exists,
 * PLoT synthesises a single constraint so ISL produces constraint_analysis.
 *
 * Tests:
 * - T1: Fallback triggers — zero constraints + goal_threshold → auto-constraint synthesised
 * - T2: Fallback skipped — explicit constraints present → no synthesis
 * - T3: No threshold — zero constraints + no goal_threshold → no synthesis
 * - T4: ISL translation — synthesised constraint passes through value→threshold mapping
 * - T5: Edge cases — null, NaN, undefined goal_threshold → no synthesis, no crash
 * - T6: HTTP integration — end-to-end via /v2/run with spawnServer
 * - T7: Log assertions — structured log events fire with expected payloads
 * - T8: Node-level goal_threshold fallback — goal_threshold on raw upstream goal node
 */

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  GoalConstraint,
  EngineGraphV3,
  EngineNodeV3,
  OptionV3,
} from '../src/types/engine-v3.js';
import { toISLRobustnessRequest } from '../src/integrations/isl/translator-v3.js';
import { compileConstraintNodes } from '../src/normalisation/constraint-compiler.js';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------

function createTestGraph(goalNodeOverrides?: Record<string, any>): EngineGraphV3 {
  return {
    nodes: [
      {
        id: 'goal_node',
        kind: 'goal',
        label: 'Business Goal',
        ...goalNodeOverrides,
      } as EngineNodeV3,
      {
        id: 'factor_a',
        kind: 'factor',
        label: 'Factor A',
        observed_state: { value: 0.5 },
      },
      {
        id: 'factor_b',
        kind: 'factor',
        label: 'Factor B',
        observed_state: { value: 0.3 },
      },
    ],
    edges: [
      { from: 'factor_a', to: 'goal_node', exists_probability: 1, strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor_b', to: 'goal_node', exists_probability: 1, strength: { mean: 0.3, std: 0.1 } },
    ],
  };
}

const TEST_OPTIONS: OptionV3[] = [
  { id: 'opt1', label: 'Option 1', interventions: { factor_a: { value: 0.8, source: 'user_specified' } } },
  { id: 'opt2', label: 'Option 2', interventions: { factor_b: { value: 0.6, source: 'user_specified' } } },
];

// =============================================================================
// T1: Fallback Triggers
// =============================================================================

describe('T1: Auto-constraint fallback triggers', () => {
  it('synthesises one constraint when goal_constraints is empty and goal_threshold exists', () => {
    const graph = createTestGraph();
    const goalThreshold = 0.2;
    const goalNodeId = 'goal_node';

    // Phase 1c: Compile constraint nodes — no constraint nodes in graph, no explicit constraints
    const compilation = compileConstraintNodes(graph, undefined);
    expect(compilation.constraints).toHaveLength(0);

    // Phase 1c+: Auto-constraint fallback (simulating the run.ts logic)
    if (compilation.constraints.length === 0 && goalThreshold !== undefined && Number.isFinite(goalThreshold)) {
      compilation.constraints.push({
        constraint_id: 'auto_goal_threshold',
        node_id: goalNodeId,
        operator: '>=',
        value: goalThreshold,
        label: 'Goal target',
      });
    }

    expect(compilation.constraints).toHaveLength(1);
    expect(compilation.constraints[0]).toEqual({
      constraint_id: 'auto_goal_threshold',
      node_id: 'goal_node',
      operator: '>=',
      value: 0.2,
      label: 'Goal target',
    });
  });

  it('auto-constraint reaches ISL with correct field mapping', () => {
    const graph = createTestGraph();
    const autoConstraint: GoalConstraint = {
      constraint_id: 'auto_goal_threshold',
      node_id: 'goal_node',
      operator: '>=',
      value: 0.2,
      label: 'Goal target',
    };

    const islRequest = toISLRobustnessRequest(
      graph,
      TEST_OPTIONS,
      'goal_node',
      'test-request-id',
      1000,
      undefined, // effectiveGoalThreshold cleared when using multi-constraint path
      [autoConstraint]
    );

    expect(islRequest.goal_constraints).toBeDefined();
    expect(islRequest.goal_constraints).toHaveLength(1);
    expect(islRequest.goal_constraints![0]).toEqual({
      constraint_id: 'auto_goal_threshold',
      node_id: 'goal_node',
      operator: '>=',
      value: 0.2, // F-20: canonical "value" field
      label: 'Goal target',
    });
    // goal_threshold should NOT be set (cleared by precedence routing)
    expect(islRequest.goal_threshold).toBeUndefined();
  });
});

// =============================================================================
// T2: Fallback Skipped (Constraints Present)
// =============================================================================

describe('T2: Fallback skipped when constraints present', () => {
  it('does not synthesise when explicit goal_constraints exist', () => {
    const graph = createTestGraph();
    const goalThreshold = 0.2;

    const explicitConstraints: GoalConstraint[] = [
      { constraint_id: 'c1', node_id: 'factor_a', operator: '>=', value: 0.6 },
      { constraint_id: 'c2', node_id: 'factor_b', operator: '<=', value: 0.4 },
    ];

    // Phase 1c: Compile with explicit constraints
    const compilation = compileConstraintNodes(graph, explicitConstraints);
    expect(compilation.constraints.length).toBeGreaterThan(0);

    // Phase 1c+: Auto-constraint fallback should NOT fire
    const shouldSynthesise = compilation.constraints.length === 0;
    expect(shouldSynthesise).toBe(false);

    // Constraints forwarded verbatim
    expect(compilation.constraints).toHaveLength(2);
    expect(compilation.constraints[0].constraint_id).toBe('c1');
    expect(compilation.constraints[1].constraint_id).toBe('c2');
  });

  it('does not synthesise when graph constraint nodes exist', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal_node', kind: 'goal', label: 'Goal' },
        { id: 'factor_a', kind: 'factor', label: 'Factor A', observed_state: { value: 100 } },
        {
          id: 'constraint_node',
          kind: 'constraint' as any,
          label: 'MRR Constraint',
          observed_state: { value: 200, metadata: { operator: '>=' } },
        },
      ],
      edges: [
        { from: 'factor_a', to: 'goal_node', exists_probability: 1, strength: { mean: 0.5, std: 0.1 } },
        { from: 'factor_a', to: 'constraint_node', exists_probability: 1, strength: { mean: 1, std: 0.1 } },
      ],
    };

    const compilation = compileConstraintNodes(graph, undefined);
    // Compiled from graph constraint node
    expect(compilation.constraints.length).toBeGreaterThan(0);

    // Auto-constraint should NOT fire
    const shouldSynthesise = compilation.constraints.length === 0;
    expect(shouldSynthesise).toBe(false);
  });
});

// =============================================================================
// T3: No Threshold
// =============================================================================

describe('T3: No threshold — no synthesis', () => {
  it('does not synthesise when goal_threshold is undefined (qualitative goal)', () => {
    const graph = createTestGraph();
    const goalThreshold: number | undefined = undefined;

    const compilation = compileConstraintNodes(graph, undefined);
    expect(compilation.constraints).toHaveLength(0);

    // Phase 1c+: threshold is undefined → no synthesis
    const autoThreshold = goalThreshold;
    const shouldSynthesise =
      compilation.constraints.length === 0 &&
      autoThreshold !== undefined &&
      Number.isFinite(autoThreshold);

    expect(shouldSynthesise).toBe(false);
    expect(compilation.constraints).toHaveLength(0);
  });
});

// =============================================================================
// T4: ISL Translation
// =============================================================================

describe('T4: ISL translation of synthesised constraint', () => {
  it('maps value→threshold correctly for auto-generated constraint', () => {
    const graph = createTestGraph();
    const autoConstraint: GoalConstraint = {
      constraint_id: 'auto_goal_threshold',
      node_id: 'goal_node',
      operator: '>=',
      value: 0.2,
      label: 'Goal target',
    };

    const islRequest = toISLRobustnessRequest(
      graph,
      TEST_OPTIONS,
      'goal_node',
      'test-request-id',
      1000,
      undefined,
      [autoConstraint]
    );

    // F-20: ISL wire format uses canonical "value" field
    expect(islRequest.goal_constraints![0].value).toBe(0.2);
    expect(islRequest.goal_constraints![0]).not.toHaveProperty('threshold');
  });

  it('strips unknown fields (e.g., _internal) during ISL translation', () => {
    const graph = createTestGraph();
    // Simulate a constraint with _internal namespace
    const autoConstraint: GoalConstraint & { _internal?: { source: string } } = {
      constraint_id: 'auto_goal_threshold',
      node_id: 'goal_node',
      operator: '>=',
      value: 0.2,
      label: 'Goal target',
      _internal: { source: 'auto_from_goal_threshold' },
    };

    const islRequest = toISLRobustnessRequest(
      graph,
      TEST_OPTIONS,
      'goal_node',
      'test-request-id',
      1000,
      undefined,
      [autoConstraint as GoalConstraint]
    );

    // _internal must NOT appear in ISL wire format
    expect(islRequest.goal_constraints![0]).not.toHaveProperty('_internal');
    // Only known fields present
    expect(Object.keys(islRequest.goal_constraints![0]).sort()).toEqual(
      ['constraint_id', 'label', 'node_id', 'operator', 'value'].sort()
    );
  });
});

// =============================================================================
// T5: Edge Cases
// =============================================================================

describe('T5: Edge cases — invalid goal_threshold values', () => {
  const edgeCases: Array<{ name: string; value: any }> = [
    { name: 'null', value: null },
    { name: 'NaN', value: NaN },
    { name: 'undefined', value: undefined },
    { name: 'Infinity', value: Infinity },
    { name: '-Infinity', value: -Infinity },
    { name: 'string', value: 'not a number' },
  ];

  for (const { name, value } of edgeCases) {
    it(`does not synthesise when goal_threshold is ${name}`, () => {
      const graph = createTestGraph();
      const compilation = compileConstraintNodes(graph, undefined);
      expect(compilation.constraints).toHaveLength(0);

      // Simulate run.ts normalisation: null/non-number → undefined
      let goalThreshold: number | undefined;
      if (typeof value === 'number' && Number.isFinite(value)) {
        goalThreshold = value;
      } else {
        goalThreshold = undefined;
      }

      const autoThreshold = goalThreshold;
      const shouldSynthesise =
        compilation.constraints.length === 0 &&
        autoThreshold !== undefined &&
        Number.isFinite(autoThreshold);

      expect(shouldSynthesise).toBe(false);
      expect(compilation.constraints).toHaveLength(0);
    });
  }

  it('synthesises correctly with goal_threshold: 0 (valid edge case)', () => {
    const graph = createTestGraph();
    const compilation = compileConstraintNodes(graph, undefined);
    expect(compilation.constraints).toHaveLength(0);

    const goalThreshold = 0;

    if (
      compilation.constraints.length === 0 &&
      goalThreshold !== undefined &&
      Number.isFinite(goalThreshold)
    ) {
      compilation.constraints.push({
        constraint_id: 'auto_goal_threshold',
        node_id: 'goal_node',
        operator: '>=',
        value: goalThreshold,
        label: 'Goal target',
      });
    }

    expect(compilation.constraints).toHaveLength(1);
    expect(compilation.constraints[0].value).toBe(0);
  });

  it('synthesises correctly with negative goal_threshold (valid edge case)', () => {
    const graph = createTestGraph();
    const compilation = compileConstraintNodes(graph, undefined);
    const goalThreshold = -0.5;

    if (
      compilation.constraints.length === 0 &&
      goalThreshold !== undefined &&
      Number.isFinite(goalThreshold)
    ) {
      compilation.constraints.push({
        constraint_id: 'auto_goal_threshold',
        node_id: 'goal_node',
        operator: '>=',
        value: goalThreshold,
        label: 'Goal target',
      });
    }

    expect(compilation.constraints).toHaveLength(1);
    expect(compilation.constraints[0].value).toBe(-0.5);
  });
});

// =============================================================================
// T6: HTTP Integration Tests
// =============================================================================

describe('T6: Auto-constraint fallback via /v2/run', () => {
  let server: ServerHandle | null = null;

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
    ISL_BASE_URL: 'mock',
    ISL_MOCK_ENABLE: '1',
    UI_CANONICAL_META: '1',
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  const VALID_GRAPH = {
    nodes: [
      {
        id: 'mrr_factor',
        kind: 'factor',
        label: 'MRR',
        observed_state: { value: 15000 },
        state_space: { range: { min: 0, max: 50000 } },
      },
      { id: 'churn_factor', kind: 'factor', label: 'Churn Rate', observed_state: { value: 0.05 } },
      // ROADMAP 2.266: auto-synthesis is gated on `goal_threshold_frame ===
      // 'delta'` — the frame ISL evaluates constraints in. This suite tests the
      // FALLBACK mechanism, not framing, so the frame is stamped to keep it
      // engaged. `tests/goal-threshold-frame-synthesis-gate.test.ts` owns the
      // frame-absent / 'level' refusal cases.
      { id: 'goal', kind: 'goal', label: 'Business Goal', goal_threshold_frame: 'delta' },
    ],
    edges: [
      { from: 'mrr_factor', to: 'goal', exists_probability: 1, strength: { mean: 0.6, std: 0.1 } },
      { from: 'churn_factor', to: 'goal', exists_probability: 1, strength: { mean: -0.4, std: 0.1 } },
    ],
  };

  const VALID_OPTIONS = [
    {
      id: 'opt1',
      label: 'Growth Strategy',
      interventions: { mrr_factor: { value: 25000, source: 'user_specified' } },
    },
    {
      id: 'opt2',
      label: 'Retention Strategy',
      interventions: { churn_factor: { value: 0.02, source: 'user_specified' } },
    },
  ];

  it('synthesises auto-constraint when goal_threshold provided but goal_constraints absent', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: 0.7,
        // No goal_constraints — auto-constraint should fire
      }),
    });

    expect(status).toBe(200);

    // Verify auto-constraint repair record exists
    const repairs = data?._meta?.repairs_applied as Array<{ field: string; action: string; reason: string }>;
    const autoRepair = repairs?.find(
      (r) => r.field === 'goal_constraints' && r.action === 'derived'
    );
    expect(autoRepair).toBeDefined();
    expect(autoRepair?.reason).toContain('auto-generated');
    expect(autoRepair?.reason).toContain('goal_threshold');

    // Verify constraint_sources metadata in _meta
    const constraintSources = (data?._meta as any)?.constraint_sources;
    expect(constraintSources).toBeDefined();
    expect(constraintSources?.auto_goal_threshold).toBe('auto_from_goal_threshold');
  });

  it('synthesises auto-constraint when goal_constraints is empty array', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: 0.7,
        goal_constraints: [], // Empty array — auto-constraint should fire
      }),
    });

    expect(status).toBe(200);

    // Auto-constraint repair should be present
    const repairs = data?._meta?.repairs_applied as Array<{ field: string; action: string; reason: string }>;
    const autoRepair = repairs?.find(
      (r) => r.field === 'goal_constraints' && r.action === 'derived'
    );
    expect(autoRepair).toBeDefined();
  });

  it('does NOT synthesise when explicit goal_constraints provided', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: 0.7,
        goal_constraints: [
          { constraint_id: 'mrr_target', node_id: 'mrr_factor', operator: '>=', value: 20000 },
        ],
      }),
    });

    expect(status).toBe(200);

    // No auto-constraint repair should exist
    const repairs = data?._meta?.repairs_applied as Array<{ field: string; action: string; reason: string }>;
    const autoRepair = repairs?.find(
      (r) => r.field === 'goal_constraints' && r.action === 'derived' && r.reason?.includes('auto-generated')
    );
    expect(autoRepair).toBeUndefined();

    // constraint_sources is PRESENT but EMPTY: the constraint machinery ran and
    // had nothing to attest (no auto-synthesis). The original intent of this
    // assertion — no false provenance is claimed for a user-supplied constraint —
    // is preserved and strengthened: the entry is absent from a map that exists,
    // which is a positive statement, not silence. See T11/T12 below.
    const meta = (data?._meta ?? {}) as Record<string, unknown>;
    expect(Object.keys(meta)).toContain('constraint_sources');
    expect(meta.constraint_sources).toEqual({});
  });

  it('does NOT synthesise when goal_threshold is absent (qualitative brief)', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        // No goal_threshold, no goal_constraints — no synthesis
      }),
    });

    expect(status).toBe(200);

    // No auto-constraint repair
    const repairs = data?._meta?.repairs_applied as Array<{ field: string; action: string; reason: string }>;
    const autoRepair = repairs?.find(
      (r) => r.field === 'goal_constraints' && r.action === 'derived'
    );
    expect(autoRepair).toBeUndefined();
  });

  it('does NOT synthesise when goal_threshold is null', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: null, // Explicit null — treated as absent
      }),
    });

    expect(status).toBe(200);

    // No auto-constraint repair
    const repairs = data?._meta?.repairs_applied as Array<{ field: string; action: string; reason: string }>;
    const autoRepair = repairs?.find(
      (r) => r.field === 'goal_constraints' && r.action === 'derived'
    );
    expect(autoRepair).toBeUndefined();
  });

  it('reads goal_threshold from raw goal node when request-level is absent', async () => {
    // T8: Node-level goal_threshold fallback. CEE may put goal_threshold on
    // the goal node in the graph even when the request root field is absent.
    // PLoT should read it from the raw upstream node as a fallback.
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const graphWithNodeThreshold = {
      nodes: [
        {
          id: 'mrr_factor',
          kind: 'factor',
          label: 'MRR',
          observed_state: { value: 15000 },
          state_space: { range: { min: 0, max: 50000 } },
        },
        { id: 'churn_factor', kind: 'factor', label: 'Churn Rate', observed_state: { value: 0.05 } },
        {
          id: 'goal',
          kind: 'goal',
          label: 'Business Goal',
          // Node-level goal_threshold — not in EngineNodeV3 type but
          // accessible on the raw upstream node before normalisation strips it
          goal_threshold: 0.65,
          // ROADMAP 2.266: frame stamped so the synthesis this test is about
          // still engages (the gate is exercised in its own suite).
          goal_threshold_frame: 'delta',
        },
      ],
      edges: [
        { from: 'mrr_factor', to: 'goal', exists_probability: 1, strength: { mean: 0.6, std: 0.1 } },
        { from: 'churn_factor', to: 'goal', exists_probability: 1, strength: { mean: -0.4, std: 0.1 } },
      ],
    };

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: graphWithNodeThreshold,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        // No request-level goal_threshold — fallback to node-level
        // No goal_constraints — auto-constraint should fire from node threshold
      }),
    });

    expect(status).toBe(200);

    // Auto-constraint repair should be present (from node-level threshold)
    const repairs = data?._meta?.repairs_applied as Array<{ field: string; action: string; reason: string }>;
    const autoRepair = repairs?.find(
      (r) => r.field === 'goal_constraints' && r.action === 'derived'
    );
    expect(autoRepair).toBeDefined();
    expect(autoRepair?.reason).toContain('auto-generated');

    // constraint_sources should indicate auto-generation
    const constraintSources = (data?._meta as any)?.constraint_sources;
    expect(constraintSources).toBeDefined();
    expect(constraintSources?.auto_goal_threshold).toBe('auto_from_goal_threshold');
  });

  // T9: User-supplied constraint with the same ID as auto-generated should NOT
  // produce constraint_sources metadata (no false provenance classification).
  it('T9: user-supplied constraint_id auto_goal_threshold is NOT mislabelled as auto-generated', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: 0.7,
        // User explicitly sends a constraint using the same ID as auto-generated
        goal_constraints: [
          { constraint_id: 'auto_goal_threshold', node_id: 'goal', operator: '>=', value: 0.5 },
        ],
      }),
    });

    expect(status).toBe(200);

    // No auto-constraint repair — user supplied the constraint explicitly
    const repairs = data?._meta?.repairs_applied as Array<{ field: string; action: string; reason: string }>;
    const autoRepair = repairs?.find(
      (r) => r.field === 'goal_constraints' && r.action === 'derived' && r.reason?.includes('auto-generated')
    );
    expect(autoRepair).toBeUndefined();

    // Critical: the map is PRESENT but carries NO ENTRY for this constraint_id,
    // because the user-supplied constraint has no `_internal` namespace — only
    // auto-generated constraints carry it. Per-entry absence inside a present map
    // is the unambiguous "not auto-generated" signal; whole-map absence is not
    // (T11/T12). Asserting the entry is absent AND the map is empty is strictly
    // stronger than the previous `toBeUndefined()` on the whole map.
    const meta = (data?._meta ?? {}) as Record<string, unknown>;
    expect(Object.keys(meta)).toContain('constraint_sources');
    expect((meta.constraint_sources as Record<string, string>).auto_goal_threshold).toBeUndefined();
    expect(meta.constraint_sources).toEqual({});
  });

  // T10: User-supplied _internal is stripped at ingress — client cannot spoof provenance.
  it('T10: user-supplied _internal on goal_constraints is stripped at ingress', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        // Client attempts to spoof _internal provenance
        goal_constraints: [
          {
            constraint_id: 'spoofed_constraint',
            node_id: 'goal',
            operator: '>=',
            value: 0.5,
            _internal: { source: 'auto_from_goal_threshold' },
          },
        ],
      }),
    });

    expect(status).toBe(200);

    // _internal was stripped at ingress, so constraint_sources must NOT contain
    // the spoofed provenance — only server-synthesised constraints carry _internal.
    const constraintSources = (data?._meta as any)?.constraint_sources;
    expect(constraintSources?.spoofed_constraint).toBeUndefined();
  });

  // ===========================================================================
  // T11/T12: the attestation's MAP-LEVEL absence semantics.
  //
  // Per-ENTRY absence has always been unambiguous ("this constraint is not
  // auto-derived"). Whole-MAP absence was not: the emission used to be guarded
  // by `Object.keys(sources).length > 0`, so a run whose constraint set produced
  // no entries emitted no key at all — byte-identical to a run with no
  // constraints, and to a future bug that drops the attestation entirely. A
  // consumer then had to either fabricate an origin from silence or fail closed
  // on legitimate runs. Only the producer can tell those states apart, so the
  // producer now states it:
  //
  //   map PRESENT and EMPTY  = the constraint machinery ran, nothing to attest
  //   map ABSENT             = there were no constraints at all
  //
  // T11 and T12 are a matched pair: T11 pins the empty map, T12 pins that the
  // absent case did NOT collapse into it. Neither is sufficient alone — T11 with
  // an unconditional emission would pass while destroying the distinction it
  // exists to create.
  // ===========================================================================

  it('T11: an all-user-constraint run emits constraint_sources: {} — NOT an omitted key', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: 0.7,
        // Explicit user constraint: auto-synthesis cannot fire (it only fires
        // when the compiled constraint set is EMPTY), so no constraint carries
        // `_internal.source` and the sources map is legitimately empty.
        goal_constraints: [
          { constraint_id: 'mrr_target', node_id: 'mrr_factor', operator: '>=', value: 20000 },
        ],
      }),
    });

    expect(status).toBe(200);

    const meta = (data?._meta ?? {}) as Record<string, unknown>;
    // The KEY must exist. `?.constraint_sources` would read `undefined` for both
    // "absent" and "present but undefined", so assert on the key itself.
    expect(Object.keys(meta)).toContain('constraint_sources');
    expect(meta.constraint_sources).toEqual({});
    // And it must serialise as an empty object on the wire, not vanish.
    expect(JSON.stringify(meta.constraint_sources)).toBe('{}');
  });

  it('T12: a run with NO constraints omits constraint_sources entirely (absent ≠ empty)', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    const { status, data } = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        // No goal_constraints, no goal_threshold, no constraint nodes in the
        // graph → auto-synthesis does not fire and activeGoalConstraints stays
        // undefined. The constraint machinery never ran; there is nothing to
        // attest about, so the producer says nothing.
      }),
    });

    expect(status).toBe(200);

    const meta = (data?._meta ?? {}) as Record<string, unknown>;
    expect(Object.keys(meta)).not.toContain('constraint_sources');
  });
});

// =============================================================================
// T7: Log Assertions (via createServer + app.inject + logger spy)
// =============================================================================

// ISL mock for in-process tests (same pattern as cil-constraint-passthrough.test.ts)
const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [],
      minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
        })),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

// Import createServer AFTER the vi.mock call
const { createServer } = await import('../src/createServer.js');

describe('T7: Log assertions for auto-constraint events', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  const GRAPH = {
    nodes: [
      // ROADMAP 2.266: frame stamped so auto-synthesis engages (see gate suite).
      { id: 'goal', kind: 'goal', label: 'Revenue', goal_threshold_frame: 'delta' },
      { id: 'factor-a', kind: 'factor', label: 'Market Size', observed_state: { value: 0.5 } },
      { id: 'factor-b', kind: 'factor', label: 'Retention', observed_state: { value: 0.3 } },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', strength: { mean: 0.7, std: 0.1 } },
    ],
  };

  const OPTIONS = [
    { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 0.8 } },
    { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': 0.6 } },
  ];

  it('logs synthesised event with correct payload when auto-constraint fires', async () => {
    // Capture structured log calls via spy on the child logger created per-request.
    // Fastify creates a child logger for each request, so we spy on the prototype.
    const logCalls: any[] = [];
    const originalChildLogger = app.log.child.bind(app.log);
    vi.spyOn(app.log, 'child').mockImplementation((...args: any[]) => {
      const child = originalChildLogger(...args);
      const originalInfo = child.info.bind(child);
      child.info = (...infoArgs: any[]) => {
        logCalls.push(infoArgs[0]);
        return originalInfo(...infoArgs);
      };
      return child;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: {
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: 0.7,
        seed: '42',
        // No goal_constraints — auto-constraint should fire
      },
    });

    expect(res.statusCode).toBe(200);

    // Find the auto-constraint log event
    const autoLog = logCalls.find(
      (c: any) => c?.event === 'plot.auto_constraint_from_threshold'
    );
    expect(autoLog).toBeDefined();
    expect(autoLog.action).toBe('synthesised');
    expect(autoLog.goal_node_id).toBe('goal');
    expect(autoLog.threshold).toBe(0.7);
    expect(autoLog.threshold_source).toBe('request');

    vi.restoreAllMocks();
  });

  it('logs skipped event with reason constraints_present', async () => {
    const logCalls: any[] = [];
    const originalChildLogger = app.log.child.bind(app.log);
    vi.spyOn(app.log, 'child').mockImplementation((...args: any[]) => {
      const child = originalChildLogger(...args);
      const originalInfo = child.info.bind(child);
      child.info = (...infoArgs: any[]) => {
        logCalls.push(infoArgs[0]);
        return originalInfo(...infoArgs);
      };
      return child;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: {
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: 0.7,
        goal_constraints: [
          { constraint_id: 'c1', node_id: 'factor-a', operator: '>=', value: 0.6 },
        ],
        seed: '42',
      },
    });

    expect(res.statusCode).toBe(200);

    const autoLog = logCalls.find(
      (c: any) => c?.event === 'plot.auto_constraint_from_threshold'
    );
    expect(autoLog).toBeDefined();
    expect(autoLog.action).toBe('skipped');
    expect(autoLog.reason).toBe('constraints_present');
    expect(autoLog.constraint_count).toBe(1);

    vi.restoreAllMocks();
  });

  it('logs skipped event with reason no_goal_threshold', async () => {
    const logCalls: any[] = [];
    const originalChildLogger = app.log.child.bind(app.log);
    vi.spyOn(app.log, 'child').mockImplementation((...args: any[]) => {
      const child = originalChildLogger(...args);
      const originalInfo = child.info.bind(child);
      child.info = (...infoArgs: any[]) => {
        logCalls.push(infoArgs[0]);
        return originalInfo(...infoArgs);
      };
      return child;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: {
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
        // No goal_threshold, no goal_constraints
      },
    });

    expect(res.statusCode).toBe(200);

    const autoLog = logCalls.find(
      (c: any) => c?.event === 'plot.auto_constraint_from_threshold'
    );
    expect(autoLog).toBeDefined();
    expect(autoLog.action).toBe('skipped');
    expect(autoLog.reason).toBe('no_goal_threshold');

    vi.restoreAllMocks();
  });

  it('T10: goal_threshold_no_probability WARNS when precedence routing clears a stated target (2.239)', async () => {
    // ⚠ THIS TEST WAS INVERTED BY ROADMAP 2.239, DELIBERATELY. It used to assert
    // the opposite — "no warning when multi-constraint path clears
    // effectiveGoalThreshold" — on the reasoning that "the threshold path was
    // intentionally disabled". That reasoning codified the defect: the alarm was
    // gated on `effectiveGoalThreshold`, precedence routing clears
    // `effectiveGoalThreshold` in exactly the cases where the target fails to
    // reach ISL, and so the alarm was silent by construction in the one scenario
    // it exists to catch. This test was the lock on that door — it would have
    // failed anyone who tried to fix it.
    //
    // The user DID state a target (goal_threshold: 0.7). PLoT routed it away and
    // ISL returned no probability_of_goal. That is a defect, and a warn-level log
    // is the right place to say so. Routing away a stated target is precisely
    // what the operator needs told.
    //
    // The structural half of the original assertion is KEPT: precedence routing
    // still activates and still clears the threshold for a genuine user
    // constraint. Only the silence is gone.
    const logCalls: any[] = [];
    const warnCalls: any[] = [];
    const originalChildLogger = app.log.child.bind(app.log);
    vi.spyOn(app.log, 'child').mockImplementation((...args: any[]) => {
      const child = originalChildLogger(...args);
      const originalInfo = child.info.bind(child);
      const originalWarn = child.warn.bind(child);
      child.info = (...infoArgs: any[]) => {
        logCalls.push(infoArgs[0]);
        return originalInfo(...infoArgs);
      };
      child.warn = (...warnArgs: any[]) => {
        warnCalls.push(warnArgs[0]);
        return originalWarn(...warnArgs);
      };
      return child;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: {
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        goal_threshold: 0.7,
        goal_constraints: [
          { constraint_id: 'c1', node_id: 'factor-a', operator: '>=', value: 0.6 },
        ],
        seed: '42',
      },
    });

    expect(res.statusCode).toBe(200);

    // Unchanged: a genuine user constraint still activates the multi-constraint
    // path and still clears the threshold. The 2.239 carry-through applies ONLY
    // to the auto-synthesised constraint, which is derived from the target.
    const multiLog = logCalls.find(
      (c: any) => c?.event === 'multi_constraint_path_activated'
    );
    expect(multiLog).toBeDefined();
    expect(multiLog.goal_threshold_carried).toBe(false);

    // Inverted (2.239): the warning MUST appear. A target was stated, nothing
    // was sent to ISL, and no probability came back.
    const thresholdWarning = warnCalls.find(
      (c: any) => c?.event === 'goal_threshold_no_probability'
    );
    expect(thresholdWarning).toBeDefined();
    expect(thresholdWarning.goal_threshold).toBeNull();  // nothing reached ISL
    expect(thresholdWarning.goal_target).toBe(0.7);      // but the user asked for 0.7
    expect(thresholdWarning.goal_target_source).toBe('request');

    vi.restoreAllMocks();
  });
});
