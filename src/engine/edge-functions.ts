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
 * - noisy_or: P(Y=1) = 1 - (1-leak) * ∏(1 - w_i * X_i) — generative causes with leak
 * - noisy_and_not: P(Y=1) = base_rate * ∏(1 - w_i * X_i) — preventative causes
 * - logistic: P(Y=1) = 1 / (1 + e^(-k*(X - threshold))) — continuous→binary transitions
 *
 * Brief 17: SCM Enhancements
 * - noisy_or now supports leak parameter (default 0.01) for background probability
 * - noisy_and_not models preventative causes where active parents reduce probability
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
      // Validate leak parameter if provided (optional, default 0.01)
      if (params.leak !== undefined) {
        if (params.leak < 0 || params.leak > 1) {
          return {
            code: 'INVALID_FUNCTION_PARAMS',
            field: 'function_params.leak',
            message: `leak must be in range [0, 1] (got ${params.leak})`,
            edge_id: edgeId,
          };
        }
      }
      // Validation of binary nodes happens at graph level
      return null;

    case 'noisy_and_not':
      // Noisy-AND-NOT requires flag to be enabled
      if (!FLAGS.ENABLE_NOISY_AND_NOT) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_type',
          message: `noisy_and_not is disabled. Set ENABLE_NOISY_AND_NOT=true to enable.`,
          edge_id: edgeId,
        };
      }
      // base_rate is required for noisy_and_not
      if (params.base_rate === undefined) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_params.base_rate',
          message: `noisy_and_not requires base_rate parameter`,
          edge_id: edgeId,
        };
      }
      if (params.base_rate < 0 || params.base_rate > 1) {
        return {
          code: 'INVALID_FUNCTION_PARAMS',
          field: 'function_params.base_rate',
          message: `base_rate must be in range [0, 1] (got ${params.base_rate})`,
          edge_id: edgeId,
        };
      }
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
 * Apply Noisy-AND-NOT function for a single parent contribution.
 *
 * Noisy-AND-NOT models PREVENTATIVE causes where active parents REDUCE probability.
 * Formula: P(Y=1 | parents) = base_rate * ∏(1 - w_i * X_i)
 *
 * Use cases:
 * - "Safety training reduces accident probability"
 * - "Competitor entry reduces market share"
 * - "Hedging reduces downside risk"
 *
 * This function computes a single term: 1 - w * x
 * which represents the "preventative power" of one parent.
 *
 * The full Noisy-AND-NOT multiplies all these terms with base_rate
 * (done at the node aggregation level via aggregateNoisyAndNot).
 *
 * @param x - Parent state (typically 0 or 1 for binary nodes)
 * @param weight - Edge weight interpreted as preventative power (0-1)
 * @returns Contribution factor (1 when parent=0, 1-weight when parent=1)
 */
function applyNoisyAndNot(x: number, weight: number): number {
  // For binary inputs (0 or 1), the standard formula applies
  // For continuous inputs, we treat x as probability P(parent=1)

  // Clamp x to [0, 1] for probability interpretation
  const probX = Math.max(0, Math.min(1, x));
  // Clamp weight to [0, 1] for preventative power interpretation
  const preventativePower = Math.max(0, Math.min(1, weight));

  // Return the "prevention factor" for this parent
  // When parent is inactive (x=0): factor = 1 (no prevention)
  // When parent is active (x=1): factor = 1 - weight (reduces probability)
  return 1 - preventativePower * probX;
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

    case 'noisy_and_not': {
      // Noisy-AND-NOT uses weight as preventative power
      const weight = edge.weight ?? 1;
      return applyNoisyAndNot(value, weight);
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
 * Noisy-OR with leak: P(Y=1 | parents) = 1 - (1 - leak) * ∏(1 - activation_i)
 *
 * Each activation_i is the result of applyNoisyOr(parent_value, edge_weight)
 * representing the probability that parent_i causes Y=1.
 *
 * The leak parameter (default 0.01) represents background probability that Y=1
 * even when all parents are inactive (0). This aligns with Pearl's SCM framework.
 *
 * Behaviour:
 * - leak = 0: Pure Noisy-OR (backward compatible)
 * - leak = 0.01: 1% background probability (sensible default)
 * - leak = 0.1: 10% background probability (high leak)
 *
 * @param activations - Array of individual parent activation probabilities
 * @param leak - Background probability Y=1 when all parents are 0 (default: 0.01)
 * @returns Combined probability P(Y=1)
 */
export function aggregateNoisyOr(activations: number[], leak: number = 0.01): number {
  // Clamp leak to [0, 1]
  const clampedLeak = Math.max(0, Math.min(1, leak));

  if (activations.length === 0) {
    // No parents → P(Y=1) = leak (background probability)
    return clampedLeak;
  }

  // Compute product of (1 - activation_i)
  // This is P(Y NOT activated by any parent)
  let productNotActivated = 1;
  for (const activation of activations) {
    // Clamp activation to [0, 1]
    const clampedActivation = Math.max(0, Math.min(1, activation));
    productNotActivated *= (1 - clampedActivation);
  }

  // P(Y=1) = 1 - (1 - leak) * P(Y not activated by any parent)
  return 1 - (1 - clampedLeak) * productNotActivated;
}

/**
 * Aggregate multiple Noisy-AND-NOT contributions into final probability.
 *
 * Noisy-AND-NOT: P(Y=1 | parents) = base_rate * ∏(1 - w_i * X_i)
 *
 * Each factor_i is the result of applyNoisyAndNot(parent_value, edge_weight)
 * representing the "survival probability" after parent_i's preventative effect.
 *
 * Use cases for preventative causes:
 * - "Safety training (w=0.5) reduces accident probability (base_rate=0.3)"
 * - "Competitor entry (w=0.7) reduces market share (base_rate=0.8)"
 * - "Hedging (w=0.9) reduces downside risk (base_rate=0.4)"
 *
 * @param factors - Array of individual prevention factors from applyNoisyAndNot
 * @param baseRate - Probability Y=1 when no preventative parents are active (required)
 * @returns Combined probability P(Y=1)
 */
export function aggregateNoisyAndNot(factors: number[], baseRate: number): number {
  // Clamp baseRate to [0, 1]
  const clampedBaseRate = Math.max(0, Math.min(1, baseRate));

  if (factors.length === 0) {
    // No preventative parents → P(Y=1) = base_rate
    return clampedBaseRate;
  }

  // Compute product of all prevention factors
  let productFactors = 1;
  for (const factor of factors) {
    // Clamp factor to [0, 1]
    const clampedFactor = Math.max(0, Math.min(1, factor));
    productFactors *= clampedFactor;
  }

  // P(Y=1) = base_rate * product_of_factors
  return clampedBaseRate * productFactors;
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
 * - noisy_or: All connected nodes must be binary (generative causes)
 * - noisy_and_not: All connected nodes must be binary (preventative causes)
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

    if (functionType === 'noisy_or' || functionType === 'noisy_and_not') {
      // All connected nodes must be binary for noisy_or and noisy_and_not
      const sourceNode = nodeMap.get(edge.from);
      const targetNode = nodeMap.get(edge.to);
      const funcName = functionType === 'noisy_or' ? 'noisy_or' : 'noisy_and_not';

      if (sourceNode && !isNodeBinary(sourceNode)) {
        errors.push({
          code: 'INVALID_NODE_CONSTRAINT',
          edge_id: edgeId,
          message: `${funcName} requires binary source node, but '${edge.from}' is not binary`,
          constraint: 'binary_parent',
        });
      }

      if (targetNode && !isNodeBinary(targetNode)) {
        errors.push({
          code: 'INVALID_NODE_CONSTRAINT',
          edge_id: edgeId,
          message: `${funcName} requires binary target node, but '${edge.to}' is not binary`,
          constraint: 'binary_target',
        });
      }
    }

    // Note: logistic target validation is advisory - the logistic function
    // transforms continuous input to binary output (0-1 probability)
  }

  return errors;
}
