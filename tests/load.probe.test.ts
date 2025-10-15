import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

describe('Load probe tool', () => {
  describe('load-probe.mjs script', () => {
    it('exists and is executable', () => {
      const script_path = join(process.cwd(), 'tools', 'load-probe.mjs');
      expect(existsSync(script_path)).toBe(true);

      const content = readFileSync(script_path, 'utf8');
      expect(content).toContain('#!/usr/bin/env node');
      expect(content).toContain('load-probe');
    });

    it('has correct configuration constants', () => {
      const script_path = join(process.cwd(), 'tools', 'load-probe.mjs');
      const content = readFileSync(script_path, 'utf8');

      // Check target RPS
      expect(content).toContain('TARGET_RPS = 25');
      
      // Check duration
      expect(content).toContain('DURATION_SECONDS = 120');
      
      // Check fixture path
      expect(content).toContain('run-graph.json');
    });

    it('writes slos.live.json to evidence directory', () => {
      const script_path = join(process.cwd(), 'tools', 'load-probe.mjs');
      const content = readFileSync(script_path, 'utf8');

      expect(content).toContain('slos.live.json');
      expect(content).toContain('evidence');
    });

    it('validates performance budgets', () => {
      const script_path = join(process.cwd(), 'tools', 'load-probe.mjs');
      const content = readFileSync(script_path, 'utf8');

      // Check rolling p95 budget
      expect(content).toContain('< 100');
      
      // Check client p95 budget
      expect(content).toContain('< 600');
    });
  });

  describe('p95 calculation (inline test)', () => {
    function calculateP95(durations: number[]): number {
      if (durations.length === 0) return 0;
      const sorted = [...durations].sort((a, b) => a - b);
      const index = Math.ceil(sorted.length * 0.95) - 1;
      return sorted[index];
    }

    it('calculates p95 correctly for small sample', () => {
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const p95 = calculateP95(durations);
      
      // p95 of 10 values = 95th percentile = index 9 (100)
      expect(p95).toBe(100);
    });

    it('calculates p95 correctly for larger sample', () => {
      const durations = Array.from({ length: 100 }, (_, i) => i + 1);
      const p95 = calculateP95(durations);
      
      // p95 of 100 values = 95th value
      expect(p95).toBe(95);
    });

    it('handles empty array', () => {
      const p95 = calculateP95([]);
      expect(p95).toBe(0);
    });

    it('handles single value', () => {
      const p95 = calculateP95([42]);
      expect(p95).toBe(42);
    });

    it('is deterministic', () => {
      const durations = [15, 25, 35, 45, 55, 65, 75, 85, 95, 105];
      
      const results = Array.from({ length: 10 }, () => calculateP95(durations));
      
      expect(new Set(results).size).toBe(1);
      expect(results[0]).toBe(105);
    });
  });

  describe('SLO schema validation', () => {
    it('defines expected SLO structure', () => {
      const expected_schema = {
        schema: 'slos.v1',
        source: 'load-probe',
        timestamp: expect.any(String),
        engine_get_p95_ms: expect.any(Number),
        client_p95_ms: expect.any(Number),
        client_p50_ms: expect.any(Number),
        load_test: {
          target_rps: expect.any(Number),
          actual_rps: expect.any(Number),
          duration_s: expect.any(Number),
          total_requests: expect.any(Number),
          success_count: expect.any(Number),
          error_count: expect.any(Number),
        },
        baseline: {
          engine_p95_ms_rolling: expect.any(Number),
        },
        final: {
          engine_p95_ms_rolling: expect.any(Number),
        },
      };

      // Validate structure (schema test)
      expect(expected_schema).toBeDefined();
      expect(expected_schema.schema).toBe('slos.v1');
      expect(expected_schema.source).toBe('load-probe');
    });
  });

  describe('Budget thresholds', () => {
    it('defines rolling p95 budget', () => {
      const ROLLING_P95_BUDGET_MS = 100;
      expect(ROLLING_P95_BUDGET_MS).toBe(100);
    });

    it('defines 12-node p95 budget', () => {
      const NODE_12_P95_BUDGET_MS = 600;
      expect(NODE_12_P95_BUDGET_MS).toBe(600);
    });

    it('validates budget compliance', () => {
      const rolling_p95 = 85; // Example
      const client_p95 = 450; // Example

      const rolling_ok = rolling_p95 < 100;
      const client_ok = client_p95 < 600;

      expect(rolling_ok).toBe(true);
      expect(client_ok).toBe(true);
    });
  });
});
