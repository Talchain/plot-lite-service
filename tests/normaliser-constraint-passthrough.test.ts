/**
 * Graph Normaliser — Constraint Node CEE Field Passthrough
 *
 * Targeted unit tests verifying that normaliseNode() preserves CEE-specific
 * fields on constraint-kind nodes:
 *
 * 1. deadline_metadata, unit, source_quote, confidence, provenance
 * 2. observed_state.metadata (contains operator for the constraint compiler)
 *
 * These lock the normaliser half of the B1-8 fix. The compiler half is
 * covered by constraint-compiler-cee-fields.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { normaliseNode } from '../src/normalisation/graph-normaliser.js';
import type { UpstreamNode } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConstraintNode(extras: Record<string, unknown> = {}): UpstreamNode {
  return {
    id: 'deadline_constraint',
    kind: 'constraint',
    label: 'Delivery deadline',
    observed_state: { value: 12, metadata: { operator: '<=' } } as any,
    ...extras,
  } as UpstreamNode;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normaliseNode — constraint CEE field passthrough', () => {
  it('preserves deadline_metadata on constraint node', () => {
    const raw = makeConstraintNode({
      deadline_metadata: { deadline_date: '2027-02-19' },
    });

    const normalised = normaliseNode(raw);

    expect((normalised as any).deadline_metadata).toEqual({ deadline_date: '2027-02-19' });
  });

  it('preserves unit on constraint node', () => {
    const raw = makeConstraintNode({ unit: 'months' });
    const normalised = normaliseNode(raw);

    expect((normalised as any).unit).toBe('months');
  });

  it('preserves source_quote and provenance on constraint node', () => {
    const raw = makeConstraintNode({
      source_quote: 'within 12 months',
      provenance: 'inferred',
    });

    const normalised = normaliseNode(raw);

    expect((normalised as any).source_quote).toBe('within 12 months');
    expect((normalised as any).provenance).toBe('inferred');
  });

  it('preserves confidence on constraint node', () => {
    const raw = makeConstraintNode({ confidence: 0.85 });
    const normalised = normaliseNode(raw);

    expect((normalised as any).confidence).toBe(0.85);
  });

  it('preserves observed_state.metadata (contains operator)', () => {
    const raw = makeConstraintNode(); // has metadata: { operator: '<=' }
    const normalised = normaliseNode(raw);

    expect((normalised.observed_state as any)?.metadata).toEqual({ operator: '<=' });
  });

  it('does NOT add CEE fields to non-constraint nodes', () => {
    const factorNode: UpstreamNode = {
      id: 'factor_a',
      kind: 'factor',
      label: 'Factor A',
      observed_state: { value: 0.5 },
    };
    // Simulate extra fields that might leak through
    (factorNode as any).deadline_metadata = { deadline_date: '2027-01-01' };
    (factorNode as any).unit = 'months';

    const normalised = normaliseNode(factorNode);

    expect((normalised as any).deadline_metadata).toBeUndefined();
    expect((normalised as any).unit).toBeUndefined();
  });

  it('reads CEE fields from data bag (React Flow nesting)', () => {
    const raw: UpstreamNode = {
      id: 'deadline_rf',
      kind: 'constraint',
      label: 'Deadline RF',
      observed_state: { value: 6 } as any,
      data: {
        deadline_metadata: { deadline_date: '2027-06-01' },
        unit: 'months',
      } as any,
    } as UpstreamNode;

    const normalised = normaliseNode(raw);

    expect((normalised as any).deadline_metadata).toEqual({ deadline_date: '2027-06-01' });
    expect((normalised as any).unit).toBe('months');
  });

  it('direct node fields take precedence over data bag', () => {
    const raw: UpstreamNode = {
      id: 'deadline_both',
      kind: 'constraint',
      label: 'Deadline Both',
      observed_state: { value: 12 } as any,
      data: {
        unit: 'days',
      } as any,
    } as UpstreamNode;
    (raw as any).unit = 'months';

    const normalised = normaliseNode(raw);

    expect((normalised as any).unit).toBe('months'); // direct wins over data bag
  });
});
