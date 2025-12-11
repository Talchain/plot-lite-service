/**
 * Sequential Graph Validation Tests
 *
 * Tests for Phase 4 sequential graph support:
 * - Stage definition validation
 * - Node stage assignments
 * - Forward reference detection
 * - Discount factor validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateSequentialGraph,
  isSequentialGraph,
  getMaxStage,
} from '../src/util/sequential-validation.js';
import type { Graph, SequentialMetadata, StageDefinition } from '../src/trust/types.js';

describe('validateSequentialGraph', () => {
  describe('non-sequential graphs', () => {
    it('returns valid for graph without sequential metadata', () => {
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'Node A' },
          { id: 'B', label: 'Node B' },
        ],
        edges: [{ from: 'A', to: 'B' }],
      };

      const result = validateSequentialGraph(graph);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.stage_count).toBe(0);
    });

    it('warns when nodes have stages but no metadata', () => {
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'Node A', stage: 0 },
          { id: 'B', label: 'Node B', stage: 1 },
        ],
        edges: [{ from: 'A', to: 'B' }],
      };

      const result = validateSequentialGraph(graph);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('MISSING_SEQUENTIAL_METADATA');
      expect(result.issues[0].severity).toBe('warning');
      expect(result.stage_count).toBe(2);
    });
  });

  describe('sequential graph validation', () => {
    it('validates contiguous stage indices', () => {
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'Decision A', kind: 'decision' },
          { id: 'B', label: 'Decision B', kind: 'decision' },
        ],
        edges: [],
        sequential_metadata: {
          is_sequential: true,
          stages: [
            { index: 0, label: 'Stage 0', decisions: ['A'], resolved_uncertainties: [] },
            { index: 2, label: 'Stage 2', decisions: ['B'], resolved_uncertainties: [] },
          ],
        },
      };

      const result = validateSequentialGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'NON_CONTIGUOUS_STAGES')).toBe(true);
    });

    it('validates decision nodes exist in graph', () => {
      const graph: Graph = {
        nodes: [{ id: 'A', label: 'Decision A', kind: 'decision' }],
        edges: [],
        sequential_metadata: {
          is_sequential: true,
          stages: [
            {
              index: 0,
              label: 'Stage 0',
              decisions: ['A', 'MISSING'],
              resolved_uncertainties: [],
            },
          ],
        },
      };

      const result = validateSequentialGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'MISSING_DECISION_NODE')).toBe(true);
      expect(result.issues.find((i) => i.code === 'MISSING_DECISION_NODE')?.affected_ids).toContain(
        'MISSING'
      );
    });

    it('validates uncertainty nodes exist in graph', () => {
      const graph: Graph = {
        nodes: [{ id: 'A', label: 'Uncertainty A' }],
        edges: [],
        sequential_metadata: {
          is_sequential: true,
          stages: [
            {
              index: 0,
              label: 'Stage 0',
              decisions: [],
              resolved_uncertainties: ['A', 'MISSING'],
            },
          ],
        },
      };

      const result = validateSequentialGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'MISSING_UNCERTAINTY_NODE')).toBe(true);
    });

    it('warns when decision node has wrong kind', () => {
      const graph: Graph = {
        nodes: [{ id: 'A', label: 'Node A', kind: 'outcome' }],
        edges: [],
        sequential_metadata: {
          is_sequential: true,
          stages: [
            { index: 0, label: 'Stage 0', decisions: ['A'], resolved_uncertainties: [] },
          ],
        },
      };

      const result = validateSequentialGraph(graph);

      expect(result.valid).toBe(true);
      expect(result.issues.some((i) => i.code === 'INVALID_DECISION_KIND')).toBe(true);
      expect(result.issues.find((i) => i.code === 'INVALID_DECISION_KIND')?.severity).toBe(
        'warning'
      );
    });

    it('validates node stage assignment matches definitions', () => {
      const graph: Graph = {
        nodes: [{ id: 'A', label: 'Node A', stage: 5 }],
        edges: [],
        sequential_metadata: {
          is_sequential: true,
          stages: [
            { index: 0, label: 'Stage 0', decisions: ['A'], resolved_uncertainties: [] },
          ],
        },
      };

      const result = validateSequentialGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'INVALID_NODE_STAGE')).toBe(true);
    });

    it('warns on forward references (backward dependencies)', () => {
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'Stage 1 Node', stage: 1 },
          { id: 'B', label: 'Stage 0 Node', stage: 0 },
        ],
        edges: [{ from: 'A', to: 'B' }], // Forward reference: stage 1 -> stage 0
        sequential_metadata: {
          is_sequential: true,
          stages: [
            { index: 0, label: 'Stage 0', decisions: ['B'], resolved_uncertainties: [] },
            { index: 1, label: 'Stage 1', decisions: ['A'], resolved_uncertainties: [] },
          ],
        },
      };

      const result = validateSequentialGraph(graph);

      expect(result.valid).toBe(true);
      expect(result.issues.some((i) => i.code === 'FORWARD_REFERENCE')).toBe(true);
      expect(result.issues.find((i) => i.code === 'FORWARD_REFERENCE')?.severity).toBe('warning');
    });

    it('validates discount factor range', () => {
      const graph: Graph = {
        nodes: [{ id: 'A', label: 'Node A' }],
        edges: [],
        sequential_metadata: {
          is_sequential: true,
          stages: [
            { index: 0, label: 'Stage 0', decisions: ['A'], resolved_uncertainties: [] },
          ],
          default_discount_factor: 1.5, // Invalid: > 1
        },
      };

      const result = validateSequentialGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'INVALID_DISCOUNT_FACTOR')).toBe(true);
    });

    it('returns valid for well-formed sequential graph', () => {
      const graph: Graph = {
        nodes: [
          { id: 'D1', label: 'Launch Decision', kind: 'decision', stage: 0 },
          { id: 'U1', label: 'Market Response', stage: 0 },
          { id: 'D2', label: 'Pricing Decision', kind: 'decision', stage: 1 },
          { id: 'O1', label: 'Revenue Outcome', kind: 'outcome', stage: 1 },
        ],
        edges: [
          { from: 'D1', to: 'U1' },
          { from: 'U1', to: 'D2' },
          { from: 'D2', to: 'O1' },
        ],
        sequential_metadata: {
          is_sequential: true,
          stages: [
            { index: 0, label: 'Launch', decisions: ['D1'], resolved_uncertainties: ['U1'] },
            { index: 1, label: 'Pricing', decisions: ['D2'], resolved_uncertainties: [] },
          ],
          default_discount_factor: 0.95,
        },
      };

      const result = validateSequentialGraph(graph);

      expect(result.valid).toBe(true);
      expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
      expect(result.stage_count).toBe(2);
    });
  });

  describe('is_sequential false', () => {
    it('returns valid immediately when is_sequential is false', () => {
      const graph: Graph = {
        nodes: [{ id: 'A', label: 'Node A' }],
        edges: [],
        sequential_metadata: {
          is_sequential: false,
          stages: [],
        },
      };

      const result = validateSequentialGraph(graph);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.stage_count).toBe(0);
    });
  });
});

describe('isSequentialGraph', () => {
  it('returns true when sequential_metadata.is_sequential is true', () => {
    const graph: Graph = {
      nodes: [],
      edges: [],
      sequential_metadata: {
        is_sequential: true,
        stages: [],
      },
    };

    expect(isSequentialGraph(graph)).toBe(true);
  });

  it('returns true when nodes have stage assignments', () => {
    const graph: Graph = {
      nodes: [{ id: 'A', label: 'Node A', stage: 0 }],
      edges: [],
    };

    expect(isSequentialGraph(graph)).toBe(true);
  });

  it('returns false for non-sequential graph', () => {
    const graph: Graph = {
      nodes: [{ id: 'A', label: 'Node A' }],
      edges: [],
    };

    expect(isSequentialGraph(graph)).toBe(false);
  });
});

describe('getMaxStage', () => {
  it('returns 0 for non-sequential graph', () => {
    const graph: Graph = {
      nodes: [{ id: 'A', label: 'Node A' }],
      edges: [],
    };

    expect(getMaxStage(graph)).toBe(0);
  });

  it('returns max stage from metadata', () => {
    const graph: Graph = {
      nodes: [],
      edges: [],
      sequential_metadata: {
        is_sequential: true,
        stages: [
          { index: 0, label: 'Stage 0', decisions: [], resolved_uncertainties: [] },
          { index: 1, label: 'Stage 1', decisions: [], resolved_uncertainties: [] },
          { index: 2, label: 'Stage 2', decisions: [], resolved_uncertainties: [] },
        ],
      },
    };

    expect(getMaxStage(graph)).toBe(2);
  });

  it('returns max stage from node assignments', () => {
    const graph: Graph = {
      nodes: [
        { id: 'A', label: 'Node A', stage: 0 },
        { id: 'B', label: 'Node B', stage: 3 },
        { id: 'C', label: 'Node C', stage: 1 },
      ],
      edges: [],
    };

    expect(getMaxStage(graph)).toBe(3);
  });

  it('returns max from both metadata and nodes', () => {
    const graph: Graph = {
      nodes: [{ id: 'A', label: 'Node A', stage: 5 }],
      edges: [],
      sequential_metadata: {
        is_sequential: true,
        stages: [
          { index: 0, label: 'Stage 0', decisions: [], resolved_uncertainties: [] },
          { index: 2, label: 'Stage 2', decisions: [], resolved_uncertainties: [] },
        ],
      },
    };

    expect(getMaxStage(graph)).toBe(5);
  });
});
