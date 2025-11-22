import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawnServer, waitFor, sleep, createTestArtifactDir, writeTestConfig, requestJSON, type ServerHandle } from './utils.js';

describe('Health counters and last reload timestamp', () => {
  let server: ServerHandle;
  let artifactDir: ReturnType<typeof createTestArtifactDir>;

  beforeAll(async () => {
    // Create isolated artifact directory with unique name to avoid conflicts
    artifactDir = createTestArtifactDir(`health-counters-${Date.now()}`);
    
    // Write runtime config for SIGHUP reload
    writeTestConfig(artifactDir.path, {
      sse_per_ip_max: 1,
      sse_global_max: 1,
      rate_limit_rpm: 1,
    });
    
    // Spawn server with test config and deterministic env
    server = await spawnServer({
      env: {
        TEST_ROUTES: '1',
        AUTH_ENABLED: '0',
        RATE_LIMIT_ENABLED: '1',
        SSE_PER_IP_MAX: '1',
        SSE_GLOBAL_MAX: '1',
        RATE_LIMIT_RPM: '1',
        RUNTIME_CONFIG_PATH: `${artifactDir.path}/runtime-config.json`,
        NODE_ENV: 'test',
      },
    });
    
    // Wait for server to be fully ready
    await sleep(200);
  });

  afterAll(async () => {
    try {
      await server?.kill();
    } catch (err) {
      console.warn('Server cleanup warning:', err);
    }
    try {
      artifactDir?.cleanup();
    } catch (err) {
      console.warn('Artifact cleanup warning:', err);
    }
  });

  it('exposes json_429_count, sse_429_count and last_config_reload_iso', async () => {
    const { baseUrl } = server;
    
    // Verify health endpoint has counter fields (initially 0)
    const health0 = await requestJSON(`${baseUrl}/v1/health`);
    expect(health0.data).toBeTruthy();
    expect(typeof health0.data.json_429_count).toBe('number');
    expect(typeof health0.data.sse_429_count).toBe('number');
    
    // Trigger JSON 429 by exceeding RPM=1
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({ description: 'test' });
    
    const r1 = await requestJSON(`${baseUrl}/v1/draft`, { method: 'POST', headers, body });
    expect([200, 201]).toContain(r1.status);
    
    const r2 = await requestJSON(`${baseUrl}/v1/draft`, { method: 'POST', headers, body });
    expect(r2.status).toBe(429);
    
    // Verify JSON 429 counter incremented
    const health1 = await requestJSON(`${baseUrl}/v1/health`);
    expect(health1.data.json_429_count).toBeGreaterThanOrEqual(1);
    
    // SIGHUP to trigger config reload
    if (server.child.pid) {
      process.kill(server.child.pid, 'SIGHUP');
    }
    
    // Wait for reload timestamp to appear
    const health2 = await waitFor(
      async () => {
        const h = await requestJSON(`${baseUrl}/v1/health`);
        if (h.data?.last_config_reload_iso) {
          return h.data;
        }
        return null;
      },
      { timeout: 2000, interval: 100, label: 'config reload timestamp' }
    );
    
    expect(typeof health2.last_config_reload_iso).toBe('string');
    expect(health2.last_config_reload_iso.length).toBeGreaterThan(0);
  }, 15000);
});
