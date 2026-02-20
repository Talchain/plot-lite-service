/**
 * Deterministic Sweep Tests (B5.26)
 *
 * Verifies that the deterministic sweep correctly strips/warns for
 * LLM-fabricated goal_threshold fields based on label digit content.
 *
 * Test matrix:
 * 1. "Improve UX Quality" + threshold 0.7 + raw 70 → STRIPPED
 * 2. "Reach 800 Pro Customers" + threshold 0.8 + raw 800 → NOT stripped (label has digits)
 * 3. "Grow Revenue" + threshold, no raw → Step 4b handles (no raw → strip)
 * 4. "Achieve 20% Growth" + threshold 0.2 + raw 20 → NOT stripped (label has "20")
 * 5. "Improve UX v2" + threshold 0.7 + raw 70 → NOT stripped ("2" in label)
 * 6. repair.contract.ts allowedDrops.node includes 4 threshold fields
 */

import { describe, it, expect } from 'vitest';
import {
  runDeterministicSweep,
  fixGoalThresholdNoRaw,
  warnGoalThresholdPossiblyInferred,
  stripGoalThresholdNoDigits,
  isGoalThresholdPossiblyInferred,
} from '../src/cee/deterministic-sweep.js';
import type { SweepNode } from '../src/cee/deterministic-sweep.js';
import { allowedDrops } from '../src/cee/repair.contract.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGoalNode(
  label: string,
  threshold: number | undefined,
  raw: number | string | undefined,
  extras: Partial<SweepNode> = {}
): SweepNode {
  const node: SweepNode = {
    id: 'goal-node',
    kind: 'goal',
    label,
    ...extras,
  };
  if (threshold !== undefined) node.goal_threshold = threshold;
  if (raw !== undefined) node.goal_threshold_raw = raw;
  return node;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Deterministic sweep (B5.26)', () => {

  // Test 1: "Improve UX Quality" — no digits in label → stripped + repair
  it('strips threshold when label has no digits (Step 4b-iii)', () => {
    const nodes: SweepNode[] = [
      makeGoalNode('Improve UX Quality', 0.7, 70, {
        goal_threshold_unit: '%',
      }),
    ];

    const result = runDeterministicSweep(nodes);

    // Threshold fields should be stripped
    expect(nodes[0].goal_threshold).toBeUndefined();
    expect(nodes[0].goal_threshold_raw).toBeUndefined();
    expect(nodes[0].goal_threshold_unit).toBeUndefined();
    expect(nodes[0].goal_threshold_direction).toBeUndefined();

    // Repair emitted with GOAL_THRESHOLD_STRIPPED_NO_DIGITS
    const stripRepair = result.repairs.find(r =>
      r.reason.includes('GOAL_THRESHOLD_STRIPPED_NO_DIGITS')
    );
    expect(stripRepair).toBeDefined();
    expect(stripRepair!.field).toBe('nodes[0].goal_threshold');
    expect(stripRepair!.action).toBe('removed');

    // Warning also emitted (warn ⊇ strip)
    const warn = result.warnings.find(w =>
      w.code === 'GOAL_THRESHOLD_POSSIBLY_INFERRED'
    );
    expect(warn).toBeDefined();
    expect(warn!.node_id).toBe('goal-node');
  });

  // Test 2: "Reach 800 Pro Customers" — label has digits → NOT stripped
  it('does NOT strip when label has digits ("800")', () => {
    const nodes: SweepNode[] = [
      makeGoalNode('Reach 800 Pro Customers', 0.8, 800, {
        goal_threshold_unit: 'customers',
      }),
    ];

    const result = runDeterministicSweep(nodes);

    // Threshold fields preserved
    expect(nodes[0].goal_threshold).toBe(0.8);
    expect(nodes[0].goal_threshold_raw).toBe(800);
    expect(nodes[0].goal_threshold_unit).toBe('customers');

    // No strip repair
    const stripRepair = result.repairs.find(r =>
      r.reason.includes('GOAL_THRESHOLD_STRIPPED_NO_DIGITS')
    );
    expect(stripRepair).toBeUndefined();

    // No warn either (label has digits → predicate doesn't fire)
    expect(result.warnings).toHaveLength(0);
  });

  // Test 3: "Grow Revenue" — threshold present, raw absent → Step 4b handles
  it('Step 4b strips when goal_threshold_raw is absent', () => {
    const nodes: SweepNode[] = [
      makeGoalNode('Grow Revenue', 0.5, undefined),
    ];

    const result = runDeterministicSweep(nodes);

    // Step 4b strips because raw is absent
    expect(nodes[0].goal_threshold).toBeUndefined();

    // Repair from Step 4b (not 4b-iii)
    const repair = result.repairs.find(r =>
      r.reason.includes('Step 4b')
    );
    expect(repair).toBeDefined();

    // No GOAL_THRESHOLD_STRIPPED_NO_DIGITS (that's 4b-iii, doesn't fire)
    const stripNoDigits = result.repairs.find(r =>
      r.reason.includes('GOAL_THRESHOLD_STRIPPED_NO_DIGITS')
    );
    expect(stripNoDigits).toBeUndefined();
  });

  // Test 4: "Achieve 20% Growth" — label has "20" → NOT stripped
  it('does NOT strip when label contains digits ("20%")', () => {
    const nodes: SweepNode[] = [
      makeGoalNode('Achieve 20% Growth', 0.2, 20),
    ];

    const result = runDeterministicSweep(nodes);

    // Preserved — label has digits
    expect(nodes[0].goal_threshold).toBe(0.2);
    expect(nodes[0].goal_threshold_raw).toBe(20);

    // No strip repair
    expect(result.repairs.filter(r =>
      r.reason.includes('GOAL_THRESHOLD_STRIPPED_NO_DIGITS')
    )).toHaveLength(0);

    // No warn (label has digits)
    expect(result.warnings).toHaveLength(0);
  });

  // Test 5: "Improve UX v2" — "2" in label blocks strip
  it('"Improve UX v2" — "2" in label blocks strip (acceptable false negative)', () => {
    const nodes: SweepNode[] = [
      makeGoalNode('Improve UX v2', 0.7, 70, {
        goal_threshold_unit: '%',
      }),
    ];

    const result = runDeterministicSweep(nodes);

    // NOT stripped — "2" in "v2" makes /\d/.test() return true
    expect(nodes[0].goal_threshold).toBe(0.7);
    expect(nodes[0].goal_threshold_raw).toBe(70);
    expect(nodes[0].goal_threshold_unit).toBe('%');

    // No GOAL_THRESHOLD_STRIPPED_NO_DIGITS repair
    expect(result.repairs.filter(r =>
      r.reason.includes('GOAL_THRESHOLD_STRIPPED_NO_DIGITS')
    )).toHaveLength(0);

    // No warn either — label has digit "2"
    // This is an acceptable trade-off: false negatives (not stripping)
    // are safer than false positives (stripping legitimate thresholds).
    expect(result.warnings).toHaveLength(0);
  });

  // Test 6: repair.contract.ts includes 4 threshold fields
  it('repair.contract.ts allowedDrops.node includes all 4 threshold fields', () => {
    expect(allowedDrops.node).toContain('goal_threshold');
    expect(allowedDrops.node).toContain('goal_threshold_raw');
    expect(allowedDrops.node).toContain('goal_threshold_unit');
    expect(allowedDrops.node).toContain('goal_threshold_direction');
    expect(allowedDrops.node).toHaveLength(4);
  });

  // ----- Unit tests for predicates -----

  it('isGoalThresholdPossiblyInferred returns correct values', () => {
    // Should return true: goal, has threshold, has raw, raw is round, no digits in label
    expect(isGoalThresholdPossiblyInferred(
      makeGoalNode('Improve Quality', 0.7, 70)
    )).toBe(true);

    // Should return false: label has digits
    expect(isGoalThresholdPossiblyInferred(
      makeGoalNode('Reach 100 Users', 0.8, 100)
    )).toBe(false);

    // Should return false: non-round raw value
    expect(isGoalThresholdPossiblyInferred(
      makeGoalNode('Improve Quality', 0.73, 73.2)
    )).toBe(false);

    // Should return false: not a goal node
    const factorNode: SweepNode = {
      id: 'factor', kind: 'factor', label: 'Some Factor',
      goal_threshold: 0.5, goal_threshold_raw: 50,
    };
    expect(isGoalThresholdPossiblyInferred(factorNode)).toBe(false);
  });
});
