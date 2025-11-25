import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  shouldAllowCeeCall,
  recordCeeSuccess,
  recordCeeFailure,
  getCeeCircuitBreakerStats,
  resetCeeCircuitBreaker,
} from '../src/cee/circuit-breaker.js';

describe('CEE Circuit Breaker', () => {
  beforeEach(() => {
    resetCeeCircuitBreaker();
    vi.useFakeTimers();
  });

  describe('Initial state', () => {
    it('starts in closed state', () => {
      const stats = getCeeCircuitBreakerStats();
      expect(stats.state).toBe('closed');
      expect(stats.consecutiveFailures).toBe(0);
      expect(shouldAllowCeeCall()).toBe(true);
    });
  });

  describe('Failure tracking', () => {
    it('tracks consecutive failures', () => {
      recordCeeFailure();
      expect(getCeeCircuitBreakerStats().consecutiveFailures).toBe(1);

      recordCeeFailure();
      expect(getCeeCircuitBreakerStats().consecutiveFailures).toBe(2);
    });

    it('opens circuit after threshold failures (default: 5)', () => {
      for (let i = 0; i < 4; i++) {
        recordCeeFailure();
        expect(getCeeCircuitBreakerStats().state).toBe('closed');
        expect(shouldAllowCeeCall()).toBe(true);
      }

      // 5th failure opens the circuit
      recordCeeFailure();
      expect(getCeeCircuitBreakerStats().state).toBe('open');
      expect(shouldAllowCeeCall()).toBe(false);
    });

    it('resets failures on success', () => {
      recordCeeFailure();
      recordCeeFailure();
      expect(getCeeCircuitBreakerStats().consecutiveFailures).toBe(2);

      recordCeeSuccess();
      const stats = getCeeCircuitBreakerStats();
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.state).toBe('closed');
    });
  });

  describe('Open state', () => {
    beforeEach(() => {
      // Open the circuit by recording 5 failures
      for (let i = 0; i < 5; i++) {
        recordCeeFailure();
      }
      expect(getCeeCircuitBreakerStats().state).toBe('open');
    });

    it('blocks calls when open', () => {
      expect(shouldAllowCeeCall()).toBe(false);
    });

    it('transitions to half-open after cooldown (default: 30s)', () => {
      expect(shouldAllowCeeCall()).toBe(false);

      // Advance time by 29 seconds - still open
      vi.advanceTimersByTime(29_000);
      expect(shouldAllowCeeCall()).toBe(false);
      expect(getCeeCircuitBreakerStats().state).toBe('open');

      // Advance time by 1 more second - transitions to half-open
      vi.advanceTimersByTime(1_000);
      expect(shouldAllowCeeCall()).toBe(true);
      expect(getCeeCircuitBreakerStats().state).toBe('half-open');
    });
  });

  describe('Half-open state', () => {
    beforeEach(() => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        recordCeeFailure();
      }
      // Wait for cooldown to enter half-open
      vi.advanceTimersByTime(30_000);
      shouldAllowCeeCall(); // Triggers transition to half-open and starts probe
      expect(getCeeCircuitBreakerStats().state).toBe('half-open');
    });

    it('blocks additional calls while probe is in flight (single-probe guard)', () => {
      // Probe is already in flight from beforeEach
      expect(getCeeCircuitBreakerStats().probeInFlight).toBe(true);
      // Additional calls should be blocked
      expect(shouldAllowCeeCall()).toBe(false);
      expect(shouldAllowCeeCall()).toBe(false);
    });

    it('closes circuit on success', () => {
      recordCeeSuccess();
      const stats = getCeeCircuitBreakerStats();
      expect(stats.state).toBe('closed');
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.probeInFlight).toBe(false);
      expect(shouldAllowCeeCall()).toBe(true);
    });

    it('reopens circuit if probe times out (after 10s)', () => {
      // Probe is in flight from beforeEach
      expect(getCeeCircuitBreakerStats().probeInFlight).toBe(true);

      // Advance time by 9 seconds - still half-open, but calls blocked
      vi.advanceTimersByTime(9_000);
      expect(shouldAllowCeeCall()).toBe(false); // Still blocked by probe in flight
      expect(getCeeCircuitBreakerStats().state).toBe('half-open');

      // Advance time by 1 more second - timeout, reopens
      vi.advanceTimersByTime(1_000);
      expect(shouldAllowCeeCall()).toBe(false);
      expect(getCeeCircuitBreakerStats().state).toBe('open');
    });

    it('reopens circuit on explicit failure', () => {
      recordCeeFailure();
      expect(getCeeCircuitBreakerStats().state).toBe('open');
      expect(getCeeCircuitBreakerStats().probeInFlight).toBe(false);
      expect(shouldAllowCeeCall()).toBe(false);
    });

    it('allows new probe after previous probe completes (success)', () => {
      // First probe succeeds, closes circuit
      recordCeeSuccess();
      expect(getCeeCircuitBreakerStats().state).toBe('closed');

      // Open circuit again
      for (let i = 0; i < 5; i++) {
        recordCeeFailure();
      }

      // Wait for cooldown
      vi.advanceTimersByTime(30_000);
      expect(shouldAllowCeeCall()).toBe(true); // New probe allowed
      expect(getCeeCircuitBreakerStats().probeInFlight).toBe(true);
    });

    it('allows new probe after previous probe completes (failure)', () => {
      // First probe fails
      recordCeeFailure();
      expect(getCeeCircuitBreakerStats().state).toBe('open');
      expect(getCeeCircuitBreakerStats().probeInFlight).toBe(false);

      // Wait for cooldown
      vi.advanceTimersByTime(30_000);
      expect(shouldAllowCeeCall()).toBe(true); // New probe allowed
      expect(getCeeCircuitBreakerStats().probeInFlight).toBe(true);
    });
  });

  describe('Full cycle', () => {
    it('closed -> open -> half-open -> closed', () => {
      // Start closed
      expect(getCeeCircuitBreakerStats().state).toBe('closed');

      // 5 failures -> open
      for (let i = 0; i < 5; i++) {
        recordCeeFailure();
      }
      expect(getCeeCircuitBreakerStats().state).toBe('open');
      expect(shouldAllowCeeCall()).toBe(false);

      // Wait 30s -> half-open
      vi.advanceTimersByTime(30_000);
      expect(shouldAllowCeeCall()).toBe(true);
      expect(getCeeCircuitBreakerStats().state).toBe('half-open');

      // Success -> closed
      recordCeeSuccess();
      expect(getCeeCircuitBreakerStats().state).toBe('closed');
      expect(shouldAllowCeeCall()).toBe(true);
    });

    it('closed -> open -> half-open -> open (timeout)', () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        recordCeeFailure();
      }

      // Transition to half-open
      vi.advanceTimersByTime(30_000);
      shouldAllowCeeCall();
      expect(getCeeCircuitBreakerStats().state).toBe('half-open');

      // Wait for timeout (10s) -> back to open
      vi.advanceTimersByTime(10_000);
      expect(shouldAllowCeeCall()).toBe(false);
      expect(getCeeCircuitBreakerStats().state).toBe('open');
    });
  });

  describe('Stats exposure', () => {
    it('exposes current state and config', () => {
      const stats = getCeeCircuitBreakerStats();
      expect(stats).toHaveProperty('state');
      expect(stats).toHaveProperty('consecutiveFailures');
      expect(stats).toHaveProperty('threshold');
      expect(stats).toHaveProperty('cooldownMs');
      expect(stats).toHaveProperty('probeInFlight');
      expect(stats.threshold).toBe(5);
      expect(stats.cooldownMs).toBe(30_000);
      expect(stats.probeInFlight).toBe(false);
    });

    it('updates stats in real-time', () => {
      recordCeeFailure();
      expect(getCeeCircuitBreakerStats().consecutiveFailures).toBe(1);

      recordCeeFailure();
      expect(getCeeCircuitBreakerStats().consecutiveFailures).toBe(2);

      recordCeeSuccess();
      expect(getCeeCircuitBreakerStats().consecutiveFailures).toBe(0);
    });

    it('tracks probeInFlight status', () => {
      // Start closed, no probe
      expect(getCeeCircuitBreakerStats().probeInFlight).toBe(false);

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        recordCeeFailure();
      }
      expect(getCeeCircuitBreakerStats().probeInFlight).toBe(false);

      // Wait for cooldown and trigger probe
      vi.advanceTimersByTime(30_000);
      shouldAllowCeeCall();
      expect(getCeeCircuitBreakerStats().probeInFlight).toBe(true);

      // Complete probe with success
      recordCeeSuccess();
      expect(getCeeCircuitBreakerStats().probeInFlight).toBe(false);
    });
  });
});
