import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Staging smoke test setup', () => {
  it('golden-3node-revenue fixture is valid', () => {
    const path = join(process.cwd(), 'fixtures', 'golden-3node-revenue.json');
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    
    expect(payload.seed).toBe(4242);
    expect(payload.outcome_node).toBe('Revenue');
    expect(payload.graph.nodes).toHaveLength(3);
    expect(payload.graph.edges).toHaveLength(2);
  });
});
