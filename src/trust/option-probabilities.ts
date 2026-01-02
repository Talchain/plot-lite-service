/**
 * Option Probabilities - Brief A
 *
 * Computes P(goal achieved | option) for each option node in the graph.
 * Uses do-operator semantics: P(goal ≥ threshold | do(option=1))
 *
 * This enables UI to display "50% chance of achieving £20k MRR" for each option,
 * based on actual conditional probability from Monte Carlo simulation.
 */

import { computeThresholdProbability, type ThresholdProbabilityResult } from '../scm-lite/kernel.js';
import type { DAG } from '../scm-lite/types.js';
import { MAX_NODES, MAX_EDGES } from '../constants/limits.js';

/**
 * Per-option goal probability result
 */
export interface OptionProbability {
  /** P(goal achieved | do(option)) - probability [0,1] */
  goal_probability: number;
  /** Confidence in the estimate [0,1] based on binomial SE */
  confidence: number;
}

/**
 * Full result for all options
 */
export interface OptionProbabilitiesResult {
  [option_id: string]: OptionProbability;
}

/**
 * Configuration for computing option probabilities
 */
export interface OptionProbabilitiesConfig {
  /** The causal graph */
  graph: DAG;
  /** Goal node ID (must have kind: 'goal') */
  goal_node: string;
  /** Threshold value for goal achievement */
  goal_threshold: number;
  /** Random seed for reproducibility */
  seed: number;
  /** Number of Monte Carlo samples per option */
  k_samples: number;
  /** Maximum nodes allowed (default 50) */
  maxNodes?: number;
  /** Maximum edges allowed (default 200) */
  maxEdges?: number;
}

/**
 * Detect goal node from graph
 *
 * Strategy (tiered):
 * 1. Explicit goal_node parameter
 * 2. Node with kind: 'goal'
 * 3. Last node in graph (fallback)
 *
 * @param graph - The causal graph
 * @param explicitGoal - Explicitly specified goal node ID
 * @returns Goal node ID or null if not found
 */
export function detectGoalNode(graph: DAG, explicitGoal?: string): string | null {
  // 1. Explicit parameter
  if (explicitGoal) {
    const node = graph.nodes.find(n => n.id === explicitGoal);
    if (node) return explicitGoal;
  }

  // 2. Node with kind: 'goal'
  const goalNode = graph.nodes.find((n: any) => n.kind === 'goal');
  if (goalNode) return goalNode.id;

  // 3. Last node (common pattern for outcome)
  if (graph.nodes.length > 0) {
    return graph.nodes[graph.nodes.length - 1].id;
  }

  return null;
}

/**
 * Detect option nodes from graph
 *
 * Options are nodes with kind: 'option' or kind: 'action'
 *
 * @param graph - The causal graph
 * @returns Array of option nodes with id and label
 */
export function detectOptionNodes(graph: DAG): Array<{ id: string; label: string }> {
  return graph.nodes
    .filter((n: any) => n.kind === 'option' || n.kind === 'action')
    .map((n: any) => ({
      id: n.id,
      label: n.label || n.id,
    }));
}

/**
 * Detect goal threshold from graph or config
 *
 * Strategy (tiered):
 * 1. Explicit threshold parameter
 * 2. Node's threshold property
 * 3. Baseline value (default)
 *
 * @param graph - The causal graph
 * @param goalNode - Goal node ID
 * @param explicitThreshold - Explicitly specified threshold
 * @param baseline - Fallback baseline value
 * @returns Threshold value
 */
export function detectGoalThreshold(
  graph: DAG,
  goalNode: string,
  explicitThreshold?: number,
  baseline?: number
): number {
  // 1. Explicit parameter
  if (explicitThreshold !== undefined) {
    return explicitThreshold;
  }

  // 2. Node's threshold property
  const node = graph.nodes.find(n => n.id === goalNode) as any;
  if (node?.threshold !== undefined) {
    return node.threshold;
  }

  // 3. Baseline fallback
  return baseline ?? 100;
}

/**
 * Compute P(goal achieved | option) for each option in the graph
 *
 * Uses do-operator semantics: For each option, we intervene by setting
 * the option node to 1 (do(option=1)) and measure what fraction of
 * Monte Carlo samples achieve the goal threshold.
 *
 * @param config - Configuration for option probability computation
 * @returns Object mapping option_id → { goal_probability, confidence }
 */
export function computeOptionProbabilities(
  config: OptionProbabilitiesConfig
): OptionProbabilitiesResult {
  const {
    graph,
    goal_node,
    goal_threshold,
    seed,
    k_samples,
    maxNodes = MAX_NODES,
    maxEdges = MAX_EDGES,
  } = config;

  // Detect options
  const options = detectOptionNodes(graph);
  if (options.length === 0) {
    return {}; // No options to evaluate
  }

  const result: OptionProbabilitiesResult = {};

  // For each option, compute P(goal ≥ threshold | do(option=1))
  for (let i = 0; i < options.length; i++) {
    const option = options[i];

    // Unique seed per option for independent samples
    const optionSeed = seed + i + 1;

    try {
      const thresholdResult = computeThresholdProbability(
        graph,
        goal_node,
        goal_threshold,
        {
          seed: optionSeed,
          K: k_samples,
          maxNodes,
          maxEdges,
          interventions: [{ node_id: option.id, value: 1 }],
          mode: 'interventional', // do-operator semantics
        }
      );

      result[option.id] = {
        goal_probability: Math.round(thresholdResult.probability * 1000) / 1000,
        confidence: Math.round(thresholdResult.confidence * 1000) / 1000,
      };
    } catch (err) {
      // Log error but continue with other options
      // Option may be isolated or have graph issues
      result[option.id] = {
        goal_probability: 0,
        confidence: 0,
      };
    }
  }

  return result;
}
