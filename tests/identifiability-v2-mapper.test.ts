/**
 * V2 Identifiability Mapper Tests (B1.5a)
 *
 * Tests the boundary mapper (toIdentifiabilityResponse) that converts
 * internal computation results to the contracted IdentifiabilityAssessment shape.
 *
 * 10 test cases:
 * 1. Mapping: all identifiable → status 'identifiable', no details
 * 2. Mapping: partially identifiable → status 'partially_identifiable', details present
 * 3. Mapping: none identifiable → status 'not_backdoor_identifiable'
 * 4. Mapping: error (undefined input) → status 'unknown'
 * 5. Mapping: zero pairs → status 'unknown'
 * 6. Always present on response (integration)
 * 7. Always present on error path (integration)
 * 8. Details truncation at 20
 * 9. Sorting (details, confounders, adjustment_set)
 * 10. Existing B1.5 tests still pass (verified by running the full suite)
 */

import { describe, it, expect } from 'vitest';
import {
  toIdentifiabilityResponse,
  assessGraphIdentifiability,
  type InternalIdentifiabilityResult,
  type InternalPairResult,
} from '../src/trust/identifiability-v2.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(id: string): EngineGraphV3['nodes'][0] {
  return { id, label: id, kind: 'factor', observed_state: { value: 0.5 } } as EngineGraphV3['nodes'][0];
}

function edge(from: string, to: string): EngineGraphV3['edges'][0] {
  return { from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8 } as EngineGraphV3['edges'][0];
}

function option(id: string, interventions: Record<string, number>): OptionV3 {
  return { id, label: id, interventions } as OptionV3;
}

/** Build an internal pair result */
function pair(
  treatment: string,
  outcome: string,
  identifiable: boolean,
  confounders: string[] = [],
  adjustment_set: string[] = []
): InternalPairResult {
  return { treatment_node_id: treatment, outcome_node_id: outcome, identifiable, confounders, adjustment_set };
}

/** Build an internal result from pairs */
function internalResult(pairs: InternalPairResult[]): InternalIdentifiabilityResult {
  const nonId = pairs.filter((p) => !p.identifiable).length;
  return {
    all_identifiable: nonId === 0,
    pair_count: pairs.length,
    non_identifiable_count: nonId,
    pairs,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Identifiability Mapper (B1.5a)', () => {

  // =========================================================================
  // Test 1: all identifiable → status 'identifiable', no details
  // =========================================================================
  it('T1: maps all-identifiable result to status=identifiable with no details', () => {
    const internal = internalResult([
      pair('A', 'Goal', true, [], ['C']),
      pair('B', 'Goal', true, ['C'], ['C']),
    ]);

    const response = toIdentifiabilityResponse(internal);

    expect(response.status).toBe('identifiable');
    expect(response.method).toBe('backdoor');
    expect(response.pairs_checked).toBe(2);
    expect(response.pairs_identifiable).toBe(2);
    expect(response.details).toBeUndefined();
    expect(response.details_truncated).toBeUndefined();
  });

  // =========================================================================
  // Test 2: partially identifiable → status 'partially_identifiable', details present
  // =========================================================================
  it('T2: maps mixed result to status=partially_identifiable with details', () => {
    const internal = internalResult([
      pair('A', 'Goal', true, [], []),
      pair('B', 'Goal', false, ['U'], []),
    ]);

    const response = toIdentifiabilityResponse(internal);

    expect(response.status).toBe('partially_identifiable');
    expect(response.method).toBe('backdoor');
    expect(response.pairs_checked).toBe(2);
    expect(response.pairs_identifiable).toBe(1);
    expect(response.details).toBeDefined();
    expect(response.details).toHaveLength(2);

    // Check per-pair statuses
    const detailA = response.details!.find((d) => d.treatment_node_id === 'A');
    const detailB = response.details!.find((d) => d.treatment_node_id === 'B');
    expect(detailA?.status).toBe('identifiable');
    expect(detailB?.status).toBe('not_backdoor_identifiable');
    expect(detailB?.confounders).toEqual(['U']);
  });

  // =========================================================================
  // Test 3: none identifiable → status 'not_backdoor_identifiable'
  // =========================================================================
  it('T3: maps all-non-identifiable result to status=not_backdoor_identifiable', () => {
    const internal = internalResult([
      pair('A', 'Goal', false, ['U1'], []),
      pair('B', 'Goal', false, ['U2'], []),
    ]);

    const response = toIdentifiabilityResponse(internal);

    expect(response.status).toBe('not_backdoor_identifiable');
    expect(response.pairs_checked).toBe(2);
    expect(response.pairs_identifiable).toBe(0);
    expect(response.details).toHaveLength(2);
    expect(response.details!.every((d) => d.status === 'not_backdoor_identifiable')).toBe(true);
  });

  // =========================================================================
  // Test 4: error (undefined input) → status 'unknown'
  // =========================================================================
  it('T4: maps undefined (error) to status=unknown with zero counts', () => {
    const response = toIdentifiabilityResponse(undefined);

    expect(response).toEqual({
      status: 'unknown',
      method: 'backdoor',
      pairs_checked: 0,
      pairs_identifiable: 0,
    });
    expect(response.details).toBeUndefined();
  });

  // =========================================================================
  // Test 5: zero pairs → status 'unknown'
  // =========================================================================
  it('T5: maps zero-pair result to status=unknown', () => {
    const internal = internalResult([]);

    const response = toIdentifiabilityResponse(internal);

    expect(response).toEqual({
      status: 'unknown',
      method: 'backdoor',
      pairs_checked: 0,
      pairs_identifiable: 0,
    });
  });

  // =========================================================================
  // Test 6: always present on response (integration via assessGraphIdentifiability + mapper)
  // =========================================================================
  it('T6: identifiability field is always present via mapper (identifiable graph)', () => {
    const graph: EngineGraphV3 = {
      nodes: [node('A'), node('Goal')],
      edges: [edge('A', 'Goal')],
    };
    const internalRes = assessGraphIdentifiability(graph, [option('opt1', { A: 10 })], 'Goal');
    const response = toIdentifiabilityResponse(internalRes);

    // Always present — not undefined
    expect(response).toBeDefined();
    expect(response.status).toBe('identifiable');
    expect(response.method).toBe('backdoor');
    expect(response.pairs_checked).toBe(1);
    expect(response.pairs_identifiable).toBe(1);
  });

  // =========================================================================
  // Test 7: always present on error path
  // =========================================================================
  it('T7: identifiability field is present even when assessGraphIdentifiability fails', () => {
    // Force an error by passing malformed graph
    const graph = { nodes: [node('A'), node('Goal')], edges: null as any } as EngineGraphV3;
    const internalRes = assessGraphIdentifiability(graph, [option('opt1', { A: 10 })], 'Goal');

    // Internal returns undefined on error
    expect(internalRes).toBeUndefined();

    // Mapper always returns a valid object
    const response = toIdentifiabilityResponse(internalRes);
    expect(response).toBeDefined();
    expect(response.status).toBe('unknown');
    expect(response.method).toBe('backdoor');
    expect(response.pairs_checked).toBe(0);
    expect(response.pairs_identifiable).toBe(0);
  });

  // =========================================================================
  // Test 8: details truncation at 20
  // =========================================================================
  it('T8: truncates details to 20 entries and sets details_truncated=true', () => {
    // Create 25 non-identifiable pairs
    const pairs: InternalPairResult[] = [];
    for (let i = 0; i < 25; i++) {
      pairs.push(pair(`T${String(i).padStart(2, '0')}`, 'Goal', false, [`C${i}`], []));
    }
    const internal = internalResult(pairs);

    const response = toIdentifiabilityResponse(internal);

    expect(response.status).toBe('not_backdoor_identifiable');
    expect(response.pairs_checked).toBe(25);
    expect(response.pairs_identifiable).toBe(0);
    expect(response.details).toHaveLength(20);
    expect(response.details_truncated).toBe(true);
    // First entry should be T00 (sorted alphabetically)
    expect(response.details![0].treatment_node_id).toBe('T00');
    // Last entry should be T19 (truncated at 20)
    expect(response.details![19].treatment_node_id).toBe('T19');
  });

  // =========================================================================
  // Test 9: sorting (details by treatment_node_id, confounders/adjustment_set alphabetical)
  // =========================================================================
  it('T9: sorts details by treatment_node_id and arrays alphabetically', () => {
    const internal = internalResult([
      pair('Z', 'Goal', false, ['C2', 'C1', 'C3'], ['A2', 'A1']),
      pair('A', 'Goal', false, ['D2', 'D1'], ['B3', 'B1', 'B2']),
      pair('M', 'Goal', true, ['E1'], ['E1']),
    ]);

    const response = toIdentifiabilityResponse(internal);

    expect(response.details).toBeDefined();
    // Sorted by treatment_node_id
    expect(response.details!.map((d) => d.treatment_node_id)).toEqual(['A', 'M', 'Z']);
    // Confounders sorted alphabetically
    expect(response.details![0].confounders).toEqual(['D1', 'D2']);
    expect(response.details![2].confounders).toEqual(['C1', 'C2', 'C3']);
    // Adjustment set sorted alphabetically
    expect(response.details![0].adjustment_set).toEqual(['B1', 'B2', 'B3']);
    expect(response.details![2].adjustment_set).toEqual(['A1', 'A2']);
  });

  // =========================================================================
  // Test 10: Existing B1.5 tests still pass (structural verification)
  // =========================================================================
  it('T10: internal assessGraphIdentifiability still returns expected shape', () => {
    // Verify the internal function output is compatible with the mapper
    const graph: EngineGraphV3 = {
      nodes: [node('C'), node('A'), node('Goal')],
      edges: [edge('C', 'A'), edge('C', 'Goal'), edge('A', 'Goal')],
    };
    const internalRes = assessGraphIdentifiability(graph, [option('opt1', { A: 10 })], 'Goal');

    // Internal shape is preserved
    expect(internalRes).toBeDefined();
    expect(internalRes!.all_identifiable).toBe(true);
    expect(internalRes!.pair_count).toBe(1);
    expect(internalRes!.pairs[0].identifiable).toBe(true);
    expect(internalRes!.pairs[0].confounders).toContain('C');
    expect(internalRes!.pairs[0].adjustment_set).toContain('C');

    // And mapper produces valid contracted shape
    const response = toIdentifiabilityResponse(internalRes);
    expect(response.status).toBe('identifiable');
    expect(response.pairs_checked).toBe(1);
    expect(response.pairs_identifiable).toBe(1);
    expect(response.details).toBeUndefined(); // All identifiable → no details
  });

  // =========================================================================
  // Bonus: details omitted when all identifiable (even with confounders)
  // =========================================================================
  it('omits details array when all pairs are identifiable', () => {
    const internal = internalResult([
      pair('A', 'Goal', true, ['C1'], ['C1']),
      pair('B', 'Goal', true, ['C2', 'C3'], ['C2', 'C3']),
    ]);

    const response = toIdentifiabilityResponse(internal);

    expect(response.status).toBe('identifiable');
    expect(response.details).toBeUndefined();
    expect(response.details_truncated).toBeUndefined();
  });

  // =========================================================================
  // Bonus: empty confounders/adjustment_set omitted from detail
  // =========================================================================
  it('omits confounders and adjustment_set when empty', () => {
    const internal = internalResult([
      pair('A', 'Goal', false, [], []),
    ]);

    const response = toIdentifiabilityResponse(internal);

    expect(response.details).toBeDefined();
    expect(response.details![0].confounders).toBeUndefined();
    expect(response.details![0].adjustment_set).toBeUndefined();
  });
});
