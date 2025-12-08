/**
 * Graph Health / Variance Detection Helpers
 *
 * Detects conditions that cause flat/collapsed analysis results:
 * - Uniform weights: all edges have the same weight
 * - Uniform beliefs: all edges have the same belief
 * - Single path: linear chain with no branching
 */

import type { Graph, GraphEdge, GraphHealth, GraphHealthIssue } from './types.js';
import type { PLoTSensitivityResult } from '../integrations/isl/types/plot-types.js';

/** Default weight when not specified on edge */
const DEFAULT_WEIGHT = 1.0;

/** Default belief when not specified on edge */
const DEFAULT_BELIEF = 0.7;

/**
 * Detects if all edges have uniform (identical) weights
 * Returns true if all weights are the same (including defaults)
 */
export function detectUniformWeights(edges: GraphEdge[]): boolean {
  if (edges.length === 0) return false;

  const weights = edges.map((e) => e.weight ?? DEFAULT_WEIGHT);
  const uniqueWeights = new Set(weights);
  return uniqueWeights.size === 1;
}

/**
 * Detects if all edges have uniform (identical) beliefs
 * Returns true if all beliefs are the same (including defaults)
 */
export function detectUniformBeliefs(edges: GraphEdge[]): boolean {
  if (edges.length === 0) return false;

  const beliefs = edges.map((e) => e.belief ?? DEFAULT_BELIEF);
  const uniqueBeliefs = new Set(beliefs);
  return uniqueBeliefs.size === 1;
}

/**
 * Detects if graph is a single linear path (no branching)
 * A single path has at most one incoming AND one outgoing edge per node
 */
export function detectSinglePath(graph: Graph): boolean {
  if (graph.nodes.length === 0 || graph.edges.length === 0) return false;

  // Count incoming and outgoing edges per node
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    outDegree.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    outDegree.set(edge.from, (outDegree.get(edge.from) || 0) + 1);
  }

  // If any node has >1 incoming edge, there's converging (not single path)
  for (const degree of inDegree.values()) {
    if (degree > 1) return false;
  }

  // If any node has >1 outgoing edge, there's diverging (not single path)
  for (const degree of outDegree.values()) {
    if (degree > 1) return false;
  }

  return true;
}

/**
 * Builds graph health assessment from graph structure and optional ISL sensitivity
 */
export function buildGraphHealth(
  graph: Graph,
  islSensitivity?: PLoTSensitivityResult,
): GraphHealth {
  const issues: GraphHealthIssue[] = [];

  // Detect issues
  if (detectUniformWeights(graph.edges)) {
    issues.push('uniform_weights');
  }
  if (detectUniformBeliefs(graph.edges)) {
    issues.push('uniform_beliefs');
  }
  if (detectSinglePath(graph)) {
    issues.push('single_path');
  }

  // Determine variance status
  let variance_status: GraphHealth['variance_status'] = 'healthy';
  if (issues.length > 0) {
    variance_status = 'limited';
  }

  // Build suggestion based on issues
  let suggestion: string | undefined;
  if (issues.includes('uniform_weights') && issues.includes('uniform_beliefs')) {
    suggestion =
      'Vary edge weights and beliefs to reflect different influence strengths and certainties';
  } else if (issues.includes('uniform_weights')) {
    suggestion = 'Vary edge weights to reflect different influence strengths (e.g., 0.5–1.5)';
  } else if (issues.includes('uniform_beliefs')) {
    suggestion = 'Vary edge beliefs to reflect different levels of certainty (e.g., 50–100%)';
  } else if (issues.includes('single_path')) {
    suggestion = 'Add alternative paths or factors to enable meaningful variance analysis';
  }

  // Determine source
  const source: GraphHealth['source'] = islSensitivity?.source === 'isl' ? 'isl' : 'engine';

  return {
    variance_status,
    ...(issues.length > 0 ? { issues } : {}),
    ...(suggestion ? { suggestion } : {}),
    source,
  };
}
