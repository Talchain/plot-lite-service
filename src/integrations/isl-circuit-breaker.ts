/**
 * Lightweight in-memory circuit breaker for ISL operations
 * Protects against cascading failures by skipping ISL calls after N consecutive errors
 *
 * Phase 4: Sequential & Advanced - Circuit breaker integration
 */

interface CircuitBreakerState {
  consecutiveFailures: number;
  state: 'closed' | 'open' | 'half-open';
  openedAt: number | null;
  lastAttemptAt: number | null;
  probeInFlight: boolean;
}

// Default values
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30_000; // 30 seconds
const DEFAULT_HALF_OPEN_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Parse and validate a numeric env var with fallback
 */
function parsePositiveInt(raw: string | undefined, defaultVal: number): number {
  if (!raw || raw.trim() === '') return defaultVal;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultVal;
  return Math.floor(parsed);
}

function parsePositiveMs(raw: string | undefined, defaultVal: number): number {
  if (!raw || raw.trim() === '') return defaultVal;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultVal;
  return parsed;
}

// ISL Circuit breaker configuration (via environment variables)
const FAILURE_THRESHOLD = parsePositiveInt(
  process.env.ISL_CB_FAILURE_THRESHOLD,
  DEFAULT_FAILURE_THRESHOLD
);
const COOLDOWN_MS = parsePositiveMs(process.env.ISL_CB_COOLDOWN_MS, DEFAULT_COOLDOWN_MS);
const HALF_OPEN_TIMEOUT_MS = parsePositiveMs(
  process.env.ISL_CB_HALF_OPEN_TIMEOUT_MS,
  DEFAULT_HALF_OPEN_TIMEOUT_MS
);

// In-memory state (single instance for all ISL calls)
const state: CircuitBreakerState = {
  consecutiveFailures: 0,
  state: 'closed',
  openedAt: null,
  lastAttemptAt: null,
  probeInFlight: false,
};

/**
 * Check if the circuit breaker allows ISL calls
 * In half-open state, only one probe call is allowed at a time
 * @returns Object with allowed flag and reason
 */
export function shouldAllowIslCall(): { allowed: boolean; reason?: string } {
  const now = Date.now();

  // Update state based on time elapsed
  if (state.state === 'open' && state.openedAt !== null) {
    const elapsedSinceOpen = now - state.openedAt;
    if (elapsedSinceOpen >= COOLDOWN_MS) {
      // Transition to half-open: allow one test call
      state.state = 'half-open';
      state.lastAttemptAt = now;
      state.probeInFlight = true;
      return { allowed: true };
    }
    // Circuit still open
    const remainingMs = COOLDOWN_MS - elapsedSinceOpen;
    return {
      allowed: false,
      reason: `ISL circuit breaker open (${Math.ceil(remainingMs / 1000)}s remaining)`,
    };
  }

  if (state.state === 'half-open') {
    // Check for half-open timeout first
    if (state.lastAttemptAt !== null) {
      const elapsedSinceAttempt = now - state.lastAttemptAt;
      if (elapsedSinceAttempt >= HALF_OPEN_TIMEOUT_MS) {
        // Half-open timeout - reopen circuit
        state.state = 'open';
        state.openedAt = now;
        state.probeInFlight = false;
        return {
          allowed: false,
          reason: 'ISL circuit breaker reopened (probe timeout)',
        };
      }
    }

    // If a probe is already in flight, reject additional calls
    if (state.probeInFlight) {
      return {
        allowed: false,
        reason: 'ISL circuit breaker half-open (probe in flight)',
      };
    }

    // Half-open but no probe in flight - allow the call
    state.probeInFlight = true;
    state.lastAttemptAt = now;
    return { allowed: true };
  }

  // Closed: allow calls
  return { allowed: true };
}

/**
 * Record a successful ISL call
 * Resets the circuit breaker to closed state
 */
export function recordIslSuccess(): void {
  state.consecutiveFailures = 0;
  state.state = 'closed';
  state.openedAt = null;
  state.lastAttemptAt = null;
  state.probeInFlight = false;
}

/**
 * Record a failed ISL call
 * Opens the circuit if failure threshold is reached
 */
export function recordIslFailure(): void {
  state.consecutiveFailures += 1;
  state.probeInFlight = false;

  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.state = 'open';
    state.openedAt = Date.now();
  }
}

/**
 * Get current circuit breaker stats for observability
 */
export function getIslCircuitBreakerStats(): {
  state: string;
  consecutiveFailures: number;
  threshold: number;
  cooldownMs: number;
  probeInFlight: boolean;
} {
  return {
    state: state.state,
    consecutiveFailures: state.consecutiveFailures,
    threshold: FAILURE_THRESHOLD,
    cooldownMs: COOLDOWN_MS,
    probeInFlight: state.probeInFlight,
  };
}

/**
 * Reset the circuit breaker (for testing)
 */
export function resetIslCircuitBreaker(): void {
  state.consecutiveFailures = 0;
  state.state = 'closed';
  state.openedAt = null;
  state.lastAttemptAt = null;
  state.probeInFlight = false;
}
