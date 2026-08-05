/**
 * Graph Normalization for V3 Engine
 *
 * Transforms upstream graph formats (EdgeV2.2, React Flow, legacy)
 * to internal canonical EngineGraphV3 format.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import type {
  UpstreamNode,
  UpstreamEdge,
  UpstreamGraph,
  EngineNodeV3,
  EngineEdgeV3,
  EngineGraphV3,
  EngineNodeKindV3,
} from '../types/engine-v3.js';
import { NON_CAUSAL_NODE_KINDS } from '../types/engine-v3.js';
import { DEFAULT_EXISTS_PROBABILITY } from '../constants/limits.js';
import { REPAIR_CODES } from './repair-codes.js';

// -----------------------------------------------------------------------------
// Error Types
// -----------------------------------------------------------------------------

export class NormalisationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly nodeId?: string,
    public readonly edgeId?: string
  ) {
    super(message);
    this.name = 'NormalisationError';
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const VALID_NODE_KINDS: Set<string> = new Set([
  'goal',
  'factor',
  'outcome',
  'decision',
  'risk',
  'action',
]);

// CIL M5: Imported from constants/limits.ts (single source of truth)

// -----------------------------------------------------------------------------
// Label Cleaning
// -----------------------------------------------------------------------------

/**
 * Common annotation suffix patterns to strip from labels.
 * These patterns are added by CEE/upstream and should not be shown in UI.
 *
 * Matches trailing parentheticals containing encoding keywords:
 * - Ranges:      (0-1), (0–1), (0–1, higher is better)
 * - Binary:      (Yes/No), (True/False), (0/1)
 * - Descriptors: (percentage), (likert), (qualitative scale)
 *
 * Preserves non-encoding parentheticals like "Revenue (quarterly)".
 */
const LABEL_ANNOTATION_PATTERN = /\s*\([^)]*(?:scale|0[-–]1|0\/1|percentage|likert|qualitative|yes\/no|true\/false)[^)]*\)\s*$/i;

/**
 * Clean annotation suffixes from node labels.
 *
 * CEE and other upstream sources may add scale/format annotations to labels
 * (e.g., "(0-1)", "(percentage)", "(qualitative scale)").
 * These are stripped before returning to UI.
 *
 * @param label Raw label with potential annotation suffix
 * @returns Cleaned label without annotation suffix
 */
export function cleanLabelAnnotation(label: string): string {
  return label.replace(LABEL_ANNOTATION_PATTERN, '').trim();
}
const DEFAULT_WEIGHT = 0.5;
const MIN_STD = 0.001;           // ISL minimum (technical requirement)
const STD_RANGE_MIN = 0.05;      // Causal edge floor (epistemic uncertainty)
const STRUCTURAL_STD_MIN = 0.01; // Structural edge floor (definitional edges)
const STD_RANGE_MAX = 0.4;

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

/**
 * Derive standard deviation from mean and belief/confidence.
 * Higher belief = lower uncertainty = smaller std.
 *
 * CV (coefficient of variation) ranges from 0.1 (high confidence) to 0.4 (low confidence)
 */
export function deriveStd(mean: number, belief: number): number {
  // CV ∈ [0.1, 0.4] based on belief
  const cv = 0.3 * (1 - belief) + 0.1;
  return Math.max(0.05, cv * Math.abs(mean));
}

/**
 * Clamp a value to a range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Determine if an edge is structural (definitional) rather than causal.
 * Structural edges represent graph structure, not epistemic uncertainty.
 *
 * Structural edge types:
 * - decision → option (decision structure)
 * - option → factor (intervention definition)
 *
 * @param edge The edge to check
 * @param nodeKindMap Map of node IDs to their kinds (before filtering)
 * @returns true if edge is structural, false if causal
 */
function isStructuralEdgeType(
  edge: { from: string; to: string },
  nodeKindMap: Map<string, string>
): boolean {
  const fromKind = nodeKindMap.get(edge.from);
  const toKind = nodeKindMap.get(edge.to);

  if (!fromKind || !toKind) return false;

  // decision → option
  if (fromKind === 'decision' && toKind === 'option') return true;

  // option → factor
  if (fromKind === 'option' && toKind === 'factor') return true;

  return false;
}

// -----------------------------------------------------------------------------
// Node Normalization
// -----------------------------------------------------------------------------

/**
 * Normalize an upstream node to canonical EngineNodeV3 format.
 *
 * Handles:
 * - React Flow nesting (data.kind, data.value, etc.)
 * - Legacy field names (type → kind, body → description)
 * - Missing fields with sensible defaults
 *
 * @param node Upstream node in any supported format
 * @returns Normalized node in EngineNodeV3 format
 * @throws NormalisationError if node is invalid
 */
export function normaliseNode(
  node: UpstreamNode,
  warnings?: NormalisationWarning[]
): EngineNodeV3 {
  if (!node.id) {
    throw new NormalisationError('Node missing id', 'id');
  }

  // Resolve kind from multiple sources
  const rawKind =
    node.kind ?? node.type ?? node.data?.kind ?? node.data?.type ?? 'factor';

  // Validate kind (but allow 'option' - it will be filtered later)
  const normalizedKind = rawKind.toLowerCase();
  const kind = normalizedKind as EngineNodeKindV3;

  if (
    !VALID_NODE_KINDS.has(normalizedKind) &&
    !NON_CAUSAL_NODE_KINDS.includes(normalizedKind as (typeof NON_CAUSAL_NODE_KINDS)[number])
  ) {
    warnings?.push({
      code: REPAIR_CODES.UNKNOWN_NODE_KIND,
      message: `Node '${node.id}' has unknown kind '${normalizedKind}'`,
      node_id: node.id,
    });
  }

  // Extract observed_state from various locations
  let observedState: EngineNodeV3['observed_state'] | undefined;

  // Extract and validate intercept from various locations
  // Contract: optional; if present must be a finite number.
  //
  // Null rejection rationale:
  // - `undefined` or omitted = "not specified" → defaults to 0.0 in hash computation
  // - `null` = explicit "no value" → rejected as anti-pattern
  // - This prevents accidental null values from being silently converted to 0.0
  // - Clients should omit the field entirely if intercept is unknown
  //
  // Migration: If receiving 422 errors for null intercept, filter out null values
  // before sending the request, or omit the intercept field entirely.
  let rawIntercept: unknown = undefined;
  if (Object.prototype.hasOwnProperty.call(node, 'intercept')) {
    rawIntercept = node.intercept;
  } else if (node.data && Object.prototype.hasOwnProperty.call(node.data, 'intercept')) {
    rawIntercept = node.data.intercept;
  }

  if (rawIntercept === null) {
    throw new NormalisationError(
      `Node '${node.id}': intercept cannot be null. ` +
      `To use the default intercept (0.0), omit the field entirely instead of setting it to null.`,
      'intercept',
      node.id
    );
  }
  if (rawIntercept !== undefined) {
    if (typeof rawIntercept !== 'number' || !Number.isFinite(rawIntercept)) {
      throw new NormalisationError(
        `Node '${node.id}': intercept must be a finite number`,
        'intercept',
        node.id
      );
    }
  }

  // Extract and validate epsilon_std (per-node stochastic noise).
  // Contract: optional; if present must be a finite non-negative number (ISL enforces ge=0.0).
  // Same null-rejection rationale as intercept.
  let rawEpsilonStd: unknown = undefined;
  if (Object.prototype.hasOwnProperty.call(node, 'epsilon_std')) {
    rawEpsilonStd = node.epsilon_std;
  } else if (node.data && Object.prototype.hasOwnProperty.call(node.data, 'epsilon_std')) {
    rawEpsilonStd = node.data.epsilon_std;
  }

  if (rawEpsilonStd === null) {
    throw new NormalisationError(
      `Node '${node.id}': epsilon_std cannot be null. ` +
      `To use the default epsilon_std (0.0), omit the field entirely instead of setting it to null.`,
      'epsilon_std',
      node.id
    );
  }
  if (rawEpsilonStd !== undefined) {
    if (typeof rawEpsilonStd !== 'number' || !Number.isFinite(rawEpsilonStd)) {
      throw new NormalisationError(
        `Node '${node.id}': epsilon_std must be a finite number`,
        'epsilon_std',
        node.id
      );
    }
    if (rawEpsilonStd < 0) {
      throw new NormalisationError(
        `Node '${node.id}': epsilon_std must be non-negative (got ${rawEpsilonStd})`,
        'epsilon_std',
        node.id
      );
    }
  }

  if (node.observed_state?.value !== undefined) {
    // Explicit allowlist: core fields + V3 expansion metadata
    // This preserves V3 fields (raw_value, cap, factor_type, uncertainty_drivers)
    // without passing through arbitrary upstream garbage.
    //
    // ⚠ ROADMAP 2.520 S1 — THIS LIST IS THE INGRESS STRIP POINT, and it was
    // silently discarding every human confirmation. `source` and
    // `extractionType` were absent here while PLoT's OWN egress projector
    // (`ISL_DECLARED_OBSERVED_STATE_FIELDS`, translator-v3.ts) already declared
    // them and ISL already consumed AND echoed them back as `value_source` /
    // `value_extraction_type`. So a user confirming an estimate produced a
    // number the compute engine could not distinguish from an AI guess — not
    // because anything downstream refused it, but because two keys were missing
    // from this literal, one hop upstream of a list that had them.
    //
    // This list is a hand-maintained mirror (programme trap 12) and stays one:
    // it is deliberately NOT a blind passthrough, because `metadata` below is
    // PLoT-internal and must not reach ISL. What makes it safe now is that its
    // AGREEMENT with the egress list is derived rather than remembered —
    // `tests/observed-state-provenance-ingress.test.ts` T5 iterates
    // `ISL_DECLARED_OBSERVED_STATE_FIELDS` (itself pinned to ISL's own
    // machine-generated OpenAPI) and REDs if any declared field fails to survive
    // this copy. Add a field to ISL and this literal must follow, or CI fails.
    const os = node.observed_state;
    observedState = {
      value: node.observed_state.value, // use narrowed path (TS knows !== undefined)
      baseline: os.baseline,
      unit: os.unit,
      std: os.std,
      raw_value: os.raw_value,
      cap: os.cap,
      factor_type: os.factor_type,
      uncertainty_drivers: os.uncertainty_drivers,
      // Value provenance (2.520 S1) — an upstream CLAIM about this number's
      // origin, copied VERBATIM and validated in no way. Transport, not
      // attestation: carrying `source: 'user_set'` here does not establish that
      // a human set the value. See the field's own doc on `RawNodeV3`.
      source: os.source,
      extractionType: os.extractionType,
      // For constraint nodes, preserve metadata (contains operator) so the
      // constraint compiler can extract it via observed_state.metadata.operator.
      ...((os as any).metadata !== undefined && { metadata: (os as any).metadata }),
    };
  } else if (node.data?.value !== undefined) {
    observedState = {
      value: node.data.value,
      baseline: node.data.baseline,
      unit: node.data.unit,
    };
  }

  // Extract state_space from various locations
  const stateSpace = node.state_space ?? node.data?.state_space;

  // Extract and validate category field (for M1 coaching classification)
  const rawCategory = node.category ?? node.data?.category;
  let category: 'controllable' | 'observable' | 'external' | undefined;

  if (rawCategory !== undefined) {
    // Type check: category must be a string
    if (typeof rawCategory !== 'string') {
      warnings?.push({
        code: REPAIR_CODES.INVALID_CATEGORY,
        message: `Node '${node.id}': category must be a string, got ${typeof rawCategory}`,
        node_id: node.id,
        repair: {
          field: 'node.category',
          action: 'defaulted',
          from_value: String(rawCategory),
          to_value: 'undefined',
          reason: `Category must be a string (got ${typeof rawCategory})`,
        },
      });
      category = undefined;
    } else {
      // Normalize to lowercase and validate against allowed values
      const normalizedCategory = rawCategory.toLowerCase();
      if (normalizedCategory === 'controllable' || normalizedCategory === 'observable' || normalizedCategory === 'external') {
        category = normalizedCategory;
      } else {
        // Invalid category value - issue warning with repair metadata
        warnings?.push({
          code: REPAIR_CODES.INVALID_CATEGORY,
          message: `Node '${node.id}' has invalid category '${rawCategory}'. Valid values: controllable, observable, external`,
          node_id: node.id,
          repair: {
            field: 'node.category',
            action: 'defaulted',
            from_value: rawCategory,
            to_value: 'undefined',
            reason: `Invalid category value. Valid values: controllable, observable, external`,
          },
        });
        category = undefined;
      }
    }
  }

  // Clean annotation suffixes from labels (e.g., "(0-1)", "(percentage)")
  // before returning to UI. Fall back to node.id if cleaned label is empty.
  const rawLabel = node.label ?? node.id;
  const cleanedLabel = cleanLabelAnnotation(rawLabel);
  const finalLabel = cleanedLabel || node.id; // Fallback to ID if cleaning produces empty string

  // Emit repair if label was modified by annotation cleaning
  if (finalLabel !== rawLabel) {
    warnings?.push({
      code: REPAIR_CODES.CLEAN_LABEL_ANNOTATION,
      message: `Node '${node.id}': label annotation stripped`,
      node_id: node.id,
      repair: {
        field: 'node.label',
        action: 'normalised',
        from_value: rawLabel,
        to_value: finalLabel,
        reason: 'Scale/encoding annotation suffix stripped from label',
      },
    });
  }

  // Validate and pass through prior field (for external factor priors from CEE)
  let prior: EngineNodeV3['prior'] | undefined;
  if (node.prior !== undefined) {
    const p = node.prior;
    if (
      typeof p === 'object' && p !== null &&
      typeof p.distribution === 'string' &&
      typeof p.range_min === 'number' && Number.isFinite(p.range_min) &&
      typeof p.range_max === 'number' && Number.isFinite(p.range_max)
    ) {
      prior = p;

      // Warn if prior exists on non-external factor
      if (category !== 'external') {
        warnings?.push({
          code: REPAIR_CODES.PRIOR_ON_NON_EXTERNAL,
          message: `Node '${node.id}' has prior but category is '${category ?? 'undefined'}' (expected 'external'). Prior will be ignored.`,
          node_id: node.id,
        });
      }
    } else {
      warnings?.push({
        code: REPAIR_CODES.INVALID_PRIOR,
        message: `Node '${node.id}' has malformed prior (requires distribution:string, range_min:number, range_max:number). Prior dropped.`,
        node_id: node.id,
        repair: {
          field: 'node.prior',
          action: 'defaulted',
          from_value: JSON.stringify(p),
          to_value: 'undefined',
          reason: 'Malformed prior object',
        },
      });
    }
  }

  // For constraint nodes, preserve CEE-specific fields that the temporal
  // constraint filter needs to detect non-evaluable constraints (B1-8).
  // Fields are sourced from the raw node or its React Flow data bag.
  const ceeConstraintFields: Record<string, unknown> = {};
  if (normalizedKind === 'constraint') {
    const dm = (node as any).deadline_metadata ?? (node as any).data?.deadline_metadata;
    if (dm !== undefined) ceeConstraintFields.deadline_metadata = dm;

    const u = (node as any).unit ?? (node as any).data?.unit;
    if (u !== undefined) ceeConstraintFields.unit = u;

    const sq = (node as any).source_quote ?? (node as any).data?.source_quote;
    if (sq !== undefined) ceeConstraintFields.source_quote = sq;

    const conf = (node as any).confidence ?? (node as any).data?.confidence;
    if (conf !== undefined) ceeConstraintFields.confidence = conf;

    const prov = (node as any).provenance ?? (node as any).data?.provenance;
    if (prov !== undefined) ceeConstraintFields.provenance = prov;
  }

  return {
    id: node.id,
    kind,
    label: finalLabel,
    description: node.description ?? node.body,
    intercept: rawIntercept === undefined ? undefined : (rawIntercept as number),
    epsilon_std: rawEpsilonStd === undefined ? undefined : (rawEpsilonStd as number),
    observed_state: observedState,
    state_space: stateSpace,
    category,
    prior,
    ...ceeConstraintFields,
  } as EngineNodeV3;
}

// -----------------------------------------------------------------------------
// Edge Normalization
// -----------------------------------------------------------------------------

/**
 * Infer effect direction from source node kind when not explicitly provided.
 *
 * Risk nodes should have negative effect on goals/outcomes by default.
 * This aligns with the semantics: risks reduce goal achievement.
 *
 * @param fromNodeKind Kind of the source node (if known)
 * @param toNodeKind Kind of the target node (if known)
 * @returns Inferred effect direction
 */
function inferEffectDirection(
  fromNodeKind: string | undefined,
  toNodeKind: string | undefined
): 'positive' | 'negative' {
  // Risk nodes have negative effects on goals/outcomes
  if (fromNodeKind === 'risk') {
    // Risk → goal/outcome = negative (risks reduce achievement)
    if (toNodeKind === 'goal' || toNodeKind === 'outcome') {
      return 'negative';
    }
  }
  // Default to positive for all other relationships
  return 'positive';
}

/**
 * Normalize an upstream edge to canonical EngineEdgeV3 format.
 *
 * Handles:
 * - React Flow naming (source/target → from/to)
 * - Multiple uncertainty field names (exists_probability, belief_exists, belief)
 * - Multiple strength representations (weight, strength, strength_std, belief_strength)
 * - Effect direction (positive/negative) - inferred from node kinds if not provided
 *
 * @param edge Upstream edge in any supported format
 * @param index Edge index for error reporting
 * @param nodeKindMap Map of node IDs to their kinds for effect direction inference and structural edge detection
 * @returns Normalized edge in EngineEdgeV3 format
 * @throws NormalisationError if edge is invalid
 */
export function normaliseEdge(
  edge: UpstreamEdge,
  index: number,
  nodeKindMap: Map<string, string>,
  warnings?: NormalisationWarning[]
): EngineEdgeV3 {
  // 1. Resolve from/to
  const from = edge.from ?? edge.source;
  const to = edge.to ?? edge.target;

  if (!from) {
    throw new NormalisationError(
      `Edge at index ${index} missing 'from' or 'source'`,
      'from',
      undefined,
      `edge_${index}`
    );
  }

  if (!to) {
    throw new NormalisationError(
      `Edge at index ${index} missing 'to' or 'target'`,
      'to',
      undefined,
      `edge_${index}`
    );
  }

  const edgeId = `${from}::${to}`;

  /**
   * Push a coefficient repair warning with structured repair data.
   * @param code Canonical repair code from REPAIR_CODES
   */
  const pushRepairWarning = (
    code: string,
    message: string,
    repair: {
      field: string;
      action: 'clamped' | 'defaulted' | 'inferred' | 'floored' | 'derived';
      from_value: number | string | null;
      to_value: number | string;
      reason: string;
    }
  ) => {
    warnings?.push({
      code,
      message,
      edge_id: edgeId,
      repair,
    });
  };

  // 2. Resolve exists_probability (fallback chain)
  const rawExistsProbability = edge.exists_probability ?? edge.belief_exists ?? edge.belief;
  let existsProbability: number;
  if (rawExistsProbability === undefined) {
    existsProbability = DEFAULT_EXISTS_PROBABILITY;
    pushRepairWarning(
      REPAIR_CODES.DEFAULT_EXISTS_PROBABILITY,
      `Edge ${edgeId}: exists_probability defaulted to ${DEFAULT_EXISTS_PROBABILITY}`,
      {
        field: 'edge.exists_probability',
        action: 'defaulted',
        from_value: null,
        to_value: DEFAULT_EXISTS_PROBABILITY,
        reason: 'Missing value, using default',
      }
    );
  } else if (typeof rawExistsProbability !== 'number' || !Number.isFinite(rawExistsProbability)) {
    existsProbability = DEFAULT_EXISTS_PROBABILITY;
    pushRepairWarning(
      REPAIR_CODES.INVALID_EXISTS_PROBABILITY,
      `Edge ${edgeId}: exists_probability invalid, defaulted to ${DEFAULT_EXISTS_PROBABILITY}`,
      {
        field: 'edge.exists_probability',
        action: 'defaulted',
        from_value: rawExistsProbability as number | string | null,
        to_value: DEFAULT_EXISTS_PROBABILITY,
        reason: 'Invalid value, using default',
      }
    );
  } else {
    const clampedExistsProbability = clamp(rawExistsProbability, 0, 1);
    if (clampedExistsProbability !== rawExistsProbability) {
      pushRepairWarning(
        REPAIR_CODES.CLAMP_EXISTS_PROBABILITY,
        `Edge ${edgeId}: exists_probability clamped from ${rawExistsProbability} to ${clampedExistsProbability}`,
        {
          field: 'edge.exists_probability',
          action: 'clamped',
          from_value: rawExistsProbability,
          to_value: clampedExistsProbability,
          reason: 'Value exceeded valid range [0, 1]',
        }
      );
    }
    existsProbability = clampedExistsProbability;
  }

  // 3. Resolve strength
  // Accept BOTH nested (strength.mean/std) AND flat (strength_mean/std) formats
  // This enables compatibility with CEE V3 which outputs flat fields
  let mean: number = DEFAULT_WEIGHT;
  let std: number = MIN_STD;

  // Check for explicit strength: nested object OR flat fields
  const rawMean = edge.strength?.mean ?? edge.strength_mean;
  let hasExplicitMean = false;

  if (rawMean !== undefined) {
    if (typeof rawMean === 'number' && Number.isFinite(rawMean)) {
      mean = rawMean;
      hasExplicitMean = true;
    } else {
      pushRepairWarning(
        REPAIR_CODES.INVALID_STRENGTH_MEAN,
        `Edge ${edgeId}: strength.mean invalid, defaulted using weight`,
        {
          field: 'edge.strength.mean',
          action: 'defaulted',
          from_value: rawMean as number | string | null,
          to_value: DEFAULT_WEIGHT,
          reason: 'Invalid value, derived from weight',
        }
      );
    }
  }

  if (!hasExplicitMean) {
    // Derive from weight and direction
    let weight = edge.weight;
    if (weight === undefined) {
      weight = DEFAULT_WEIGHT;
      pushRepairWarning(
        REPAIR_CODES.DEFAULT_STRENGTH_MEAN,
        `Edge ${edgeId}: strength.mean defaulted using weight ${DEFAULT_WEIGHT}`,
        {
          field: 'edge.strength.mean',
          action: 'defaulted',
          from_value: null,
          to_value: DEFAULT_WEIGHT,
          reason: 'Missing value, derived from weight',
        }
      );
    } else if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      const invalidWeight = weight;
      weight = DEFAULT_WEIGHT;
      pushRepairWarning(
        REPAIR_CODES.DEFAULT_STRENGTH_MEAN,
        `Edge ${edgeId}: strength.mean defaulted using weight ${DEFAULT_WEIGHT} (invalid weight)`,
        {
          field: 'edge.strength.mean',
          action: 'defaulted',
          from_value: invalidWeight as number | string | null,
          to_value: DEFAULT_WEIGHT,
          reason: 'Invalid weight, using default',
        }
      );
    }

    // Resolve effect direction: explicit > inferred from node kinds > positive default
    let direction: 'positive' | 'negative' = edge.effect_direction ?? edge.direction ?? 'positive';

    // If no explicit direction and we have node kind info, infer from semantics
    if (!edge.effect_direction && !edge.direction && nodeKindMap) {
      const fromKind = nodeKindMap.get(from);
      const toKind = nodeKindMap.get(to);
      direction = inferEffectDirection(fromKind, toKind);
      if (direction === 'negative') {
        warnings?.push({
          code: REPAIR_CODES.INFER_EFFECT_DIRECTION,
          message: `Edge '${from}' -> '${to}': effect direction inferred as 'negative' from ${fromKind ?? 'unknown'} -> ${toKind ?? 'unknown'}`,
          edge_id: edgeId,
          repair: {
            field: 'edge.effect_direction',
            action: 'inferred',
            from_value: null,
            to_value: 'negative',
            reason: `Inferred from source node kind '${fromKind ?? 'unknown'}'`,
          },
        });
      }
    }

    mean = direction === 'negative' ? -Math.abs(weight) : Math.abs(weight);
  }

  // APPLY_SIGN_FROM_DIRECTION: When mean is explicitly provided but an explicit
  // direction field says negative and mean is positive, flip the sign.
  // This ensures parity with validate-patch's semantic repair.
  if (hasExplicitMean) {
    const explicitDirection = edge.effect_direction ?? edge.direction;
    if (explicitDirection === 'negative' && mean > 0) {
      const before = mean;
      mean = -Math.abs(mean);
      pushRepairWarning(
        REPAIR_CODES.APPLY_SIGN_FROM_DIRECTION,
        `Edge ${edgeId}: applied negative sign from effect_direction`,
        {
          field: 'edge.strength.mean',
          action: 'inferred',
          from_value: before,
          to_value: mean,
          reason: 'Applied negative sign from explicit effect_direction',
        }
      );
    }
  }

  const clampedMean = clamp(mean, -1, 1);
  if (clampedMean !== mean) {
    pushRepairWarning(
      REPAIR_CODES.CLAMP_STRENGTH_MEAN,
      `Edge ${edgeId}: strength.mean clamped from ${mean} to ${clampedMean}`,
      {
        field: 'edge.strength.mean',
        action: 'clamped',
        from_value: mean,
        to_value: clampedMean,
        reason: 'Value exceeded valid range [-1, 1]',
      }
    );
    mean = clampedMean;
  }

  const rawStd = edge.strength?.std ?? edge.strength_std;
  if (rawStd !== undefined) {
    if (typeof rawStd === 'number' && Number.isFinite(rawStd)) {
      std = rawStd;
    } else {
      std = deriveStd(mean, existsProbability);
      pushRepairWarning(
        REPAIR_CODES.INVALID_STRENGTH_STD,
        `Edge ${edgeId}: strength.std invalid, defaulted to ${std}`,
        {
          field: 'edge.strength.std',
          action: 'defaulted',
          from_value: rawStd as number | string | null,
          to_value: std,
          reason: 'Invalid value, derived from mean and belief',
        }
      );
    }
  } else if (edge.belief_strength !== undefined) {
    if (typeof edge.belief_strength === 'number' && Number.isFinite(edge.belief_strength)) {
      // Higher belief_strength = lower uncertainty
      std = (1 - edge.belief_strength) * 0.5 * Math.abs(mean) + 0.05;
      pushRepairWarning(
        REPAIR_CODES.DERIVE_STD_FROM_BELIEF_STRENGTH,
        `Edge ${edgeId}: strength.std derived from belief_strength=${edge.belief_strength}`,
        {
          field: 'edge.strength.std',
          action: 'derived',
          from_value: null,
          to_value: std,
          reason: 'Derived from belief_strength',
        }
      );
    } else {
      std = deriveStd(mean, existsProbability);
      pushRepairWarning(
        REPAIR_CODES.INVALID_STRENGTH_STD,
        `Edge ${edgeId}: strength.std defaulted to ${std} (invalid belief_strength)`,
        {
          field: 'edge.strength.std',
          action: 'defaulted',
          from_value: edge.belief_strength as number | string | null,
          to_value: std,
          reason: 'Invalid belief_strength, derived from mean and belief',
        }
      );
    }
  } else {
    std = deriveStd(mean, existsProbability);
    pushRepairWarning(
      REPAIR_CODES.DEFAULT_STRENGTH_STD,
      `Edge ${edgeId}: strength.std defaulted to ${std}`,
      {
        field: 'edge.strength.std',
        action: 'derived',
        from_value: null,
        to_value: std,
        reason: 'Missing value, derived from mean and belief',
      }
    );
  }

  if (!Number.isFinite(std)) {
    const prevStd = std;
    std = MIN_STD;
    pushRepairWarning(
      REPAIR_CODES.FLOOR_STRENGTH_STD,
      `Edge ${edgeId}: strength.std floored from ${prevStd} to ${MIN_STD}`,
      {
        field: 'edge.strength.std',
        action: 'floored',
        from_value: prevStd,
        to_value: MIN_STD,
        reason: 'Value not finite, floored to minimum',
      }
    );
  } else {
    // Structural edges (decision→option, option→factor) use lower floor (0.01)
    // Causal edges use epistemic uncertainty floor (0.05)
    const isStructural = isStructuralEdgeType({ from, to }, nodeKindMap);
    const effectiveMinStd = isStructural ? STRUCTURAL_STD_MIN : STD_RANGE_MIN;
    const clampedStd = clamp(std, effectiveMinStd, STD_RANGE_MAX);
    if (clampedStd !== std) {
      pushRepairWarning(
        REPAIR_CODES.CLAMP_STRENGTH_STD,
        `Edge ${edgeId}: strength.std clamped from ${std} to ${clampedStd}`,
        {
          field: 'edge.strength.std',
          action: 'clamped',
          from_value: std,
          to_value: clampedStd,
          reason: `Value exceeded valid range [${effectiveMinStd}, ${STD_RANGE_MAX}]`,
        }
      );
    }
    std = clampedStd;

    // Final guard for ISL requirement (std > 0)
    if (std <= 0) {
      const prevStd = std;
      std = MIN_STD;
      pushRepairWarning(
        REPAIR_CODES.FLOOR_STRENGTH_STD,
        `Edge ${edgeId}: strength.std floored from ${prevStd} to ${MIN_STD}`,
        {
          field: 'edge.strength.std',
          action: 'floored',
          from_value: prevStd,
          to_value: MIN_STD,
          reason: `Value below minimum threshold ${MIN_STD}`,
        }
      );
    }
  }

  const result: EngineEdgeV3 = {
    from,
    to,
    exists_probability: existsProbability,
    strength: { mean, std },
    label: edge.label ? cleanLabelAnnotation(edge.label) || undefined : edge.label,
  };

  // 3A-trust: Preserve edge_type through normalization (bidirected edges)
  if (edge.edge_type === 'bidirected') {
    result.edge_type = 'bidirected';
  }

  return result;
}

// -----------------------------------------------------------------------------
// Graph Normalization
// -----------------------------------------------------------------------------

/**
 * Result of graph normalization.
 */
export interface NormalisationWarning {
  code: string;
  message: string;
  /** Affected node ID (for node-level warnings) */
  node_id?: string;
  /** Affected edge ID (for edge-level warnings) */
  edge_id?: string;
  /**
   * Structured repair data for _meta.repairs_applied.
   * Only present for warnings that represent actual data repairs.
   */
  repair?: {
    field: string;
    action: 'clamped' | 'defaulted' | 'inferred' | 'floored' | 'derived' | 'normalised';
    from_value: number | string | null;
    to_value: number | string;
    reason: string;
  };
}

export interface NormalisationResult {
  /** Normalized graph */
  graph: EngineGraphV3;
  /** Number of nodes normalized */
  nodesNormalised: number;
  /** Number of edges normalized */
  edgesNormalised: number;
  /** Warnings generated during normalization */
  warnings: NormalisationWarning[];
}

/**
 * Normalize an entire upstream graph to canonical EngineGraphV3 format.
 *
 * This does NOT filter option nodes - that is done separately.
 * This just normalizes all field formats to canonical form.
 *
 * Effect direction inference:
 * - If edge has explicit effect_direction, use it
 * - If not, infer from node kinds (e.g., risk → goal = negative)
 * - Otherwise default to positive
 *
 * @param upstreamGraph Graph in upstream format
 * @returns Normalized graph with stats
 * @throws NormalisationError if any node/edge is invalid
 */
export function normaliseGraph(upstreamGraph: UpstreamGraph): NormalisationResult {
  const warnings: NormalisationWarning[] = [];
  const nodes: EngineNodeV3[] = [];
  const edges: EngineEdgeV3[] = [];

  // Build node kind map for effect direction inference
  // Map node IDs to their kinds so edges can infer direction from source/target semantics
  const nodeKindMap = new Map<string, string>();
  for (const upstreamNode of upstreamGraph.nodes ?? []) {
    const kind = upstreamNode.kind ?? upstreamNode.type ?? upstreamNode.data?.kind ?? upstreamNode.data?.type ?? 'factor';
    nodeKindMap.set(upstreamNode.id, kind.toLowerCase());
  }

  // Normalize nodes
  for (const upstreamNode of upstreamGraph.nodes ?? []) {
    try {
      const node = normaliseNode(upstreamNode, warnings);

      // Warn about option nodes (they'll be filtered later)
      if ((upstreamNode.kind ?? upstreamNode.type ?? upstreamNode.data?.kind ?? upstreamNode.data?.type) === 'option') {
        warnings.push({
          code: 'NORMALIZATION_WARNING',
          message: `Node '${node.id}' has kind='option'. Option nodes are filtered before analysis.`,
        });
      }

      nodes.push(node);
    } catch (err) {
      if (err instanceof NormalisationError) {
        throw err;
      }
      throw new NormalisationError(
        `Failed to normalize node: ${(err as Error).message}`,
        'node',
        upstreamNode.id
      );
    }
  }

  // Normalize edges (with node kind map for effect direction inference and structural edge detection)
  let edgeIndex = 0;
  for (const upstreamEdge of upstreamGraph.edges ?? []) {
    try {
      edges.push(normaliseEdge(upstreamEdge, edgeIndex, nodeKindMap, warnings));
      edgeIndex++;
    } catch (err) {
      if (err instanceof NormalisationError) {
        throw err;
      }
      throw new NormalisationError(
        `Failed to normalize edge at index ${edgeIndex}: ${(err as Error).message}`,
        'edge',
        undefined,
        `edge_${edgeIndex}`
      );
    }
  }

  return {
    graph: { nodes, edges },
    nodesNormalised: nodes.length,
    edgesNormalised: edges.length,
    warnings,
  };
}
