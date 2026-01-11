/**
 * Correlation-Based Sampling for Factor Nodes
 *
 * Phase 3: Model Enhancements - Consume ISL Correlation Groups
 *
 * Implements correlated sampling using Cholesky decomposition to generate
 * jointly distributed random values that respect correlation structure.
 *
 * Key Features:
 * - Cholesky decomposition for correlation matrix → lower triangular L
 * - Correlated samples: Y = L × Z where Z ~ N(0, I)
 * - Positive semi-definite validation with numerical tolerance
 * - Fallback to independent sampling if decomposition fails
 */

import type { CorrelationGroup } from '../trust/types.js';

/**
 * Result of correlation matrix validation
 */
export interface CorrelationValidationResult {
  /** Is the matrix valid for use? */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Warning messages (e.g., near-singular) */
  warnings: string[];
  /** Was the matrix repaired? */
  repaired: boolean;
  /** Repaired matrix (if applicable) */
  repaired_matrix?: number[][];
}

/**
 * Result of correlated sampling
 */
export interface CorrelatedSampleResult {
  /** Sampled values by node ID */
  values: Map<string, number>;
  /** Was fallback used? */
  used_fallback: boolean;
  /** Fallback reason if applicable */
  fallback_reason?: string;
}

/**
 * Configuration for correlation sampling
 */
export interface CorrelationSamplingConfig {
  /** Tolerance for positive semi-definite check (default: 1e-8) */
  psd_tolerance?: number;
  /** Minimum eigenvalue allowed (default: -1e-6) */
  min_eigenvalue?: number;
  /** Enable matrix repair for near-PSD matrices (default: true) */
  enable_repair?: boolean;
}

const DEFAULT_CONFIG: Required<CorrelationSamplingConfig> = {
  psd_tolerance: 1e-8,
  min_eigenvalue: -1e-6,
  enable_repair: true,
};

/**
 * Seeded pseudo-random number generator using Mulberry32
 * Provides deterministic random numbers for reproducibility
 */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    // Initialize state from seed (ensure non-zero)
    this.state = (seed >>> 0) || 1;
  }

  /**
   * Generate next random number in [0, 1)
   */
  next(): number {
    // Mulberry32 algorithm - proven to produce values in [0, 1)
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generate standard normal using Box-Muller transform
   */
  nextNormal(): number {
    // Ensure u1 is not 0 to avoid log(0)
    let u1 = this.next();
    while (u1 === 0) {
      u1 = this.next();
    }
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Generate vector of standard normal values
   */
  nextNormalVector(n: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
      result.push(this.nextNormal());
    }
    return result;
  }
}

/**
 * Check if a matrix is symmetric within tolerance
 */
export function isSymmetric(matrix: number[][], tolerance = 1e-10): boolean {
  const n = matrix.length;
  for (let i = 0; i < n; i++) {
    if (matrix[i].length !== n) return false;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(matrix[i][j] - matrix[j][i]) > tolerance) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Check if a matrix has valid diagonal (all 1s for correlation matrix)
 */
export function hasValidDiagonal(matrix: number[][], tolerance = 1e-10): boolean {
  for (let i = 0; i < matrix.length; i++) {
    if (Math.abs(matrix[i][i] - 1.0) > tolerance) {
      return false;
    }
  }
  return true;
}

/**
 * Compute eigenvalues of a symmetric matrix using power iteration
 * Simplified implementation for positive semi-definite check
 *
 * @param matrix - Symmetric matrix
 * @returns Array of approximate eigenvalues (sorted descending)
 */
export function approximateEigenvalues(matrix: number[][]): number[] {
  const n = matrix.length;
  if (n === 0) return [];
  if (n === 1) return [matrix[0][0]];

  // For small matrices, use Gershgorin circle theorem bounds
  // This gives us conservative bounds without full eigendecomposition
  const eigenvalues: number[] = [];

  for (let i = 0; i < n; i++) {
    // Gershgorin circle: eigenvalue within [aii - ri, aii + ri]
    // where ri = sum of |aij| for j != i
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        rowSum += Math.abs(matrix[i][j]);
      }
    }
    // Conservative minimum eigenvalue estimate
    eigenvalues.push(matrix[i][i] - rowSum);
  }

  return eigenvalues.sort((a, b) => b - a);
}

/**
 * Check if a matrix is positive semi-definite
 *
 * Uses Cholesky decomposition attempt as definitive test.
 */
export function isPositiveSemiDefinite(
  matrix: number[][],
  tolerance = 1e-8
): boolean {
  try {
    choleskyDecomposition(matrix, tolerance);
    return true;
  } catch {
    return false;
  }
}

/**
 * Perform Cholesky decomposition: A = L × L^T
 *
 * @param matrix - Symmetric positive semi-definite matrix
 * @param tolerance - Numerical tolerance for near-zero values
 * @returns Lower triangular matrix L
 * @throws Error if matrix is not positive semi-definite
 */
export function choleskyDecomposition(
  matrix: number[][],
  tolerance = 1e-8
): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;

      if (i === j) {
        // Diagonal elements
        for (let k = 0; k < j; k++) {
          sum += L[j][k] * L[j][k];
        }
        const diag = matrix[i][i] - sum;

        if (diag < -tolerance) {
          throw new Error(
            `Matrix is not positive semi-definite: diagonal element ${i} would be ${diag}`
          );
        }

        L[i][j] = Math.sqrt(Math.max(0, diag));
      } else {
        // Off-diagonal elements
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[j][k];
        }

        if (L[j][j] === 0) {
          L[i][j] = 0;
        } else {
          L[i][j] = (matrix[i][j] - sum) / L[j][j];
        }
      }
    }
  }

  return L;
}

/**
 * Multiply lower triangular matrix L by vector z
 *
 * @param L - Lower triangular matrix
 * @param z - Vector of standard normal values
 * @returns Correlated vector y = L × z
 */
export function multiplyLowerTriangular(L: number[][], z: number[]): number[] {
  const n = L.length;
  const y: number[] = Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      y[i] += L[i][j] * z[j];
    }
  }

  return y;
}

/**
 * Validate a correlation matrix for use in sampling
 *
 * @param matrix - Correlation matrix to validate
 * @param config - Validation configuration
 * @returns Validation result with optional repaired matrix
 */
export function validateCorrelationMatrix(
  matrix: number[][],
  config: CorrelationSamplingConfig = {}
): CorrelationValidationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const warnings: string[] = [];
  const n = matrix.length;

  // Check empty matrix
  if (n === 0) {
    return { valid: false, error: 'Empty correlation matrix', warnings, repaired: false };
  }

  // Check square matrix
  for (let i = 0; i < n; i++) {
    if (!matrix[i] || matrix[i].length !== n) {
      return {
        valid: false,
        error: `Matrix is not square: row ${i} has ${matrix[i]?.length ?? 0} elements, expected ${n}`,
        warnings,
        repaired: false,
      };
    }
  }

  // Check symmetry
  if (!isSymmetric(matrix)) {
    return { valid: false, error: 'Correlation matrix is not symmetric', warnings, repaired: false };
  }

  // Check diagonal
  if (!hasValidDiagonal(matrix)) {
    warnings.push('Diagonal elements not all 1.0 - may affect correlation interpretation');
  }

  // Check element bounds
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i][j] < -1 || matrix[i][j] > 1) {
        return {
          valid: false,
          error: `Correlation value out of range [-1, 1]: matrix[${i}][${j}] = ${matrix[i][j]}`,
          warnings,
          repaired: false,
        };
      }
    }
  }

  // Check positive semi-definiteness
  if (!isPositiveSemiDefinite(matrix, cfg.psd_tolerance)) {
    if (cfg.enable_repair) {
      // Attempt to repair by adjusting eigenvalues
      const repaired = repairCorrelationMatrix(matrix, cfg.min_eigenvalue);
      if (repaired) {
        warnings.push('Matrix repaired to ensure positive semi-definiteness');
        return { valid: true, warnings, repaired: true, repaired_matrix: repaired };
      }
    }
    return {
      valid: false,
      error: 'Correlation matrix is not positive semi-definite',
      warnings,
      repaired: false,
    };
  }

  return { valid: true, warnings, repaired: false };
}

/**
 * Attempt to repair a correlation matrix to make it positive semi-definite
 *
 * Uses nearPD algorithm: iteratively project onto PSD cone
 * Simplified version that adjusts near-zero eigenvalues
 *
 * @param matrix - Original correlation matrix
 * @param minEigenvalue - Minimum eigenvalue to enforce
 * @returns Repaired matrix or null if repair failed
 */
export function repairCorrelationMatrix(
  matrix: number[][],
  minEigenvalue = 0
): number[][] | null {
  const n = matrix.length;

  // Simple repair: ensure diagonal is 1 and make symmetric
  const repaired: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      if (i === j) {
        repaired[i][j] = 1.0;
      } else {
        // Average the off-diagonal elements to ensure symmetry
        const avg = (matrix[i][j] + matrix[j][i]) / 2;
        // Clamp to valid correlation range
        const clamped = Math.max(-0.99, Math.min(0.99, avg));
        repaired[i][j] = clamped;
        repaired[j][i] = clamped;
      }
    }
  }

  // Check if repair was successful
  if (isPositiveSemiDefinite(repaired)) {
    return repaired;
  }

  // More aggressive repair: reduce off-diagonal correlations
  const shrinkFactor = 0.95;
  for (let attempt = 0; attempt < 10; attempt++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        repaired[i][j] *= shrinkFactor;
        repaired[j][i] = repaired[i][j];
      }
    }

    if (isPositiveSemiDefinite(repaired)) {
      return repaired;
    }
  }

  return null;
}

/**
 * Generate correlated samples for a correlation group
 *
 * @param group - Correlation group definition
 * @param rng - Seeded random number generator
 * @param config - Sampling configuration
 * @returns Correlated sample result
 */
export function sampleCorrelatedGroup(
  group: CorrelationGroup,
  rng: SeededRNG,
  config: CorrelationSamplingConfig = {}
): CorrelatedSampleResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const values = new Map<string, number>();

  const n = group.node_ids.length;

  // Validate matrix first
  const validation = validateCorrelationMatrix(group.correlation_matrix, cfg);

  if (!validation.valid) {
    // Fallback to independent sampling
    for (const nodeId of group.node_ids) {
      values.set(nodeId, rng.nextNormal());
    }
    return {
      values,
      used_fallback: true,
      fallback_reason: validation.error || 'Invalid correlation matrix',
    };
  }

  // Use repaired matrix if available
  const matrix = validation.repaired_matrix || group.correlation_matrix;

  try {
    // Cholesky decomposition
    const L = choleskyDecomposition(matrix, cfg.psd_tolerance);

    // Generate independent standard normal vector
    const z = rng.nextNormalVector(n);

    // Transform to correlated vector
    const y = multiplyLowerTriangular(L, z);

    // Map values to node IDs
    for (let i = 0; i < n; i++) {
      values.set(group.node_ids[i], y[i]);
    }

    return { values, used_fallback: false };
  } catch (error) {
    // Fallback to independent sampling
    for (const nodeId of group.node_ids) {
      values.set(nodeId, rng.nextNormal());
    }
    return {
      values,
      used_fallback: true,
      fallback_reason: error instanceof Error ? error.message : 'Cholesky decomposition failed',
    };
  }
}

/**
 * Sample all correlation groups in a graph
 *
 * @param groups - Correlation groups from graph
 * @param seed - Random seed for reproducibility
 * @param config - Sampling configuration
 * @returns Map of node ID to sampled value
 */
export function sampleAllCorrelationGroups(
  groups: CorrelationGroup[],
  seed: number,
  config: CorrelationSamplingConfig = {}
): {
  values: Map<string, number>;
  fallback_groups: string[];
  warnings: string[];
} {
  const rng = new SeededRNG(seed);
  const values = new Map<string, number>();
  const fallbackGroups: string[] = [];
  const warnings: string[] = [];

  for (const group of groups) {
    const result = sampleCorrelatedGroup(group, rng, config);

    // Merge values
    for (const [nodeId, value] of result.values) {
      values.set(nodeId, value);
    }

    if (result.used_fallback) {
      fallbackGroups.push(group.group_id);
      warnings.push(
        `Correlation group "${group.group_id}" used independent sampling: ${result.fallback_reason}`
      );
    }
  }

  return { values, fallback_groups: fallbackGroups, warnings };
}

/**
 * Validate all correlation groups in a graph
 *
 * @param groups - Correlation groups to validate
 * @param nodeIds - Set of valid node IDs in the graph
 * @returns Validation errors (empty if all valid)
 */
export function validateCorrelationGroups(
  groups: CorrelationGroup[],
  nodeIds: Set<string>
): string[] {
  const errors: string[] = [];

  for (const group of groups) {
    // Check that node IDs exist in graph
    for (const nodeId of group.node_ids) {
      if (!nodeIds.has(nodeId)) {
        errors.push(
          `Correlation group "${group.group_id}" references unknown node: ${nodeId}`
        );
      }
    }

    // Check matrix dimensions match node count
    const n = group.node_ids.length;
    if (group.correlation_matrix.length !== n) {
      errors.push(
        `Correlation group "${group.group_id}" matrix dimensions (${group.correlation_matrix.length}) ` +
          `don't match node count (${n})`
      );
    }

    // Validate matrix structure
    const validation = validateCorrelationMatrix(group.correlation_matrix);
    if (!validation.valid) {
      errors.push(`Correlation group "${group.group_id}": ${validation.error}`);
    }
  }

  return errors;
}
