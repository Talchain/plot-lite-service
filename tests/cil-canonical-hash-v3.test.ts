/**
 * CIL C2: Canonical Hash v3 — Goal Constraints Inclusion
 *
 * Verifies that goal_constraints are included in the canonical hash (v3),
 * producing different hashes when constraints differ, and maintaining
 * backward compatibility for non-constraint requests.
 */

import { describe, it, expect } from 'vitest';
import { canonicaliseRequest, computeResponseHash } from '../src/normalisation/canonicalise.js';
import type { RunRequestV3, EngineGraphV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'factor-a', kind: 'factor', label: 'Factor A' },
    { id: 'factor-b', kind: 'factor', label: 'Factor B' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
  { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
];

function makeRequest(overrides: Partial<RunRequestV3> = {}): RunRequestV3 {
  return {
    graph: GRAPH,
    options: OPTIONS,
    goal_node_id: 'goal',
    seed: '42',
    ...overrides,
  } as RunRequestV3;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CIL C2: Canonical hash with goal_constraints', () => {
  it('produces different hashes for different goal_constraints', () => {
    const reqA = makeRequest({
      goal_constraints: [
        { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 20000 },
      ],
    });
    const reqB = makeRequest({
      goal_constraints: [
        { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 30000 },
      ],
    });

    const hashA = computeResponseHash(canonicaliseRequest(reqA, GRAPH, '42'));
    const hashB = computeResponseHash(canonicaliseRequest(reqB, GRAPH, '42'));

    expect(hashA).not.toBe(hashB);
  });

  it('produces same hash regardless of constraint order (sorted by constraint_id)', () => {
    const constraints = [
      { constraint_id: 'c1', node_id: 'goal', operator: '>=' as const, value: 20000 },
      { constraint_id: 'c2', node_id: 'factor-a', operator: '<=' as const, value: 5000 },
    ];

    const reqA = makeRequest({ goal_constraints: constraints });
    const reqB = makeRequest({ goal_constraints: [...constraints].reverse() });

    const hashA = computeResponseHash(canonicaliseRequest(reqA, GRAPH, '42'));
    const hashB = computeResponseHash(canonicaliseRequest(reqB, GRAPH, '42'));

    expect(hashA).toBe(hashB);
  });

  it('absent vs undefined goal_constraints produces consistent hash (v3 hashes differ from v2 by design)', () => {
    const reqNoConstraints = makeRequest();
    const reqUndefined = makeRequest({ goal_constraints: undefined });

    const hashA = computeResponseHash(canonicaliseRequest(reqNoConstraints, GRAPH, '42'));
    const hashB = computeResponseHash(canonicaliseRequest(reqUndefined, GRAPH, '42'));

    // Both should produce identical hashes (no constraints = no hash contribution)
    // Note: ALL v3 hashes differ from v2 due to version prefix bump — this only
    // tests that absent and undefined are treated identically within v3.
    expect(hashA).toBe(hashB);
    // Hash should be a 16-char hex string
    expect(hashA).toMatch(/^[0-9a-f]{16}$/);
  });

  it('empty goal_constraints array produces same hash as absent', () => {
    const reqEmpty = makeRequest({ goal_constraints: [] });
    const reqAbsent = makeRequest();

    const hashEmpty = computeResponseHash(canonicaliseRequest(reqEmpty, GRAPH, '42'));
    const hashAbsent = computeResponseHash(canonicaliseRequest(reqAbsent, GRAPH, '42'));

    expect(hashEmpty).toBe(hashAbsent);
  });

  it('constraint value is normalised to 12dp (float precision)', () => {
    const reqA = makeRequest({
      goal_constraints: [
        { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 20000 },
      ],
    });
    const reqB = makeRequest({
      goal_constraints: [
        { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 20000.0 },
      ],
    });

    const hashA = computeResponseHash(canonicaliseRequest(reqA, GRAPH, '42'));
    const hashB = computeResponseHash(canonicaliseRequest(reqB, GRAPH, '42'));

    expect(hashA).toBe(hashB);
  });

  it('hash version is 7 (includes version in canonical form)', () => {
    const req = makeRequest({
      goal_constraints: [
        { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 20000 },
      ],
    });

    const canonical = canonicaliseRequest(req, GRAPH, '42');
    const parsed = JSON.parse(canonical);

    // Track S: HASH_VERSION bumped 6→7 (n_samples added to canonical form).
    expect(parsed.version).toBe(7);
    expect(parsed.n_samples).toBe(4000); // PR-E: standard default depth raised 1000→4000
    expect(parsed.goal_constraints).toBeDefined();
    expect(parsed.goal_constraints).toHaveLength(1);
    expect(parsed.goal_constraints[0].constraint_id).toBe('c1');
  });
});
