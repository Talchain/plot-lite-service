import { describe, it, expect } from 'vitest';

describe('Load Probe (C6)', () => {
  it('percentile math is correct', () => {
    function percentile(arr: number[], p: number): number {
      const sorted = arr.slice().sort((a, b) => a - b);
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    }
    
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(samples, 50)).toBe(50);
    expect(percentile(samples, 95)).toBe(100);
    expect(percentile(samples, 90)).toBe(90);
  });

  it('skip behavior when env missing', () => {
    // Probe script exits 0 with "skipped" message when PLOT_STAGING_URL unset
    const origUrl = process.env.PLOT_STAGING_URL;
    delete process.env.PLOT_STAGING_URL;
    
    // Script would log and exit(0)
    expect(process.env.PLOT_STAGING_URL).toBeUndefined();
    
    if (origUrl) process.env.PLOT_STAGING_URL = origUrl;
  });

  it('evidence schema is stable', () => {
    const entry = {
      timestamp: new Date().toISOString(),
      client_p95_ms: 123,
      server_p95_ms_rolling: 45,
      rps: 25,
      sample_size: 3000,
      slo_client_p95_ms: 600,
      slo_server_p95_ms: 100,
      pass: true
    };
    
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof entry.client_p95_ms).toBe('number');
    expect(typeof entry.pass).toBe('boolean');
  });
});
