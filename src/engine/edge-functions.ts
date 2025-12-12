/**
 * Non-linear Edge Functions
 *
 * Transforms edge values based on function_type/functional_form and function_params.
 * Used in inference to model non-linear relationships between nodes.
 *
 * EdgeV1 Function Types:
 * - linear: y = x (default, identity function)
 * - diminishing_returns: y = 1 - e^(-k*x) — saturates at high input values
 * - threshold: y = 0 if x < t, else slope * (x - t) — step with optional slope
 * - s_curve: y = 1 / (1 + e^(-k*(x - m))) — logistic/sigmoid transition
 *
 * EdgeV2 Additions (flag-gated):
 * - noisy_or: P(Y=1) = 1 - ∏(1 - w_i * X_i) — for binary nodes with multiple binary parents
 * - logistic: P(Y=1) = 1 / (1 + e^(-k*(X - threshold))) — continuous→binary transitions
 */

import type { GraphEdge, EdgeFunctionType, EdgeFunctionParams, FunctionalForm } from '../trust/types.js';
import { FLAGS } from '../config/flags.js';
import { getFunctionalForm } from './edge-migration.js';

/**
 * Validation error for edge function parameters
 */
export interface EdgeFunctionValidationError {
  code: 'INVALID_FUNCTION_PARAMS';
  field: string;
  message: string;
  edge_id: string;
}

/**
 * Validate edge function parameters based on function type.
 * Returns null if valid, or an error object if invalid.
 *
 * Supports both EdgeV1 (function_type) and EdgeV2 (functional_form).
 */
export function validateEdgeFunctionParams(
  edge: GraphEdge
): EdgeFunctionValidationError | null {
  const edgeId = edge.id ?? `${edge.from}->${edge.to}`;
  // Support both EdgeV1 (function_type) and EdgeV2 (functional_form)
  const functionType = getFunctionalForm(edge);
  const params = edge.function_params ?? {};

  switch (functionType) {
    case 'linear':
      // No parameters required
      return null;

    case 'diminishing_returns':
      if (params.k === undefined) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_params.k',
          message: `diminishing_returns requires k parameter`,
          edge_id: edgeId,
        };
      }
      if (params.k <= 0) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_params.k',
          message: `k must be > 0 for diminishing_returns (got ${params.k})`,
          edge_id: edgeId,
        };
      }
      return null;

    case 'threshold':
      if (params.threshold === undefined) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_params.threshold',
          message: `threshold function requires threshold parameter`,
          edge_id: edgeId,
        };
      }
      return null;

    case 's_curve':
      if (params.k === undefined) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_params.k',
          message: `s_curve requires k parameter`,
          edge_id: edgeId,
        };
      }
      if (params.k <= 0) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_params.k',
          message: `k must be > 0 for s_curve (got ${params.k})`,
          edge_id: edgeId,
        };
      }
      if (params.midpoint === undefined) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_params.midpoint',
          message: `s_curve requires midpoint parameter`,
          edge_id: edgeId,
        };
      }
      return null;

    case 'noisy_or':
      // Noisy-OR requires flag to be enabled
      if (!FLAGS.ENABLE_NOISY_OR) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_type',
          message: `noisy_or is disabled. Set ENABLE_NOISY_OR=true to enable.`,
          edge_id: edgeId,
        };
      }
      // No additional parameters required for noisy_or
      // Validation of binary nodes happens at graph level
      return null;

    case 'logistic':
      // Logistic requires flag to be enabled
      if (!FLAGS.ENABLE_LOGISTIC) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_type',
          message: `logistic is disabled. Set ENABLE_LOGISTIC=true to enable.`,
          edge_id: edgeId,
        };
      }
      if (params.k === undefined) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_params.k',
          message: `logistic requires k parameter (steepness)`,
          edge_id: edgeId,
        };
      }
      if (params.k <= 0) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_params.k',
          message: `k must be > 0 for logistic (got ${params.k})`,
          edge_id: edgeId,
        };
      }
      if (params.threshold === undefined) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_params.threshold',
          message: `logistic requires threshold parameter`,
          edge_id: edgeId,
        };
      }
      return null;

    default:
      return {
        code: 'INVALID_FUNCTION_PARAMS',
        field: 'function_type',
        message: `Unknown function_type: ${functionType}`,
        edge_id: edgeId,
      };
  }
}

/**
 * Apply linear function (identity).
 * y = x
 */
function applyLinear(x: number): number {
  return x;
}

/**
 * Apply diminishing returns function.
 * y = 1 - e^(-k*x)
 *
 * Starts at 0, approaches 1 asymptotically as x increases.
 * Rate k controls how quickly it approaches saturation.
 */
function applyDiminishingReturns(x: number, k: number): number {
  // Handle edge cases
  if (x <= 0) return 0;
  if (!Number.isFinite(k) || k <= 0) return x; // Fallback to linear

  return 1 - Math.exp(-k * x);
}

/**
 * Apply threshold function.
 * y = 0 if x < threshold, else slope * (x - threshold)
 *
 * Step function with optional post-threshold slope.
 */
function applyThreshold(x: number, threshold: number, slope: number): number {
  if (x < threshold) return 0;
  return slope * (x - threshold);
}

/**
 * Apply S-curve (logistic/sigmoid) function.
 * y = 1 / (1 + e^(-k*(x - midpoint)))
 *
 * Smooth transition from 0 to 1, centered at midpoint.
 * Rate k controls steepness of transition.
 */
function applyScurve(x: number, k: number, midpoint: number): number {
  // Handle edge cases
  if (!Number.isFinite(k) || k <= 0) return x; // Fallback to linear

  const exponent = -k * (x - midpoint);
  // Prevent overflow for very large exponents
  if (exponent > 700) return 0;
  if (exponent < -700) return 1;

  return 1 / (1 + Math.exp(exponent));
}

/**
 * Apply Noisy-OR function for a single parent contribution.
 *
 * Noisy-OR computes: P(Y=1 | parents) = 1 - ∏(1 - w_i * X_i)
 *
 * This function computes a single term: 1 - w * x
 * which represents the probability that this parent does NOT cause Y=1.
 *
 * The full Noisy-OR is computed by multiplying all these terms together
 * and subtracting from 1 (done at the node aggregation level).
 *
 * For a single edge: returns the "causal power" contribution
 * w * x where w is edge weight (interpreted as causal power) and x is parent state.
 *
 * @param x - Parent state (typically 0 or 1 for binary nodes)
 * @param weight - Edge weight interpreted as causal power (0-1)
 * @returns Contribution to Noisy-OR (value that will contribute to NOT causing Y)
 */
function applyNoisyOr(x: number, weight: number): number {
  // For binary inputs (0 or 1), the standard Noisy-OR applies
  // For continuous inputs, we treat x as probability P(parent=1)

  // Clamp x to [0, 1] for probability interpretation
  const probX = Math.max(0, Math.min(1, x));
  // Clamp weight to [0, 1] for causal power interpretation
  const causalPower = Math.max(0, Math.min(1, weight));

  // Return the "activation probability" for this parent
  // This is P(Y activated by this parent) = causal_power * P(parent=1)
  return causalPower * probX;
}

/**
 * Apply Logistic function for continuous→binary transitions.
 * P(Y=1 | X) = 1 / (1 + e^(-k * (X - threshold)))
 *
 * Similar to s_curve but specifically for binary outcomes.
 * The threshold parameter is the transition point where P(Y=1) = 0.5.
 *
 * @param x - Continuous input value
 * @param k - Steepness parameter (higher = sharper transition)
 * @param threshold - Value of x where P(Y=1) = 0.5
 * @returns Probability of Y=1 (range 0-1)
 */
function applyLogistic(x: number, k: number, threshold: number): number {
  // Handle edge cases
  if (!Number.isFinite(k) || k <= 0) return x > threshold ? 1 : 0; // Fallback to hard threshold

  const exponent = -k * (x - threshold);
  // Prevent overflow for very large exponents
  if (exponent > 700) return 0;
  if (exponent < -700) return 1;

  return 1 / (1 + Math.exp(exponent));
}

/**
 * Apply edge function to transform a value based on the edge's function configuration.
 *
 * This is a pure function - deterministic and side-effect free.
 * Supports both EdgeV1 (function_type) and EdgeV2 (functional_form) schemas.
 *
 * @param value - Input value to transform
 * @param edge - Edge containing function_type/functional_form and function_params
 * @returns Transformed value
 */
export function applyEdgeFunction(value: number, edge: GraphEdge): number {
  // Support both EdgeV1 (function_type) and EdgeV2 (functional_form)
  const functionType: FunctionalForm = getFunctionalForm(edge);
  const params: EdgeFunctionParams = edge.function_params ?? {};

  switch (functionType) {
    case 'linear':
      return applyLinear(value);

    case 'diminishing_returns': {
      const k = params.k ?? 1;
      return applyDiminishingReturns(value, k);
    }

    case 'threshold': {
      const threshold = params.threshold ?? 0;
      const slope = params.slope ?? 1;
      return applyThreshold(value, threshold, slope);
    }

    case 's_curve': {
      const k = params.k ?? 1;
      const midpoint = params.midpoint ?? 0;
      return applyScurve(value, k, midpoint);
    }

    case 'noisy_or': {
      // Noisy-OR uses weight as causal power
      const weight = edge.weight ?? 1;
      return applyNoisyOr(value, weight);
    }

    case 'logistic': {
      const k = params.k ?? 1;
      const threshold = params.threshold ?? 0;
      return applyLogistic(value, k, threshold);
    }

    default:
      // Unknown function type - fallback to linear
      return applyLinear(value);
  }
}

/**
 * Apply edge function with weight scaling.
 *
 * Combines the edge's weight with the non-linear function transformation.
 * Formula: weight * applyEdgeFunction(value, edge)
 *
 * @param value - Input value to transform
 * @param edge - Edge containing weight, function_type, and function_params
 * @returns Weighted transformed value
 */
export function applyWeightedEdgeFunction(value: number, edge: GraphEdge): number {
  const weight = edge.weight ?? 1;
  const transformedValue = applyEdgeFunction(value, edge);
  return weight * transformedValue;
}

/**
 * Validate all edges in a graph and return any validation errors.
 * Supports both EdgeV1 (function_type) and EdgeV2 (functional_form).
 */
export function validateGraphEdgeFunctions(
  edges: GraphEdge[]
): EdgeFunctionValidationError[] {
  const errors: EdgeFunctionValidationError[] = [];

  for (const edge of edges) {
    const functionType = getFunctionalForm(edge);
    if (functionType !== 'linear') {
      const error = validateEdgeFunctionParams(edge);
      if (error) {
        errors.push(error);
      }
    }
  }

  return errors;
}

/**
 * Aggregate multiple Noisy-OR contributions into final probability.
 *
 * Noisy-OR: P(Y=1 | parents) = 1 - ∏(1 - activation_i)
 *
 * Each activation_i is the result of applyNoisyOr(parent_value, edge_weight)
 * representing the probability that parent_i causes Y=1.
 *
 * @param activations - Array of individual parent activation probabilities
 * @returns Combined probability P(Y=1)
 */
export function aggregateNoisyOr(activations: number[]): number {
  if (activations.length === 0) {
    return 0; // No parents → P(Y=1) = 0
  }

  // Compute product of (1 - activation_i)
  // This is P(Y NOT activated by any parent)
  let productNotActivated = 1;
  for (const activation of activations) {
    // Clamp activation to [0, 1]
    const clampedActivation = Math.max(0, Math.min(1, activation));
    productNotActivated *= (1 - clampedActivation);
  }

  // P(Y=1) = 1 - P(Y not activated by any parent)
  return 1 - productNotActivated;
}

/**
 * Validation error for node constraints on functional forms
 */
export interface NodeConstraintError {
  code: 'INVALID_NODE_CONSTRAINT';
  edge_id: string;
  message: string;
  constraint: 'binary_parent' | 'binary_target' | 'binary_all';
}

/**
 * Check if a node is binary (has only 0/1 values or is marked as binary)
 *
 * @param node - Node to check
 * @returns true if node is binary
 */
export function isNodeBinary(node: { kind?: string; value?: number }): boolean {
  // If kind is set to specific binary kinds
  if (node.kind === 'option' || node.kind === 'decision') {
    return true;
  }

  // If value is 0 or 1
  if (node.value !== undefined) {
    return node.value === 0 || node.value === 1;
  }

  // Default to not binary (continuous assumed)
  return false;
}

/**
 * Validate node constraints for functional forms.
 *
 * - noisy_or: All connected nodes must be binary
 * - logistic: Target must be binary (or will become binary after transform)
 *
 * @param edges - Edges to validate
 * @param nodeMap - Map of node ID to node object
 * @returns Array of constraint violations
 */
export function validateNodeConstraints(
  edges: GraphEdge[],
  nodeMap: Map<string, { kind?: string; value?: number }>
): NodeConstraintError[] {
  const errors: NodeConstraintError[] = [];

  for (const edge of edges) {
    const functionType = getFunctionalForm(edge);
    const edgeId = edge.id ?? `${edge.from}->${edge.to}`;

    if (functionType === 'noisy_or') {
      // All connected nodes must be binary for noisy_or
      const sourceNode = nodeMap.get(edge.from);
      const targetNode = nodeMap.get(edge.to);

      if (sourceNode && !isNodeBinary(sourceNode)) {
        errors.push({
          code: 'INVALID_NODE_CONSTRAINT',
          edge_id: edgeId,
          message: `noisy_or requires binary source node, but '${edge.from}' is not binary`,
          constraint: 'binary_parent',
        });
      }

      if (targetNode && !isNodeBinary(targetNode)) {
        errors.push({
          code: 'INVALID_NODE_CONSTRAINT',
          edge_id: edgeId,
          message: `noisy_or requires binary target node, but '${edge.to}' is not binary`,
          constraint: 'binary_target',
        });
      }
    }

    // Note: logistic target validation is advisory - the logistic function
    // transforms continuous input to binary output (0-1 probability)
  }

  return errors;
}
