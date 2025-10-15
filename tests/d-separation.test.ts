import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeIdentifiability } from '../src/trust/d-separation.js';

describe('D-Separation Identifiability (E3)', () => {
  let origEnv: string | undefined;

  beforeEach(() => {
    origEnv = process.env.IDENT_DSEP_ENABLE;
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.IDENT_DSEP_ENABLE = origEnv;
    } else {
      delete process.env.IDENT_DSEP_ENABLE;
    }
  });

  it('clean path is identifiable', () => {
    process.env.IDENT_DSEP_ENABLE = '1';
    const dag = {
      nodes: ['X', 'Y'],
      edges: [{ from: 'X', to: 'Y' }]
    };
    
    const result = computeIdentifiability(dag, 'X', 'Y');
    expect(result.identifiable).toBe(true);
    expect(result.adjustment_set).toEqual([]);
  });

  it('backdoor confounder requires adjustment', () => {
    process.env.IDENT_DSEP_ENABLE = '1';
    const dag = {
      nodes: ['X', 'Y', 'Z'],
      edges: [
        { from: 'Z', to: 'X' },
        { from: 'Z', to: 'Y' },
        { from: 'X', to: 'Y' }
      ]
    };
    
    const result = computeIdentifiability(dag, 'X', 'Y');
    expect(result.identifiable).toBe(true);
    expect(result.adjustment_set).toContain('Z');
  });

  it('empty graph is identifiable', () => {
    process.env.IDENT_DSEP_ENABLE = '1';
    const dag = {
      nodes: ['A'],
      edges: []
    };
    
    const result = computeIdentifiability(dag, 'A', 'A');
    expect(result.identifiable).toBe(true);
  });

  it('flag OFF returns default identifiable', () => {
    delete process.env.IDENT_DSEP_ENABLE;
    const dag = {
      nodes: ['X', 'Y', 'Z'],
      edges: [
        { from: 'Z', to: 'X' },
        { from: 'Z', to: 'Y' }
      ]
    };
    
    const result = computeIdentifiability(dag, 'X', 'Y');
    expect(result.identifiable).toBe(true);
    expect(result.adjustment_set).toEqual([]);
  });

  it('deterministic across runs', () => {
    process.env.IDENT_DSEP_ENABLE = '1';
    const dag = {
      nodes: ['A', 'B', 'C'],
      edges: [
        { from: 'C', to: 'A' },
        { from: 'C', to: 'B' }
      ]
    };
    
    const r1 = computeIdentifiability(dag, 'A', 'B');
    const r2 = computeIdentifiability(dag, 'A', 'B');
    
    expect(r1).toEqual(r2);
  });
});
