import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkThreshold,
  startMonitoring,
  stopMonitoring,
  getState,
  resetState,
  setTestOverrides,
} from '../src/monitoring/rolling-p95-monitor.js';

describe('Rolling P95 threshold monitoring', () => {
  let mockP95Value = 0;
  let warnings: Array<{ data: any; message: string }> = [];

  beforeEach(() => {
    mockP95Value = 0;
    warnings = [];
    resetState();
    
    // Override functions for testing
    setTestOverrides({
      getRollingP95Ms: () => mockP95Value,
      logWarning: (data, message) => {
        warnings.push({ data, message });
      },
    });
  });

  afterEach(() => {
    stopMonitoring();
  });

  it('does not warn when p95 is below threshold', () => {
    mockP95Value = 50; // Below 100ms threshold
    
    for (let i = 0; i < 10; i++) {
      checkThreshold();
    }
    
    expect(warnings).toHaveLength(0);
    expect(getState().consecutiveHighCount).toBe(0);
  });

  it('increments counter when p95 exceeds threshold', () => {
    mockP95Value = 150; // Above 100ms threshold
    
    checkThreshold();
    expect(getState().consecutiveHighCount).toBe(1);
    
    checkThreshold();
    expect(getState().consecutiveHighCount).toBe(2);
    
    checkThreshold();
    expect(getState().consecutiveHighCount).toBe(3);
  });

  it('resets counter when p95 drops below threshold', () => {
    mockP95Value = 150;
    
    checkThreshold();
    checkThreshold();
    expect(getState().consecutiveHighCount).toBe(2);
    
    mockP95Value = 50; // Drop below threshold
    checkThreshold();
    expect(getState().consecutiveHighCount).toBe(0);
  });

  it('logs warning after 5 consecutive high readings', () => {
    mockP95Value = 150;
    
    // First 4 checks: no warning
    for (let i = 0; i < 4; i++) {
      checkThreshold();
    }
    expect(warnings).toHaveLength(0);
    
    // 5th check: warning logged
    checkThreshold();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('engine_p95 high for 5m');
    expect(warnings[0].data.rolling_p95_ms).toBe(150);
    expect(warnings[0].data.threshold_ms).toBe(100);
    expect(warnings[0].data.consecutive_minutes).toBe(5);
  });

  it('does not spam warnings (max 1 per hour)', () => {
    mockP95Value = 150;
    
    // Trigger initial warning
    for (let i = 0; i < 5; i++) {
      checkThreshold();
    }
    expect(warnings).toHaveLength(1);
    
    // Continue checking (should not log more warnings)
    for (let i = 0; i < 10; i++) {
      checkThreshold();
    }
    expect(warnings).toHaveLength(1); // Still only 1 warning
  });

  it('includes correct metadata in warning', () => {
    mockP95Value = 175;
    
    for (let i = 0; i < 5; i++) {
      checkThreshold();
    }
    
    expect(warnings).toHaveLength(1);
    const warning = warnings[0];
    
    expect(warning.data).toHaveProperty('rolling_p95_ms');
    expect(warning.data).toHaveProperty('threshold_ms');
    expect(warning.data).toHaveProperty('consecutive_minutes');
    expect(warning.data.rolling_p95_ms).toBe(175);
    expect(warning.data.threshold_ms).toBe(100);
    expect(warning.data.consecutive_minutes).toBeGreaterThanOrEqual(5);
  });

  it('can start and stop monitoring', () => {
    expect(() => {
      startMonitoring({ checkIntervalMs: 100 });
      stopMonitoring();
    }).not.toThrow();
  });

  it('does not start monitoring twice', () => {
    startMonitoring();
    startMonitoring(); // Should be no-op
    stopMonitoring();
  });
});
