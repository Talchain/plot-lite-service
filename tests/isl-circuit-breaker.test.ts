/**
 * ISL Circuit Breaker Tests
 *
 * Phase 4: Sequential & Advanced - Circuit breaker integration tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldAllowIslCall,
  recordIslSuccess,
  recordIslFailure,
  getIslCircuitBreakerStats,
  resetIslCircuitBreaker,
} from '../src/integrations/isl-circuit-breaker.js';

describe('ISL Circuit Breaker', () => {
  beforeEach(() => {
    resetIslCircuitBreaker();
  });

  describe('shouldAllowIslCall', () => {
    it('allows calls in closed state', () => {
      const result = shouldAllowIslCall();
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns stats showing closed state initially', () => {
      const stats = getIslCircuitBreakerStats();
      expect(stats.state).toBe('closed');
      expect(stats.consecutiveFailures).toBe(0);
    });
  });

  describe('recordIslSuccess', () => {
    it('resets consecutive failures', () => {
      recordIslFailure();
      recordIslFailure();
      expect(getIslCircuitBreakerStats().consecutiveFailures).toBe(2);

      recordIslSuccess();
      expect(getIslCircuitBreakerStats().consecutiveFailures).toBe(0);
    });

    it('keeps circuit closed after success', () => {
      recordIslSuccess();
      const stats = getIslCircuitBreakerStats();
      expect(stats.state).toBe('closed');
    });
  });

  describe('recordIslFailure', () => {
    it('increments consecutive failures', () => {
      recordIslFailure();
      expect(getIslCircuitBreakerStats().consecutiveFailures).toBe(1);

      recordIslFailure();
      expect(getIslCircuitBreakerStats().consecutiveFailures).toBe(2);
    });

    it('opens circuit after threshold failures (default 3)', () => {
      recordIslFailure();
      recordIslFailure();
      expect(getIslCircuitBreakerStats().state).toBe('closed');

      recordIslFailure();
      expect(getIslCircuitBreakerStats().state).toBe('open');
    });

    it('blocks calls when circuit is open', () => {
      // Open the circuit
      recordIslFailure();
      recordIslFailure();
      recordIslFailure();

      const result = shouldAllowIslCall();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('circuit breaker open');
    });
  });

  describe('circuit breaker states', () => {
    it('transitions from closed to open after threshold', () => {
      expect(getIslCircuitBreakerStats().state).toBe('closed');

      for (let i = 0; i < 3; i++) {
        recordIslFailure();
      }

      expect(getIslCircuitBreakerStats().state).toBe('open');
    });

    it('success in closed state stays closed', () => {
      recordIslFailure();
      recordIslSuccess();

      const stats = getIslCircuitBreakerStats();
      expect(stats.state).toBe('closed');
      expect(stats.consecutiveFailures).toBe(0);
    });
  });

  describe('resetIslCircuitBreaker', () => {
    it('resets all state', () => {
      recordIslFailure();
      recordIslFailure();
      recordIslFailure();
      expect(getIslCircuitBreakerStats().state).toBe('open');

      resetIslCircuitBreaker();

      const stats = getIslCircuitBreakerStats();
      expect(stats.state).toBe('closed');
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.probeInFlight).toBe(false);
    });
  });

  describe('getIslCircuitBreakerStats', () => {
    it('returns all expected fields', () => {
      const stats = getIslCircuitBreakerStats();

      expect(stats).toHaveProperty('state');
      expect(stats).toHaveProperty('consecutiveFailures');
      expect(stats).toHaveProperty('threshold');
      expect(stats).toHaveProperty('cooldownMs');
      expect(stats).toHaveProperty('probeInFlight');
    });

    it('threshold is 3 by default', () => {
      const stats = getIslCircuitBreakerStats();
      expect(stats.threshold).toBe(3);
    });

    it('cooldownMs is 30000 by default', () => {
      const stats = getIslCircuitBreakerStats();
      expect(stats.cooldownMs).toBe(30_000);
    });
  });

  describe('integration scenarios', () => {
    it('recovers after success following failures', () => {
      recordIslFailure();
      recordIslFailure();
      expect(getIslCircuitBreakerStats().consecutiveFailures).toBe(2);

      recordIslSuccess();
      expect(getIslCircuitBreakerStats().consecutiveFailures).toBe(0);
      expect(getIslCircuitBreakerStats().state).toBe('closed');
    });

    it('consecutive successes keep circuit closed', () => {
      for (let i = 0; i < 5; i++) {
        recordIslSuccess();
      }

      const stats = getIslCircuitBreakerStats();
      expect(stats.state).toBe('closed');
      expect(stats.consecutiveFailures).toBe(0);
    });

    it('alternating success/failure stays closed', () => {
      for (let i = 0; i < 5; i++) {
        recordIslFailure();
        recordIslSuccess();
      }

      const stats = getIslCircuitBreakerStats();
      expect(stats.state).toBe('closed');
    });
  });
});
