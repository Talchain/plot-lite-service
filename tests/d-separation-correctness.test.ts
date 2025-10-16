import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeIdentifiability } from '../src/trust/d-separation.js';

describe('D-Separation Correctness (F3)', () => {
  let origEnv: string | undefined;

  beforeEach(() => { origEnv = process.env.IDENT_DSEP_ENABLE; });
  afterEach(() => {
    if (origEnv) process.env.IDENT_DSEP_ENABLE = origEnv;
    else delete process.env.IDENT_DSEP_ENABLE;
  });

  it('clean path identifiable', () => {
    process.env.IDENT_DSEP_ENABLE = '1';
    const dag = { nodes: ['X', 'Y'], edges: [{ from: 'X', to: 'Y' }] };
    const result = computeIdentifiability(dag, 'X', 'Y');
    expect(result.identifiable).toBe(true);
    expect(result.adjustment_set).toEqual([]);
  });

  it('single confounder', () => {
    process.env.IDENT_DSEP_ENABLE = '1';
    const dag = {
      nodes: ['X', 'Y', 'Z'],
      edges: [{ from: 'Z', to: 'X' }, { from: 'Z', to: 'Y' }, { from: 'X', to: 'Y' }]
    };
    const result = computeIdentifiability(dag, 'X', 'Y');
    expect(result.adjustment_set).toContain('Z');
  });

  it('multi-hop confounder', () => {
    process.env.IDENT_DSEP_ENABLE = '1';
    const dag = {
      nodes: ['X', 'Y', 'Z', 'W'],
      edges: [
        { from: 'W', to: 'Z' },
        { from: 'Z', to: 'X' },
        { from: 'Z', to: 'Y' }
      ]
    };
    const result = computeIdentifiability(dag, 'X', 'Y');
    expect(result.adjustment_set).toContain('Z');
    expect(result.adjustment_set).toContain('W');
  });

  it('multiple confounders sorted', () => {
    process.env.IDENT_DSEP_ENABLE = '1';
    const dag = {
      nodes: ['X', 'Y', 'A', 'B'],
      edges: [
        { from: 'B', to: 'X' }, { from: 'B', to: 'Y' },
        { from: 'A', to: 'X' }, { from: 'A', to: 'Y' }
      ]
    };
    const result = computeIdentifiability(dag, 'X', 'Y');
    expect(result.adjustment_set).toEqual(['A', 'B']); // Sorted
  });

  it('collider no adjustment', () => {
    process.env.IDENT_DSEP_ENABLE = '1';
    const dag = {
      nodes: ['X', 'Y', 'Z'],
      edges: [{ from: 'X', to: 'Z' }, { from: 'Y', to: 'Z' }]
    };
    const result = computeIdentifiability(dag, 'X', 'Y');
    expect(result.adjustment_set).toEqual([]);
  });

  it('determinism 10x', () => {
    process.env.IDENT_DSEP_ENABLE = '1';
    const dag = {
      nodes: ['A', 'B', 'C'],
      edges: [{ from: 'C', to: 'A' }, { from: 'C', to: 'B' }]
    };
    
    const results = Array(10).fill(0).map(() => 
      computeIdentifiability(dag, 'A', 'B')
    );
    
    const unique = new Set(results.map(r => JSON.stringify(r)));
    expect(unique.size).toBe(1);
  });

  it('flag OFF returns default', () => {
    delete process.env.IDENT_DSEP_ENABLE;
    const dag = {
      nodes: ['X', 'Y', 'Z'],
      edges: [{ from: 'Z', to: 'X' }, { from: 'Z', to: 'Y' }]
    };
    const result = computeIdentifiability(dag, 'X', 'Y');
    expect(result.identifiable).toBe(true);
    expect(result.adjustment_set).toEqual([]);
  });
});
