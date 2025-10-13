import { describe, it, expect } from 'vitest';
import type { SCM, Intervention } from '../src/causal/types.js';
import { rollout } from '../src/causal/dscm/rollout.js';

describe('dSCM rollout (deterministic)', () => {
  it('single-node identity over T steps with fixed seed is deterministic', () => {
    const scm: SCM = {
      dag: { nodes: ['X'], edges: [] },
      f: { X: (_p, u) => u['X'] },
      U: { X: { dist: 'uniform', params: {} } },
    };
    const iv: Intervention[] = [];
    const T = 5;
    const r1 = rollout(scm, iv, T, 42);
    const r2 = rollout(scm, iv, T, 42);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.trace).toHaveLength(T);
    // stable key order
    expect(Object.keys(r1.trace[0])).toEqual(['X']);
  });

  it('two-node chain applies parents then interventions deterministically', () => {
    const scm: SCM = {
      dag: { nodes: ['A','B'], edges: [['A','B']] },
      f: {
        A: (_p, u) => u['A'],
        B: (p, u) => (p['A'] ?? 0) + u['B'],
      },
      U: { A: { dist: 'uniform', params: {} }, B: { dist: 'uniform', params: {} } },
    };
    const iv: Intervention[] = [{ do: { A: 1 } }];
    const out = rollout(scm, iv, 3, 7);
    expect(out.trace).toHaveLength(3);
    // A should be forced to 1, B should be >= 1 due to parent contribution
    for (const r of out.trace) {
      expect(r.A).toBe(1);
      expect(r.B).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it('idempotent seed yields identical traces', () => {
    const scm: SCM = {
      dag: { nodes: ['Z'], edges: [] },
      f: { Z: (_p, u) => u['Z'] },
      U: { Z: { dist: 'normal', params: {} } },
    };
    const iv: Intervention[] = [];
    const T = 10;
    const a = rollout(scm, iv, T, 4242);
    const b = rollout(scm, iv, T, 4242);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
