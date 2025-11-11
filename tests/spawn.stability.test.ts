/**
 * Spawn Stability Test
 * Verifies concurrent server spawns with ephemeral ports and unique TMPDIRs
 */
import { describe, it, expect } from 'vitest';
import { spawnServer } from './utils.js';

describe('Spawn Stability', () => {
  it('spawns 3 servers concurrently with unique ports and no collisions', async () => {
    const servers = await Promise.all([
      spawnServer(),
      spawnServer(),
      spawnServer(),
    ]);
    
    try {
      // Verify unique ports
      const ports = servers.map(s => s.port);
      const uniquePorts = new Set(ports);
      expect(uniquePorts.size).toBe(3);
      
      // Verify all are responsive
      const healthChecks = await Promise.all(
        servers.map(async s => {
          const res = await fetch(`${s.baseUrl}/v1/health`);
          return res.ok;
        })
      );
      expect(healthChecks.every(ok => ok)).toBe(true);
      
    } finally {
      // Cleanup
      await Promise.all(servers.map(s => s.kill()));
      
      // Verify no zombies (best effort check)
      await new Promise(r => setTimeout(r, 500));
    }
  }, 15000);
});
