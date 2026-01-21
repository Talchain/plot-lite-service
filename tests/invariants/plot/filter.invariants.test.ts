/**
 * Filter Invariants Test Stubs
 *
 * Tests for SSOT v1.2 invariant contracts on non-causal node filtering.
 * These tests verify that filtering operations remove exactly the expected nodes.
 *
 * @see docs/audits/PLOT_OPERATIONS_INVENTORY.md
 */
import { describe, it, expect } from 'vitest';
import {
  filterOptionNodes,
  hasOptionNodes,
  countOptionNodes,
  filterForISL,
} from '../../../src/normalisation/option-filter.js';
import type { EngineGraphV3 } from '../../../src/types/engine-v3.js';

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------

const GRAPH_WITH_OPTIONS: EngineGraphV3 = {
  nodes: [
    { id: 'factor_a', kind: 'factor', label: 'Factor A' },
    { id: 'option_1', kind: 'option', label: 'Option 1' },
    { id: 'decision_1', kind: 'decision', label: 'Decision 1' },
    { id: 'goal_1', kind: 'goal', label: 'Goal 1' },
  ],
  edges: [
    { from: 'factor_a', to: 'goal_1', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
    { from: 'option_1', to: 'goal_1', exists_probability: 0.8, strength: { mean: 0.7, std: 0.1 } },
    { from: 'decision_1', to: 'option_1', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
  ],
};

const GRAPH_WITHOUT_OPTIONS: EngineGraphV3 = {
  nodes: [
    { id: 'factor_a', kind: 'factor', label: 'Factor A' },
    { id: 'outcome_1', kind: 'outcome', label: 'Outcome 1' },
    { id: 'goal_1', kind: 'goal', label: 'Goal 1' },
  ],
  edges: [
    { from: 'factor_a', to: 'outcome_1', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
    { from: 'outcome_1', to: 'goal_1', exists_probability: 0.95, strength: { mean: 0.8, std: 0.1 } },
  ],
};

const GRAPH_WITH_CONSTRAINT: EngineGraphV3 = {
  nodes: [
    { id: 'factor_a', kind: 'factor', label: 'Factor A' },
    { id: 'constraint_1', kind: 'constraint', label: 'Constraint 1' },
    { id: 'goal_1', kind: 'goal', label: 'Goal 1' },
  ],
  edges: [
    { from: 'factor_a', to: 'goal_1', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
    { from: 'constraint_1', to: 'factor_a', exists_probability: 0.7, strength: { mean: -0.3, std: 0.1 } },
  ],
};

// -----------------------------------------------------------------------------
// INV-FILTER-01: Non-causal nodes are removed
// -----------------------------------------------------------------------------
describe('INV-FILTER-01: Non-causal nodes are removed', () => {
  it('removes option nodes', () => {
    const result = filterOptionNodes(GRAPH_WITH_OPTIONS);
    const hasOption = result.filteredGraph.nodes.some(n => n.kind === 'option');
    expect(hasOption).toBe(false);
  });

  it('removes decision nodes', () => {
    const result = filterOptionNodes(GRAPH_WITH_OPTIONS);
    const hasDecision = result.filteredGraph.nodes.some(n => n.kind === 'decision');
    expect(hasDecision).toBe(false);
  });

  it('removes constraint nodes', () => {
    const result = filterOptionNodes(GRAPH_WITH_CONSTRAINT);
    const hasConstraint = result.filteredGraph.nodes.some(n => n.kind === 'constraint');
    expect(hasConstraint).toBe(false);
  });

  it('preserves causal nodes (factor, outcome, goal, risk, action)', () => {
    const result = filterOptionNodes(GRAPH_WITH_OPTIONS);

    const factorNode = result.filteredGraph.nodes.find(n => n.id === 'factor_a');
    const goalNode = result.filteredGraph.nodes.find(n => n.id === 'goal_1');

    expect(factorNode).toBeDefined();
    expect(goalNode).toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// INV-FILTER-02: Incident edges are removed
// -----------------------------------------------------------------------------
describe('INV-FILTER-02: Incident edges are removed', () => {
  it('removes edges FROM non-causal nodes', () => {
    const result = filterOptionNodes(GRAPH_WITH_OPTIONS);

    // Edge decision_1 → option_1 should be removed (from decision)
    const hasEdgeFromDecision = result.filteredGraph.edges.some(e => e.from === 'decision_1');
    expect(hasEdgeFromDecision).toBe(false);
  });

  it('removes edges TO non-causal nodes', () => {
    const result = filterOptionNodes(GRAPH_WITH_OPTIONS);

    // Edge decision_1 → option_1 should be removed (to option)
    const hasEdgeToOption = result.filteredGraph.edges.some(e => e.to === 'option_1');
    expect(hasEdgeToOption).toBe(false);
  });

  it('preserves edges between causal nodes', () => {
    const result = filterOptionNodes(GRAPH_WITH_OPTIONS);

    // Edge factor_a → goal_1 should be preserved
    const causalEdge = result.filteredGraph.edges.find(
      e => e.from === 'factor_a' && e.to === 'goal_1'
    );
    expect(causalEdge).toBeDefined();
  });

  it('reports correct removed edge count', () => {
    const result = filterOptionNodes(GRAPH_WITH_OPTIONS);

    // 2 edges involve non-causal nodes: option_1→goal_1 and decision_1→option_1
    expect(result.removedEdgeCount).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// INV-FILTER-03: Filter result metadata is accurate
// -----------------------------------------------------------------------------
describe('INV-FILTER-03: Filter result metadata is accurate', () => {
  it('returns correct removedNodeIds set', () => {
    const result = filterOptionNodes(GRAPH_WITH_OPTIONS);

    expect(result.removedNodeIds.has('option_1')).toBe(true);
    expect(result.removedNodeIds.has('decision_1')).toBe(true);
    expect(result.removedNodeIds.has('factor_a')).toBe(false);
    expect(result.removedNodeIds.size).toBe(2);
  });

  it('returns empty removedNodeIds for graph without options', () => {
    const result = filterOptionNodes(GRAPH_WITHOUT_OPTIONS);

    expect(result.removedNodeIds.size).toBe(0);
    expect(result.removedEdgeCount).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// INV-FILTER-04: Idempotency - filtering is idempotent
// -----------------------------------------------------------------------------
describe('INV-FILTER-04: Filter idempotency', () => {
  it('second filter produces identical graph', () => {
    const first = filterOptionNodes(GRAPH_WITH_OPTIONS);
    const second = filterOptionNodes(first.filteredGraph);

    expect(second.filteredGraph.nodes).toEqual(first.filteredGraph.nodes);
    expect(second.filteredGraph.edges).toEqual(first.filteredGraph.edges);
    expect(second.removedNodeIds.size).toBe(0);
    expect(second.removedEdgeCount).toBe(0);
  });

  it('filterForISL produces same result as filterOptionNodes().filteredGraph', () => {
    const fromFilter = filterOptionNodes(GRAPH_WITH_OPTIONS).filteredGraph;
    const fromISL = filterForISL(GRAPH_WITH_OPTIONS);

    expect(fromISL.nodes).toEqual(fromFilter.nodes);
    expect(fromISL.edges).toEqual(fromFilter.edges);
  });
});

// -----------------------------------------------------------------------------
// INV-FILTER-05: Helper functions are consistent
// -----------------------------------------------------------------------------
describe('INV-FILTER-05: Helper function consistency', () => {
  it('hasOptionNodes returns true when options present', () => {
    expect(hasOptionNodes(GRAPH_WITH_OPTIONS)).toBe(true);
  });

  it('hasOptionNodes returns false when no options', () => {
    expect(hasOptionNodes(GRAPH_WITHOUT_OPTIONS)).toBe(false);
  });

  it('countOptionNodes matches removedNodeIds size', () => {
    const count = countOptionNodes(GRAPH_WITH_OPTIONS);
    const result = filterOptionNodes(GRAPH_WITH_OPTIONS);

    expect(count).toBe(result.removedNodeIds.size);
  });

  it('countOptionNodes returns 0 for graph without options', () => {
    expect(countOptionNodes(GRAPH_WITHOUT_OPTIONS)).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// INV-FILTER-06: Original graph is not mutated
// -----------------------------------------------------------------------------
describe('INV-FILTER-06: Original graph is not mutated', () => {
  it('filtering does not mutate original nodes array', () => {
    const originalNodesLength = GRAPH_WITH_OPTIONS.nodes.length;
    filterOptionNodes(GRAPH_WITH_OPTIONS);

    expect(GRAPH_WITH_OPTIONS.nodes.length).toBe(originalNodesLength);
  });

  it('filtering does not mutate original edges array', () => {
    const originalEdgesLength = GRAPH_WITH_OPTIONS.edges.length;
    filterOptionNodes(GRAPH_WITH_OPTIONS);

    expect(GRAPH_WITH_OPTIONS.edges.length).toBe(originalEdgesLength);
  });
});

// -----------------------------------------------------------------------------
// INV-FILTER-07: Case-insensitive kind matching
// -----------------------------------------------------------------------------
describe('INV-FILTER-07: Case-insensitive kind matching', () => {
  it('filters uppercase OPTION kind', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor' },
        { id: 'option_1', kind: 'OPTION' as any, label: 'Option' },
      ],
      edges: [],
    };

    const result = filterOptionNodes(graph);
    expect(result.removedNodeIds.has('option_1')).toBe(true);
  });

  it('filters mixed-case Decision kind', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor' },
        { id: 'decision_1', kind: 'Decision' as any, label: 'Decision' },
      ],
      edges: [],
    };

    const result = filterOptionNodes(graph);
    expect(result.removedNodeIds.has('decision_1')).toBe(true);
  });
});
