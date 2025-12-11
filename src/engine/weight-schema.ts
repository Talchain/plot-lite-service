/**
 * Weight Schema Infrastructure
 *
 * Phase 2: Schema & Contracts - Task 2.1
 *
 * Provides infrastructure for unbounded weights while maintaining backward compatibility
 * with UI-bounded inputs. Implements normalisation and versioned schema support.
 *
 * Weight Schema Versions:
 * - v1: Legacy bounded weights [-1, +1] - UI default representation
 * - v2: Extended bounded weights [-3, +3] - Recommended for numerical stability
 * - v3: Unbounded weights (-∞, +∞) - Internal representation, expert mode
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Weight schema version
 * - v1: Legacy [-1, +1] - backward compatible with older UIs
 * - v2: Extended [-3, +3] - recommended for numerical stability
 * - v3: Unbounded - internal/expert mode
 */
export type WeightSchemaVersion = 'v1' | 'v2' | 'v3';

/**
 * Weight interpretation metadata
 */
export interface WeightSchemaMetadata {
  /** Schema version */
  version: WeightSchemaVersion;
  /** Minimum bound (null = unbounded) */
  min_bound: number | null;
  /** Maximum bound (null = unbounded) */
  max_bound: number | null;
  /** Description of the schema */
  description: string;
  /** Whether this is the default UI representation */
  ui_default: boolean;
}

/**
 * Weight normalisation result
 */
export interface NormalisedWeight {
  /** Normalised weight value in target schema */
  weight: number;
  /** Original weight value */
  original: number;
  /** Source schema version */
  source_schema: WeightSchemaVersion;
  /** Target schema version */
  target_schema: WeightSchemaVersion;
  /** Whether the weight was clamped */
  clamped: boolean;
  /** Warning message if applicable */
  warning?: string;
}

/**
 * Graph weight metadata for versioning
 */
export interface GraphWeightMetadata {
  /** Weight schema version used in this graph */
  weight_schema_version: WeightSchemaVersion;
  /** Whether weights have been normalised */
  normalised: boolean;
  /** Original schema if converted */
  original_schema?: WeightSchemaVersion;
  /** Normalisation timestamp */
  normalised_at?: string;
}

// ============================================================================
// Schema Definitions
// ============================================================================

/**
 * Weight schema definitions by version
 */
export const WEIGHT_SCHEMAS: Record<WeightSchemaVersion, WeightSchemaMetadata> = {
  v1: {
    version: 'v1',
    min_bound: -1,
    max_bound: 1,
    description: 'Legacy bounded weights [-1, +1]. Standard UI representation.',
    ui_default: true,
  },
  v2: {
    version: 'v2',
    min_bound: -3,
    max_bound: 3,
    description: 'Extended bounded weights [-3, +3]. Recommended for numerical stability.',
    ui_default: false,
  },
  v3: {
    version: 'v3',
    min_bound: null,
    max_bound: null,
    description: 'Unbounded weights (-∞, +∞). Internal representation, expert mode.',
    ui_default: false,
  },
};

/**
 * Default weight schema version for new graphs
 */
export const DEFAULT_WEIGHT_SCHEMA: WeightSchemaVersion = 'v2';

/**
 * Internal processing schema (always unbounded)
 */
export const INTERNAL_WEIGHT_SCHEMA: WeightSchemaVersion = 'v3';

// ============================================================================
// Normalisation Functions
// ============================================================================

/**
 * Normalise a weight from one schema to another
 *
 * @param weight - Weight value to normalise
 * @param sourceSchema - Source schema version
 * @param targetSchema - Target schema version
 * @returns Normalised weight with metadata
 */
export function normaliseWeight(
  weight: number,
  sourceSchema: WeightSchemaVersion,
  targetSchema: WeightSchemaVersion
): NormalisedWeight {
  const source = WEIGHT_SCHEMAS[sourceSchema];
  const target = WEIGHT_SCHEMAS[targetSchema];

  let normalisedWeight = weight;
  let clamped = false;
  let warning: string | undefined;

  // If converting from bounded to bounded, scale proportionally
  if (source.min_bound !== null && source.max_bound !== null &&
      target.min_bound !== null && target.max_bound !== null) {
    // Linear mapping from source range to target range
    const sourceRange = source.max_bound - source.min_bound;
    const targetRange = target.max_bound - target.min_bound;
    const sourceMid = (source.max_bound + source.min_bound) / 2;
    const targetMid = (target.max_bound + target.min_bound) / 2;

    // Normalise relative to midpoint
    const relativePos = (weight - sourceMid) / (sourceRange / 2);
    normalisedWeight = targetMid + relativePos * (targetRange / 2);
  }

  // Apply target bounds if bounded
  if (target.min_bound !== null && normalisedWeight < target.min_bound) {
    warning = `Weight ${weight} clamped to minimum ${target.min_bound}`;
    normalisedWeight = target.min_bound;
    clamped = true;
  }
  if (target.max_bound !== null && normalisedWeight > target.max_bound) {
    warning = `Weight ${weight} clamped to maximum ${target.max_bound}`;
    normalisedWeight = target.max_bound;
    clamped = true;
  }

  return {
    weight: normalisedWeight,
    original: weight,
    source_schema: sourceSchema,
    target_schema: targetSchema,
    clamped,
    warning,
  };
}

/**
 * Convert weight from UI representation to internal representation
 *
 * @param weight - Weight value from UI
 * @param uiSchema - UI schema version (default: v1)
 * @returns Weight in internal (unbounded) representation
 */
export function weightFromUI(weight: number, uiSchema: WeightSchemaVersion = 'v1'): number {
  // Internal representation is unbounded, so just validate source bounds
  const schema = WEIGHT_SCHEMAS[uiSchema];

  if (schema.min_bound !== null && schema.max_bound !== null) {
    // No transformation needed - just pass through
    // Internal representation accepts all values
    return weight;
  }

  return weight;
}

/**
 * Convert weight from internal representation to UI representation
 *
 * @param weight - Weight value from internal processing
 * @param targetSchema - Target UI schema version (default: v1)
 * @returns Normalised weight for UI display
 */
export function weightToUI(weight: number, targetSchema: WeightSchemaVersion = 'v1'): NormalisedWeight {
  return normaliseWeight(weight, 'v3', targetSchema);
}

/**
 * Normalise all edges in a graph to a target schema
 *
 * @param edges - Array of edges with weights
 * @param sourceSchema - Source schema version
 * @param targetSchema - Target schema version
 * @returns Normalised edges with metadata
 */
export function normaliseGraphWeights(
  edges: Array<{ from: string; to: string; weight?: number; [key: string]: any }>,
  sourceSchema: WeightSchemaVersion,
  targetSchema: WeightSchemaVersion
): {
  edges: Array<{ from: string; to: string; weight?: number; [key: string]: any }>;
  metadata: GraphWeightMetadata;
  warnings: string[];
} {
  const warnings: string[] = [];
  const normalisedEdges = edges.map((edge) => {
    if (edge.weight === undefined) {
      return edge;
    }

    const result = normaliseWeight(edge.weight, sourceSchema, targetSchema);
    if (result.warning) {
      warnings.push(`Edge ${edge.from}->${edge.to}: ${result.warning}`);
    }

    return {
      ...edge,
      weight: result.weight,
    };
  });

  return {
    edges: normalisedEdges,
    metadata: {
      weight_schema_version: targetSchema,
      normalised: sourceSchema !== targetSchema,
      original_schema: sourceSchema !== targetSchema ? sourceSchema : undefined,
      normalised_at: sourceSchema !== targetSchema ? new Date().toISOString() : undefined,
    },
    warnings,
  };
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check if a weight is within schema bounds
 *
 * @param weight - Weight value to check
 * @param schema - Schema version to check against
 * @returns True if weight is within bounds
 */
export function isWeightInBounds(weight: number, schema: WeightSchemaVersion): boolean {
  const schemaSpec = WEIGHT_SCHEMAS[schema];

  if (schemaSpec.min_bound !== null && weight < schemaSpec.min_bound) {
    return false;
  }
  if (schemaSpec.max_bound !== null && weight > schemaSpec.max_bound) {
    return false;
  }

  return true;
}

/**
 * Get weight bounds for a schema
 *
 * @param schema - Schema version
 * @returns Bounds as [min, max] or [null, null] for unbounded
 */
export function getWeightBounds(schema: WeightSchemaVersion): [number | null, number | null] {
  const schemaSpec = WEIGHT_SCHEMAS[schema];
  return [schemaSpec.min_bound, schemaSpec.max_bound];
}

/**
 * Detect the likely schema version for a set of weights
 *
 * @param weights - Array of weight values
 * @returns Most likely schema version
 */
export function detectWeightSchema(weights: number[]): WeightSchemaVersion {
  if (weights.length === 0) {
    return DEFAULT_WEIGHT_SCHEMA;
  }

  const maxAbs = Math.max(...weights.map(Math.abs));

  // If all weights within [-1, 1], likely v1
  if (maxAbs <= 1) {
    return 'v1';
  }

  // If all weights within [-3, 3], likely v2
  if (maxAbs <= 3) {
    return 'v2';
  }

  // Otherwise, must be unbounded v3
  return 'v3';
}

// ============================================================================
// Migration Helpers
// ============================================================================

/**
 * Migration path documentation
 */
export const WEIGHT_MIGRATION_GUIDE = {
  overview: `
Weight Schema Migration Guide
=============================

PLoT Engine supports three weight schema versions:

1. v1 (Legacy): Weights bounded to [-1, +1]
   - Standard UI representation
   - Used by older clients
   - Safe for all numerical operations

2. v2 (Extended): Weights bounded to [-3, +3]
   - Recommended for numerical stability
   - Allows stronger causal relationships
   - Default for new graphs

3. v3 (Unbounded): Weights can be any real number
   - Internal representation
   - Expert mode for advanced users
   - Requires careful handling to avoid overflow

Migration Paths:
----------------
v1 → v2: Linear scaling (×3)
v1 → v3: Direct pass-through (no scaling)
v2 → v1: Linear scaling (÷3) with clamping
v2 → v3: Direct pass-through (no scaling)
v3 → v1: Clamping to [-1, +1]
v3 → v2: Clamping to [-3, +3]

Backward Compatibility:
-----------------------
- Graphs without weight_schema_version are assumed to be v2
- UI clients should always normalise to their preferred schema
- Internal processing uses v3 (unbounded) for maximum flexibility
`,

  migrationSteps: [
    {
      from: 'v1',
      to: 'v2',
      method: 'Linear scaling ×3',
      reversible: true,
    },
    {
      from: 'v1',
      to: 'v3',
      method: 'Direct pass-through',
      reversible: true,
    },
    {
      from: 'v2',
      to: 'v1',
      method: 'Linear scaling ÷3 with clamping',
      reversible: false, // May lose information
    },
    {
      from: 'v2',
      to: 'v3',
      method: 'Direct pass-through',
      reversible: true,
    },
    {
      from: 'v3',
      to: 'v1',
      method: 'Clamping to [-1, +1]',
      reversible: false, // May lose information
    },
    {
      from: 'v3',
      to: 'v2',
      method: 'Clamping to [-3, +3]',
      reversible: false, // May lose information
    },
  ],
};

/**
 * Get migration path information
 *
 * @param from - Source schema version
 * @param to - Target schema version
 * @returns Migration path details
 */
export function getMigrationPath(
  from: WeightSchemaVersion,
  to: WeightSchemaVersion
): { method: string; reversible: boolean; warning?: string } | null {
  if (from === to) {
    return { method: 'No migration needed', reversible: true };
  }

  const path = WEIGHT_MIGRATION_GUIDE.migrationSteps.find(
    (p) => p.from === from && p.to === to
  );

  if (!path) {
    return null;
  }

  return {
    method: path.method,
    reversible: path.reversible,
    warning: path.reversible
      ? undefined
      : 'This migration may lose information due to clamping.',
  };
}
