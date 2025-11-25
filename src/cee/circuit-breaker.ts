/**
 * Lightweight in-memory circuit breaker for CEE operations
 * Protects against cascading failures by skipping CEE calls after N consecutive errors
 */

interface CircuitBreakerState {
  consecutiveFailures: number;
  state: 'closed' | 'open' | 'half-open';
  openedAt: number | null;
  lastAttemptAt: number | null;
}

// Circuit breaker configuration (via environment variables)
const FAILURE_THRESHOLD = Number(process.env.CEE_CB_FAILURE_THRESHOLD ?? 5);
const COOLDOWN_MS = Number(process.env.CEE_CB_COOLDOWN_MS ?? 30_000); // 30 seconds default
const HALF_OPEN_TIMEOUT_MS = Number(process.env.CEE_CB_HALF_OPEN_TIMEOUT_MS ?? 10_000); // 10 seconds

// In-memory state (single instance, not per-route or per-principal)
const state: CircuitBreakerState = {
  consecutiveFailures: 0,
  state: 'closed',
  openedAt: null,
  lastAttemptAt: null,
};

/**
 * Check if the circuit breaker allows CEE calls
 * @returns true if CEE calls are allowed, false if circuit is open
 */
export function shouldAllowCeeCall(): boolean {
  const now = Date.now();

  // Update state based on time elapsed
  if (state.state === 'open' && state.openedAt !== null) {
    const elapsedSinceOpen = now - state.openedAt;
    if (elapsedSinceOpen >= COOLDOWN_MS) {
      // Transition to half-open: allow one test call
      state.state = 'half-open';
      state.lastAttemptAt = now;
      return true;
    }
    // Circuit still open
    return false;
  }

  if (state.state === 'half-open' && state.lastAttemptAt !== null) {
    const elapsedSinceAttempt = now - state.lastAttemptAt;
    if (elapsedSinceAttempt >= HALF_OPEN_TIMEOUT_MS) {
      // Half-open timeout - reopen circuit
      state.state = 'open';
      state.openedAt = now;
      return false;
    }
  }

  // Closed or half-open: allow calls
  return true;
}

/**
 * Record a successful CEE call
 * Resets the circuit breaker to closed state
 */
export function recordCeeSuccess(): void {
  state.consecutiveFailures = 0;
  state.state = 'closed';
  state.openedAt = null;
  state.lastAttemptAt = null;
}

/**
 * Record a failed CEE call
 * Opens the circuit if failure threshold is reached
 */
export function recordCeeFailure(): void {
  state.consecutiveFailures += 1;

  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.state = 'open';
    state.openedAt = Date.now();
  }
}

/**
 * Get current circuit breaker stats for observability
 */
export function getCeeCircuitBreakerStats(): {
  state: string;
  consecutiveFailures: number;
  threshold: number;
  cooldownMs: number;
} {
  return {
    state: state.state,
    consecutiveFailures: state.consecutiveFailures,
    threshold: FAILURE_THRESHOLD,
    cooldownMs: COOLDOWN_MS,
  };
}

/**
 * Reset the circuit breaker (for testing)
 */
export function resetCeeCircuitBreaker(): void {
  state.consecutiveFailures = 0;
  state.state = 'closed';
  state.openedAt = null;
  state.lastAttemptAt = null;
}
