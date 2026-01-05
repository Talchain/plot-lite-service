import { LIMITS, MAX_NODES, MAX_EDGES, MAX_OPTIONS } from '../constants/limits.js';

export const MAX_RATE_KEYS = Number(process.env.MAX_RATE_KEYS || 20000);
export const MAX_IDEM_ENTRIES = Number(process.env.MAX_IDEM_ENTRIES || 10);
export const SSE_SLOT_MAX_MS = Number(process.env.SSE_MAX_MS || 120000); // C3: 2min default

// Body size limits (bytes)
export const BODY_LIMIT_BYTES = 96 * 1024; // 96 KiB for /v1/run

// Service-level graph limits exposed via /v1/limits (SSOT from src/constants/limits.ts)
// Environment overrides are supported but CAPPED at canonical values to ensure consistency
// with SCM-Lite kernel which uses canonical limits directly.
export const LIMITS_MAX_NODES = Math.min(
  Number(process.env.GRAPH_MAX_NODES || MAX_NODES),
  MAX_NODES
);
export const LIMITS_MAX_EDGES = Math.min(
  Number(process.env.GRAPH_MAX_EDGES || MAX_EDGES),
  MAX_EDGES
);
export const LIMITS_MAX_OPTIONS = Math.min(
  Number(process.env.GRAPH_MAX_OPTIONS || MAX_OPTIONS),
  MAX_OPTIONS
);

// Re-export LIMITS for convenience
export { LIMITS };

// Validation-layer graph limits (internal, more permissive than public limits)
// These allow larger graphs for non-SCM inference modes
export const VALIDATION_MAX_NODES = Number(process.env.VALIDATION_MAX_NODES || 200);
export const VALIDATION_MAX_EDGES = Number(process.env.VALIDATION_MAX_EDGES || 500);

// Advisory sweet-spot and warning thresholds for graph complexity (not enforced)
const DEFAULT_SWEET_SPOT_NODES = 15;
const DEFAULT_WARNING_NODES = 30;
const DEFAULT_SWEET_SPOT_EDGES = 30;
const DEFAULT_WARNING_EDGES = 100;

export const LIMITS_SWEET_SPOT_NODES = Math.min(DEFAULT_SWEET_SPOT_NODES, LIMITS_MAX_NODES);
export const LIMITS_WARNING_NODES = Math.min(DEFAULT_WARNING_NODES, LIMITS_MAX_NODES);
export const LIMITS_SWEET_SPOT_EDGES = Math.min(DEFAULT_SWEET_SPOT_EDGES, LIMITS_MAX_EDGES);
export const LIMITS_WARNING_EDGES = Math.min(DEFAULT_WARNING_EDGES, LIMITS_MAX_EDGES);
