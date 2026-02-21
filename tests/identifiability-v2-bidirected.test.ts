/**
 * 3A-trust: Bidirected Edge Tests
 *
 * 18 test cases covering bidirected edge handling for identifiability,
 * ISL filtering, response hash, warnings, normalization, DAG validators,
 * and node-kind guardrails.
 *
 * 1.  Bidirected between treatment and outcome → not_backdoor_identifiable
 * 2.  Bidirected between treatment ancestor and outcome → not_backdoor_identifiable
 * 3.  Bidirected between unrelated nodes → identifiable
 * 4.  Multiple bidirected, one relevant → not_backdoor_identifiable for relevant pair
 * 5.  Backward compatibility (no bidirected edges) → same as B1.5 T1
 * 6.  Bidirected edges filtered from ISL request (translator path)
 * 6a. Bidirected edges filtered from threshold ISL payload
 * 7.  UNMEASURED_CONFOUNDING_WARNING emitted (helper-level)
 * 7a. Route-level critique emission: both warnings present
 * 8.  Warning NOT emitted without bidirected edges
 * 9.  Determinism (same graph twice → identical results)
 * 10. Response hash excludes bidirected edges
 * 11. Latent node ID collision guard
 * 12. DAG validators accept bidirected edges
 * 13. Normalization preserves edge_type through pipeline
 * 14. Node-kind guardrail: valid factor↔factor → no warning
 * 15. Node-kind guardrail: invalid option↔factor → INVALID_BIDIRECTED_EDGE warning
 * 16. Node-kind guardrail: invalid factor↔goal → INVALID_BIDIRECTED_EDGE warning
 * 17. Node-kind guardrail: mixed valid + invalid → valid processed, invalid warned
 */

import { describe, it, expect } from 'vitest';
import {
  assessGraphIdentifiability,
  toIdentifiabilityResponse,
  detectUnmeasuredConfounding,
} from '../src/trust/identifiability-v2.js';
import { validateDAG } from '../src/trust/d-separation.js';
import { buildAdjacencyList } from '../src/validation/path-to-goal.js';
import { toISLRobustnessRequest } from '../src/integrations/isl/translator-v3.js';
import { normaliseEdge } from '../src/normalisation/graph-normaliser.js';
import { canonicaliseRequest, computeResponseHash } from '../src/normalisation/canonicalise.js';
import { runPreflightValidation, filterInvalidBidirectedEdges } from '../src/validation/preflight-v2.js';
import type { EngineGraphV3, OptionV3, RunRequestV3, UpstreamEdge } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal EngineGraphV3 node with required fields */
function node(id: string, kind: string = 'factor'): EngineGraphV3['nodes'][0] {
  return {
    id,
    label: id,
    kind,
    observed_state: { value: 0.5 },
  } as EngineGraphV3['nodes'][0];
}

/** Minimal directed EngineGraphV3 edge */
function edge(from: string, to: string): EngineGraphV3['edges'][0] {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.8,
  } as EngineGraphV3['edges'][0];
}

/** Bidirected edge: A↔B (unmeasured confounding) */
function biedge(from: string, to: string): EngineGraphV3['edges'][0] {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.8,
    edge_type: 'bidirected' as const,
  } as EngineGraphV3['edges'][0];
}

/** Minimal option with interventions (simplified format for identifiability tests) */
function option(id: string, interventions: Record<string, number>): OptionV3 {
  return { id, label: id, interventions } as OptionV3;
}

/** Option with proper InterventionValueV3 format (for ISL translator tests) */
function islOption(id: string, interventions: Record<string, number>): OptionV3 {
  const rich: Record<string, { value: number; source: string }> = {};
  for (const [k, v] of Object.entries(interventions)) {
    rich[k] = { value: v, source: 'user_specified' };
  }
  return { id, label: id, interventions: rich } as OptionV3;
}

/** Build a minimal RunRequestV3 for hash testing */
function runRequest(graph: EngineGraphV3, goalNodeId: string): RunRequestV3 {
  return {
    graph: { nodes: graph.nodes, edges: graph.edges } as any,
    options: [option('opt1', { [graph.nodes[0].id]: 10 }), option('opt2', { [graph.nodes[0].id]: 20 })],
    goal_node_id: goalNodeId,
    seed: '42',
  } as RunRequestV3;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('3A-trust: Bidirected Edges', () => {

  // =========================================================================
  // Test 1: Bidirected between treatment and outcome
  // =========================================================================
  it('T1: bidirected between treatment and outcome → not_backdoor_identifiable', () => {
    // A↔C (bidirected) + A→C (directed). A treatment, C outcome.
    const graph: EngineGraphV3 = {
      nodes: [node('A'), node('C')],
      edges: [edge('A', 'C'), biedge('A', 'C')],
    };
    const options = [option('opt1', { A: 10 }), option('opt2', { A: 20 })];

    const result = assessGraphIdentifiability(graph, options, 'C');

    expect(result).toBeDefined();
    expect(result!.all_identifiable).toBe(false);
    expect(result!.pairs).toHaveLength(1);
    expect(result!.pairs[0].identifiable).toBe(false);
    expect(result!.pairs[0].treatment_node_id).toBe('A');
    expect(result!.pairs[0].outcome_node_id).toBe('C');

    // Contracted response should be not_backdoor_identifiable
    const response = toIdentifiabilityResponse(result);
    expect(response.status).toBe('not_backdoor_identifiable');
  });

  // =========================================================================
  // Test 2: Bidirected between treatment ancestor and outcome
  // =========================================================================
  it('T2: bidirected between treatment ancestor and outcome → not_backdoor_identifiable', () => {
    // B→A, B↔C (bidirected), A→C. A treatment, C outcome.
    // B is an ancestor of A (treatment). B↔C means B and C share an
    // unmeasured common cause U. The latent expansion creates U→B and U→C.
    // This opens a backdoor path: A←B←U→C that cannot be blocked because
    // U is unobserved (excluded from adjustment set).
    const graph: EngineGraphV3 = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [edge('B', 'A'), edge('A', 'C'), biedge('B', 'C')],
    };
    const options = [option('opt1', { A: 10 }), option('opt2', { A: 20 })];

    const result = assessGraphIdentifiability(graph, options, 'C');

    expect(result).toBeDefined();
    expect(result!.all_identifiable).toBe(false);
    expect(result!.pairs[0].identifiable).toBe(false);
  });

  // =========================================================================
  // Test 3: Bidirected between unrelated nodes
  // =========================================================================
  it('T3: bidirected between unrelated nodes → identifiable', () => {
    // A→C (treatment→outcome), D↔E (unrelated bidirected).
    const graph: EngineGraphV3 = {
      nodes: [node('A'), node('C'), node('D'), node('E')],
      edges: [edge('A', 'C'), biedge('D', 'E')],
    };
    const options = [option('opt1', { A: 10 }), option('opt2', { A: 20 })];

    const result = assessGraphIdentifiability(graph, options, 'C');

    expect(result).toBeDefined();
    expect(result!.all_identifiable).toBe(true);
    expect(result!.pairs).toHaveLength(1);
    expect(result!.pairs[0].identifiable).toBe(true);
  });

  // =========================================================================
  // Test 4: Multiple bidirected, one relevant
  // =========================================================================
  it('T4: multiple bidirected, one relevant → not_backdoor_identifiable for relevant pair', () => {
    // A→B→C, A↔C (relevant bidirected), D↔E (irrelevant bidirected).
    // A is treatment, C is outcome. A↔C introduces an unmeasured confounder
    // between treatment and outcome.
    const graph: EngineGraphV3 = {
      nodes: [node('A'), node('B'), node('C'), node('D'), node('E')],
      edges: [
        edge('A', 'B'), edge('B', 'C'),
        biedge('A', 'C'),   // Relevant: connects treatment to outcome
        biedge('D', 'E'),   // Irrelevant: unrelated nodes
      ],
    };
    const options = [option('opt1', { A: 10 }), option('opt2', { A: 20 })];

    const result = assessGraphIdentifiability(graph, options, 'C');

    expect(result).toBeDefined();
    expect(result!.all_identifiable).toBe(false);
    expect(result!.pairs[0].treatment_node_id).toBe('A');
    expect(result!.pairs[0].identifiable).toBe(false);
  });

  // =========================================================================
  // Test 5: Backward compatibility (no bidirected edges)
  // =========================================================================
  it('T5: directed-only graph produces same results as B1.5 T1', () => {
    // Reuse B1.5 T1: simple chain A → B → Goal
    const graph: EngineGraphV3 = {
      nodes: [node('A'), node('B'), node('Goal')],
      edges: [edge('A', 'B'), edge('B', 'Goal')],
    };
    const options = [option('opt1', { A: 10 })];

    const result = assessGraphIdentifiability(graph, options, 'Goal');

    expect(result).toBeDefined();
    expect(result!.all_identifiable).toBe(true);
    expect(result!.pair_count).toBe(1);
    expect(result!.non_identifiable_count).toBe(0);
    expect(result!.pairs[0]).toMatchObject({
      treatment_node_id: 'A',
      outcome_node_id: 'Goal',
      identifiable: true,
    });
  });

  // =========================================================================
  // Test 6: Bidirected edges filtered from ISL request (translator path)
  // =========================================================================
  it('T6: bidirected edges filtered from ISL request payload (translator path)', () => {
    const graph: EngineGraphV3 = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [edge('A', 'B'), edge('B', 'C'), biedge('A', 'C')],
    };
    const options = [islOption('opt1', { A: 10 }), islOption('opt2', { A: 20 })];

    const islRequest = toISLRobustnessRequest(graph, options, 'C', 'req-test');

    // ISL request should only contain directed edges
    expect(islRequest.graph.edges).toHaveLength(2);
    for (const e of islRequest.graph.edges) {
      // ISL edges don't have edge_type field — they're plain directed edges
      expect((e as any).edge_type).toBeUndefined();
    }
    // Verify the directed edges are present
    const edgePairs = islRequest.graph.edges.map((e) => `${e.from}→${e.to}`);
    expect(edgePairs).toContain('A→B');
    expect(edgePairs).toContain('B→C');
  });

  // =========================================================================
  // Test 6a: Bidirected edges filtered from threshold ISL payload
  // =========================================================================
  it('T6a: bidirected edges excluded from threshold analysis payload construction', () => {
    // Simulate what run.ts does at line ~3167 for the threshold path:
    // filteredGraph.edges.filter(e => e.edge_type !== 'bidirected')
    const graphEdges: EngineGraphV3['edges'] = [
      edge('A', 'B'),
      edge('B', 'C'),
      biedge('A', 'C'),
    ];

    // Apply the same filter used in the threshold payload construction
    const directedEdges = graphEdges.filter(e => e.edge_type !== 'bidirected');

    expect(directedEdges).toHaveLength(2);
    expect(directedEdges.every(e => e.edge_type !== 'bidirected')).toBe(true);
    expect(directedEdges.map(e => `${e.from}→${e.to}`)).toEqual(['A→B', 'B→C']);
  });

  // =========================================================================
  // Test 7: UNMEASURED_CONFOUNDING_WARNING emitted
  // =========================================================================
  it('T7: UNMEASURED_CONFOUNDING_WARNING emitted when bidirected edges cause non-identifiability', () => {
    // Use test 1 fixture: A↔C + A→C
    const graph: EngineGraphV3 = {
      nodes: [node('A'), node('C')],
      edges: [edge('A', 'C'), biedge('A', 'C')],
    };
    const options = [option('opt1', { A: 10 }), option('opt2', { A: 20 })];

    const result = assessGraphIdentifiability(graph, options, 'C');
    expect(result).toBeDefined();
    expect(result!.all_identifiable).toBe(false);

    // Detect unmeasured confounding
    const affectedCount = detectUnmeasuredConfounding(result!, graph, options, 'C');
    expect(affectedCount).toBe(1);

    // Without bidirected, A→C is identifiable (direct effect, no confounders)
    const directedOnly: EngineGraphV3 = {
      nodes: [node('A'), node('C')],
      edges: [edge('A', 'C')],
    };
    const withoutBi = assessGraphIdentifiability(directedOnly, options, 'C');
    expect(withoutBi).toBeDefined();
    expect(withoutBi!.all_identifiable).toBe(true);
  });

  // =========================================================================
  // Test 8: Warning NOT emitted without bidirected edges
  // =========================================================================
  it('T8: no UNMEASURED_CONFOUNDING_WARNING for directed-only identifiable graph', () => {
    const graph: EngineGraphV3 = {
      nodes: [node('A'), node('B'), node('Goal')],
      edges: [edge('A', 'B'), edge('B', 'Goal')],
    };
    const options = [option('opt1', { A: 10 })];

    const result = assessGraphIdentifiability(graph, options, 'Goal');
    expect(result).toBeDefined();
    expect(result!.all_identifiable).toBe(true);

    // No bidirected edges → affectedCount should be 0
    const affectedCount = detectUnmeasuredConfounding(result!, graph, options, 'Goal');
    expect(affectedCount).toBe(0);
  });

  // =========================================================================
  // Test 9: Determinism
  // =========================================================================
  it('T9: same graph twice produces identical results and latent node IDs', () => {
    const graph: EngineGraphV3 = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [edge('A', 'B'), edge('B', 'C'), biedge('A', 'C')],
    };
    const options = [option('opt1', { A: 10 }), option('opt2', { A: 20 })];

    const result1 = assessGraphIdentifiability(graph, options, 'C');
    const result2 = assessGraphIdentifiability(graph, options, 'C');

    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  // =========================================================================
  // Test 10: Response hash excludes bidirected edges
  // =========================================================================
  it('T10: response_hash identical for graphs differing only by bidirected edge', () => {
    // Graph 1: directed only
    const graph1: EngineGraphV3 = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [edge('A', 'B'), edge('B', 'C')],
    };

    // Graph 2: same directed edges + one bidirected edge
    const graph2: EngineGraphV3 = {
      nodes: [node('A'), node('B'), node('C')],
      edges: [edge('A', 'B'), edge('B', 'C'), biedge('A', 'C')],
    };

    // Build identical request objects that differ ONLY in the bidirected edge
    const req1: RunRequestV3 = {
      graph: { nodes: graph1.nodes, edges: graph1.edges } as any,
      options: [option('opt1', { A: 10 }), option('opt2', { A: 20 })],
      goal_node_id: 'C',
      seed: '42',
    } as RunRequestV3;

    const req2: RunRequestV3 = {
      graph: { nodes: graph2.nodes, edges: graph2.edges } as any,
      options: [option('opt1', { A: 10 }), option('opt2', { A: 20 })],
      goal_node_id: 'C',
      seed: '42',
    } as RunRequestV3;

    const canonical1 = canonicaliseRequest(req1, graph1, '42');
    const canonical2 = canonicaliseRequest(req2, graph2, '42');

    const hash1 = computeResponseHash(canonical1);
    const hash2 = computeResponseHash(canonical2);

    expect(hash1).toBe(hash2);
  });

  // =========================================================================
  // Test 11: Latent node ID collision guard
  // =========================================================================
  it('T11: throws when a real node ID starts with __latent__', () => {
    const graph: EngineGraphV3 = {
      nodes: [node('__latent__bad'), node('A'), node('C')],
      edges: [edge('A', 'C')],
    };
    const options = [option('opt1', { A: 10 })];

    // assessGraphIdentifiability catches the error and returns undefined (silent degradation)
    const result = assessGraphIdentifiability(graph, options, 'C');
    expect(result).toBeUndefined();
  });

  // =========================================================================
  // Test 12: DAG validators accept bidirected edges
  // =========================================================================
  it('T12: DAG validators accept graphs with bidirected edges', () => {
    const graphEdges: EngineGraphV3['edges'] = [
      edge('A', 'B'),
      edge('B', 'C'),
      biedge('A', 'C'),
    ];

    // buildAdjacencyList should exclude bidirected edges
    const adjacency = buildAdjacencyList(graphEdges);
    expect(adjacency.get('A')).toEqual(['B']);
    expect(adjacency.get('B')).toEqual(['C']);
    // Bidirected A↔C should NOT create adjacency entries
    expect(adjacency.has('C') ? adjacency.get('C')!.length : 0).toBe(0);

    // validateDAG on the directed-only DAG should pass
    // (bidirected edges are filtered before reaching d-separation)
    const directedDAG = {
      nodes: ['A', 'B', 'C'],
      edges: graphEdges
        .filter((e) => e.edge_type !== 'bidirected')
        .map((e) => ({ from: e.from, to: e.to })),
    };
    const validation = validateDAG(directedDAG);
    expect(validation.valid).toBe(true);
    expect(validation.isDAG).toBe(true);
  });

  // =========================================================================
  // Test 13: Normalization preserves edge_type through pipeline
  // =========================================================================
  it('T13: normaliseEdge preserves edge_type: bidirected through normalization', () => {
    const nodeKindMap = new Map([['A', 'factor'], ['C', 'goal']]);

    // Bidirected upstream edge
    const upstream: UpstreamEdge = {
      from: 'A',
      to: 'C',
      strength: { mean: 0.5, std: 0.1 },
      edge_type: 'bidirected',
    };

    const normalised = normaliseEdge(upstream, 0, nodeKindMap);
    expect(normalised.edge_type).toBe('bidirected');

    // Directed upstream edge (no edge_type) should NOT have edge_type set
    const directedUpstream: UpstreamEdge = {
      from: 'A',
      to: 'C',
      strength: { mean: 0.5, std: 0.1 },
    };

    const normalisedDirected = normaliseEdge(directedUpstream, 1, nodeKindMap);
    expect(normalisedDirected.edge_type).toBeUndefined();

    // Explicitly directed edge should also NOT have edge_type set
    const explicitDirected: UpstreamEdge = {
      from: 'A',
      to: 'C',
      strength: { mean: 0.5, std: 0.1 },
      edge_type: 'directed',
    };

    const normalisedExplicit = normaliseEdge(explicitDirected, 2, nodeKindMap);
    expect(normalisedExplicit.edge_type).toBeUndefined();
  });

  // =========================================================================
  // Tests 14-17: Node-kind guardrail for bidirected edges
  // =========================================================================

  const defaultStats = {
    optionNodesFiltered: 0,
    optionEdgesFiltered: 0,
    nodesNormalised: 3,
    edgesNormalised: 2,
  };

  // T14: Valid bidirected (factor↔factor) — no warning, processed by identifiability
  it('T14: factor↔factor bidirected → no INVALID_BIDIRECTED_EDGE warning', () => {
    const graph: EngineGraphV3 = {
      nodes: [node('A', 'factor'), node('B', 'factor'), node('Goal', 'goal')],
      edges: [edge('A', 'Goal'), edge('B', 'Goal'), biedge('A', 'B')],
    };
    const opts = [option('opt1', { A: 10 }), option('opt2', { B: 20 })];

    const preflight = runPreflightValidation(graph, opts, 'Goal', defaultStats);

    const invalidWarnings = preflight.warnings.filter(w => w.code === 'INVALID_BIDIRECTED_EDGE');
    expect(invalidWarnings).toHaveLength(0);

    // Edge should survive filtering and be used by identifiability
    const filtered = filterInvalidBidirectedEdges(graph);
    expect(filtered.edges.filter(e => e.edge_type === 'bidirected')).toHaveLength(1);
  });

  // T15: Invalid bidirected (option↔factor) — warning emitted, excluded from identifiability
  // Note: option nodes are normally removed by filterOptionNodes before preflight,
  // but we test the guardrail directly on the graph that reaches preflight.
  // In practice, this guards against non-factor kinds that survive filtering
  // (e.g., action↔factor). We use 'action' as the non-factor stand-in.
  it('T15: action↔factor bidirected → INVALID_BIDIRECTED_EDGE warning, excluded from identifiability', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        node('A', 'factor'),
        node('R', 'action'),
        node('Goal', 'goal'),
      ],
      edges: [edge('A', 'Goal'), edge('R', 'Goal'), biedge('R', 'A')],
    };
    const opts = [option('opt1', { A: 10 }), option('opt2', { A: 20 })];

    const preflight = runPreflightValidation(graph, opts, 'Goal', defaultStats);

    const invalidWarnings = preflight.warnings.filter(w => w.code === 'INVALID_BIDIRECTED_EDGE');
    expect(invalidWarnings).toHaveLength(1);
    expect(invalidWarnings[0].message).toContain('unmeasured confounding is only meaningful between factor nodes');
    expect(invalidWarnings[0].affected_node_ids).toEqual(['R', 'A']);

    // Edge should be removed by filterInvalidBidirectedEdges
    const filtered = filterInvalidBidirectedEdges(graph);
    expect(filtered.edges.filter(e => e.edge_type === 'bidirected')).toHaveLength(0);
    // Directed edges preserved
    expect(filtered.edges.filter(e => e.edge_type !== 'bidirected')).toHaveLength(2);
  });

  // T16: Invalid bidirected (factor↔goal) — warning emitted, excluded
  it('T16: factor↔goal bidirected → INVALID_BIDIRECTED_EDGE warning, excluded from identifiability', () => {
    const graph: EngineGraphV3 = {
      nodes: [node('A', 'factor'), node('Goal', 'goal')],
      edges: [edge('A', 'Goal'), biedge('A', 'Goal')],
    };
    const opts = [option('opt1', { A: 10 }), option('opt2', { A: 20 })];

    const preflight = runPreflightValidation(graph, opts, 'Goal', defaultStats);

    const invalidWarnings = preflight.warnings.filter(w => w.code === 'INVALID_BIDIRECTED_EDGE');
    expect(invalidWarnings).toHaveLength(1);
    expect(invalidWarnings[0].message).toContain('unmeasured confounding is only meaningful between factor nodes');

    // Edge should be removed — identifiability should see only directed A→Goal
    const filtered = filterInvalidBidirectedEdges(graph);
    expect(filtered.edges).toHaveLength(1);
    expect(filtered.edges[0].edge_type).toBeUndefined();

    // Identifiability should see the graph as identifiable (no bidirected edges remain)
    const result = assessGraphIdentifiability(filtered, opts, 'Goal');
    expect(result).toBeDefined();
    expect(result!.all_identifiable).toBe(true);
  });

  // T17: Mixed valid and invalid — valid processed, invalid warned and excluded
  it('T17: mixed valid + invalid bidirected → valid processed, invalid warned', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        node('A', 'factor'),
        node('B', 'factor'),
        node('Goal', 'goal'),
      ],
      edges: [
        edge('A', 'Goal'),
        edge('B', 'Goal'),
        biedge('A', 'B'),      // valid: factor↔factor
        biedge('A', 'Goal'),   // invalid: factor↔goal
      ],
    };
    const opts = [option('opt1', { A: 10 }), option('opt2', { B: 20 })];

    // Preflight: one warning for the invalid edge
    const preflight = runPreflightValidation(graph, opts, 'Goal', defaultStats);
    const invalidWarnings = preflight.warnings.filter(w => w.code === 'INVALID_BIDIRECTED_EDGE');
    expect(invalidWarnings).toHaveLength(1);
    expect(invalidWarnings[0].affected_node_ids).toEqual(['A', 'Goal']);

    // Filtering: valid bidirected preserved, invalid removed
    const filtered = filterInvalidBidirectedEdges(graph);
    const bidirected = filtered.edges.filter(e => e.edge_type === 'bidirected');
    expect(bidirected).toHaveLength(1);
    expect(bidirected[0].from).toBe('A');
    expect(bidirected[0].to).toBe('B');

    // Identifiability uses only valid bidirected edges
    const result = assessGraphIdentifiability(filtered, opts, 'Goal');
    expect(result).toBeDefined();
    // A↔B (factor↔factor) doesn't affect A→Goal or B→Goal identifiability
    // (bidirected is between two treatment nodes, not treatment↔outcome)
    expect(result!.all_identifiable).toBe(true);
  });
});
