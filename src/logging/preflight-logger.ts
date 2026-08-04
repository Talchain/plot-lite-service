/**
 * Preflight Logging Utilities
 *
 * Structured logging for V2 preflight validation and ISL calls.
 * Production-safe with node ID hashing.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import { saltedDigestHex } from '../util/pii-redact.js';
import type { PreflightResultV3 } from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PREFLIGHT_VERSION = '2025-12-26';

// -----------------------------------------------------------------------------
// Hashing Utilities
// -----------------------------------------------------------------------------

/**
 * Hash a node ID for production logging.
 *
 * Wave1-L1 (review 3): was an UNSALTED sha256 truncated to 12 chars. Node ids
 * are label-derived slugs from a tiny input space, so an unsalted digest is
 * recoverable offline by anyone holding the logs (review 3 reversed one in
 * 79ms). Now routed through the shared salted primitive — same 12-char log
 * shape, no offline pre-image attack.
 *
 * Correlation is PER-PROCESS only (see pii-redact.ts DIGEST_SALT): these
 * hashes do NOT survive a restart and must not be joined across processes.
 *
 * @param nodeId Node ID to hash
 * @returns Hashed node ID (12 hex chars)
 */
export function hashNodeId(nodeId: string): string {
  return saltedDigestHex(nodeId, 12);
}

/**
 * Sanitize node IDs for logging.
 *
 * In production, hashes all node IDs.
 * In debug mode, returns original IDs.
 *
 * @param nodeIds Array of node IDs
 * @param debugMode Whether to skip hashing
 * @returns Sanitized node IDs
 */
export function sanitiseNodeIds(nodeIds: string[], debugMode: boolean): string[] {
  if (debugMode) return nodeIds;
  return nodeIds.map(hashNodeId);
}

/**
 * Check if debug mode is enabled.
 *
 * Debug mode is enabled in non-production or when V2_DEBUG=1.
 */
export function isDebugMode(): boolean {
  return (
    process.env.NODE_ENV !== 'production' || process.env.V2_DEBUG === '1'
  );
}

// -----------------------------------------------------------------------------
// Preflight Log
// -----------------------------------------------------------------------------

/**
 * Preflight validation log entry.
 */
export interface PreflightLogEntry {
  event: 'preflight_validation';
  request_id: string;
  timestamp: string;

  // Version info
  endpoint_version: 'v2/run';
  preflight_version: string;

  goal_node_id: string | null;
  goal_node_exists: boolean;

  options_count: number;
  options_with_interventions: number;
  options_with_path_to_goal: number;

  intervention_targets: string[];
  intervention_target_count: number;
  targets_with_path_to_goal_count: number;

  preflight_passed: boolean;
  blocker_codes: string[];

  option_nodes_filtered: number;
  option_edges_filtered: number;

  // Normalisation stats
  edges_normalised: number;
  nodes_normalised: number;

  // Timing
  validation_ms?: number;
}

/**
 * Create a preflight log entry.
 *
 * @param requestId Request ID for correlation
 * @param goalNodeId Goal node ID (may be undefined)
 * @param preflight Preflight validation result
 * @param validationMs Validation duration in milliseconds
 * @returns Log entry object
 */
export function createPreflightLog(
  requestId: string,
  goalNodeId: string | undefined,
  preflight: PreflightResultV3,
  validationMs?: number
): PreflightLogEntry {
  const debugMode = isDebugMode();

  return {
    event: 'preflight_validation',
    request_id: requestId,
    timestamp: new Date().toISOString(),

    endpoint_version: 'v2/run',
    preflight_version: PREFLIGHT_VERSION,

    goal_node_id: goalNodeId
      ? debugMode
        ? goalNodeId
        : hashNodeId(goalNodeId)
      : null,
    goal_node_exists: preflight.goal_node_exists,

    options_count: preflight.options_count,
    options_with_interventions: preflight.options_with_interventions,
    options_with_path_to_goal: preflight.options_with_path_to_goal,

    intervention_targets: sanitiseNodeIds(preflight.intervention_targets, debugMode),
    intervention_target_count: preflight.intervention_targets.length,
    targets_with_path_to_goal_count: preflight.targets_with_path_to_goal_count,

    preflight_passed: preflight.passed,
    blocker_codes: preflight.blockers.map((b) => b.code),

    option_nodes_filtered: preflight.option_nodes_filtered,
    option_edges_filtered: preflight.option_edges_filtered,

    edges_normalised: preflight.edges_normalised,
    nodes_normalised: preflight.nodes_normalised,

    validation_ms: validationMs,
  };
}

// -----------------------------------------------------------------------------
// ISL Call Log
// -----------------------------------------------------------------------------

/**
 * ISL call log entry.
 */
export interface ISLCallLogEntry {
  event: 'isl_robustness_call';
  request_id: string;
  timestamp: string;

  endpoint: string;
  request_schema_version: 'v3';

  // Request summary (no raw payloads)
  graph_node_count: number;
  graph_edge_count: number;
  options_count: number;
  interventions_per_option: number[];
  goal_node_id_hash: string;

  // Response summary
  status_code?: number;
  latency_ms?: number;
  success?: boolean;

  // Error handling (if applicable)
  error_code?: string;
  error_class?: string;
  error_body_hash?: string;
}

/**
 * Create an ISL call log entry for the request phase.
 *
 * @param requestId Request ID for correlation
 * @param graphNodeCount Number of nodes in graph
 * @param graphEdgeCount Number of edges in graph
 * @param optionsCount Number of options
 * @param interventionsPerOption Array of intervention counts per option
 * @param goalNodeId Goal node ID
 * @returns Log entry object
 */
export function createISLRequestLog(
  requestId: string,
  graphNodeCount: number,
  graphEdgeCount: number,
  optionsCount: number,
  interventionsPerOption: number[],
  goalNodeId: string
): ISLCallLogEntry {
  return {
    event: 'isl_robustness_call',
    request_id: requestId,
    timestamp: new Date().toISOString(),

    endpoint: '/api/v1/robustness/analyze/v2',
    request_schema_version: 'v3',

    graph_node_count: graphNodeCount,
    graph_edge_count: graphEdgeCount,
    options_count: optionsCount,
    interventions_per_option: interventionsPerOption,
    goal_node_id_hash: hashNodeId(goalNodeId),
  };
}

/**
 * Add response data to an ISL call log entry.
 *
 * @param log Existing log entry
 * @param statusCode HTTP status code
 * @param latencyMs Response latency
 * @param success Whether the call succeeded
 * @param error Optional error details
 * @returns Updated log entry
 */
export function addISLResponseToLog(
  log: ISLCallLogEntry,
  statusCode: number,
  latencyMs: number,
  success: boolean,
  error?: { code?: string; class?: string; body?: string }
): ISLCallLogEntry {
  return {
    ...log,
    status_code: statusCode,
    latency_ms: latencyMs,
    success,
    error_code: error?.code,
    error_class: error?.class,
    // Wave1-L1 (review 3): salted — an ISL error body can echo decision
    // content, and an unsalted digest of it is pre-imageable offline. Same
    // 64-char log shape; correlation stays per-process.
    error_body_hash: error?.body ? saltedDigestHex(error.body, 64) : undefined,
  };
}

// -----------------------------------------------------------------------------
// Log Output
// -----------------------------------------------------------------------------

/**
 * Log a preflight validation result.
 *
 * Uses structured JSON logging.
 */
export function logPreflight(entry: PreflightLogEntry): void {
  // eslint-disable-next-line no-console -- structured log on the sanctioned console channel (Wave1-L1 boundary arm 2, src/logging/log-boundary.ts); no redaction-covered standalone logger exists
  console.log(JSON.stringify(entry));
}

/**
 * Log an ISL call.
 *
 * Uses structured JSON logging.
 */
export function logISLCall(entry: ISLCallLogEntry): void {
  // eslint-disable-next-line no-console -- structured log on the sanctioned console channel (Wave1-L1 boundary arm 2, src/logging/log-boundary.ts); no redaction-covered standalone logger exists
  console.log(JSON.stringify(entry));
}
