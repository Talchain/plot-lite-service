/**
 * Local Utility Function Validation
 *
 * Validates utility functions locally without ISL dependency.
 * Phase 1: Basic structural validation
 * Phase 2+: ISL-based semantic validation (conflicts, non-outcome weights)
 */

import type {
  UtilityFunction,
  UtilityValidationResult,
  UtilityValidationIssue,
} from '../../routes/v1/types/run-bundle.types.js';

interface GraphNode {
  id: string;
  kind?: string;
}

/**
 * Validate utility function locally.
 *
 * Checks:
 * - Weights sum to 1.0 (within tolerance)
 * - All referenced nodes exist in graph
 * - Weights are non-negative
 * - At least one weight is specified
 *
 * @param utility - Utility function to validate
 * @param nodes - Graph nodes for existence check
 * @returns Validation result with issues
 */
export function validateUtilityLocal(
  utility: UtilityFunction,
  nodes: GraphNode[]
): UtilityValidationResult {
  const issues: UtilityValidationIssue[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const weights = utility.weights || {};
  const weightEntries = Object.entries(weights);

  // Check at least one weight specified
  if (weightEntries.length === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_WEIGHTS',
      message: 'At least one weight must be specified in utility_function.weights',
      field: 'utility_function.weights',
    });
  }

  // Check weights sum to 1.0
  const sum = weightEntries.reduce((acc, [, w]) => acc + (w as number), 0);
  if (Math.abs(sum - 1.0) > 0.001) {
    issues.push({
      severity: 'error',
      code: 'WEIGHTS_NOT_NORMALIZED',
      message: `Weights must sum to 1.0 (got ${sum.toFixed(4)})`,
      field: 'utility_function.weights',
    });
  }

  // Check each weight
  for (const [nodeId, weight] of weightEntries) {
    // Check node exists
    if (!nodeIds.has(nodeId)) {
      issues.push({
        severity: 'error',
        code: 'NODE_NOT_FOUND',
        message: `Node '${nodeId}' not found in graph`,
        field: `utility_function.weights.${nodeId}`,
      });
    }

    // Check weight is non-negative
    if (typeof weight !== 'number' || weight < 0) {
      issues.push({
        severity: 'error',
        code: 'INVALID_WEIGHT',
        message: `Weight for '${nodeId}' must be a non-negative number`,
        field: `utility_function.weights.${nodeId}`,
      });
    }

    // Check weight is not zero (warning only)
    if (weight === 0) {
      issues.push({
        severity: 'warning',
        code: 'ZERO_WEIGHT',
        message: `Weight for '${nodeId}' is zero; node will not contribute to ranking`,
        field: `utility_function.weights.${nodeId}`,
      });
    }
  }

  // Warn if weighting non-outcome nodes
  for (const [nodeId] of weightEntries) {
    const node = nodes.find((n) => n.id === nodeId);
    if (node && node.kind && node.kind !== 'outcome' && node.kind !== 'goal') {
      issues.push({
        severity: 'info',
        code: 'NON_OUTCOME_WEIGHTED',
        message: `Node '${nodeId}' has kind '${node.kind}'; typically only outcome/goal nodes are weighted`,
        field: `utility_function.weights.${nodeId}`,
      });
    }
  }

  // Validate risk_attitude if provided
  const validAttitudes = ['risk_averse', 'risk_neutral', 'risk_seeking'];
  if (
    utility.risk_attitude &&
    !validAttitudes.includes(utility.risk_attitude)
  ) {
    issues.push({
      severity: 'error',
      code: 'INVALID_RISK_ATTITUDE',
      message: `Invalid risk_attitude '${utility.risk_attitude}'; must be one of: ${validAttitudes.join(', ')}`,
      field: 'utility_function.risk_attitude',
    });
  }

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}
