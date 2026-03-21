/**
 * Pre-Analysis Sensitivity & EVOI Tests
 *
 * Tests for computePreAnalysisSensitivity and computeEVOI.
 * Validates factor/edge influence computation and EVOI ranking
 * across small (5 node), medium (12 node), and large (20 node) graphs.
 */
import { describe, it, expect } from 'vitest';
import {
  computePreAnalysisSensitivity,
  computeEVOI,
} from '../src/lib/pre-analysis-sensitivity.js';
import type { EngineGraphV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeEdge(from: string, to: string, mean: number, std = 0.1, ep = 0.9) {
  return { from, to, exists_probability: ep, strength: { mean, std } };
}

function makeFactor(id: string, label?: string) {
  return { id, kind: 'factor' as const, label: label ?? id };
}

function makeGoal(id: string) {
  return { id, kind: 'goal' as const, label: id };
}

function makeOutcome(id: string) {
  return { id, kind: 'outcome' as const, label: id };
}

// ---------------------------------------------------------------------------
// Fixture graphs
// ---------------------------------------------------------------------------

/**
 * Small graph (5 nodes):
 *   fac_a → out_x → goal
 *   fac_b → out_x → goal
 *   fac_c → goal  (direct)
 */
const SMALL_GRAPH: EngineGraphV3 = {
  nodes: [
    makeFactor('fac_a', 'Factor A'),
    makeFactor('fac_b', 'Factor B'),
    makeFactor('fac_c', 'Factor C'),
    makeOutcome('out_x'),
    makeGoal('goal'),
  ],
  edges: [
    makeEdge('fac_a', 'out_x', 0.8),
    makeEdge('fac_b', 'out_x', 0.3),
    makeEdge('out_x', 'goal', 0.9),
    makeEdge('fac_c', 'goal', 0.6),
  ],
};

/**
 * Medium graph (12 nodes):
 * Multiple layers with branching and merging paths.
 */
const MEDIUM_GRAPH: EngineGraphV3 = {
  nodes: [
    makeFactor('f1'), makeFactor('f2'), makeFactor('f3'), makeFactor('f4'),
    makeFactor('f5'), makeFactor('f6'),
    makeOutcome('o1'), makeOutcome('o2'), makeOutcome('o3'),
    makeOutcome('o4'), makeOutcome('o5'),
    makeGoal('goal'),
  ],
  edges: [
    // Layer 1 → Layer 2
    makeEdge('f1', 'o1', 0.7),
    makeEdge('f2', 'o1', 0.4),
    makeEdge('f2', 'o2', 0.5),
    makeEdge('f3', 'o2', 0.6),
    makeEdge('f4', 'o3', 0.8),
    makeEdge('f5', 'o4', 0.3),
    makeEdge('f6', 'o5', 0.2),
    // Layer 2 → Layer 3 / goal
    makeEdge('o1', 'o4', 0.5),
    makeEdge('o2', 'o5', 0.6),
    makeEdge('o3', 'goal', 0.9),
    makeEdge('o4', 'goal', 0.7),
    makeEdge('o5', 'goal', 0.4),
  ],
};

/**
 * Large graph (20 nodes):
 * 12 factors, 4 outcomes, 3 mediators, 1 goal with dense interconnections.
 */
const LARGE_GRAPH: EngineGraphV3 = (() => {
  const factors = Array.from({ length: 12 }, (_, i) => makeFactor(`f${i + 1}`));
  const outcomes = Array.from({ length: 4 }, (_, i) => makeOutcome(`o${i + 1}`));
  const mediators = Array.from({ length: 3 }, (_, i) => makeOutcome(`m${i + 1}`));
  const goal = makeGoal('goal');
  const nodes = [...factors, ...outcomes, ...mediators, goal];

  const edges = [
    // Factors → outcomes (diverse strengths)
    makeEdge('f1', 'o1', 0.9),
    makeEdge('f2', 'o1', 0.5),
    makeEdge('f3', 'o2', 0.7),
    makeEdge('f4', 'o2', 0.4),
    makeEdge('f5', 'o3', 0.8),
    makeEdge('f6', 'o3', 0.3),
    makeEdge('f7', 'o4', 0.6),
    makeEdge('f8', 'o4', 0.2),
    // Cross-connections via mediators
    makeEdge('f9', 'm1', 0.7),
    makeEdge('f10', 'm2', 0.5),
    makeEdge('f11', 'm3', 0.4),
    makeEdge('f12', 'm1', 0.3),
    makeEdge('m1', 'o1', 0.6),
    makeEdge('m2', 'o3', 0.5),
    makeEdge('m3', 'o4', 0.4),
    // Outcomes → goal
    makeEdge('o1', 'goal', 0.9),
    makeEdge('o2', 'goal', 0.7),
    makeEdge('o3', 'goal', 0.6),
    makeEdge('o4', 'goal', 0.5),
  ];

  return { nodes, edges };
})();

// ---------------------------------------------------------------------------
// Pre-Analysis Sensitivity Tests
// ---------------------------------------------------------------------------

describe('computePreAnalysisSensitivity', () => {
  it('returns factor and edge influence for small graph', () => {
    const result = computePreAnalysisSensitivity(SMALL_GRAPH, 'goal');

    expect(result.method).toBe('linear');
    expect(result.computation_ms).toBeGreaterThanOrEqual(0);

    // All 3 factors should have influence values
    expect(Object.keys(result.factor_influence)).toHaveLength(3);
    expect(Object.keys(result.edge_influence).length).toBeGreaterThan(0);

    // All values between 0 and 1
    for (const v of Object.values(result.factor_influence)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (const v of Object.values(result.edge_influence)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('factors closer to goal generally have higher influence', () => {
    // In SMALL_GRAPH: fac_a → out_x → goal with strength 0.8 * 0.9 = 0.72
    //                 fac_c → goal directly with strength 0.6
    //                 fac_b → out_x → goal with strength 0.3 * 0.9 = 0.27
    const result = computePreAnalysisSensitivity(SMALL_GRAPH, 'goal');

    // fac_a should have highest influence (0.72 total)
    expect(result.factor_influence['fac_a']).toBeGreaterThan(result.factor_influence['fac_b']);
    // fac_c (direct, 0.6) should beat fac_b (indirect, 0.27)
    expect(result.factor_influence['fac_c']).toBeGreaterThan(result.factor_influence['fac_b']);
  });

  it('edge influence reflects path contribution', () => {
    const result = computePreAnalysisSensitivity(SMALL_GRAPH, 'goal');

    // out_x→goal edge should have high influence (shared by two paths)
    expect(result.edge_influence['out_x::goal']).toBeGreaterThan(0);
    // fac_c→goal direct edge should be present
    expect(result.edge_influence['fac_c::goal']).toBeGreaterThan(0);
  });

  it('handles medium graph (12 nodes)', () => {
    const result = computePreAnalysisSensitivity(MEDIUM_GRAPH, 'goal');

    expect(Object.keys(result.factor_influence)).toHaveLength(6);
    for (const v of Object.values(result.factor_influence)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }

    // f4 has a strong direct path: f4 → o3 → goal (0.8 * 0.9 = 0.72)
    // It should be among the most influential
    expect(result.factor_influence['f4']).toBeGreaterThan(result.factor_influence['f6']);
  });

  it('handles large graph (20 nodes) within performance target', () => {
    const result = computePreAnalysisSensitivity(LARGE_GRAPH, 'goal');

    expect(Object.keys(result.factor_influence)).toHaveLength(12);
    for (const v of Object.values(result.factor_influence)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }

    // Performance: should complete well under 500ms
    expect(result.computation_ms).toBeLessThan(500);
  });

  it('deterministic: same input produces same output', () => {
    const r1 = computePreAnalysisSensitivity(MEDIUM_GRAPH, 'goal');
    const r2 = computePreAnalysisSensitivity(MEDIUM_GRAPH, 'goal');

    expect(r1.factor_influence).toEqual(r2.factor_influence);
    expect(r1.edge_influence).toEqual(r2.edge_influence);
    expect(r1.method).toBe(r2.method);
  });

  it('returns empty maps for graph with no factor nodes', () => {
    const graph: EngineGraphV3 = {
      nodes: [makeGoal('goal')],
      edges: [],
    };
    const result = computePreAnalysisSensitivity(graph, 'goal');
    expect(Object.keys(result.factor_influence)).toHaveLength(0);
    expect(Object.keys(result.edge_influence)).toHaveLength(0);
  });

  it('returns zero influence for disconnected factors', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        makeFactor('disconnected'),
        makeFactor('connected'),
        makeGoal('goal'),
      ],
      edges: [
        makeEdge('connected', 'goal', 0.5),
      ],
    };
    const result = computePreAnalysisSensitivity(graph, 'goal');
    expect(result.factor_influence['disconnected']).toBe(0);
    expect(result.factor_influence['connected']).toBe(1); // normalised max
  });

  it('skips bidirected edges', () => {
    const graph: EngineGraphV3 = {
      nodes: [makeFactor('f1'), makeFactor('f2'), makeGoal('goal')],
      edges: [
        makeEdge('f1', 'goal', 0.8),
        { from: 'f2', to: 'goal', exists_probability: 0.9, strength: { mean: 0.9, std: 0.1 }, edge_type: 'bidirected' },
      ],
    };
    const result = computePreAnalysisSensitivity(graph, 'goal');
    // f2's bidirected edge should be ignored → f2 influence = 0
    expect(result.factor_influence['f2']).toBe(0);
    expect(result.factor_influence['f1']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// EVOI Tests
// ---------------------------------------------------------------------------

describe('computeEVOI', () => {
  it('ranks contested edges by impact', () => {
    const contestedEdges = [
      { edge_id: 'fac_a::out_x', pass1_strength: 0.8, pass2_strength: 0.3 },
      { edge_id: 'fac_b::out_x', pass1_strength: 0.3, pass2_strength: 0.2 },
      { edge_id: 'fac_c::goal', pass1_strength: 0.6, pass2_strength: 0.1 },
    ];

    const result = computeEVOI(SMALL_GRAPH, 'goal', contestedEdges);

    expect(result.edges).toHaveLength(3);
    // Ranks should be 1, 2, 3
    expect(result.edges[0].evoi_rank).toBe(1);
    expect(result.edges[1].evoi_rank).toBe(2);
    expect(result.edges[2].evoi_rank).toBe(3);
    // All impacts should be non-negative
    for (const e of result.edges) {
      expect(e.evoi_impact).toBeGreaterThanOrEqual(0);
    }
  });

  it('higher divergence on high-influence path produces higher EVOI', () => {
    // fac_a::out_x has high influence (0.8 strength on strong path)
    // fac_b::out_x has low influence (0.3 strength)
    // With same divergence magnitude, fac_a edge should have higher EVOI
    const contestedEdges = [
      { edge_id: 'fac_a::out_x', pass1_strength: 0.8, pass2_strength: 0.3 }, // divergence 0.5
      { edge_id: 'fac_b::out_x', pass1_strength: 0.3, pass2_strength: -0.2 }, // divergence 0.5
    ];

    const result = computeEVOI(SMALL_GRAPH, 'goal', contestedEdges);

    // fac_a's edge should rank higher (higher influence path)
    const aEdge = result.edges.find(e => e.edge_id === 'fac_a::out_x')!;
    const bEdge = result.edges.find(e => e.edge_id === 'fac_b::out_x')!;
    expect(aEdge.evoi_impact).toBeGreaterThan(bEdge.evoi_impact);
  });

  it('consistent ranking across runs', () => {
    const contested = [
      { edge_id: 'fac_a::out_x', pass1_strength: 0.9, pass2_strength: 0.2 },
      { edge_id: 'fac_c::goal', pass1_strength: 0.7, pass2_strength: 0.1 },
    ];
    const r1 = computeEVOI(SMALL_GRAPH, 'goal', contested);
    const r2 = computeEVOI(SMALL_GRAPH, 'goal', contested);

    expect(r1.edges.map(e => e.edge_id)).toEqual(r2.edges.map(e => e.edge_id));
    expect(r1.edges.map(e => e.evoi_impact)).toEqual(r2.edges.map(e => e.evoi_impact));
  });

  it('evoi_impact reflects edge_influence × divergence', () => {
    const sensitivity = computePreAnalysisSensitivity(SMALL_GRAPH, 'goal');
    const contested = [
      { edge_id: 'fac_a::out_x', pass1_strength: 0.9, pass2_strength: 0.4 },
    ];
    const result = computeEVOI(SMALL_GRAPH, 'goal', contested);

    const expectedImpact =
      (sensitivity.edge_influence['fac_a::out_x'] ?? 0) * Math.abs(0.9 - 0.4);
    expect(result.edges[0].evoi_impact).toBeCloseTo(expectedImpact, 10);
  });

  it('handles unknown edge_id gracefully (zero influence)', () => {
    const contested = [
      { edge_id: 'nonexistent::edge', pass1_strength: 0.9, pass2_strength: 0.1 },
    ];
    const result = computeEVOI(SMALL_GRAPH, 'goal', contested);
    expect(result.edges[0].evoi_impact).toBe(0);
    expect(result.edges[0].evoi_rank).toBe(1);
  });

  it('works with medium graph contested edges', () => {
    const contested = [
      { edge_id: 'f4::o3', pass1_strength: 0.8, pass2_strength: 0.2 },
      { edge_id: 'f6::o5', pass1_strength: 0.2, pass2_strength: 0.1 },
      { edge_id: 'f1::o1', pass1_strength: 0.7, pass2_strength: 0.5 },
    ];

    const result = computeEVOI(MEDIUM_GRAPH, 'goal', contested);
    expect(result.edges).toHaveLength(3);

    // f4::o3 has high influence (direct path to goal via o3) + large divergence
    // Should rank highest
    expect(result.edges[0].edge_id).toBe('f4::o3');
  });
});
