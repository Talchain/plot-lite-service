import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeIdentifiability,
  isDSeparated,
  findReachable,
  findBackdoorAdjustmentSet,
  validateDAG,
  validateNodesExist,
  DAG,
} from '../src/trust/d-separation.js';

describe('Bayes-ball Algorithm', () => {
  describe('isDSeparated', () => {
    it('chain: A → B → C, no conditioning - not separated', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      };
      expect(isDSeparated(dag, 'A', 'C')).toBe(false);
    });

    it('chain: A → B → C, condition on B - separated', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      };
      expect(isDSeparated(dag, 'A', 'C', ['B'])).toBe(true);
    });

    it('fork: A ← B → C, no conditioning - not separated', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [
          { from: 'B', to: 'A' },
          { from: 'B', to: 'C' },
        ],
      };
      expect(isDSeparated(dag, 'A', 'C')).toBe(false);
    });

    it('fork: A ← B → C, condition on B - separated', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [
          { from: 'B', to: 'A' },
          { from: 'B', to: 'C' },
        ],
      };
      expect(isDSeparated(dag, 'A', 'C', ['B'])).toBe(true);
    });

    it('collider: A → B ← C, no conditioning - separated', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'C', to: 'B' },
        ],
      };
      expect(isDSeparated(dag, 'A', 'C')).toBe(true);
    });

    it('collider: A → B ← C, condition on B - not separated (collider opens)', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'C', to: 'B' },
        ],
      };
      expect(isDSeparated(dag, 'A', 'C', ['B'])).toBe(false);
    });

    it('collider descendant: A → B ← C, B → D, condition on D - not separated', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C', 'D'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'C', to: 'B' },
          { from: 'B', to: 'D' },
        ],
      };
      // Conditioning on descendant of collider opens the collider
      expect(isDSeparated(dag, 'A', 'C', ['D'])).toBe(false);
    });

    it('complex: mixed chain and fork', () => {
      // A → B → C ← D
      const dag: DAG = {
        nodes: ['A', 'B', 'C', 'D'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
          { from: 'D', to: 'C' },
        ],
      };
      // A and D: B-C is a collider from D's perspective
      expect(isDSeparated(dag, 'A', 'D')).toBe(true);
      // Conditioning on C opens the collider
      expect(isDSeparated(dag, 'A', 'D', ['C'])).toBe(false);
    });

    it('multiple paths: one blocked, one open', () => {
      // A → B → C and A → D → C (two paths)
      const dag: DAG = {
        nodes: ['A', 'B', 'C', 'D'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
          { from: 'A', to: 'D' },
          { from: 'D', to: 'C' },
        ],
      };
      // Blocking B only blocks one path
      expect(isDSeparated(dag, 'A', 'C', ['B'])).toBe(false);
      // Blocking both B and D separates
      expect(isDSeparated(dag, 'A', 'C', ['B', 'D'])).toBe(true);
    });

    it('disconnected nodes are separated', () => {
      const dag: DAG = {
        nodes: ['A', 'B'],
        edges: [],
      };
      expect(isDSeparated(dag, 'A', 'B')).toBe(true);
    });

    it('direct edge: not separated', () => {
      const dag: DAG = {
        nodes: ['A', 'B'],
        edges: [{ from: 'A', to: 'B' }],
      };
      expect(isDSeparated(dag, 'A', 'B')).toBe(false);
    });

    it('supports array inputs for sources and targets', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C', 'D'],
        edges: [
          { from: 'A', to: 'C' },
          { from: 'B', to: 'D' },
        ],
      };
      // A,B to C,D: A→C connected, B→D connected
      expect(isDSeparated(dag, ['A', 'B'], ['C', 'D'])).toBe(false);
    });
  });

  describe('findReachable', () => {
    it('finds all reachable nodes in simple chain', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      };
      const reachable = findReachable(dag, 'A');
      expect(reachable.has('B')).toBe(true);
      expect(reachable.has('C')).toBe(true);
    });

    it('blocking a node restricts reachability', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      };
      const reachable = findReachable(dag, 'A', ['B']);
      expect(reachable.has('B')).toBe(true); // B is reachable but blocked
      expect(reachable.has('C')).toBe(false); // C is not reachable through B
    });

    it('collider opens when conditioning on it', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'C', to: 'B' },
        ],
      };
      // Without conditioning, C is not reachable from A
      expect(findReachable(dag, 'A').has('C')).toBe(false);
      // With conditioning on B, C becomes reachable
      expect(findReachable(dag, 'A', ['B']).has('C')).toBe(true);
    });
  });

  describe('findBackdoorAdjustmentSet', () => {
    it('returns empty set when no confounders', () => {
      const dag: DAG = {
        nodes: ['X', 'Y'],
        edges: [{ from: 'X', to: 'Y' }],
      };
      const adj = findBackdoorAdjustmentSet(dag, 'X', 'Y');
      expect(adj).toEqual([]);
    });

    it('identifies single confounder', () => {
      const dag: DAG = {
        nodes: ['X', 'Y', 'Z'],
        edges: [
          { from: 'Z', to: 'X' },
          { from: 'Z', to: 'Y' },
          { from: 'X', to: 'Y' },
        ],
      };
      const adj = findBackdoorAdjustmentSet(dag, 'X', 'Y');
      expect(adj).toContain('Z');
    });

    it('excludes descendants of treatment', () => {
      const dag: DAG = {
        nodes: ['X', 'Y', 'Z', 'M'],
        edges: [
          { from: 'Z', to: 'X' },
          { from: 'Z', to: 'Y' },
          { from: 'X', to: 'M' },
          { from: 'M', to: 'Y' },
        ],
      };
      const adj = findBackdoorAdjustmentSet(dag, 'X', 'Y');
      // M is a descendant of X, should not be in adjustment set
      expect(adj).not.toContain('M');
      expect(adj).toContain('Z');
    });

    it('returns sorted adjustment set', () => {
      const dag: DAG = {
        nodes: ['X', 'Y', 'B', 'A'],
        edges: [
          { from: 'B', to: 'X' },
          { from: 'B', to: 'Y' },
          { from: 'A', to: 'X' },
          { from: 'A', to: 'Y' },
        ],
      };
      const adj = findBackdoorAdjustmentSet(dag, 'X', 'Y');
      expect(adj).toEqual(['A', 'B']); // Alphabetically sorted
    });
  });
});

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

describe('DAG Validation', () => {
  describe('validateDAG', () => {
    it('validates a proper DAG', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      };
      const result = validateDAG(dag);
      expect(result.valid).toBe(true);
      expect(result.isDAG).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it('detects simple cycle A → B → A', () => {
      const dag: DAG = {
        nodes: ['A', 'B'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'A' },
        ],
      };
      const result = validateDAG(dag);
      expect(result.valid).toBe(false);
      expect(result.isDAG).toBe(false);
      expect(result.cycleNodes).toBeDefined();
      expect(result.cycleNodes?.length).toBeGreaterThan(0);
    });

    it('detects longer cycle A → B → C → A', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
          { from: 'C', to: 'A' },
        ],
      };
      const result = validateDAG(dag);
      expect(result.valid).toBe(false);
      expect(result.isDAG).toBe(false);
    });

    it('detects missing nodes in edges', () => {
      const dag: DAG = {
        nodes: ['A', 'B'],
        edges: [
          { from: 'A', to: 'C' }, // C doesn't exist
        ],
      };
      const result = validateDAG(dag);
      expect(result.valid).toBe(false);
      expect(result.missingNodes).toContain('C');
    });

    it('handles empty graph', () => {
      const dag: DAG = {
        nodes: [],
        edges: [],
      };
      const result = validateDAG(dag);
      expect(result.valid).toBe(true);
      expect(result.isDAG).toBe(true);
    });

    it('handles single node', () => {
      const dag: DAG = {
        nodes: ['A'],
        edges: [],
      };
      const result = validateDAG(dag);
      expect(result.valid).toBe(true);
      expect(result.isDAG).toBe(true);
    });

    it('handles self-loop', () => {
      const dag: DAG = {
        nodes: ['A'],
        edges: [{ from: 'A', to: 'A' }],
      };
      const result = validateDAG(dag);
      expect(result.valid).toBe(false);
      expect(result.isDAG).toBe(false);
    });

    it('validates complex DAG without cycles', () => {
      // Diamond pattern: A → B, A → C, B → D, C → D
      const dag: DAG = {
        nodes: ['A', 'B', 'C', 'D'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'A', to: 'C' },
          { from: 'B', to: 'D' },
          { from: 'C', to: 'D' },
        ],
      };
      const result = validateDAG(dag);
      expect(result.valid).toBe(true);
      expect(result.isDAG).toBe(true);
    });
  });

  describe('validateNodesExist', () => {
    it('returns empty array when all nodes exist', () => {
      const dag: DAG = {
        nodes: ['A', 'B', 'C'],
        edges: [],
      };
      const missing = validateNodesExist(dag, ['A', 'B']);
      expect(missing).toEqual([]);
    });

    it('returns missing nodes', () => {
      const dag: DAG = {
        nodes: ['A', 'B'],
        edges: [],
      };
      const missing = validateNodesExist(dag, ['A', 'C', 'D']);
      expect(missing).toContain('C');
      expect(missing).toContain('D');
      expect(missing).not.toContain('A');
    });

    it('handles empty input', () => {
      const dag: DAG = {
        nodes: ['A', 'B'],
        edges: [],
      };
      const missing = validateNodesExist(dag, []);
      expect(missing).toEqual([]);
    });
  });
});
