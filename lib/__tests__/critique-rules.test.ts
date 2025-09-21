import { describe, it, expect } from 'vitest';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:4311';

function baseFlow() {
  return {
    nodes: [
      { id: 'd', type: 'decision', label: 'Adjust price', baseline: 99 },
      { id: 'o', type: 'outcome', label: 'Revenue', baseline: 100000 },
      { id: 'p', type: 'problem', label: 'Churn', baseline: 0.05 }
    ],
    edges: [
      { id: 'e1', from: 'd', to: 'o', weight: 0.4, belief: 0.7 },
      { id: 'e2', from: 'p', to: 'o', weight: -0.5, belief: 0.8 }
    ],
    metadata: { thresholds: [99] }
  };
}

describe('critique rules v1.1', () => {
  it('BLOCKER: missing outcome baseline', async () => {
    const f = baseFlow();
    f.nodes = f.nodes.map(n => n.id === 'o' ? { ...n, baseline: undefined } : n);
    const res = await fetch(`${BASE}/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parse_json: f }) });
    const arr = await res.json();
    expect(arr[0].severity).toBe('BLOCKER');
    expect(arr.some((x:any) => x.note.includes('Missing baseline'))).toBe(true);
  });

  it('BLOCKER: detects simple cycle', async () => {
    const f = baseFlow();
    f.edges.push({ id: 'e3', from: 'o', to: 'd', weight: 0.1, belief: 0.5 });
    const res = await fetch(`${BASE}/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parse_json: f }) });
    const arr = await res.json();
    expect(arr.find((x:any) => x.severity === 'BLOCKER' && x.note.includes('Circular'))).toBeTruthy();
  });

  it('IMPROVEMENT: collider risk detected', async () => {
    const f = baseFlow();
    f.nodes.push({ id: 'x', type: 'outcome', label: 'Margin' });
    f.edges.push({ id: 'e3', from: 'd', to: 'x', weight: 0.1, belief: 0.5 });
    f.edges.push({ id: 'e4', from: 'p', to: 'x', weight: 0.1, belief: 0.5 });
    const res = await fetch(`${BASE}/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parse_json: f }) });
    const arr = await res.json();
    expect(arr.find((x:any) => x.severity === 'IMPROVEMENT' && x.note.includes('collider'))).toBeTruthy();
  });

  it('IMPROVEMENT: competitor response missing when price decision present', async () => {
    const f = baseFlow();
    const res = await fetch(`${BASE}/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parse_json: f }) });
    const arr = await res.json();
    expect(arr.find((x:any) => x.severity === 'IMPROVEMENT' && x.note.includes('competitor'))).toBeTruthy();
  });

  it('OBSERVATION: £99 observation when threshold present', async () => {
    const f = baseFlow();
    const res = await fetch(`${BASE}/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parse_json: f }) });
    const arr = await res.json();
    expect(arr[arr.length - 1].severity).toBe('OBSERVATION');
  });

  it('Ordering: BLOCKERS, then IMPROVEMENTS, then OBSERVATIONS', async () => {
    const f = baseFlow();
    f.nodes = f.nodes.map(n => n.id === 'o' ? { ...n, baseline: undefined } : n);
    f.edges.push({ id: 'e3', from: 'o', to: 'd', weight: 0.1, belief: 0.5 });
    const res = await fetch(`${BASE}/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parse_json: f }) });
    const arr = await res.json();
    const severities = arr.map((x:any) => x.severity);
    const firstObs = severities.indexOf('OBSERVATION');
    const firstImp = severities.indexOf('IMPROVEMENT');
    const lastBlock = severities.lastIndexOf('BLOCKER');
    expect(lastBlock).toBeLessThan(firstImp);
    expect(firstImp).toBeLessThan(firstObs);
  });
});