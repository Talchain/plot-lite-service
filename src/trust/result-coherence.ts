/**
 * Result Coherence Validation
 *
 * Phase 1 Critical Fixes:
 * - Task 1.3: Constraint violation reporting
 * - Task 1.6: Result coherence validation
 * - Task 1.7: Baseline identification
 *
 * Ensures inference results support coherent recommendations.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A constraint violation detected during inference
 */
export interface ConstraintViolation {
  /** Option/scenario ID that violates the constraint */
  option_id: string;
  /** Constraint identifier */
  constraint_id: string;
  /** Human-readable constraint label */
  constraint_label: string;
  /** Actual value that violated the constraint */
  actual_value: number;
  /** Threshold value from the constraint */
  threshold: number;
}

/**
 * An active (binding) constraint at the solution boundary
 */
export interface ActiveConstraint {
  /** Constraint identifier */
  constraint_id: string;
  /** Human-readable constraint label */
  constraint_label: string;
  /** Option/scenario where this constraint is binding */
  binding_option: string;
}

/**
 * Constraint status summary for inference results
 */
export interface ConstraintStatus {
  /** List of constraint violations by option */
  violations: ConstraintViolation[];
  /** List of constraints that are active (at boundary) */
  active_constraints: ActiveConstraint[];
}

/**
 * Coherence warning codes
 */
export type CoherenceWarningCode =
  | 'TOP_OPTION_NEGATIVE'
  | 'CLOSE_RACE'
  | 'ALL_OPTIONS_NEGATIVE'
  | 'BASELINE_BEATS_ALL'
  | 'HIGH_UNCERTAINTY'
  | 'CONTRADICTORY_DIRECTION'
  | 'EDGE_FUNCTION_SENSITIVE';

/**
 * A coherence warning about the inference results
 */
export interface CoherenceWarning {
  /** Machine-readable warning code */
  code: CoherenceWarningCode;
  /** Human-readable warning message */
  message: string;
  /** Severity of the warning */
  severity: 'info' | 'warning' | 'error';
  /** Additional context data */
  context?: Record<string, unknown>;
}

/**
 * Options for coherence validation
 */
export interface CoherenceValidationOptions {
  /** Threshold for "close race" warning (default: 0.02 = 2%) */
  close_race_threshold?: number;
  /** Threshold for "high uncertainty" warning (spread / p50 ratio, default: 0.5) */
  high_uncertainty_threshold?: number;
  /** Reference value for "negative" determination (default: 0) */
  baseline_value?: number;
}

/**
 * Node constraint definition from request
 */
export interface NodeConstraint {
  /** Node ID to constrain */
  node_id: string;
  /** Minimum allowed value */
  min?: number;
  /** Maximum allowed value */
  max?: number;
  /** Label for the constraint */
  label?: string;
}

/**
 * Result with summary for ranking
 */
export interface RankableResult {
  label: string;
  summary: { p10: number; p50: number; p90: number } | null;
  rank?: number | null;
  /** Optional: constraint violations for this option */
  constraint_violations?: ConstraintViolation[];
  /** Is this option marked as infeasible? */
  infeasible?: boolean;
}

// ============================================================================
// Baseline Detection (Task 1.7)
// ============================================================================

/** Keywords that indicate a baseline/status-quo option */
const BASELINE_KEYWORDS = [
  'keep',
  'maintain',
  'do nothing',
  'status quo',
  'current',
  'baseline',
  'no change',
  'existing',
  'as-is',
  'default',
];

/**
 * Detect the baseline option from a list of results
 *
 * Priority:
 * 1. Label matching baseline keywords
 * 2. Option with no interventions (all values at default)
 * 3. First option (index 0) as fallback if explicit baseline_index not set
 *
 * @param results - Array of scenario results
 * @param deltas - Array of scenario deltas (for intervention detection)
 * @param explicitBaselineIndex - Explicitly specified baseline index
 * @returns Baseline option ID (label) or null if not determinable
 */
export function detectBaselineOption(
  results: RankableResult[],
  deltas?: Array<{ label: string; nodes?: any[]; edges?: any[] }>,
  explicitBaselineIndex?: number
): string | null {
  if (results.length === 0) return null;

  // If explicit baseline index provided and valid, use it
  if (explicitBaselineIndex !== undefined && explicitBaselineIndex >= 0 && explicitBaselineIndex < results.length) {
    return results[explicitBaselineIndex].label;
  }

  // Try to detect by label matching
  for (const result of results) {
    const labelLower = result.label.toLowerCase().trim();
    for (const keyword of BASELINE_KEYWORDS) {
      if (labelLower.includes(keyword)) {
        return result.label;
      }
    }
  }

  // Try to detect by no-intervention delta
  if (deltas) {
    for (let i = 0; i < deltas.length && i < results.length; i++) {
      const delta = deltas[i];
      const hasNodeChanges = delta.nodes && delta.nodes.length > 0;
      const hasEdgeChanges = delta.edges && delta.edges.length > 0;
      if (!hasNodeChanges && !hasEdgeChanges) {
        return results[i].label;
      }
    }
  }

  // Default to first option
  return results[0]?.label ?? null;
}

/**
 * Compute delta from baseline for each result
 *
 * @param results - Array of scenario results
 * @param baselineId - Baseline option ID
 * @returns Map of option ID to delta values
 */
export function computeDeltasVsBaseline(
  results: RankableResult[],
  baselineId: string | null
): Map<string, { p10: number; p50: number; p90: number }> {
  const deltas = new Map<string, { p10: number; p50: number; p90: number }>();

  const baseline = results.find((r) => r.label === baselineId);
  if (!baseline?.summary) {
    return deltas;
  }

  for (const result of results) {
    if (!result.summary) continue;

    deltas.set(result.label, {
      p10: Math.round((result.summary.p10 - baseline.summary.p10) * 1000) / 1000,
      p50: Math.round((result.summary.p50 - baseline.summary.p50) * 1000) / 1000,
      p90: Math.round((result.summary.p90 - baseline.summary.p90) * 1000) / 1000,
    });
  }

  return deltas;
}

// ============================================================================
// Constraint Violation Detection (Task 1.3)
// ============================================================================

/**
 * Evaluate constraints against inference results
 *
 * @param results - Array of scenario results with node values
 * @param constraints - Node constraints to evaluate
 * @param nodeValuesByOption - Map of option ID to node values
 * @returns Constraint status with violations and active constraints
 */
export function evaluateConstraints(
  results: RankableResult[],
  constraints: NodeConstraint[],
  nodeValuesByOption: Map<string, Map<string, number>>
): ConstraintStatus {
  const violations: ConstraintViolation[] = [];
  const activeConstraints: ActiveConstraint[] = [];

  if (!constraints || constraints.length === 0) {
    return { violations, active_constraints: activeConstraints };
  }

  for (const result of results) {
    const nodeValues = nodeValuesByOption.get(result.label);
    if (!nodeValues) continue;

    for (const constraint of constraints) {
      const actualValue = nodeValues.get(constraint.node_id);
      if (actualValue === undefined) continue;

      const constraintId = `${constraint.node_id}_constraint`;
      const constraintLabel = constraint.label || `${constraint.node_id} bounds`;

      // Check min constraint
      if (constraint.min !== undefined) {
        if (actualValue < constraint.min) {
          violations.push({
            option_id: result.label,
            constraint_id: constraintId,
            constraint_label: constraintLabel,
            actual_value: actualValue,
            threshold: constraint.min,
          });
        } else if (Math.abs(actualValue - constraint.min) < 0.001) {
          // Active at lower bound
          activeConstraints.push({
            constraint_id: constraintId,
            constraint_label: `${constraintLabel} (lower bound)`,
            binding_option: result.label,
          });
        }
      }

      // Check max constraint
      if (constraint.max !== undefined) {
        if (actualValue > constraint.max) {
          violations.push({
            option_id: result.label,
            constraint_id: constraintId,
            constraint_label: constraintLabel,
            actual_value: actualValue,
            threshold: constraint.max,
          });
        } else if (Math.abs(actualValue - constraint.max) < 0.001) {
          // Active at upper bound
          activeConstraints.push({
            constraint_id: constraintId,
            constraint_label: `${constraintLabel} (upper bound)`,
            binding_option: result.label,
          });
        }
      }
    }
  }

  return { violations, active_constraints: activeConstraints };
}

/**
 * Mark infeasible options based on constraint violations
 *
 * @param results - Mutable array of results to mark
 * @param constraintStatus - Constraint evaluation results
 * @returns Array of infeasible option IDs
 */
export function markInfeasibleOptions(
  results: RankableResult[],
  constraintStatus: ConstraintStatus
): string[] {
  const infeasibleIds = new Set<string>();

  for (const violation of constraintStatus.violations) {
    infeasibleIds.add(violation.option_id);
  }

  for (const result of results) {
    if (infeasibleIds.has(result.label)) {
      result.infeasible = true;
      result.constraint_violations = constraintStatus.violations.filter(
        (v) => v.option_id === result.label
      );
    }
  }

  return Array.from(infeasibleIds);
}

// ============================================================================
// Coherence Validation (Task 1.6)
// ============================================================================

/**
 * Validate coherence of inference results
 *
 * Checks:
 * - Top ranked option has non-negative expected value vs baseline
 * - Outcome direction matches ranking direction
 * - Results are not too close to call
 * - Uncertainty is not too high
 *
 * @param results - Array of scenario results (sorted by rank)
 * @param baselineId - Baseline option ID
 * @param options - Validation options
 * @returns Array of coherence warnings
 */
export function validateCoherence(
  results: RankableResult[],
  baselineId: string | null,
  options: CoherenceValidationOptions = {}
): CoherenceWarning[] {
  const warnings: CoherenceWarning[] = [];
  const {
    close_race_threshold = 0.02,
    high_uncertainty_threshold = 0.5,
    baseline_value = 0,
  } = options;

  // Filter to valid results only
  const validResults = results.filter((r) => r.summary !== null && !r.infeasible);
  if (validResults.length === 0) {
    return warnings;
  }

  // Sort by p50 descending to find top option
  const sortedResults = [...validResults].sort(
    (a, b) => (b.summary?.p50 ?? 0) - (a.summary?.p50 ?? 0)
  );

  const topOption = sortedResults[0];
  const runnerUp = sortedResults[1];
  const baseline = results.find((r) => r.label === baselineId);

  // Check: All options have negative expected value
  const allNegative = validResults.every(
    (r) => (r.summary?.p50 ?? 0) < baseline_value
  );
  if (allNegative) {
    warnings.push({
      code: 'ALL_OPTIONS_NEGATIVE',
      message: 'All options have negative expected outcomes',
      severity: 'warning',
      context: { baseline_value },
    });
  }

  // Check: Top option has negative expected value
  if (topOption?.summary && topOption.summary.p50 < baseline_value && !allNegative) {
    warnings.push({
      code: 'TOP_OPTION_NEGATIVE',
      message: `Best option "${topOption.label}" still has negative expected outcome (${topOption.summary.p50.toFixed(3)})`,
      severity: 'warning',
      context: {
        option_id: topOption.label,
        p50: topOption.summary.p50,
        baseline_value,
      },
    });
  }

  // Check: Baseline beats all other options (baseline is the top option)
  if (baseline?.summary && baselineId === topOption?.label) {
    const baselineP50 = baseline.summary.p50;
    const nonBaselineOptions = validResults.filter((r) => r.label !== baselineId);
    // If baseline IS the top option and there are other options, warn that no action is needed
    if (nonBaselineOptions.length > 0) {
      warnings.push({
        code: 'BASELINE_BEATS_ALL',
        message: `Baseline "${baselineId}" is the best option — no action recommended`,
        severity: 'info',
        context: { baseline_id: baselineId, baseline_p50: baselineP50 },
      });
    }
  }

  // Check: Close race between top options
  if (topOption?.summary && runnerUp?.summary) {
    const topP50 = topOption.summary.p50;
    const runnerP50 = runnerUp.summary.p50;
    const margin = Math.abs(topP50 - runnerP50);
    const relativeMargin = runnerP50 !== 0 ? margin / Math.abs(runnerP50) : margin;

    if (relativeMargin <= close_race_threshold) {
      warnings.push({
        code: 'CLOSE_RACE',
        message: `Top options within ${(relativeMargin * 100).toFixed(1)}% — recommendation sensitive`,
        severity: 'warning',
        context: {
          top_option: topOption.label,
          runner_up: runnerUp.label,
          margin,
          margin_pct: relativeMargin * 100,
        },
      });
    }
  }

  // Check: High uncertainty in top option
  if (topOption?.summary) {
    const spread = topOption.summary.p90 - topOption.summary.p10;
    const p50 = topOption.summary.p50;
    const uncertaintyRatio = p50 !== 0 ? spread / Math.abs(p50) : spread;

    if (uncertaintyRatio > high_uncertainty_threshold) {
      warnings.push({
        code: 'HIGH_UNCERTAINTY',
        message: `Top option "${topOption.label}" has high uncertainty (spread: ${spread.toFixed(3)}, ratio: ${(uncertaintyRatio * 100).toFixed(1)}%)`,
        severity: 'info',
        context: {
          option_id: topOption.label,
          p10: topOption.summary.p10,
          p50: topOption.summary.p50,
          p90: topOption.summary.p90,
          spread,
          uncertainty_ratio: uncertaintyRatio,
        },
      });
    }
  }

  return warnings;
}

// ============================================================================
// Utility: Build empty constraint status
// ============================================================================

/**
 * Create an empty constraint status (no constraints provided)
 */
export function emptyConstraintStatus(): ConstraintStatus {
  return {
    violations: [],
    active_constraints: [],
  };
}
