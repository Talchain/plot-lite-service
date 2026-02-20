/**
 * Deterministic Sweep (B5.26)
 *
 * Post-processing pass over CEE-extracted graph nodes to detect and fix
 * LLM-fabricated goal_threshold fields. Runs after CEE extraction,
 * before ISL translation.
 *
 * Steps:
 *   4b:     fixGoalThresholdNoRaw — strip when goal_threshold_raw is absent
 *   4b-ii:  warnGoalThresholdPossiblyInferred — warn when both present + round + no digits
 *   4b-iii: stripGoalThresholdNoDigits — strip when warn fires AND label has no digits
 */

import type { RepairRecord } from '../types/engine-v3.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Node shape expected by the deterministic sweep.
 * Compatible with UpstreamNode but only requires the fields we inspect.
 */
export interface SweepNode {
  id: string;
  kind: string;
  label: string;
  goal_threshold?: number | null;
  goal_threshold_raw?: number | string | null;
  goal_threshold_unit?: string | null;
  goal_threshold_direction?: string | null;
  [key: string]: unknown;
}

export interface SweepResult {
  /** Nodes after sweep (may have fields stripped). */
  nodes: SweepNode[];
  /** Repair records for audit trail. */
  repairs: RepairRecord[];
  /** Warning codes emitted (for critiques pipeline). */
  warnings: Array<{ code: string; message: string; node_id: string }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const GOAL_THRESHOLD_FIELDS = [
  'goal_threshold',
  'goal_threshold_raw',
  'goal_threshold_unit',
  'goal_threshold_direction',
] as const;

/** Strip all 4 goal threshold fields from a node. */
function stripThresholdFields(node: SweepNode): void {
  for (const field of GOAL_THRESHOLD_FIELDS) {
    delete node[field];
  }
}

/** True if the value is a "round" number (integer or ends in .0, .5). */
function isRoundNumber(value: number | string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return false;
  // Round = integer, or ends in .0 or .5
  return Number.isInteger(n) || (n * 2) === Math.round(n * 2);
}

/** True if the label contains zero digit characters. */
function labelHasNoDigits(label: string): boolean {
  return !/\d/.test(label);
}

// ---------------------------------------------------------------------------
// Step 4b: fixGoalThresholdNoRaw
// ---------------------------------------------------------------------------

/**
 * Strip goal_threshold when goal_threshold_raw is absent.
 *
 * Rationale: If the LLM emits goal_threshold but not goal_threshold_raw,
 * there is no source evidence for the threshold — it was fabricated.
 */
export function fixGoalThresholdNoRaw(
  nodes: SweepNode[],
  repairs: RepairRecord[],
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind !== 'goal') continue;
    if (node.goal_threshold === undefined && node.goal_threshold === null) continue;
    if (node.goal_threshold === undefined) continue;

    // goal_threshold present but goal_threshold_raw absent → strip
    if (node.goal_threshold_raw === undefined || node.goal_threshold_raw === null) {
      const originalValue = node.goal_threshold;
      stripThresholdFields(node);
      repairs.push({
        field: `nodes[${i}].goal_threshold`,
        action: 'removed' as any,
        from_value: String(originalValue),
        to_value: 'stripped',
        reason: 'goal_threshold present without goal_threshold_raw — likely LLM fabrication (Step 4b)',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Step 4b-ii: warnGoalThresholdPossiblyInferred
// ---------------------------------------------------------------------------

/**
 * Predicate: returns true when goal_threshold looks possibly inferred.
 *
 * Conditions (all must hold):
 * 1. goal_threshold is present
 * 2. goal_threshold_raw is present
 * 3. goal_threshold is a round number
 * 4. Label contains no digit characters
 */
export function isGoalThresholdPossiblyInferred(node: SweepNode): boolean {
  if (node.kind !== 'goal') return false;
  if (node.goal_threshold === undefined || node.goal_threshold === null) return false;
  if (node.goal_threshold_raw === undefined || node.goal_threshold_raw === null) return false;
  if (!isRoundNumber(node.goal_threshold_raw)) return false;
  if (!labelHasNoDigits(node.label)) return false;
  return true;
}

/**
 * Emit warning when goal_threshold looks possibly inferred but both fields are present.
 * Does NOT strip — that's Step 4b-iii's job.
 */
export function warnGoalThresholdPossiblyInferred(
  nodes: SweepNode[],
  warnings: SweepResult['warnings'],
): void {
  for (const node of nodes) {
    if (isGoalThresholdPossiblyInferred(node)) {
      warnings.push({
        code: 'GOAL_THRESHOLD_POSSIBLY_INFERRED',
        message: `Goal '${node.label}' has goal_threshold=${node.goal_threshold} with raw=${node.goal_threshold_raw}, but label contains no digits — threshold may be LLM-inferred.`,
        node_id: node.id,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Step 4b-iii: stripGoalThresholdNoDigits
// ---------------------------------------------------------------------------

/**
 * Strip goal_threshold when the warn predicate fires AND the label
 * contains zero digit characters.
 *
 * This is the stronger fallback for B2-4: when the LLM fabricates both
 * goal_threshold AND goal_threshold_raw on a goal whose label has no digits,
 * strip all threshold fields.
 *
 * Coupled to warnGoalThresholdPossiblyInferred — uses the exact same
 * predicate so strip ⊆ warn (every stripped node also has a warn).
 */
export function stripGoalThresholdNoDigits(
  nodes: SweepNode[],
  repairs: RepairRecord[],
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Coupled to warn predicate — same condition set
    if (!isGoalThresholdPossiblyInferred(node)) continue;

    // AND label has no digits (already checked in isGoalThresholdPossiblyInferred,
    // but this documents the B5.26 coupling explicitly)
    if (!labelHasNoDigits(node.label)) continue;

    const originalValue = node.goal_threshold;
    stripThresholdFields(node);
    repairs.push({
      field: `nodes[${i}].goal_threshold`,
      action: 'removed' as any,
      from_value: String(originalValue),
      to_value: 'stripped',
      reason: 'GOAL_THRESHOLD_STRIPPED_NO_DIGITS: both goal_threshold and goal_threshold_raw present, but label contains no digits — LLM fabrication (Step 4b-iii)',
    });
  }
}

// ---------------------------------------------------------------------------
// Public API: runDeterministicSweep
// ---------------------------------------------------------------------------

/**
 * Run the full deterministic sweep over CEE-extracted nodes.
 *
 * Mutates nodes in-place and returns repairs + warnings for audit trail.
 */
export function runDeterministicSweep(nodes: SweepNode[]): SweepResult {
  const repairs: RepairRecord[] = [];
  const warnings: SweepResult['warnings'] = [];

  // Step 4b: strip when goal_threshold_raw absent
  fixGoalThresholdNoRaw(nodes, repairs);

  // Step 4b-ii: warn when possibly inferred (both present + round + no digits)
  warnGoalThresholdPossiblyInferred(nodes, warnings);

  // Step 4b-iii: strip when warn fires AND label has no digits
  stripGoalThresholdNoDigits(nodes, repairs);

  return { nodes, repairs, warnings };
}
