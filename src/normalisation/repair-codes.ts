/**
 * Canonical Repair Code Enum — Single Source of Truth
 *
 * Every graph normalisation transform that modifies a value MUST log a
 * RepairEntry using one of these codes. No repair code string literals
 * should exist outside this file.
 *
 * Used by:
 *   - shared normaliser (`normalise-graph.ts`)
 *   - `/v1/validate-patch` (via shared normaliser)
 *   - `/v2/run` (via shared normaliser)
 *
 * ## Code catalogue
 *
 * ### Edge repairs
 * - DEFAULT_EXISTS_PROBABILITY: Missing `exists_probability` defaulted to 0.8
 * - CLAMP_EXISTS_PROBABILITY: `exists_probability` outside [0,1], clamped
 * - INVALID_EXISTS_PROBABILITY: Non-numeric `exists_probability` replaced with default
 * - DEFAULT_STRENGTH_MEAN: Missing `strength.mean` derived from weight/default
 * - INVALID_STRENGTH_MEAN: Non-numeric `strength.mean` replaced with default
 * - CLAMP_STRENGTH_MEAN: `strength.mean` outside [-1,1], clamped
 * - DEFAULT_STRENGTH_STD: Missing `strength.std` derived from mean+belief
 * - INVALID_STRENGTH_STD: Non-numeric `strength.std` replaced with derived value
 * - CLAMP_STRENGTH_STD: `strength.std` outside [floor, 0.4], clamped
 * - FLOOR_STRENGTH_STD: `strength.std` below ISL minimum, floored
 * - DERIVE_STD_FROM_BELIEF_STRENGTH: `strength.std` derived from `belief_strength`
 * - INFER_EFFECT_DIRECTION: Effect direction inferred from source node kind
 * - APPLY_SIGN_FROM_DIRECTION: Sign applied to mean from explicit direction field
 *
 * ### Node repairs
 * - INVALID_CATEGORY: Non-standard category value dropped to undefined
 * - INVALID_PRIOR: Malformed prior object dropped
 * - PRIOR_ON_NON_EXTERNAL: Prior present on non-external node (warning only)
 * - UNKNOWN_NODE_KIND: Unrecognised node kind (warning only)
 * - CLEAN_LABEL_ANNOTATION: Scale/encoding suffix stripped from label
 *
 * ### Structural repairs
 * - CASCADE_REMOVE_EDGE: Edge removed because connected node was deleted
 *
 * ### Constraint transforms (F.6 Data Responsibility)
 * - STRIP_RAW_CONSTRAINT_FIELDS: Non-canonical CEE fields stripped before ISL
 * - FILTER_TEMPORAL_CONSTRAINT: Temporal constraint removed before ISL
 */

// -----------------------------------------------------------------------------
// Repair Code Enum
// -----------------------------------------------------------------------------

/**
 * Canonical repair codes. Every graph transform that modifies a value
 * MUST use one of these codes in its RepairEntry.
 */
export const REPAIR_CODES = {
  // -- Edge: exists_probability --
  DEFAULT_EXISTS_PROBABILITY: 'DEFAULT_EXISTS_PROBABILITY',
  CLAMP_EXISTS_PROBABILITY: 'CLAMP_EXISTS_PROBABILITY',
  INVALID_EXISTS_PROBABILITY: 'INVALID_EXISTS_PROBABILITY',

  // -- Edge: strength.mean --
  DEFAULT_STRENGTH_MEAN: 'DEFAULT_STRENGTH_MEAN',
  INVALID_STRENGTH_MEAN: 'INVALID_STRENGTH_MEAN',
  CLAMP_STRENGTH_MEAN: 'CLAMP_STRENGTH_MEAN',

  // -- Edge: strength.std --
  DEFAULT_STRENGTH_STD: 'DEFAULT_STRENGTH_STD',
  INVALID_STRENGTH_STD: 'INVALID_STRENGTH_STD',
  CLAMP_STRENGTH_STD: 'CLAMP_STRENGTH_STD',
  FLOOR_STRENGTH_STD: 'FLOOR_STRENGTH_STD',
  DERIVE_STD_FROM_BELIEF_STRENGTH: 'DERIVE_STD_FROM_BELIEF_STRENGTH',

  // -- Edge: direction --
  INFER_EFFECT_DIRECTION: 'INFER_EFFECT_DIRECTION',
  APPLY_SIGN_FROM_DIRECTION: 'APPLY_SIGN_FROM_DIRECTION',

  // -- Node --
  INVALID_CATEGORY: 'INVALID_CATEGORY',
  INVALID_PRIOR: 'INVALID_PRIOR',
  PRIOR_ON_NON_EXTERNAL: 'PRIOR_ON_NON_EXTERNAL',
  UNKNOWN_NODE_KIND: 'UNKNOWN_NODE_KIND',
  CLEAN_LABEL_ANNOTATION: 'CLEAN_LABEL_ANNOTATION',

  // -- Structural --
  CASCADE_REMOVE_EDGE: 'CASCADE_REMOVE_EDGE',

  // -- Constraint transforms (F.6 Data Responsibility) --
  STRIP_RAW_CONSTRAINT_FIELDS: 'STRIP_RAW_CONSTRAINT_FIELDS',
  FILTER_TEMPORAL_CONSTRAINT: 'FILTER_TEMPORAL_CONSTRAINT',
} as const;

export type RepairCode = (typeof REPAIR_CODES)[keyof typeof REPAIR_CODES];

// -----------------------------------------------------------------------------
// Repair Action
// -----------------------------------------------------------------------------

/**
 * Repair action describes what kind of transform was applied.
 */
export type RepairAction =
  | 'clamped'
  | 'defaulted'
  | 'inferred'
  | 'floored'
  | 'derived'
  | 'normalised'
  | 'removed';

// -----------------------------------------------------------------------------
// Unified RepairEntry
// -----------------------------------------------------------------------------

/**
 * Canonical repair entry emitted by the shared normaliser.
 *
 * This type is used by BOTH /v2/run and /v1/validate-patch.
 * The same RepairEntry objects appear in:
 *   - `/v2/run` response `_meta.repairs_applied`
 *   - `/v1/validate-patch` response `repairs_applied`
 */
export interface RepairEntry {
  /** Canonical repair code from REPAIR_CODES enum */
  code: RepairCode;
  /** Originating layer (always 'plot' for PLoT transforms) */
  layer: 'plot';
  /** Dotted path to the affected field (e.g., 'a->b.exists_probability') */
  field_path: string;
  /** Value before repair (null if field was missing) */
  before: unknown;
  /** Value after repair */
  after: unknown;
  /** Human-readable reason */
  reason: string;
  /** Severity: info = silent default, warn = user-visible change */
  severity: 'info' | 'warn';
  /** Type of repair action (for _meta.repairs_applied compatibility) */
  action: RepairAction;
}
