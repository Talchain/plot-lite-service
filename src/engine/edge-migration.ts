/**
 * Edge Migration Utilities
 *
 * Handles automatic migration from EdgeV1 to EdgeV2 schema.
 *
 * EdgeV1 → EdgeV2 Migration:
 * - belief_exists = existing belief value (or 1.0 if missing)
 * - belief_strength = existing belief value (or 0.8 if missing)
 * - functional_form = existing function_type (or 'linear' if missing)
 * - weight = existing weight (no re-scaling in Phase 1)
 * - provenance = existing provenance (or 'template' if missing)
 *
 * All existing graphs work without modification.
 */

import type { GraphEdge, EdgeV2, FunctionalForm, ProvenanceTag } from '../trust/types.js';

/** Default values for EdgeV2 migration */
export const EDGE_V2_DEFAULTS = {
  /** Default belief_exists when migrating from EdgeV1 without belief */
  BELIEF_EXISTS: 1.0,
  /** Default belief_strength when migrating from EdgeV1 without belief */
  BELIEF_STRENGTH: 0.8,
  /** Default functional_form when not specified */
  FUNCTIONAL_FORM: 'linear' as FunctionalForm,
  /** Default provenance when not specified */
  PROVENANCE: 'template' as ProvenanceTag,
  /** Default weight when not specified */
  WEIGHT: 1.0,
  /** Default std as percentage of |weight| when neither strength_std nor belief_strength provided */
  DEFAULT_STD_RATIO: 0.1,
  /** Minimum std to ensure non-zero variance */
  MIN_STD: 0.05,
};

/**
 * Detect if an edge is EdgeV2 format
 * EdgeV2 has belief_exists and belief_strength fields
 */
export function isEdgeV2(edge: GraphEdge): boolean {
  return edge.belief_exists !== undefined || edge.belief_strength !== undefined;
}

/**
 * Get the effective belief_exists value for an edge
 * Handles both EdgeV1 (single belief) and EdgeV2 (dual beliefs) formats
 */
export function getBeliefExists(edge: GraphEdge): number {
  // EdgeV2: use belief_exists directly
  if (edge.belief_exists !== undefined) {
    return Math.max(0, Math.min(1, edge.belief_exists));
  }
  // EdgeV1: use legacy belief field
  if (edge.belief !== undefined) {
    return Math.max(0, Math.min(1, edge.belief));
  }
  // Default
  return EDGE_V2_DEFAULTS.BELIEF_EXISTS;
}

/**
 * Get the effective belief_strength value for an edge
 * Handles both EdgeV1 (single belief) and EdgeV2 (dual beliefs) formats
 */
export function getBeliefStrength(edge: GraphEdge): number {
  // EdgeV2: use belief_strength directly
  if (edge.belief_strength !== undefined) {
    return Math.max(0, Math.min(1, edge.belief_strength));
  }
  // EdgeV1: use legacy belief field as strength proxy
  if (edge.belief !== undefined) {
    return Math.max(0, Math.min(1, edge.belief));
  }
  // Default
  return EDGE_V2_DEFAULTS.BELIEF_STRENGTH;
}

/**
 * Get the effective functional_form for an edge
 * Handles both EdgeV1 (function_type) and EdgeV2 (functional_form) formats
 */
export function getFunctionalForm(edge: GraphEdge): FunctionalForm {
  // EdgeV2: use functional_form directly
  if (edge.functional_form !== undefined) {
    return edge.functional_form;
  }
  // EdgeV1: use legacy function_type field
  if (edge.function_type !== undefined) {
    return edge.function_type;
  }
  // Default
  return EDGE_V2_DEFAULTS.FUNCTIONAL_FORM;
}

/**
 * Get the effective weight for an edge
 */
export function getWeight(edge: GraphEdge): number {
  return edge.weight ?? EDGE_V2_DEFAULTS.WEIGHT;
}

/**
 * Get the effective provenance for an edge
 */
export function getProvenance(edge: GraphEdge): ProvenanceTag {
  return (edge.provenance as ProvenanceTag) ?? EDGE_V2_DEFAULTS.PROVENANCE;
}

/**
 * Migrate a single EdgeV1 to EdgeV2 format
 * This is a lossless migration that preserves all existing behaviour
 *
 * @param edge - EdgeV1 or EdgeV2 edge
 * @returns EdgeV2 format edge
 */
export function migrateEdgeToV2(edge: GraphEdge): EdgeV2 {
  return {
    id: edge.id ?? `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    weight: getWeight(edge),
    belief_exists: getBeliefExists(edge),
    belief_strength: getBeliefStrength(edge),
    functional_form: getFunctionalForm(edge),
    provenance: getProvenance(edge),
    label: edge.label,
    edge_type: edge.edge_type,
    function_params: edge.function_params,
  };
}

/**
 * Migrate an array of edges to EdgeV2 format
 *
 * @param edges - Array of EdgeV1 or EdgeV2 edges
 * @returns Array of EdgeV2 format edges
 */
export function migrateEdgesToV2(edges: GraphEdge[]): EdgeV2[] {
  return edges.map(migrateEdgeToV2);
}

/**
 * Convert EdgeV2 back to GraphEdge format for backward compatibility
 * Used when the system needs to output EdgeV1 format
 *
 * @param edge - EdgeV2 edge
 * @returns GraphEdge format
 */
export function edgeV2ToGraphEdge(edge: EdgeV2): GraphEdge {
  return {
    id: edge.id,
    from: edge.source,
    to: edge.target,
    weight: edge.weight,
    // Use belief_exists as the legacy belief (for backward compatibility)
    belief: edge.belief_exists,
    // EdgeV2 fields
    belief_exists: edge.belief_exists,
    belief_strength: edge.belief_strength,
    functional_form: edge.functional_form,
    // Also set function_type for backward compatibility
    function_type: edge.functional_form,
    function_params: edge.function_params,
    provenance: edge.provenance,
    label: edge.label,
    edge_type: edge.edge_type,
  };
}

/**
 * Compute effective weight with belief_strength variance
 *
 * When belief_strength is high (close to 1), the weight is returned as-is.
 * When belief_strength is low, the weight varies more around its center.
 *
 * Uses a simple variance model:
 * variance = k * (1 - belief_strength)
 *
 * @param baseWeight - The base weight value
 * @param beliefStrength - Confidence in weight precision (0-1)
 * @param random - Random value [0, 1) for sampling
 * @param varianceScale - Scale factor for variance (default: 0.5)
 * @returns Sampled weight value
 */
export function sampleWeightWithVariance(
  baseWeight: number,
  beliefStrength: number,
  random: number,
  varianceScale: number = 0.5
): number {
  // High belief_strength (close to 1) → tight distribution
  // Low belief_strength (close to 0) → wide distribution
  const variance = varianceScale * (1 - beliefStrength);

  if (variance <= 0) {
    return baseWeight;
  }

  // Box-Muller transform for normal distribution
  // Using two random values to get a normally distributed value
  // Since we only have one random value, use a simple approximation
  // Central limit theorem: sum of uniform randoms → normal
  // Here we use a simpler symmetric adjustment
  const adjustment = (random - 0.5) * 2 * Math.sqrt(variance * 3);

  return baseWeight + adjustment * Math.abs(baseWeight || 1);
}

/**
 * Sample weight using dual beliefs
 *
 * 1. If edge should be excluded (based on belief_exists), returns null
 * 2. If included, samples weight with variance based on belief_strength
 *
 * @param edge - Edge to sample from
 * @param existsRandom - Random value [0, 1) for existence check
 * @param weightRandom - Random value [0, 1) for weight sampling
 * @returns Sampled weight or null if edge is excluded
 */
export function sampleEdgeWeight(
  edge: GraphEdge,
  existsRandom: number,
  weightRandom: number
): number | null {
  const beliefExists = getBeliefExists(edge);
  const beliefStrength = getBeliefStrength(edge);
  const baseWeight = getWeight(edge);

  // Step 1: Edge inclusion (Bernoulli with probability belief_exists)
  if (existsRandom >= beliefExists) {
    return null; // Edge excluded
  }

  // Step 2: Weight sampling with variance based on belief_strength
  return sampleWeightWithVariance(baseWeight, beliefStrength, weightRandom);
}

/**
 * Derive standard deviation from legacy beliefStrength field.
 *
 * beliefStrength represents confidence in the effect magnitude.
 * High beliefStrength → low variance, low beliefStrength → high variance.
 *
 * @param weight - The base weight value
 * @param beliefStrength - Confidence in weight precision [0,1]
 * @returns Derived standard deviation
 */
function deriveStdFromBeliefStrength(weight: number, beliefStrength: number): number {
  // Coefficient of variation inversely proportional to belief strength
  // cv ranges from 0.1 (high confidence) to 0.4 (low confidence)
  const cv = 0.3 * (1 - beliefStrength) + 0.1;
  return Math.max(EDGE_V2_DEFAULTS.MIN_STD, cv * Math.abs(weight));
}

/**
 * Get the standard deviation for edge strength sampling.
 *
 * Priority:
 * 1. Use explicit strength_std if provided (v2.2)
 * 2. Derive from belief_strength (legacy) if provided
 * 3. Use default (10% of |weight|, minimum 0.05)
 *
 * @param edge - The edge to get std for
 * @returns Standard deviation for Normal sampling
 */
export function getEdgeStd(edge: GraphEdge): number {
  // v2.2: Prefer explicit strength_std
  if (edge.strength_std !== undefined && edge.strength_std > 0) {
    return edge.strength_std;
  }

  // Legacy: Derive from belief_strength
  const beliefStrength = getBeliefStrength(edge);
  if (edge.belief_strength !== undefined || edge.belief !== undefined) {
    return deriveStdFromBeliefStrength(edge.weight ?? 1.0, beliefStrength);
  }

  // Default fallback: 10% of |weight|, minimum 0.05
  const weight = edge.weight ?? 1.0;
  return Math.max(EDGE_V2_DEFAULTS.MIN_STD, Math.abs(weight) * EDGE_V2_DEFAULTS.DEFAULT_STD_RATIO);
}

/**
 * Validate edge strength_std field.
 *
 * @param edge - Edge to validate
 * @returns Error message if invalid, null if valid
 */
export function validateStrengthStd(edge: GraphEdge): string | null {
  if (edge.strength_std !== undefined) {
    if (typeof edge.strength_std !== 'number' || !Number.isFinite(edge.strength_std)) {
      return `Edge ${edge.from}->${edge.to}: strength_std must be a finite number`;
    }
    if (edge.strength_std <= 0) {
      return `Edge ${edge.from}->${edge.to}: strength_std must be > 0, got ${edge.strength_std}`;
    }
  }
  return null;
}
