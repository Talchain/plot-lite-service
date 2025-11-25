/**
 * Lightweight in-memory circuit breaker for CEE operations
 * Protects against cascading failures by skipping CEE calls after N consecutive errors
 */

interface CircuitBreakerState {
  consecutiveFailures: number;
  state: 'closed' | 'open' | 'half-open';
  openedAt: number | null;
  lastAttemptAt: number | null;
  probeInFlight: boolean; // Single-probe guard for half-open state
}

// Default values
const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30_000; // 30 seconds
const DEFAULT_HALF_OPEN_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Parse and validate a numeric env var with fallback
 * Returns the default if value is missing, empty, NaN, or non-positive
 */
function parsePositiveInt(raw: string | undefined, defaultVal: number): number {
  if (!raw || raw.trim() === '') return defaultVal;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultVal;
  return Math.floor(parsed); // Ensure integer for threshold
}

function parsePositiveMs(raw: string | undefined, defaultVal: number): number {
  if (!raw || raw.trim() === '') return defaultVal;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultVal;
  return parsed;
}

// Circuit breaker configuration (via environment variables, with validation)
const FAILURE_THRESHOLD = parsePositiveInt(process.env.CEE_CB_FAILURE_THRESHOLD, DEFAULT_FAILURE_THRESHOLD);
const COOLDOWN_MS = parsePositiveMs(process.env.CEE_CB_COOLDOWN_MS, DEFAULT_COOLDOWN_MS);
const HALF_OPEN_TIMEOUT_MS = parsePositiveMs(process.env.CEE_CB_HALF_OPEN_TIMEOUT_MS, DEFAULT_HALF_OPEN_TIMEOUT_MS);

// In-memory state (single instance, not per-route or per-principal)
const state: CircuitBreakerState = {
  consecutiveFailures: 0,
  state: 'closed',
  openedAt: null,
  lastAttemptAt: null,
  probeInFlight: false,
};

/**
 * Check if the circuit breaker allows CEE calls
 * In half-open state, only one probe call is allowed at a time
 * @returns true if CEE calls are allowed, false if circuit is open or probe in flight
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
      state.probeInFlight = true; // Mark probe as in-flight
      return true;
    }
    // Circuit still open
    return false;
  }

  if (state.state === 'half-open') {
    // Check for half-open timeout first (probe took too long without result)
    if (state.lastAttemptAt !== null) {
      const elapsedSinceAttempt = now - state.lastAttemptAt;
      if (elapsedSinceAttempt >= HALF_OPEN_TIMEOUT_MS) {
        // Half-open timeout - reopen circuit
        state.state = 'open';
        state.openedAt = now;
        state.probeInFlight = false;
        return false;
      }
    }

    // If a probe is already in flight, reject additional calls
    if (state.probeInFlight) {
      return false;
    }

    // Half-open but no probe in flight - this shouldn't normally happen,
    // but allow the call and mark as in-flight
    state.probeInFlight = true;
    state.lastAttemptAt = now;
    return true;
  }

  // Closed: allow calls
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
  state.probeInFlight = false;
}

/**
 * Record a failed CEE call
 * Opens the circuit if failure threshold is reached
 */
export function recordCeeFailure(): void {
  state.consecutiveFailures += 1;
  state.probeInFlight = false; // Clear probe flag on any result

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
export function resetCeeCircuitBreaker(): void {
  state.consecutiveFailures = 0;
  state.state = 'closed';
  state.openedAt = null;
  state.lastAttemptAt = null;
  state.probeInFlight = false;
}
