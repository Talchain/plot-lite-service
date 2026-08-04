/**
 * Edge Function Sensitivity Analysis
 *
 * Phase 3: Model Enhancements - Task 4.3
 *
 * Analyzes how sensitive inference results are to edge function type choices.
 * After inference, tests alternative edge functions on high-sensitivity edges
 * and reports when ranking would change.
 */

import type { Graph, EdgeFunctionType } from '../trust/types.js';
import type { CoherenceWarning, CoherenceWarningCode } from '../trust/result-coherence.js';
import { applyEdgeFunction } from './edge-functions.js';

/**
 * Edge sensitivity data for analysis
 */
export interface EdgeSensitivityData {
  edge_id: string;
  from: string;
  to: string;
  score: number;
  current_function: EdgeFunctionType;
}

/**
 * Result of testing an alternative edge function
 */
export interface AlternativeTestResult {
  edge_id: string;
  original_function: EdgeFunctionType;
  alternative_function: EdgeFunctionType;
  original_p50: number;
  alternative_p50: number;
  delta_pct: number;
  ranking_changed: boolean;
}

/**
 * Edge function sensitivity analysis result
 */
export interface EdgeFunctionSensitivityResult {
  /** Edges tested */
  edges_tested: number;
  /** Edges where alternative function changes result significantly */
  sensitive_edges: number;
  /** Detailed results for each tested edge */
  test_results: AlternativeTestResult[];
  /** Generated coherence warnings */
  warnings: CoherenceWarning[];
}

/**
 * Configuration for edge function sensitivity analysis
 */
export interface EdgeFunctionSensitivityConfig {
  /** Number of top sensitivity edges to test (default: 3) */
  top_n_edges?: number;
  /** Threshold for significant change (default: 0.05 = 5%) */
  significance_threshold?: number;
  /** Alternative functions to test */
  alternatives?: EdgeFunctionType[];
}

/** Default alternatives to test (excluding the current function) */
const DEFAULT_ALTERNATIVES: EdgeFunctionType[] = ['linear', 'diminishing_returns', 'threshold'];

/** Default configuration */
const DEFAULT_CONFIG: Required<EdgeFunctionSensitivityConfig> = {
  top_n_edges: 3,
  significance_threshold: 0.05,
  alternatives: DEFAULT_ALTERNATIVES,
};

/**
 * Get top N edges by sensitivity score
 *
 * @param edges - Graph edges with sensitivity data
 * @param topN - Number of edges to return
 * @returns Top N edges sorted by sensitivity
 */
export function getTopSensitiveEdges(
  edges: Array<{ from: string; to: string; weight?: number; belief?: number; function_type?: EdgeFunctionType }>,
  topN: number
): EdgeSensitivityData[] {
  const scored = edges.map((edge) => {
    const weight = edge.weight ?? 1;
    const belief = edge.belief ?? 0.7;
    const score = Math.abs(weight) * belief;

    return {
      edge_id: `${edge.from}->${edge.to}`,
      from: edge.from,
      to: edge.to,
      score,
      current_function: edge.function_type ?? 'linear',
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topN);
}

/**
 * Create a modified graph with an edge's function type changed
 *
 * @param graph - Original graph
 * @param edgeId - Edge to modify (from->to format)
 * @param newFunction - New function type to apply
 * @returns Modified graph (deep copy)
 */
export function createGraphWithAlternativeFunction(
  graph: Graph,
  edgeId: string,
  newFunction: EdgeFunctionType
): Graph {
  const [fromId, toId] = edgeId.split('->');

  return {
    ...graph,
    nodes: [...graph.nodes],
    edges: graph.edges.map((edge) => {
      if (edge.from === fromId && edge.to === toId) {
        return {
          ...edge,
          function_type: newFunction,
          // Provide default params for the new function type
          function_params: getDefaultParamsForFunction(newFunction),
        };
      }
      return edge;
    }),
  };
}

/**
 * Get default parameters for a function type
 */
function getDefaultParamsForFunction(
  functionType: EdgeFunctionType
): Record<string, number> | undefined {
  switch (functionType) {
    case 'linear':
      return undefined;
    case 'diminishing_returns':
      return { k: 1 };
    case 'threshold':
      return { threshold: 0.5, slope: 1 };
    case 's_curve':
      return { k: 1, midpoint: 0.5 };
    default:
      return undefined;
  }
}

/**
 * Simulate outcome with a specific edge function (simplified estimation)
 *
 * This provides a quick estimate of how changing an edge function affects
 * the outcome without running full Monte Carlo inference.
 *
 * @param graph - Graph with nodes and edges
 * @param outcomeNode - Target outcome node
 * @param baselineValue - Baseline outcome value
 * @returns Estimated outcome value
 */
export function estimateOutcomeWithGraph(
  graph: Graph,
  outcomeNode: string,
  baselineValue: number
): number {
  const node = graph.nodes.find((n) => n.id === outcomeNode);
  if (!node) return baselineValue;

  const incomingEdges = graph.edges.filter((e) => e.to === outcomeNode);

  if (incomingEdges.length === 0) {
    const nodeValue = (node as any).value ?? 0.5;
    return baselineValue * (0.8 + nodeValue * 0.4);
  }

  let totalInfluence = 0;
  let totalWeight = 0;

  for (const edge of incomingEdges) {
    const parentNode = graph.nodes.find((n) => n.id === edge.from);
    if (parentNode) {
      const parentValue = (parentNode as any).value ?? 0.5;
      const edgeWeight = edge.weight ?? 1.0;
      const transformedValue = applyEdgeFunction(parentValue, edge);
      totalInfluence += transformedValue * edgeWeight;
      totalWeight += edgeWeight;
    }
  }

  const avgInfluence = totalWeight > 0 ? totalInfluence / totalWeight : 0.5;
  const nodeValue = (node as any).value ?? 0.5;
  const combinedValue = nodeValue * 0.3 + avgInfluence * 0.7;

  return baselineValue * (0.8 + combinedValue * 0.4);
}

/**
 * Analyze sensitivity of results to edge function choices
 *
 * Tests alternative edge functions on high-sensitivity edges and
 * reports when results would change significantly.
 *
 * @param graph - Graph with nodes and edges
 * @param outcomeNode - Target outcome node
 * @param originalP50 - Original inference p50 result
 * @param config - Analysis configuration
 * @returns Sensitivity analysis result with warnings
 */
export function analyzeEdgeFunctionSensitivity(
  graph: Graph,
  outcomeNode: string,
  originalP50: number,
  config: EdgeFunctionSensitivityConfig = {}
): EdgeFunctionSensitivityResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const testResults: AlternativeTestResult[] = [];
  const warnings: CoherenceWarning[] = [];

  // Get top sensitive edges
  const topEdges = getTopSensitiveEdges(graph.edges, cfg.top_n_edges);

  // Test each edge with alternative functions
  for (const edge of topEdges) {
    for (const altFunction of cfg.alternatives) {
      // Skip if this is the current function
      if (altFunction === edge.current_function) {
        continue;
      }

      // Create graph with alternative function
      const altGraph = createGraphWithAlternativeFunction(graph, edge.edge_id, altFunction);

      // Estimate outcome with alternative
      const altP50 = estimateOutcomeWithGraph(altGraph, outcomeNode, originalP50);

      // Calculate change
      const deltaPct =
        originalP50 !== 0
          ? Math.abs(altP50 - originalP50) / Math.abs(originalP50)
          : Math.abs(altP50 - originalP50);

      const isSignificant = deltaPct >= cfg.significance_threshold;

      testResults.push({
        edge_id: edge.edge_id,
        original_function: edge.current_function,
        alternative_function: altFunction,
        original_p50: originalP50,
        alternative_p50: Math.round(altP50 * 1000) / 1000,
        delta_pct: Math.round(deltaPct * 1000) / 10, // Store as percentage
        ranking_changed: isSignificant,
      });
    }
  }

  // Count sensitive edges (edges where any alternative caused significant change)
  const sensitiveEdgeIds = new Set<string>();
  for (const result of testResults) {
    if (result.ranking_changed) {
      sensitiveEdgeIds.add(result.edge_id);
    }
  }

  // Generate warnings for sensitive edges
  for (const edgeId of sensitiveEdgeIds) {
    const relevantResults = testResults.filter(
      (r) => r.edge_id === edgeId && r.ranking_changed
    );
    const maxDelta = Math.max(...relevantResults.map((r) => r.delta_pct));
    const alternatives = relevantResults.map((r) => r.alternative_function).join(', ');

    warnings.push({
      code: 'EDGE_FUNCTION_SENSITIVE' as CoherenceWarningCode,
      message: `Results sensitive to "${edgeId}" function type (up to ${maxDelta.toFixed(1)}% change with ${alternatives})`,
      severity: 'warning',
      context: {
        edge_id: edgeId,
        max_delta_pct: maxDelta,
        alternatives_tested: alternatives,
      },
    });
  }

  return {
    edges_tested: topEdges.length,
    sensitive_edges: sensitiveEdgeIds.size,
    test_results: testResults,
    warnings,
  };
}

/**
 * Quick check if edge function sensitivity analysis should run
 *
 * @param graph - Graph to check
 * @returns True if analysis should be performed
 */
export function shouldAnalyzeEdgeFunctionSensitivity(graph: Graph): boolean {
  // Only analyze if there are edges with non-linear functions or high weights
  const hasNonLinearEdges = graph.edges.some(
    (e) => e.function_type && e.function_type !== 'linear'
  );
  const hasHighWeightEdges = graph.edges.some(
    (e) => Math.abs(e.weight ?? 1) >= 0.5
  );

  return hasNonLinearEdges || hasHighWeightEdges;
}
