/**
 * Normalisation Parity Tests
 *
 * Verifies that /v1/validate-patch and /v2/run produce identical normalisation
 * results when given the same graph input. Both endpoints call
 * normaliseGraphWithRepairs() from the shared normaliser.
 *
 * Also verifies repair code coverage for canonical REPAIR_CODES.
 */

import { describe, it, expect } from 'vitest';
import { normaliseGraphWithRepairs } from '../src/normalisation/normalise-and-repair.js';
import { REPAIR_CODES } from '../src/normalisation/repair-codes.js';
import type { RepairCode } from '../src/normalisation/repair-codes.js';
import { deriveStd, normaliseEdge } from '../src/normalisation/graph-normaliser.js';
import * as fs from 'node:fs';

// =============================================================================
// Parity: same graph → identical normalised output
// =============================================================================

describe('Normalisation parity', () => {
  it('produces identical normalised graph for a well-formed graph', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'Factor A' },
        { id: 'b', kind: 'factor', label: 'Factor B' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        { from: 'b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.15 } },
      ],
    };

    const r1 = normaliseGraphWithRepairs(graph);
    const r2 = normaliseGraphWithRepairs(graph);

    expect(JSON.stringify(r1.graph)).toBe(JSON.stringify(r2.graph));
    expect(JSON.stringify(r1.repairs)).toBe(JSON.stringify(r2.repairs));
  });

  it('produces identical normalised output for graph with missing exists_probability', () => {
    const graph = {
      nodes: [
        { id: 'x', kind: 'factor', label: 'X' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'x', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    const r1 = normaliseGraphWithRepairs(graph);
    const r2 = normaliseGraphWithRepairs(graph);

    expect(JSON.stringify(r1.graph)).toBe(JSON.stringify(r2.graph));
    expect(JSON.stringify(r1.repairs)).toBe(JSON.stringify(r2.repairs));

    // Normalised graph should have exists_probability = 0.8
    const edge = r1.graph.edges.find(e => e.from === 'x' && e.to === 'goal');
    expect(edge?.exists_probability).toBe(0.8);
  });

  it('normalised graph is deterministic (sorted repairs, stable output)', () => {
    const graph = {
      nodes: [
        { id: 'risk1', kind: 'risk', label: 'Risk 1' },
        { id: 'factor1', kind: 'factor', label: 'Factor 1' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        // Triggers: DEFAULT_EXISTS_PROBABILITY, INFER_EFFECT_DIRECTION (risk→positive mean)
        { from: 'risk1', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
        // Triggers: DEFAULT_EXISTS_PROBABILITY
        { from: 'factor1', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
      ],
    };

    // Run 3 times to verify determinism
    const results = [1, 2, 3].map(() => normaliseGraphWithRepairs(graph));
    const jsons = results.map(r => JSON.stringify({ graph: r.graph, repairs: r.repairs }));

    expect(jsons[0]).toBe(jsons[1]);
    expect(jsons[1]).toBe(jsons[2]);
  });
});

// =============================================================================
// Repair code coverage
// =============================================================================

describe('Repair code coverage', () => {
  it('DEFAULT_EXISTS_PROBABILITY: edge without exists_probability', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.DEFAULT_EXISTS_PROBABILITY);
  });

  it('CLAMP_EXISTS_PROBABILITY: exists_probability > 1', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 1.5, strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.CLAMP_EXISTS_PROBABILITY);
    const edge = result.graph.edges.find(e => e.from === 'a');
    expect(edge?.exists_probability).toBe(1);
  });

  it('CLAMP_STRENGTH_MEAN: mean > 1', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 2.5, std: 0.1 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.CLAMP_STRENGTH_MEAN);
    const edge = result.graph.edges.find(e => e.from === 'a');
    expect(edge?.strength.mean).toBe(1);
  });

  it('CLAMP_STRENGTH_STD: std below floor (0.05 for causal edges)', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.001 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.CLAMP_STRENGTH_STD);
    const edge = result.graph.edges.find(e => e.from === 'a');
    expect(edge!.strength.std).toBeGreaterThanOrEqual(0.05);
  });

  it('INFER_EFFECT_DIRECTION: risk node without explicit direction (no explicit mean)', () => {
    // INFER_EFFECT_DIRECTION fires when no explicit effect_direction on edge
    // and direction is inferred from node kinds. When mean is NOT explicitly
    // provided, the inferred direction applies the sign.
    const graph = {
      nodes: [
        { id: 'risk1', kind: 'risk', label: 'Risk' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        // No strength.mean → will be derived from DEFAULT_WEIGHT with negative sign
        { from: 'risk1', to: 'goal', exists_probability: 0.8 },
      ],
    };

    const result = normaliseGraphWithRepairs(graph);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.INFER_EFFECT_DIRECTION);
    const edge = result.graph.edges.find(e => e.from === 'risk1');
    expect(edge!.strength.mean).toBeLessThan(0);
  });

  it('DEFAULT_STRENGTH_MEAN: edge without strength.mean', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8 },
      ],
    };

    const result = normaliseGraphWithRepairs(graph);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.DEFAULT_STRENGTH_MEAN);
  });

  it('DEFAULT_STRENGTH_STD: edge without strength.std', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.DEFAULT_STRENGTH_STD);
  });

  it('DERIVE_STD_FROM_BELIEF_STRENGTH: edge with belief_strength but no std', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, weight: 0.7, belief_strength: 0.8 },
      ],
    };

    const result = normaliseGraphWithRepairs(graph);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.DERIVE_STD_FROM_BELIEF_STRENGTH);

    const repair = result.repairs.find(r => r.code === REPAIR_CODES.DERIVE_STD_FROM_BELIEF_STRENGTH);
    expect(repair!.field_path).toBe('a::goal.strength.std');
    expect(repair!.reason).toBe('Derived from belief_strength');
    expect(repair!.action).toBe('derived');
    expect(repair!.severity).toBe('info');
    expect(repair!.before).toBeNull();
    expect(repair!.after).toBeGreaterThan(0);

    // Exclusivity: DEFAULT_STRENGTH_STD must NOT fire when belief_strength drives derivation
    expect(codes).not.toContain(REPAIR_CODES.DEFAULT_STRENGTH_STD);
  });

  it('CLEAN_LABEL_ANNOTATION: label with (0-1) suffix', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'Factor A (0-1)' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.CLEAN_LABEL_ANNOTATION);
    const node = result.graph.nodes.find(n => n.id === 'a');
    expect(node?.label).toBe('Factor A');
  });

  it('all RepairEntry objects have required fields', () => {
    const graph = {
      nodes: [
        { id: 'risk1', kind: 'risk', label: 'Risk (percentage)' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        // Triggers multiple repairs: DEFAULT_EXISTS_PROBABILITY, INFER_EFFECT_DIRECTION, CLEAN_LABEL_ANNOTATION
        { from: 'risk1', to: 'goal', strength: { mean: 0.5, std: 0.001 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph);
    expect(result.repairs.length).toBeGreaterThan(0);

    for (const repair of result.repairs) {
      // All required fields present
      expect(repair.code).toBeDefined();
      expect(repair.layer).toBe('plot');
      expect(repair.field_path).toBeDefined();
      expect(typeof repair.field_path).toBe('string');
      expect(repair.reason).toBeDefined();
      expect(typeof repair.reason).toBe('string');
      expect(['info', 'warn']).toContain(repair.severity);
      expect(repair.action).toBeDefined();

      // Code is a valid RepairCode
      const validCodes = Object.values(REPAIR_CODES) as string[];
      expect(validCodes).toContain(repair.code);
    }
  });

  it('repairs are deterministically sorted by code then field_path', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'b', kind: 'factor', label: 'B' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', strength: { mean: 0.5, std: 0.001 } },
        { from: 'b', to: 'goal', strength: { mean: 0.3, std: 0.001 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph);

    // Verify sorted: code ascending, then field_path ascending
    for (let i = 1; i < result.repairs.length; i++) {
      const prev = result.repairs[i - 1];
      const curr = result.repairs[i];
      const codeCompare = prev.code.localeCompare(curr.code);
      if (codeCompare === 0) {
        expect(prev.field_path.localeCompare(curr.field_path)).toBeLessThanOrEqual(0);
      } else {
        expect(codeCompare).toBeLessThan(0);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Missing repair code coverage (INVALID_*, FLOOR_*, APPLY_SIGN, node codes)
  // -------------------------------------------------------------------------

  it('INVALID_EXISTS_PROBABILITY: non-numeric exists_probability', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 'not-a-number', strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph as any);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.INVALID_EXISTS_PROBABILITY);
    const edge = result.graph.edges.find(e => e.from === 'a');
    expect(edge?.exists_probability).toBe(0.8); // defaulted
  });

  it('INVALID_STRENGTH_MEAN: non-numeric strength.mean', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 'bad', std: 0.1 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph as any);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.INVALID_STRENGTH_MEAN);
  });

  it('INVALID_STRENGTH_STD: non-numeric strength.std (string value)', () => {
    // null is treated as nullish by ?? so falls through to DEFAULT path.
    // Must use a non-numeric, non-null value to trigger INVALID.
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 'bad' } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph as any);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.INVALID_STRENGTH_STD);
  });

  // FLOOR_STRENGTH_STD is a defensive guard that fires when std is not finite
  // after derivation (line 712) or <= 0 after clamping (line 748). Both paths
  // are unreachable from user input because:
  //   - Invalid/NaN std → INVALID_STRENGTH_STD → deriveStd() → finite value
  //   - Clamping always enforces std >= 0.01 (STRUCTURAL_STD_MIN)
  // The code exists to protect against future derivation changes.
  // CASCADE_REMOVE_EDGE is tested in validate-patch.contract.test.ts (emitted
  // by the patch application layer, not the shared normaliser).

  it('APPLY_SIGN_FROM_DIRECTION: positive mean + negative effect_direction', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 }, effect_direction: 'negative' },
      ],
    };

    const result = normaliseGraphWithRepairs(graph as any);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.APPLY_SIGN_FROM_DIRECTION);
    const edge = result.graph.edges.find(e => e.from === 'a');
    expect(edge!.strength.mean).toBeLessThan(0);
  });

  it('INVALID_CATEGORY: non-standard category value', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A', category: 'nonsense' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph as any);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.INVALID_CATEGORY);
  });

  it('INVALID_PRIOR: malformed prior object', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A', category: 'external', prior: { distribution: 123 } },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph as any);
    const codes = result.repairs.map(r => r.code);
    expect(codes).toContain(REPAIR_CODES.INVALID_PRIOR);
  });

  // -------------------------------------------------------------------------
  // Warning-only codes (no repair data, emitted as informational warnings)
  // These are in result.warnings, not result.repairs.
  // -------------------------------------------------------------------------

  it('PRIOR_ON_NON_EXTERNAL: valid prior on non-external node (warning only)', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'A', category: 'controllable',
          prior: { distribution: 'normal', range_min: 0, range_max: 1 } },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph as any);
    const warningCodes = result.warnings.map((w: any) => w.code);
    expect(warningCodes).toContain(REPAIR_CODES.PRIOR_ON_NON_EXTERNAL);
  });

  it('UNKNOWN_NODE_KIND: unrecognised node kind (warning only)', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'alien', label: 'A' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    };

    const result = normaliseGraphWithRepairs(graph as any);
    const warningCodes = result.warnings.map((w: any) => w.code);
    expect(warningCodes).toContain(REPAIR_CODES.UNKNOWN_NODE_KIND);
  });

  // CASCADE_REMOVE_EDGE is tested in validate-patch.contract.test.ts
  // (it's emitted by validate-patch's patch application layer, not the shared normaliser)
});

// =============================================================================
// Structural parity: both endpoints import the same normaliser function
// =============================================================================

describe('Structural parity', () => {
  it('/v1/validate-patch imports normaliseGraphWithRepairs from shared normaliser', () => {
    const source = fs.readFileSync('src/routes/v1/validate-patch.ts', 'utf-8');
    expect(source).toContain("from '../../normalisation/normalise-and-repair.js'");
    expect(source).toContain('normaliseGraphWithRepairs');
  });

  it('/v2/run imports normaliseGraphWithRepairs from shared normaliser', () => {
    const source = fs.readFileSync('src/routes/v2/run.ts', 'utf-8');
    expect(source).toContain("from '../../normalisation/normalise-and-repair.js'");
    expect(source).toContain('normaliseGraphWithRepairs');
  });

  it('both endpoints call the same function (not a copy-paste duplicate)', () => {
    const vpSource = fs.readFileSync('src/routes/v1/validate-patch.ts', 'utf-8');
    const runSource = fs.readFileSync('src/routes/v2/run.ts', 'utf-8');

    // Extract the import path for normaliseGraphWithRepairs from both files
    const vpImport = vpSource.match(/import\s+\{[^}]*normaliseGraphWithRepairs[^}]*\}\s+from\s+'([^']+)'/);
    const runImport = runSource.match(/import\s+\{[^}]*normaliseGraphWithRepairs[^}]*\}\s+from\s+'([^']+)'/);

    expect(vpImport).not.toBeNull();
    expect(runImport).not.toBeNull();

    // Both must resolve to the same module (normalise-and-repair)
    expect(vpImport![1]).toContain('normalise-and-repair');
    expect(runImport![1]).toContain('normalise-and-repair');
  });
});

// =============================================================================
// deriveStd invariant: always finite and >= STRUCTURAL_STD_MIN
//
// FLOOR_STRENGTH_STD is unreachable defensive code. Rather than mocking the
// unreachable path, we test the invariant it protects: the std normalisation
// pipeline ALWAYS produces a finite value >= STRUCTURAL_STD_MIN for any input.
// =============================================================================

const STRUCTURAL_STD_MIN = 0.01; // from graph-normaliser.ts (not exported)
const CAUSAL_STD_MIN = 0.05;     // from graph-normaliser.ts STD_RANGE_MIN (not exported)

describe('deriveStd invariant: finite and >= 0.05 for finite inputs', () => {
  // deriveStd guarantees finite >= 0.05 when both inputs are finite numbers.
  // Non-finite inputs (NaN, Infinity) propagate — the pipeline's
  // FLOOR_STRENGTH_STD guard catches those downstream.
  const finiteInputs: Array<{ label: string; mean: number; belief: number }> = [
    { label: 'zero mean, zero belief', mean: 0, belief: 0 },
    { label: 'zero mean, full belief', mean: 0, belief: 1 },
    { label: 'normal positive', mean: 0.5, belief: 0.8 },
    { label: 'negative mean', mean: -0.7, belief: 0.5 },
    { label: 'extreme mean', mean: 1, belief: 0 },
    { label: 'very small mean', mean: 0.001, belief: 0.5 },
    { label: 'negative belief (out of range)', mean: 0.5, belief: -1 },
    { label: 'belief > 1 (out of range)', mean: 0.5, belief: 2 },
  ];

  for (const { label, mean, belief } of finiteInputs) {
    it(`deriveStd(${mean}, ${belief}) [${label}] returns finite >= 0.05`, () => {
      const std = deriveStd(mean, belief);
      expect(Number.isFinite(std)).toBe(true);
      expect(std).toBeGreaterThanOrEqual(0.05);
    });
  }
});

describe('Std pipeline invariant: normaliseEdge always produces finite std >= floor', () => {
  // Test the full pipeline through normaliseEdge with adversarial std inputs.
  // This verifies the defensive guards protect the invariant end-to-end.
  const adversarialInputs: Array<{ label: string; std: any }> = [
    { label: 'undefined (missing)', std: undefined },
    { label: 'null', std: null },
    { label: 'NaN', std: NaN },
    { label: 'Infinity', std: Infinity },
    { label: '-Infinity', std: -Infinity },
    { label: 'zero', std: 0 },
    { label: 'negative', std: -0.5 },
    { label: 'very small positive', std: 0.0001 },
    { label: 'string', std: 'bad' },
    { label: 'normal valid', std: 0.15 },
  ];

  // Causal edges (empty nodeKindMap → non-structural) use STD_RANGE_MIN = 0.05
  for (const { label, std } of adversarialInputs) {
    it(`causal: std=${JSON.stringify(std)} [${label}] → normalised std is finite >= ${CAUSAL_STD_MIN}`, () => {
      const warnings: any[] = [];
      const edge = normaliseEdge(
        { from: 'A', to: 'B', exists_probability: 0.8, strength: { mean: 0.5, std } },
        0,
        new Map(),
        warnings,
      );

      expect(Number.isFinite(edge.strength.std)).toBe(true);
      expect(edge.strength.std).toBeGreaterThanOrEqual(CAUSAL_STD_MIN);
    });
  }

  // Structural edges (decision→option) use STRUCTURAL_STD_MIN = 0.01
  it('structural edge (decision→option): std floored to STRUCTURAL_STD_MIN (0.01)', () => {
    const nodeKindMap = new Map([['d', 'decision'], ['o', 'option']]);
    const warnings: any[] = [];
    const edge = normaliseEdge(
      { from: 'd', to: 'o', exists_probability: 0.8, strength: { mean: 0.5, std: 0.001 } },
      0,
      nodeKindMap,
      warnings,
    );

    expect(Number.isFinite(edge.strength.std)).toBe(true);
    expect(edge.strength.std).toBeGreaterThanOrEqual(STRUCTURAL_STD_MIN);
    // Structural floor is lower than causal floor
    expect(edge.strength.std).toBeLessThan(CAUSAL_STD_MIN);
  });
});
