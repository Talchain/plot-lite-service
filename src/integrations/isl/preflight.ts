/**
 * ISL Pre-flight Validation
 *
 * Validates graph structure before making ISL /robustness/analyze/v2 calls.
 * Returns separate statuses for edge and factor sensitivity to enable
 * granular fallback decisions.
 */

import type { Graph, GraphEdge, GraphNode } from '../../trust/types.js';
import type { ISLPreflightResult } from './types/plot-types.js';
import type { ISLParameterUncertainty } from './types/isl-types.js';
import { DEFAULT_EXISTS_PROBABILITY } from '../../constants/limits.js';
import {
  DEFAULT_STD_FLOOR,
  BINARY_DEFAULT_STD,
  VALUE_BASED_STD_FRACTION,
  FALLBACK_STD,
  resolveUserSuppliedStd,
} from './parameter-uncertainty-bounds.js';

/**
 * Check if an edge has uncertainty data for sensitivity analysis
 *
 * Edge sensitivity requires:
 * - exists_probability (0 < p < 1) for existence sensitivity, OR
 * - strength.std > 0 (or belief_strength < 1) for magnitude sensitivity
 *
 * Supports both nested (strength.std) and flat (strength_std) field formats
 * for compatibility with CEE V3 which outputs flat fields.
 */
export function edgeHasUncertainty(edge: GraphEdge): boolean {
  // Cast to any to access properties from multiple edge formats
  // Preflight may receive upstream (GraphEdge) or normalized (EngineEdgeV3) edges
  const e = edge as any;

  // Check for existence uncertainty - support multiple field names
  // exists_probability (normalized EngineEdgeV3), belief_exists (upstream EdgeV2), belief (legacy EdgeV1)
  const existsProb = e.exists_probability ?? e.belief_exists ?? e.belief ?? DEFAULT_EXISTS_PROBABILITY;
  const hasExistenceUncertainty = existsProb > 0 && existsProb < 1;

  // Check for strength uncertainty - support nested AND flat formats
  // Nested: edge.strength.std (normalized EngineEdgeV3 format)
  // Flat: edge.strength_std (CEE V3 / EdgeV2.2 format)
  const strengthStd = e.strength?.std ?? e.strength_std ?? 0;
  const hasStrengthUncertainty =
    strengthStd > 0 ||
    (e.belief_strength !== undefined && e.belief_strength < 1);

  return hasExistenceUncertainty || hasStrengthUncertainty;
}

/**
 * Check if a node is a factor with a finite numeric observed value.
 * Non-finite values (NaN, Infinity) are excluded to prevent poisoning
 * ISL Monte Carlo analysis with invalid means.
 */
function isFactorWithValue(node: GraphNode): boolean {
  return (
    node.kind === 'factor' &&
    node.observed_state !== undefined &&
    node.observed_state.value !== undefined &&
    Number.isFinite(node.observed_state.value)
  );
}

/**
 * Build parameter uncertainties from graph factor nodes.
 *
 * Mirrors `buildParameterUncertaintiesV3` in translator-v3.ts. Shared bounds
 * and defaults live in `./parameter-uncertainty-bounds.ts`.
 *
 * Standard deviation calculation priority:
 * 1. Finite positive `observed_state.std` → clamped to [MIN_USER_STD, MAX_USER_STD].
 *    User value is honoured down to MIN_USER_STD; the default floor does NOT apply.
 * 2. Binary factors → BINARY_DEFAULT_STD.
 * 3. Non-zero continuous factors → |value| × VALUE_BASED_STD_FRACTION.
 * 4. Zero-valued continuous factors → FALLBACK_STD.
 *
 * DEFAULT_STD_FLOOR is applied ONLY to priorities 2–4. Small user-supplied
 * values (e.g. 0.001) propagate to ISL as-is — fixed: previously the floor
 * silently widened them.
 */
export function buildParameterUncertainties(graph: Graph): ISLParameterUncertainty[] {
  const uncertainties: ISLParameterUncertainty[] = [];

  for (const node of graph.nodes) {
    if (isFactorWithValue(node)) {
      const value = node.observed_state!.value;
      const userStd = resolveUserSuppliedStd(node.observed_state!.std);

      let std: number;

      if (userStd !== null) {
        // Priority 1: honour user-supplied std (already clamped to
        // [MIN_USER_STD, MAX_USER_STD] by the shared helper).
        std = userStd;
      } else {
        // Priorities 2–4: synthesised defaults, with DEFAULT_STD_FLOOR applied.
        const isBinary = isBinaryFactorNode(node);
        if (isBinary) {
          std = BINARY_DEFAULT_STD;
        } else if (value !== 0) {
          std = Math.abs(value) * VALUE_BASED_STD_FRACTION;
        } else {
          std = FALLBACK_STD;
        }
        std = Math.max(DEFAULT_STD_FLOOR, std);
      }

      uncertainties.push({
        node_id: node.id,
        distribution: 'normal',
        mean: value,
        std,
      });
    }
  }

  return uncertainties;
}

/**
 * Detect if a factor node is binary using strong signals.
 * Avoids misclassifying continuous factors (e.g., "Number of Developers Hired" = 0) as binary.
 *
 * Binary detection signals (in order):
 * 1. Explicit range [0,1]
 * 2. Label contains explicit binary markers: "(0/1)", "yes/no", "true/false"
 * 3. Unit suggests boolean: "boolean", "bool", "binary"
 * 4. Common boolean naming patterns + value is exactly 0 or 1
 */
function isBinaryFactorNode(node: GraphNode): boolean {
  const range = (node as any).state_space?.range;
  const value = node.observed_state?.value;

  // Signal 1: Explicit range [0,1]
  if (range && range.min === 0 && range.max === 1) {
    return true;
  }

  const label = (node.label ?? '').toLowerCase();

  // Signal 2: Label contains explicit binary markers
  if (label.includes('(0/1)') || label.includes('yes/no') || label.includes('true/false')) {
    return true;
  }

  // Signal 3: Unit suggests boolean
  const unit = (node.observed_state?.unit ?? '').toLowerCase();
  if (unit === 'boolean' || unit === 'bool' || unit === 'binary') {
    return true;
  }

  // Signal 4: Common boolean naming patterns + value is exactly 0 or 1
  // Only applies when no range is specified and value suggests binary
  if ((value === 0 || value === 1) && !range) {
    const id = node.id.toLowerCase();
    const booleanPrefixes = ['is_', 'has_', 'can_', 'should_', 'will_', 'was_', 'did_'];
    const booleanSuffixes = ['_flag', '_enabled', '_active', '_hired', '_present', '_available'];

    if (booleanPrefixes.some((p) => id.startsWith(p))) return true;
    if (booleanSuffixes.some((s) => id.endsWith(s))) return true;
  }

  return false;
}

/**
 * Validate graph before making ISL robustness/analyze/v2 call
 *
 * Returns separate statuses for edge and factor sensitivity analysis.
 * This enables granular decisions about what data to request from ISL.
 *
 * @param graph - The decision graph
 * @param parameterUncertainties - Optional pre-built parameter uncertainties
 * @returns Pre-flight validation result
 *
 * @example
 * ```typescript
 * const preflight = validateBeforeISL(graph);
 *
 * if (!preflight.canCallISL) {
 *   // Skip ISL call entirely
 *   return createFallbackRobustnessAnalysis('No valid analysis possible');
 * }
 *
 * if (preflight.edge_sensitivity_status === 'skipped_no_edges') {
 *   // Can still call ISL for factor sensitivity only
 * }
 * ```
 */
export function validateBeforeISL(
  graph: Graph,
  parameterUncertainties?: ISLParameterUncertainty[]
): ISLPreflightResult {
  const skipReasons: string[] = [];

  // === Edge Sensitivity Validation ===
  const hasEdges = graph.edges.length > 0;
  const edgesWithUncertainty = graph.edges.filter(edgeHasUncertainty);
  const hasEdgeUncertainty = edgesWithUncertainty.length > 0;

  let edgeStatus: ISLPreflightResult['edge_sensitivity_status'];

  if (!hasEdges) {
    edgeStatus = 'skipped_no_edges';
    skipReasons.push('No edges in graph');
  } else if (!hasEdgeUncertainty) {
    edgeStatus = 'skipped_missing_uncertainty';
    skipReasons.push(
      `No edges with uncertainty (${graph.edges.length} edges, 0 with exists_probability < 1 or strength_std)`
    );
  } else {
    edgeStatus = 'available';
  }

  // === Factor Sensitivity Validation ===
  const factorNodes = graph.nodes.filter((n) => n.kind === 'factor');
  const factorsWithValues = graph.nodes.filter(isFactorWithValue);

  // Use provided uncertainties or build from graph
  const uncertainties = parameterUncertainties ?? buildParameterUncertainties(graph);

  let factorStatus: ISLPreflightResult['factor_sensitivity_status'];

  if (factorsWithValues.length === 0) {
    factorStatus = 'skipped_no_factor_values';
    skipReasons.push(
      `No factor nodes with finite observed_state.value (${factorNodes.length} factor nodes, 0 with usable values)`
    );
  } else if (uncertainties.length === 0) {
    factorStatus = 'skipped_no_parameter_uncertainties';
    skipReasons.push('No parameter uncertainties provided or derivable');
  } else {
    factorStatus = 'available';
  }

  // === Overall ISL Call Decision ===
  // Can call ISL if either edge OR factor sensitivity is available
  const canCallISL = edgeStatus === 'available' || factorStatus === 'available';

  return {
    canCallISL,
    edge_sensitivity_status: edgeStatus,
    factor_sensitivity_status: factorStatus,
    skipReasons,
  };
}

/**
 * Log pre-flight validation result for observability
 */
export function logPreflightResult(
  preflight: ISLPreflightResult,
  requestId: string
): void {
  const entry = {
    level: 'info',
    time: Date.now(),
    event: 'isl_preflight_validation',
    request_id: requestId,
    can_call_isl: preflight.canCallISL,
    edge_sensitivity_status: preflight.edge_sensitivity_status,
    factor_sensitivity_status: preflight.factor_sensitivity_status,
    skip_reasons: preflight.skipReasons,
  };
  console.log(JSON.stringify(entry));
}

// -----------------------------------------------------------------------------
// Duplicate-edge preflight (ISL 422s duplicate (from, to, type) edges)
// -----------------------------------------------------------------------------

/**
 * Structural edge shape consumed by the duplicate-edge preflight.
 * Matches EngineEdgeV3 (normalised graph) — the shape forwarded to ISL.
 */
export interface DuplicateCheckEdge {
  from: string;
  to: string;
  exists_probability: number;
  strength: { mean: number; std: number };
  label?: string;
  edge_type?: 'directed' | 'bidirected';
}

/** A coalesced EXACT-duplicate group (identical on every field). */
export interface CoalescedDuplicate {
  from: string;
  to: string;
  edge_type: string;
  /** Total identical copies found (>= 2); one is kept, the rest dropped */
  count: number;
}

/** A NON-identical duplicate conflict — same (from, to, type), differing payload. */
export interface DuplicateEdgeConflict {
  from: string;
  to: string;
  edge_type: string;
  /** Number of edges sharing this (from, to, type) key */
  count: number;
  /** Fields whose values differ across the conflicting edges */
  divergent_fields: string[];
}

/** Result of the duplicate-edge preflight. */
export interface DuplicateEdgePreflightResult {
  /** Edges with exact-identical duplicates coalesced (order preserved, first kept) */
  edges: DuplicateCheckEdge[];
  /** Exact-identical groups that were coalesced (for repairs_applied) */
  coalesced: CoalescedDuplicate[];
  /**
   * Non-identical duplicates. NEVER silently deduped — PLoT cannot know which
   * belief/weight/provenance the user meant, so this is a typed actionable
   * blocker for the caller (producers own semantics; PLoT must not invent a
   * merge).
   */
  conflicts: DuplicateEdgeConflict[];
}

/**
 * Canonical duplicate key: (from, to, edge_type). Matches the uniqueness
 * constraint ISL now enforces with a 422 on /robustness/analyze/v2.
 * JSON-encoded so IDs containing delimiter characters cannot collide
 * (e.g. from="a b",to="c" vs from="a",to="b c").
 */
function duplicateEdgeKey(e: DuplicateCheckEdge): string {
  return JSON.stringify([e.from, e.to, e.edge_type ?? 'directed']);
}

/** Canonical full-payload fingerprint used to detect EXACT-identical edges. */
function edgeFingerprint(e: DuplicateCheckEdge): string {
  return JSON.stringify({
    from: e.from,
    to: e.to,
    edge_type: e.edge_type ?? 'directed',
    exists_probability: e.exists_probability,
    strength_mean: e.strength?.mean,
    strength_std: e.strength?.std,
    label: e.label ?? null,
  });
}

/** Field-level diff across a conflicting duplicate group (for the blocker message). */
function divergentFields(group: DuplicateCheckEdge[]): string[] {
  const fields: Array<[string, (e: DuplicateCheckEdge) => unknown]> = [
    ['exists_probability', (e) => e.exists_probability],
    ['strength.mean', (e) => e.strength?.mean],
    ['strength.std', (e) => e.strength?.std],
    ['label', (e) => e.label ?? null],
  ];
  const out: string[] = [];
  for (const [name, get] of fields) {
    const first = JSON.stringify(get(group[0]));
    if (group.some((e) => JSON.stringify(get(e)) !== first)) out.push(name);
  }
  return out;
}

/**
 * Duplicate-edge preflight, run BEFORE building the ISL request.
 *
 * - EXACT identical duplicates (every field equal) are coalesced to a single
 *   edge; each coalesced group is reported so the caller can log it through
 *   the existing repairs_applied mechanism (observable, not silent).
 * - NON-identical duplicates — same (from, to, type) but differing
 *   weight/belief/label — are returned as conflicts. The caller MUST block
 *   with a typed actionable critique; silently deduping would pick one of
 *   the user's contradictory claims and discard the other without consent.
 *
 * Edge order is preserved; the first occurrence of each duplicate group keeps
 * its position (relevant for downstream index-based references and for ISL
 * determinism).
 */
export function preflightDuplicateEdges(
  edges: DuplicateCheckEdge[],
): DuplicateEdgePreflightResult {
  const groups = new Map<string, DuplicateCheckEdge[]>();
  for (const e of edges) {
    const key = duplicateEdgeKey(e);
    const group = groups.get(key);
    if (group) group.push(e);
    else groups.set(key, [e]);
  }

  const coalesced: CoalescedDuplicate[] = [];
  const conflicts: DuplicateEdgeConflict[] = [];
  const dropFingerprints = new Map<string, number>(); // fingerprint -> copies still to drop

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const firstFp = edgeFingerprint(group[0]);
    const allIdentical = group.every((e) => edgeFingerprint(e) === firstFp);
    const edgeType = group[0].edge_type ?? 'directed';
    if (allIdentical) {
      coalesced.push({
        from: group[0].from,
        to: group[0].to,
        edge_type: edgeType,
        count: group.length,
      });
      dropFingerprints.set(
        firstFp,
        (dropFingerprints.get(firstFp) ?? 0) + group.length - 1,
      );
    } else {
      conflicts.push({
        from: group[0].from,
        to: group[0].to,
        edge_type: edgeType,
        count: group.length,
        divergent_fields: divergentFields(group),
      });
    }
  }

  // Nothing to coalesce (or only conflicts): return input untouched.
  if (coalesced.length === 0) {
    return { edges, coalesced, conflicts };
  }

  // Drop all-but-first copy of each exact-identical group, preserving order.
  const seenKeep = new Set<string>();
  const result: DuplicateCheckEdge[] = [];
  for (const e of edges) {
    const fp = edgeFingerprint(e);
    const toDrop = dropFingerprints.get(fp);
    if (toDrop !== undefined) {
      if (seenKeep.has(fp)) {
        if (toDrop > 0) {
          dropFingerprints.set(fp, toDrop - 1);
          continue; // drop this exact-identical copy
        }
      } else {
        seenKeep.add(fp); // first copy: keep
      }
    }
    result.push(e);
  }
  return { edges: result, coalesced, conflicts };
}
