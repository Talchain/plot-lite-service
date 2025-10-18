/**
 * WP-P3: Rate-Limit Circuit Breaker
 * Flag: RL_CB_ENABLE='1'
 * 
 * Prevents burst cascades by opening circuit on sustained overload.
 * States: closed → open → half_open → closed
 */
import type { FastifyRequest, FastifyReply } from 'fastify';

type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: number;
  openedAt: number;
  halfOpenProbes: number;
}

// Config from env with safe defaults
const CONFIG = {
  enabled: process.env.RL_CB_ENABLE === '1',
  qpsThreshold: parseInt(process.env.RL_CB_QPS || '100', 10),
  windowMs: parseInt(process.env.RL_CB_WINDOW_MS || '10000', 10), // 10s
  cooldownMs: parseInt(process.env.RL_CB_COOLDOWN_MS || '30000', 10), // 30s
  failureThreshold: parseInt(process.env.RL_CB_FAILURE_THRESHOLD || '50', 10),
  halfOpenProbes: parseInt(process.env.RL_CB_HALF_OPEN_PROBES || '3', 10),
};

// Global circuit state
const globalCircuit: CircuitStats = {
  state: 'closed',
  failures: 0,
  successes: 0,
  lastFailureAt: 0,
  openedAt: 0,
  halfOpenProbes: 0,
};

// Per-principal circuits (bounded map)
const principalCircuits = new Map<string, CircuitStats>();
const MAX_PRINCIPAL_CIRCUITS = 1000;

// Metrics
let circuitOpenTotal = 0;
let circuitHalfOpenTotal = 0;
let circuitClosedTotal = 0;

/**
 * Get or create circuit for principal
 */
function getCircuit(principal: string | undefined): CircuitStats {
  const key = principal || 'unknown';
  let circuit = principalCircuits.get(key);
  if (!circuit) {
    // Evict oldest if at capacity
    if (principalCircuits.size >= MAX_PRINCIPAL_CIRCUITS) {
      const firstKey = principalCircuits.keys().next().value;
      if (firstKey !== undefined) {
        principalCircuits.delete(firstKey);
      }
    }
    circuit = {
      state: 'closed',
      failures: 0,
      successes: 0,
      lastFailureAt: 0,
      openedAt: 0,
      halfOpenProbes: 0,
    };
    principalCircuits.set(key, circuit);
  }
  return circuit;
}

/**
 * Check if circuit should trip to open
 */
function shouldTrip(circuit: CircuitStats): boolean {
  const now = Date.now();
  const windowStart = now - CONFIG.windowMs;
  
  // Reset old failures outside window
  if (circuit.lastFailureAt < windowStart) {
    circuit.failures = 0;
  }
  
  return circuit.failures >= CONFIG.failureThreshold;
}

/**
 * Check if circuit can transition from open to half-open
 */
function canAttemptRecovery(circuit: CircuitStats): boolean {
  const now = Date.now();
  const cooldownElapsed = now - circuit.openedAt >= CONFIG.cooldownMs;
  return cooldownElapsed;
}

/**
 * Transition circuit state
 */
function transitionTo(circuit: CircuitStats, newState: CircuitState): void {
  const now = Date.now();
  circuit.state = newState;
  
  if (newState === 'open') {
    circuit.openedAt = now;
    circuit.halfOpenProbes = 0;
    circuitOpenTotal++;
  } else if (newState === 'half_open') {
    circuit.halfOpenProbes = 0;
    circuitHalfOpenTotal++;
  } else if (newState === 'closed') {
    circuit.failures = 0;
    circuit.successes = 0;
    circuitClosedTotal++;
  }
}

/**
 * Record request outcome
 */
function recordOutcome(circuit: CircuitStats, is429: boolean): void {
  const now = Date.now();
  
  if (is429) {
    circuit.failures++;
    circuit.lastFailureAt = now;
    
    // Check if should trip
    if (circuit.state === 'closed' && shouldTrip(circuit)) {
      transitionTo(circuit, 'open');
    }
  } else {
    circuit.successes++;
    
    // In half-open, successful probes can close circuit
    if (circuit.state === 'half_open') {
      circuit.halfOpenProbes++;
      if (circuit.halfOpenProbes >= CONFIG.halfOpenProbes) {
        transitionTo(circuit, 'closed');
      }
    }
  }
}

/**
 * Circuit breaker middleware
 */
export async function circuitBreakerMiddleware(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!CONFIG.enabled) {
    return; // Pass through
  }
  
  // Extract principal (reuse existing logic)
  const principal = (req as any).principal || req.ip || 'unknown';
  
  // Check global circuit
  if (globalCircuit.state === 'open') {
    if (canAttemptRecovery(globalCircuit)) {
      transitionTo(globalCircuit, 'half_open');
    } else {
      const retryAfter = Math.ceil((globalCircuit.openedAt + CONFIG.cooldownMs - Date.now()) / 1000);
      reply.header('Retry-After', String(retryAfter));
      reply.header('X-RateLimit-Reason', 'circuit_open_global');
      await reply.code(503).send({
        error: {
          type: 'SERVICE_UNAVAILABLE',
          message: 'Circuit breaker open (global)',
          retry_after_seconds: retryAfter,
        },
      });
      return;
    }
  }
  
  // Check per-principal circuit
  const circuit = getCircuit(principal);
  if (circuit.state === 'open') {
    if (canAttemptRecovery(circuit)) {
      transitionTo(circuit, 'half_open');
    } else {
      const retryAfter = Math.ceil((circuit.openedAt + CONFIG.cooldownMs - Date.now()) / 1000);
      reply.header('Retry-After', String(retryAfter));
      reply.header('X-RateLimit-Reason', 'circuit_open_principal');
      await reply.code(503).send({
        error: {
          type: 'SERVICE_UNAVAILABLE',
          message: 'Circuit breaker open (principal)',
          retry_after_seconds: retryAfter,
        },
      });
      return;
    }
  }
  
  // Allow request to proceed, but track outcome via onResponse hook
  // Note: We'll add this tracking in the main server setup
}

/**
 * Track response for circuit breaker
 */
export function trackCircuitBreakerResponse(
  req: FastifyRequest,
  reply: FastifyReply
): void {
  if (!CONFIG.enabled) return;
  
  const principal = (req as any).principal || req.ip || 'unknown';
  const is429 = reply.statusCode === 429;
  
  // Update global circuit
  recordOutcome(globalCircuit, is429);
  
  // Update per-principal circuit
  const circuit = getCircuit(principal);
  recordOutcome(circuit, is429);
}

/**
 * Get circuit breaker stats for observability
 */
export function getCircuitBreakerStats() {
  if (!CONFIG.enabled) {
    return null;
  }
  
  return {
    global: {
      state: globalCircuit.state,
      failures: globalCircuit.failures,
      successes: globalCircuit.successes,
    },
    principals: {
      tracked: principalCircuits.size,
      open: Array.from(principalCircuits.values()).filter(c => c.state === 'open').length,
      half_open: Array.from(principalCircuits.values()).filter(c => c.state === 'half_open').length,
    },
    metrics: {
      circuit_open_total: circuitOpenTotal,
      circuit_half_open_total: circuitHalfOpenTotal,
      circuit_closed_total: circuitClosedTotal,
    },
  };
}

/**
 * Reset circuit breaker (for testing)
 */
export function resetCircuitBreaker(): void {
  globalCircuit.state = 'closed';
  globalCircuit.failures = 0;
  globalCircuit.successes = 0;
  globalCircuit.lastFailureAt = 0;
  globalCircuit.openedAt = 0;
  globalCircuit.halfOpenProbes = 0;
  
  principalCircuits.clear();
  
  circuitOpenTotal = 0;
  circuitHalfOpenTotal = 0;
  circuitClosedTotal = 0;
}
