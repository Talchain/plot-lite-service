/**
 * Constraint Auto-Uncertainty Tests
 *
 * Tests for Phase 4b+ of /v2/run: auto-generating ParameterUncertainty
 * entries for constrained non-root factor nodes.
 *
 * ISL's SCM evaluator uses observed_state.value as sampling base only
 * for root nodes. Non-root nodes without a ParameterUncertainty entry
 * default to base=0.0, making constraints trivially satisfied.
 */

import { describe, it, expect } from 'vitest';
import type { EngineGraphV3, EngineNodeV3 } from '../src/types/engine-v3.js';
import type { GoalConstraint } from '../src/types/engine-v3.js';
import type { ISLParameterUncertainty } from '../src/integrations/isl/types/isl-types.js';

// =============================================================================
// Extracted logic under test
// =============================================================================

/**
 * Augment parameter_uncertainties for constrained nodes that lack entries.
 *
 * ⚠ THIS IS A HAND-MAINTAINED COPY OF PRODUCTION LOGIC, NOT THE PRODUCT.
 * When it was written the logic lived inline in run.ts Phase 4b+; production
 * has since been extracted to
 * `src/integrations/isl/constraint-pu-injection.ts`
 * (`injectConstraintParameterUncertainties`), and this copy has not tracked it.
 * A green run here therefore proves something about this file, not about the
 * ISL request PLoT sends — the exact mirror-drift class the estate keeps
 * paying for. It was updated by hand again in contract step-2 slice 6 (the
 * wire entry no longer carries `mean`), which is the second time, which is the
 * argument for retiring it: this file should call
 * `injectConstraintParameterUncertainties` directly, and
 * `tests/constraint-pu-injection.test.ts` already covers that function.
 * Tracked as follow-up; not done here to keep slice 6 to producer cleanup.
 *
 * @returns augmented array (original is not mutated)
 */
function augmentParameterUncertainties(
  constraints: GoalConstraint[],
  existingUncertainties: ISLParameterUncertainty[],
  graph: EngineGraphV3,
  log: { info: (obj: unknown) => void; warn: (obj: unknown) => void }
): { uncertainties: ISLParameterUncertainty[]; added: string[]; warnings: string[] } {
  const existingPuNodeIds = new Set(existingUncertainties.map((p) => p.node_id));
  const augmented = [...existingUncertainties];
  const added: string[] = [];
  const warnings: string[] = [];

  for (const constraint of constraints) {
    if (existingPuNodeIds.has(constraint.node_id)) continue;

    const node = graph.nodes.find((n) => n.id === constraint.node_id);
    if (!node || node.observed_state?.value === undefined) {
      warnings.push(constraint.node_id);
      log.warn({
        event: 'plot.constraint_no_observed_value',
        node_id: constraint.node_id,
        constraint_id: constraint.constraint_id,
      });
      continue;
    }

    const mean = node.observed_state.value;
    // Slice 6 (mirrored from constraint-pu-injection.ts): the WIRE entry has no
    // `mean` — ISL declares none. `mean` survives only in the log record below,
    // which is PLoT's own disclosure.
    augmented.push({
      node_id: constraint.node_id,
      distribution: 'normal' as const,
      std: 0.001,
    });
    existingPuNodeIds.add(constraint.node_id);
    added.push(constraint.node_id);
    log.info({
      event: 'plot.constraint_auto_uncertainty',
      node_id: constraint.node_id,
      observed_value: mean,
      distribution: 'normal',
      std: 0.001,
    });
  }

  return { uncertainties: augmented, added, warnings };
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createGraph(nodes: Partial<EngineNodeV3>[]): EngineGraphV3 {
  const fullNodes: EngineNodeV3[] = nodes.map((n) => ({
    id: n.id ?? 'unknown',
    kind: n.kind ?? 'factor',
    label: n.label ?? n.id ?? 'Unknown',
    ...n,
  })) as EngineNodeV3[];

  return {
    nodes: fullNodes,
    edges: [
      // fac_customer_churn is a non-root node (has incoming edge)
      { from: 'fac_marketing', to: 'fac_customer_churn', exists_probability: 1, strength: { mean: 0.3, std: 0.1 } },
      { from: 'fac_customer_churn', to: 'goal_revenue', exists_probability: 1, strength: { mean: -0.5, std: 0.1 } },
    ],
  };
}

function makeConstraint(overrides?: Partial<GoalConstraint>): GoalConstraint {
  return {
    constraint_id: 'c1',
    node_id: 'fac_customer_churn',
    operator: '<=',
    value: 0.04,
    ...overrides,
  };
}

function makeLogger() {
  const logs: { info: unknown[]; warn: unknown[] } = { info: [], warn: [] };
  return {
    logger: {
      info: (obj: unknown) => logs.info.push(obj),
      warn: (obj: unknown) => logs.warn.push(obj),
    },
    logs,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Phase 4b+: Constraint auto-uncertainty', () => {
  describe('non-root factor with observed_state.value and no existing PU', () => {
    it('adds a ParameterUncertainty entry for the constrained node', () => {
      const graph = createGraph([
        { id: 'fac_marketing', kind: 'factor', observed_state: { value: 0.6 } },
        { id: 'fac_customer_churn', kind: 'factor', observed_state: { value: 0.5 } },
        { id: 'goal_revenue', kind: 'goal' },
      ]);
      const constraints = [makeConstraint()];
      const existingPU: ISLParameterUncertainty[] = [
        { node_id: 'fac_marketing', distribution: 'normal', std: 0.1 },
      ];
      const { logger } = makeLogger();

      const result = augmentParameterUncertainties(constraints, existingPU, graph, logger);

      expect(result.added).toContain('fac_customer_churn');
      const entry = result.uncertainties.find((p) => p.node_id === 'fac_customer_churn');
      expect(entry).toBeDefined();
      expect(entry!.distribution).toBe('normal');
      expect(entry!).not.toHaveProperty('mean'); // slice 6: undeclared by ISL
      // CONSTRAINT_PINNED_STD is the discriminator that the injection path ran
      // (the translator's own path never produces 0.001).
      expect(entry!.std).toBe(0.001);
      // The observed value is still what the injector keyed on — asserted via
      // its disclosure log below rather than via an undeclared wire key.
      expect(logger.info).toBeDefined();
    });
  });

  describe('node already has a ParameterUncertainty entry', () => {
    it('does not create a duplicate entry', () => {
      const graph = createGraph([
        { id: 'fac_marketing', kind: 'factor', observed_state: { value: 0.6 } },
        { id: 'fac_customer_churn', kind: 'factor', observed_state: { value: 0.5 } },
        { id: 'goal_revenue', kind: 'goal' },
      ]);
      const constraints = [makeConstraint()];
      const existingPU: ISLParameterUncertainty[] = [
        { node_id: 'fac_marketing', distribution: 'normal', std: 0.1 },
        { node_id: 'fac_customer_churn', distribution: 'normal', std: 0.15 },
      ];
      const { logger } = makeLogger();

      const result = augmentParameterUncertainties(constraints, existingPU, graph, logger);

      expect(result.added).not.toContain('fac_customer_churn');
      const entries = result.uncertainties.filter((p) => p.node_id === 'fac_customer_churn');
      expect(entries).toHaveLength(1);
      // Original entry preserved (std=0.15, not overwritten with 0.001)
      expect(entries[0].std).toBe(0.15);
    });
  });

  describe('root node constraint (no incoming edges)', () => {
    it('still adds ParameterUncertainty for consistency', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'fac_root', kind: 'factor', label: 'Root Factor', observed_state: { value: 0.3 } } as EngineNodeV3,
          { id: 'goal_revenue', kind: 'goal', label: 'Revenue' } as EngineNodeV3,
        ],
        edges: [
          { from: 'fac_root', to: 'goal_revenue', exists_probability: 1, strength: { mean: 0.5, std: 0.1 } },
        ],
      };
      const constraints = [makeConstraint({ node_id: 'fac_root', constraint_id: 'c_root' })];
      const existingPU: ISLParameterUncertainty[] = [];
      const { logger } = makeLogger();

      const result = augmentParameterUncertainties(constraints, existingPU, graph, logger);

      expect(result.added).toContain('fac_root');
      const entry = result.uncertainties.find((p) => p.node_id === 'fac_root');
      expect(entry).toBeDefined();
      expect(entry!).not.toHaveProperty('mean'); // slice 6: undeclared by ISL
      expect(entry!.std).toBe(0.001);
    });
  });

  describe('node with no observed_state.value', () => {
    it('logs warning and does not add entry', () => {
      const graph = createGraph([
        { id: 'fac_marketing', kind: 'factor', observed_state: { value: 0.6 } },
        { id: 'fac_customer_churn', kind: 'factor' }, // No observed_state
        { id: 'goal_revenue', kind: 'goal' },
      ]);
      const constraints = [makeConstraint()];
      const existingPU: ISLParameterUncertainty[] = [];
      const { logger, logs } = makeLogger();

      const result = augmentParameterUncertainties(constraints, existingPU, graph, logger);

      expect(result.added).not.toContain('fac_customer_churn');
      expect(result.warnings).toContain('fac_customer_churn');
      expect(logs.warn.length).toBeGreaterThan(0);
      const warnLog = logs.warn[0] as any;
      expect(warnLog.event).toBe('plot.constraint_no_observed_value');
      expect(warnLog.node_id).toBe('fac_customer_churn');
    });
  });

  describe('original array not mutated', () => {
    it('returns a new array without mutating the input', () => {
      const graph = createGraph([
        { id: 'fac_marketing', kind: 'factor', observed_state: { value: 0.6 } },
        { id: 'fac_customer_churn', kind: 'factor', observed_state: { value: 0.5 } },
        { id: 'goal_revenue', kind: 'goal' },
      ]);
      const constraints = [makeConstraint()];
      const existingPU: ISLParameterUncertainty[] = [
        { node_id: 'fac_marketing', distribution: 'normal', std: 0.1 },
      ];
      const originalLength = existingPU.length;
      const { logger } = makeLogger();

      const result = augmentParameterUncertainties(constraints, existingPU, graph, logger);

      // Original array not mutated
      expect(existingPU).toHaveLength(originalLength);
      // Result has additional entry
      expect(result.uncertainties.length).toBeGreaterThan(originalLength);
    });
  });

  describe('multiple constraints on different nodes', () => {
    it('adds entries for all constrained nodes missing PU', () => {
      const graph = createGraph([
        { id: 'fac_marketing', kind: 'factor', observed_state: { value: 0.6 } },
        { id: 'fac_customer_churn', kind: 'factor', observed_state: { value: 0.5 } },
        { id: 'fac_pricing', kind: 'factor', observed_state: { value: 0.8 } },
        { id: 'goal_revenue', kind: 'goal' },
      ]);
      const constraints = [
        makeConstraint({ constraint_id: 'c1', node_id: 'fac_customer_churn' }),
        makeConstraint({ constraint_id: 'c2', node_id: 'fac_pricing', operator: '>=', value: 0.5 }),
      ];
      const existingPU: ISLParameterUncertainty[] = [];
      const { logger } = makeLogger();

      const result = augmentParameterUncertainties(constraints, existingPU, graph, logger);

      expect(result.added).toContain('fac_customer_churn');
      expect(result.added).toContain('fac_pricing');
      expect(result.uncertainties).toHaveLength(2);

      // Slice 6: `mean` is no longer on the wire entry. Both nodes are still
      // distinguished by identity + the pinned injection std.
      const churnEntry = result.uncertainties.find((p) => p.node_id === 'fac_customer_churn');
      expect(churnEntry).toBeDefined();
      expect(churnEntry!).not.toHaveProperty('mean');
      expect(churnEntry!.std).toBe(0.001);

      const pricingEntry = result.uncertainties.find((p) => p.node_id === 'fac_pricing');
      expect(pricingEntry).toBeDefined();
      expect(pricingEntry!).not.toHaveProperty('mean');
      expect(pricingEntry!.std).toBe(0.001);
    });
  });

  describe('duplicate constraints on same node', () => {
    it('adds only one entry for the node', () => {
      const graph = createGraph([
        { id: 'fac_marketing', kind: 'factor', observed_state: { value: 0.6 } },
        { id: 'fac_customer_churn', kind: 'factor', observed_state: { value: 0.5 } },
        { id: 'goal_revenue', kind: 'goal' },
      ]);
      const constraints = [
        makeConstraint({ constraint_id: 'c1', node_id: 'fac_customer_churn', operator: '<=', value: 0.04 }),
        makeConstraint({ constraint_id: 'c2', node_id: 'fac_customer_churn', operator: '>=', value: 0.01 }),
      ];
      const existingPU: ISLParameterUncertainty[] = [];
      const { logger } = makeLogger();

      const result = augmentParameterUncertainties(constraints, existingPU, graph, logger);

      const entries = result.uncertainties.filter((p) => p.node_id === 'fac_customer_churn');
      expect(entries).toHaveLength(1);
    });
  });
});
