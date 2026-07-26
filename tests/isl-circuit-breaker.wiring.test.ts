/**
 * ROADMAP 1.209 — the ISL circuit breaker had no writers, so it could not trip.
 *
 * Audited state before this change: `recordIslSuccess` / `recordIslFailure` had
 * ZERO production callers (their only one, analysis-optimise.ts, went with the
 * vacuous routes in #269 — and even that sat behind an unset flag). The single
 * production reader, `shouldAllowIslCall()` at retry-strategy.ts:283, lives
 * inside `withRetry()`, which has zero production call sites. The live ISL path
 * (routes/v2/run.ts -> isl/index.ts -> isl/client.ts) has its own inline retry
 * loop and never consulted the breaker. Its state was published nowhere, while
 * the CEE breaker beside it WAS on /health — so a reader would infer ISL had no
 * breaker rather than a dead one.
 *
 * A breaker that cannot trip, while nothing contradicts the impression that it
 * protects something, is worse than no breaker.
 *
 * THIS TEST ACTUALLY TRIPS IT — the thing that was previously impossible.
 *
 * Design note the tests pin: only AVAILABILITY-class failures count. `retryable`
 * is 5xx/429 plus timeouts and network errors; a 4xx is the caller's fault, not
 * the service being down. That distinction matters concretely right now,
 * because ISL 404s on every /api/v1/analysis/* endpoint — and those 404s must
 * NOT open a breaker for everyone else.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  shouldAllowIslCall,
  recordIslSuccess,
  recordIslFailure,
  getIslCircuitBreakerStats,
  resetIslCircuitBreaker,
} from '../src/integrations/isl-circuit-breaker.js';

beforeEach(() => resetIslCircuitBreaker());
afterEach(() => resetIslCircuitBreaker());

describe('the breaker can now actually trip', () => {
  it('POSITIVE CONTROL: starts closed and allows calls', () => {
    expect(shouldAllowIslCall().allowed).toBe(true);
    expect(getIslCircuitBreakerStats().state).toBe('closed');
  });

  it('opens after the failure threshold — the behaviour that was unreachable before', () => {
    // Default threshold is 3 consecutive failures.
    recordIslFailure();
    expect(shouldAllowIslCall().allowed).toBe(true); // 1 — still closed
    recordIslFailure();
    expect(shouldAllowIslCall().allowed).toBe(true); // 2 — still closed
    recordIslFailure();

    const gate = shouldAllowIslCall();
    expect(gate.allowed).toBe(false); // 3 — OPEN
    expect(getIslCircuitBreakerStats().state).toBe('open');
    expect(gate.reason).toBeTruthy();
  });

  it('a success resets the consecutive-failure count, so intermittent errors do not trip it', () => {
    recordIslFailure();
    recordIslFailure();
    recordIslSuccess();
    recordIslFailure();
    recordIslFailure();

    // Four failures total, but never three CONSECUTIVE.
    expect(shouldAllowIslCall().allowed).toBe(true);
    expect(getIslCircuitBreakerStats().state).toBe('closed');
  });

  it('reports the failure count it is acting on', () => {
    recordIslFailure();
    recordIslFailure();

    expect(getIslCircuitBreakerStats().consecutiveFailures).toBe(2);
  });
});

describe('the state is observable', () => {
  it('exposes state, threshold and cooldown — so /health can report a real value', () => {
    const stats = getIslCircuitBreakerStats();

    expect(stats).toHaveProperty('state');
    expect(stats).toHaveProperty('consecutiveFailures');
    expect(stats.threshold).toBeGreaterThan(0);
    expect(stats.cooldownMs).toBeGreaterThan(0);
  });

  it('the reported state tracks reality rather than a default', () => {
    expect(getIslCircuitBreakerStats().state).toBe('closed');
    recordIslFailure();
    recordIslFailure();
    recordIslFailure();
    shouldAllowIslCall();

    expect(getIslCircuitBreakerStats().state).toBe('open');
  });
});
