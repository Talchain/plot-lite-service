/**
 * Non-linear Edge Functions
 *
 * Transforms edge values based on function_type and function_params.
 * Used in inference to model non-linear relationships between nodes.
 *
 * Function Types:
 * - linear: y = x (default, identity function)
 * - diminishing_returns: y = 1 - e^(-k*x) — saturates at high input values
 * - threshold: y = 0 if x < t, else slope * (x - t) — step with optional slope
 * - s_curve: y = 1 / (1 + e^(-k*(x - m))) — logistic/sigmoid transition
 */

import type { GraphEdge, EdgeFunctionType, EdgeFunctionParams } from '../trust/types.js';

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
 */
export function validateEdgeFunctionParams(
  edge: GraphEdge
): EdgeFunctionValidationError | null {
  const edgeId = `${edge.from}->${edge.to}`;
  const functionType = edge.function_type ?? 'linear';
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
 * Apply edge function to transform a value based on the edge's function configuration.
 *
 * This is a pure function - deterministic and side-effect free.
 *
 * @param value - Input value to transform
 * @param edge - Edge containing function_type and function_params
 * @returns Transformed value
 */
export function applyEdgeFunction(value: number, edge: GraphEdge): number {
  const functionType: EdgeFunctionType = edge.function_type ?? 'linear';
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
 */
export function validateGraphEdgeFunctions(
  edges: GraphEdge[]
): EdgeFunctionValidationError[] {
  const errors: EdgeFunctionValidationError[] = [];

  for (const edge of edges) {
    if (edge.function_type && edge.function_type !== 'linear') {
      const error = validateEdgeFunctionParams(edge);
      if (error) {
        errors.push(error);
      }
    }
  }

  return errors;
}
