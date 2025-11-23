/**
 * WP-P3: Rate-Limit Circuit Breaker
 * Flag: RL_CB_ENABLE='1'
 * 
 * Prevents burst cascades by opening circuit on sustained overload.
 * States: closed → open → half_open → closed
 * 
 * PR-2A: Added sliding window with ring buffer for accurate burst detection
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SlidingWindow } from './cb/window.js';
import { BoundedLRU } from '../lib/BoundedLRU.js';
import { extractPrincipal, isPrincipalExtractionEnabled } from '../lib/extractPrincipal.js'; // PR-3

type CircuitState = 'closed' | 'open' | 'half_open';
type TransitionReason = 'threshold' | 'half_open_timeout' | 'probes_success'; // PR-2C.1

interface CircuitStats {
  state: CircuitState;
  failureWindow: SlidingWindow; // PR-2A: Ring buffer for sliding window
  successes: number;
  openedAt: number;
  halfOpenProbes: number;
  halfOpenAt?: number; // PR-2C: Timestamp when entered half-open
  lastTransitionAt?: number; // PR-2C: Last state transition timestamp
}

// Config from env with safe defaults
const CONFIG = {
  enabled: process.env.RL_CB_ENABLE === '1',
  qpsThreshold: parseInt(process.env.RL_CB_QPS || '100', 10),
  windowMs: parseInt(process.env.RL_CB_WINDOW_MS || '10000', 10), // 10s
  cooldownMs: parseInt(process.env.RL_CB_COOLDOWN_MS || '30000', 10), // 30s
  failureThreshold: parseInt(process.env.RL_CB_FAILURE_THRESHOLD || '50', 10),
  halfOpenProbes: parseInt(process.env.RL_CB_HALF_OPEN_PROBES || '3', 10),
  halfOpenTimeoutMs: parseInt(process.env.RL_CB_HALF_OPEN_TIMEOUT_MS || '60000', 10), // PR-2C: 60s
};

// Global circuit state
const globalCircuit: CircuitStats = {
  state: 'closed',
  failureWindow: new SlidingWindow(CONFIG.failureThreshold),
  successes: 0,
  openedAt: 0,
  halfOpenProbes: 0,
};

// PR-2B: Per-principal circuits with BoundedLRU (memory-bounded, true LRU)
const PRINCIPAL_MAX = parseInt(process.env.RL_CB_MAX_PRINCIPALS || '1000', 10);
// PR-2C: Default TTL = Infinity to prevent spaced-burst bypass
const PRINCIPAL_TTL = process.env.RL_CB_PRINCIPAL_TTL_MS 
  ? parseInt(process.env.RL_CB_PRINCIPAL_TTL_MS, 10)
  : Infinity;

if (PRINCIPAL_TTL !== Infinity) {
  console.warn('[CB] RL_CB_PRINCIPAL_TTL_MS set to finite value. Time-spaced bursts may bypass circuit.');
}

const principalCircuits = new BoundedLRU<CircuitStats>({
  maxSize: PRINCIPAL_MAX,
  ttlMs: PRINCIPAL_TTL,
});

// PR-3: Check if principal extraction is enabled
const principalExtractionEnabled = isPrincipalExtractionEnabled();
if (CONFIG.enabled && !principalExtractionEnabled) {
  console.error('[circuit-breaker] RL_CB_ENABLE=1 but PRINCIPAL_HMAC_SECRET missing — per-principal breaker disabled; global breaker only.');
}

// PR-F: Secret strength guard (fail-fast on weak secrets)
// P0-2: Support dual-secret rotation
const isTestMode = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
if (CONFIG.enabled && principalExtractionEnabled) {
  const active = process.env.PRINCIPAL_HMAC_SECRET_ACTIVE || process.env.PRINCIPAL_HMAC_SECRET || '';
  const staged = process.env.PRINCIPAL_HMAC_SECRET_STAGED || '';
  
  if (active.length < 64) {
    console.error(`[circuit-breaker] PRINCIPAL_HMAC_SECRET_ACTIVE (or legacy PRINCIPAL_HMAC_SECRET) must be ≥64 hex chars (32 bytes). Current: ${active.length} chars.`);
    console.error('[circuit-breaker] Generate a strong secret: openssl rand -hex 32');
    if (isTestMode) {
      process.exitCode = 1;
    } else {
      process.exit(1);
    }
  }
  
  if (staged && staged.length < 64) {
    console.error(`[circuit-breaker] PRINCIPAL_HMAC_SECRET_STAGED must be ≥64 hex chars when set. Current: ${staged.length} chars.`);
    console.error('[circuit-breaker] Generate a strong secret: openssl rand -hex 32');
    if (isTestMode) {
      process.exitCode = 1;
    } else {
      process.exit(1);
    }
  }
}

// Metrics
let circuitOpenTotal = 0;
let circuitHalfOpenTotal = 0;
let circuitClosedTotal = 0;

/**
 * Get or create circuit for principal
 * PR-2B: BoundedLRU handles eviction automatically
 */
function getCircuit(principal: string | undefined): CircuitStats {
  const key = principal || 'unknown';
  let circuit = principalCircuits.get(key);
  if (!circuit) {
    // BoundedLRU handles capacity and eviction automatically
    circuit = {
      state: 'closed',
      failureWindow: new SlidingWindow(CONFIG.failureThreshold),
      successes: 0,
      openedAt: 0,
      halfOpenProbes: 0,
    };
    principalCircuits.set(key, circuit);
  }
  return circuit;
}


/**
 * Check if circuit should trip to open
 * PR-2A: Use sliding window for accurate burst detection
 */
function shouldTrip(circuit: CircuitStats): boolean {
  const now = Date.now();
  const failures = circuit.failureWindow.countSince(now, CONFIG.windowMs);
  return failures >= CONFIG.failureThreshold;
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
 * PR-1: Record circuit open events in metrics
 * PR-2C: Track timestamps and handle half-open timeout
 * PR-2C.1: Type-safe reasons and idempotent transitions
 */
function transitionTo(circuit: CircuitStats, newState: CircuitState, scope?: 'global' | 'principal', reason?: TransitionReason): void {
  // PR-2C.1: Idempotent - skip if already in target state
  if (circuit.state === newState) return;
  
  const now = Date.now();
  circuit.state = newState;
  circuit.lastTransitionAt = now; // PR-2C: Always track transition time
  
  if (newState === 'open') {
    circuit.openedAt = now;
    circuit.halfOpenProbes = 0;
    circuit.successes = 0;
    delete circuit.halfOpenAt; // PR-2C: Clear half-open timestamp
    circuitOpenTotal++;
    
    // PR-1/PR-2C: Record circuit open event with reason
    if (scope) {
      try {
        const { recordCircuitOpen } = require('../metrics/registry.js');
        recordCircuitOpen(scope, reason);
      } catch (err) {
        console.warn('[circuit-breaker] Failed to record circuit open event:', err);
      }
    }
  } else if (newState === 'half_open') {
    circuit.halfOpenProbes = 0;
    circuit.halfOpenAt = now; // PR-2C: Track when we entered half-open
    circuitHalfOpenTotal++;
  } else if (newState === 'closed') {
    // PR-2C: Preserve failure window on close (let events age out naturally)
    // This reduces oscillation - don't hard-reset, just clear counters
    circuit.successes = 0;
    circuit.halfOpenProbes = 0;
    delete circuit.halfOpenAt; // PR-2C: Clear half-open timestamp
    circuitClosedTotal++;
  }
}

/**
 * Record request outcome
 * PR-1: Pass scope to transitionTo for metrics
 */
function recordOutcome(circuit: CircuitStats, is429: boolean, scope?: 'global' | 'principal'): void {
  const now = Date.now();
  
  if (is429) {
    // PR-2A: Add timestamp to sliding window
    circuit.failureWindow.add(now);
    
    // Check if should trip
    if (circuit.state === 'closed' && shouldTrip(circuit)) {
      transitionTo(circuit, 'open', scope, 'threshold');
    }
  } else {
    circuit.successes++;
    
    // In half-open, successful probes can close circuit
    if (circuit.state === 'half_open') {
      circuit.halfOpenProbes++;
      
      // PR-1: Record probe result
      if (scope) {
        try {
          const { recordCircuitProbe } = require('../metrics/registry.js');
          recordCircuitProbe(scope, 'success');
        } catch (err) {
          console.warn('[circuit-breaker] Failed to record circuit probe:', err);
        }
      }
      
      if (circuit.halfOpenProbes >= CONFIG.halfOpenProbes) {
        transitionTo(circuit, 'closed', scope, 'probes_success');
      }
    }
  }
}

/**
 * PR-2C: Check if half-open state has timed out
 */
function checkHalfOpenTimeout(circuit: CircuitStats, scope?: 'global' | 'principal'): void {
  if (circuit.state === 'half_open' && circuit.halfOpenAt) {
    const now = Date.now();
    if (now - circuit.halfOpenAt > CONFIG.halfOpenTimeoutMs) {
      // Conservative: reopen on timeout (assume still unhealthy)
      transitionTo(circuit, 'open', scope, 'half_open_timeout');
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
  
  // PR-3: Extract principal using secure extractor
  const principal = extractPrincipal(req);
  
  // PR-2C: Check for half-open timeout (global)
  checkHalfOpenTimeout(globalCircuit, 'global');
  
  // Check global circuit
  if (globalCircuit.state === 'open') {
    if (canAttemptRecovery(globalCircuit)) {
      transitionTo(globalCircuit, 'half_open', 'global');
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
  
  // PR-3: Per-principal circuit (only if extraction enabled)
  if (!principalExtractionEnabled) {
    // Degraded mode: skip per-principal checks
    return;
  }
  
  // PR-2C: Check for half-open timeout (principal)
  const circuit = getCircuit(principal);
  checkHalfOpenTimeout(circuit, 'principal');
  
  if (circuit.state === 'open') {
    if (canAttemptRecovery(circuit)) {
      transitionTo(circuit, 'half_open', 'principal');
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
 * PR-1: Always record 429 events (even when RL_CB_ENABLE=0)
 */
export function trackCircuitBreakerResponse(
  req: FastifyRequest,
  reply: FastifyReply
): void {
  const is429 = reply.statusCode === 429;
  
  // PR-1: Always record 429 events for metrics (even when breaker is OFF)
  if (is429) {
    try {
      const { recordRateLimit429 } = require('../metrics/registry.js');
      const route = (req as any)?.routeOptions?.url || 'unknown';
      recordRateLimit429(route);
    } catch (err) {
      console.warn('[circuit-breaker] Failed to record 429 metric:', err);
    }
  }
  
  // Only update circuit state if breaker is enabled
  if (!CONFIG.enabled) return;
  
  // PR-3: Extract principal using secure extractor
  const principal = extractPrincipal(req);
  
  // Update global circuit
  recordOutcome(globalCircuit, is429, 'global');
  
  // PR-3: Update per-principal circuit (only if extraction enabled)
  if (principalExtractionEnabled) {
    const circuit = getCircuit(principal);
    recordOutcome(circuit, is429, 'principal');
  }
}

/**
 * Get circuit breaker stats for observability
 */
export function getCircuitBreakerStats() {
  if (!CONFIG.enabled) {
    return null;
  }
  
  // PR-2A: Count failures in current window
  const now = Date.now();
  const globalFailures = globalCircuit.failureWindow.countSince(now, CONFIG.windowMs);
  
  // PR-2C.1: Count principal states (single loop, no Array.from)
  let principalOpen = 0;
  let principalHalfOpen = 0;
  const lruCache = (principalCircuits as any).cache; // Access internal Map
  if (lruCache) {
    for (const [, entry] of lruCache.entries()) {
      const circuit = entry.value;
      if (circuit.state === 'open') principalOpen++;
      else if (circuit.state === 'half_open') principalHalfOpen++;
    }
  }
  
  return {
    config: {
      half_open_timeout_ms: CONFIG.halfOpenTimeoutMs, // PR-2C
    },
    global: {
      state: globalCircuit.state,
      failures: globalFailures,
      successes: globalCircuit.successes,
      last_transition_at: globalCircuit.lastTransitionAt, // PR-2C
      state_duration_ms: globalCircuit.lastTransitionAt ? now - globalCircuit.lastTransitionAt : 0, // PR-2C
    },
    principals: {
      tracked: principalCircuits.getSize(),
      capacity: PRINCIPAL_MAX,
      ttl_ms: PRINCIPAL_TTL,
      open: principalOpen, // PR-2C.1
      half_open: principalHalfOpen, // PR-2C.1
    },
    window: {
      windowMs: CONFIG.windowMs,
      failureThreshold: CONFIG.failureThreshold,
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
  globalCircuit.failureWindow = new SlidingWindow(CONFIG.failureThreshold);
  globalCircuit.successes = 0;
  globalCircuit.openedAt = 0;
  globalCircuit.halfOpenProbes = 0;
  
  principalCircuits.clear();
  
  circuitOpenTotal = 0;
  circuitHalfOpenTotal = 0;
  circuitClosedTotal = 0;
}
