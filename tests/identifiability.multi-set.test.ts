import { describe, it, expect } from 'vitest';
import { computeParentsChildren, dSeparatedSets } from '../src/causal/dsep.js';

describe('identifiability multi-set d-sep', () => {
  it('X⊥Y | Z∪W using set-wise check on simple DAG', () => {
    // Graph: A->C<-B, C->D, E->D; conditioning on C blocks A-B influence on D if not opened
    const nodes = ['A','B','C','D','E'];
    const edges: Array<[string,string]> = [ ['A','C'], ['B','C'], ['C','D'], ['E','D'] ];
    const g = computeParentsChildren(nodes as any, edges as any);
    const X = new Set(['A']);
    const Y = new Set(['B']);
    const Z = new Set(['C']);
    const W = new Set<string>();
    // With C conditioned (collider), path A->C<-B is opened, so not d-separated
    const sep1 = dSeparatedSets(X as any, Y as any, new Set([...Z, ...W]) as any, g);
    expect(sep1).toBe(false);
    // Without C, collider blocks → d-separated
    const sep2 = dSeparatedSets(X as any, Y as any, new Set([]) as any, g);
    expect(sep2).toBe(true);
  });

  it('multiple mediators case remains deterministic', () => {
    // T->M1->Y and T->M2->Y; check that with Z={M1,M2} we block all backdoor paths
    const nodes = ['T','M1','M2','Y'];
    const edges: Array<[string,string]> = [ ['T','M1'], ['M1','Y'], ['T','M2'], ['M2','Y'] ];
    const g = computeParentsChildren(nodes as any, edges as any);
    const X = new Set(['T']);
    const Y = new Set(['Y']);
    const Z = new Set(['M1','M2']);
    const sep = dSeparatedSets(X as any, Y as any, Z as any, g);
    // Directed path remains, so Bayes-ball for separations is false (not d-separated)
    expect(sep).toBe(false);
  });
});
