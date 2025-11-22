import { describe, it, expect } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Stability smoke - concurrent servers', () => {
  it('launches 3 servers concurrently and runs minimal flow on each', async () => {
    const servers: ServerHandle[] = [];
    
    try {
      // Launch 3 servers in parallel
      const spawns = [
        spawnServer(),
        spawnServer(),
        spawnServer()
      ];
      
      const launched = await Promise.all(spawns);
      servers.push(...launched);
      
      // Verify all servers are healthy
      const healthChecks = servers.map(s => 
        fetch(`${s.baseUrl}/v1/health`).then(r => r.ok)
      );
      const results = await Promise.all(healthChecks);
      expect(results.every(ok => ok)).toBe(true);
      
      // Run minimal flow on each
      const flows = servers.map(async (s) => {
        const res = await fetch(`${s.baseUrl}/v1/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            graph: {
              nodes: [{ id: 'A', label: 'A' }],
              edges: []
            },
            seed: 4242
          })
        });
        return res.ok;
      });
      
      const flowResults = await Promise.all(flows);
      expect(flowResults.every(ok => ok)).toBe(true);
      
    } finally {
      // Clean shutdown
      await Promise.all(servers.map(s => s.kill()));
    }
  }, 30000); // 30s timeout for concurrent spawns
});
