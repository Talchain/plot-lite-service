import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/optimise - budget precedence', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('enforces top-level budget even if constraints.budget is higher', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' }
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        budget: 50,  // Top-level budget
        actions: [
          { id: 'action1', cost: 30, do: [{ node_id: 'A', set_to: 0.8 }] },
          { id: 'action2', cost: 40, do: [{ node_id: 'B', set_to: 0.9 }] }
        ],
        objective: {
          type: 'utility_linear',
          weights: { B: 1.0 }
        },
        constraints: {
          budget: 100  // Nested budget (should be ignored)
        },
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    
    // Calculate total cost of selected actions
    const actions = [
      { id: 'action1', cost: 30 },
      { id: 'action2', cost: 40 }
    ];
    const totalCost = data.selected.reduce((sum: number, id: string) => {
      const action = actions.find(a => a.id === id);
      return sum + (action?.cost || 0);
    }, 0);
    
    // Total cost must not exceed top-level budget (50), even though constraints.budget was 100
    expect(totalCost).toBeLessThanOrEqual(50);
    expect(data.selected.length).toBeGreaterThan(0); // At least one action selected
    expect(data.selected.length).toBeLessThan(2); // Cannot select both (30+40=70 > 50)
  });

  it('does not include nested budget in response meta.constraints_applied', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'X', label: 'X' }],
          edges: []
        },
        budget: 100,
        actions: [
          { id: 'a1', cost: 50, do: [{ node_id: 'X', set_to: 0.7 }] }
        ],
        objective: {
          type: 'utility_linear',
          weights: { X: 1.0 }
        },
        constraints: {
          budget: 200,
          must: ['a1']
        },
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    
    // meta.constraints_applied should not include 'budget'
    expect(data.meta.constraints_applied).toBeDefined();
    expect(data.meta.constraints_applied).not.toContain('budget');
    expect(data.meta.constraints_applied).toContain('must');
  });
});
