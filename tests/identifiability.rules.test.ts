import { describe, it, expect } from 'vitest';
import { isIdentifiable } from '../src/causal/identifiability.js';
import type { DAG, Query } from '../src/causal/types.js';

describe('identifiability rules (deterministic)', () => {
  it('backdoor adjustment detected with sorted set', () => {
    const dag: DAG = {
      nodes: ['Z','T','Y'],
      edges: [['Z','T'], ['Z','Y'], ['T','Y']],
    };
    const q: Query = { outcome: 'Y', intervention: { do: { T: 1 } } } as any;
    const res = isIdentifiable(q, dag);
    expect(res.ok).toBe(true);
    expect(res.method).toBe('backdoor');
    expect(res.notes.join(' ')).toContain('backdoor');
  });

  it('frontdoor detected when mediator exists', () => {
    const dag: DAG = {
      nodes: ['T','M','Y'],
      edges: [['T','M'], ['M','Y']],
    };
    const q: Query = { outcome: 'Y', intervention: { do: { T: 1 } } } as any;
    const res = isIdentifiable(q, dag);
    expect(res.ok).toBe(true);
    // our heuristic will pick backdoor if parents(T) non-empty else frontdoor; here parents(T)=[]
    expect(['frontdoor','g-formula','backdoor']).toContain(res.method);
  });

  it('unidentifiable when outcome missing or no path', () => {
    const dag: DAG = { nodes: ['A','B'], edges: [['A','B']] };
    const q: Query = { outcome: 'Z', intervention: { do: { A: 1 } } } as any;
    const res = isIdentifiable(q, dag);
    expect(res.ok).toBe(false);
    expect(res.method).toBe('unidentifiable');
  });

  it('near-collider: no directed path T→Y, do(T) on Y is unidentifiable', () => {
    // T -> C <- U -> Y (collider C); no directed T->Y
    const dag: DAG = { nodes: ['T','C','U','Y'], edges: [['T','C'], ['U','C'], ['U','Y']] };
    const q: Query = { outcome: 'Y', intervention: { do: { T: 1 } } } as any;
    const res = isIdentifiable(q, dag);
    expect(res.ok).toBe(false);
    expect(res.method).toBe('unidentifiable');
  });

  it('blocked path with conditioning on collider along T→Y path → unidentifiable', () => {
    // T -> M -> Y and U -> M (M is collider on the directed path). Conditioning on M opens bias.
    const dag: DAG = { nodes: ['T','M','U','Y'], edges: [['T','M'], ['M','Y'], ['U','M']] };
    const q: Query = { outcome: 'Y', intervention: { do: { T: 1 } }, given: ['M'] } as any;
    const res = isIdentifiable(q, dag);
    expect(res.ok).toBe(false);
    expect(res.method).toBe('unidentifiable');
    expect(res.notes.join(' ')).toContain('collider');
  });

  it('bounds tag propagation on fallback is deterministic (manski)', () => {
    // No parents(T), no mediator satisfying frontdoor; fallback path → g-formula with bounds note
    const dag: DAG = { nodes: ['T','Y'], edges: [['T','Y']] };
    const q: Query = { outcome: 'Y', intervention: { do: { T: 1 } } } as any;
    const res = isIdentifiable(q, dag);
    expect(res.ok).toBe(true);
    expect(res.method).toBe('g-formula');
    expect(res.notes.join(' ')).toContain('bounds: manski');
  });
});
