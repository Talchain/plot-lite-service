/**
 * Belief→Spread Mapping Documentation
 *
 * Phase 2: Schema & Contracts - Task 2.2
 *
 * Makes the sampling spread formula explicit and versioned.
 * Documents how edge belief values affect inference uncertainty.
 *
 * Current Implementation (v1):
 * - Belief ∈ [0, 1] represents edge existence probability
 * - During Monte Carlo sampling, edges are included with probability = belief
 * - Higher belief → more consistent edge inclusion → lower variance
 * - Lower belief → more random edge inclusion → higher variance
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Belief spread formula version
 */
export type BeliefSpreadVersion = 'v1' | 'v2';

/**
 * Belief spread formula specification
 */
export interface BeliefSpreadFormula {
  /** Formula version */
  version: BeliefSpreadVersion;
  /** Formula description */
  description: string;
  /** Mathematical formula (LaTeX-like notation) */
  formula: string;
  /** Default belief value */
  default_belief: number;
  /** Parameters used in the formula */
  parameters: Record<string, number | string>;
  /** Effective date */
  effective_from: string;
  /** Deprecation date (null if current) */
  deprecated_from: string | null;
}

/**
 * Visualisation data point for belief→spread curve
 */
export interface BeliefSpreadPoint {
  /** Belief level [0, 1] */
  belief: number;
  /** Expected spread (standard deviation of output) */
  spread: number;
  /** Lower bound of spread (p10) */
  spread_p10: number;
  /** Upper bound of spread (p90) */
  spread_p90: number;
  /** Edge inclusion probability */
  inclusion_probability: number;
  /** Effective variance contribution */
  variance_contribution: number;
}

/**
 * Belief spread capability response
 */
export interface BeliefSpreadCapability {
  /** Current formula version */
  current_version: BeliefSpreadVersion;
  /** Formula specification */
  formula: BeliefSpreadFormula;
  /** Visualisation data for UI */
  visualisation_data: BeliefSpreadPoint[];
  /** Supported versions */
  supported_versions: BeliefSpreadVersion[];
}

// ============================================================================
// Formula Definitions
// ============================================================================

/**
 * Belief spread formulas by version
 */
export const BELIEF_SPREAD_FORMULAS: Record<BeliefSpreadVersion, BeliefSpreadFormula> = {
  v1: {
    version: 'v1',
    description: `
Edge Belief as Existence Probability (v1)
==========================================

In this model, belief represents the probability that an edge exists in the
causal graph. During Monte Carlo sampling:

1. For each edge with belief b:
   - Edge is included with probability b
   - Edge is excluded with probability (1-b)

2. Multiple samples create a distribution of outcomes:
   - High belief (b → 1): Edge almost always included → consistent outcomes
   - Low belief (b → 0): Edge rarely included → high variance in outcomes

3. The effective variance contribution from belief is:
   variance_contribution = b × (1 - b)

   This is maximised at b = 0.5 (maximum uncertainty about edge existence).

4. The spread (standard deviation) of outcomes is proportional to:
   spread ∝ √(Σ weight_i² × belief_i × (1 - belief_i))

Key Properties:
- Symmetric around b = 0.5
- Minimum variance at b = 0 or b = 1
- Maximum variance at b = 0.5
    `,
    formula: 'P(edge_included) = belief; variance_contribution = belief × (1 - belief)',
    default_belief: 0.7,
    parameters: {
      K_samples: 32,
      default_belief: 0.7,
      rng_seed: 'deterministic',
    },
    effective_from: '2024-01-01',
    deprecated_from: null,
  },
  v2: {
    version: 'v2',
    description: `
Belief-Weighted Spread Model (v2) - Future
===========================================

Reserved for future belief→spread model that maps belief to continuous
weight uncertainty rather than discrete edge inclusion.

In this model, belief would affect the spread of the edge weight itself:
- High belief: Weight used as-is (narrow distribution)
- Low belief: Weight sampled from wider distribution around nominal value

Formula: weight_effective ~ N(weight, σ²) where σ = f(belief)

Not yet implemented.
    `,
    formula: 'weight_effective ~ N(weight, σ²); σ = σ_max × (1 - belief)',
    default_belief: 0.7,
    parameters: {
      sigma_max: 0.3,
      default_belief: 0.7,
    },
    effective_from: 'TBD',
    deprecated_from: null,
  },
};

/**
 * Current belief spread version
 */
export const CURRENT_BELIEF_SPREAD_VERSION: BeliefSpreadVersion = 'v1';

// ============================================================================
// Computation Functions
// ============================================================================

/**
 * Compute variance contribution from belief
 *
 * For v1 model: variance = belief × (1 - belief)
 * Maximum at belief = 0.5, minimum at belief = 0 or 1
 *
 * @param belief - Edge belief value [0, 1]
 * @returns Variance contribution
 */
export function computeVarianceContribution(belief: number): number {
  // Clamp belief to [0, 1]
  const b = Math.max(0, Math.min(1, belief));
  return b * (1 - b);
}

/**
 * Compute expected spread from belief and weight
 *
 * @param belief - Edge belief value [0, 1]
 * @param weight - Edge weight value
 * @returns Expected spread (standard deviation contribution)
 */
export function computeSpreadFromBelief(belief: number, weight: number): number {
  const varianceContribution = computeVarianceContribution(belief);
  // Spread is proportional to |weight| × √(variance_contribution)
  return Math.abs(weight) * Math.sqrt(varianceContribution);
}

/**
 * Compute total graph spread from all edges
 *
 * @param edges - Array of edges with belief and weight
 * @returns Total expected spread
 */
export function computeGraphSpread(
  edges: Array<{ belief?: number; weight?: number }>
): number {
  const defaultBelief = BELIEF_SPREAD_FORMULAS.v1.default_belief;

  let totalVariance = 0;
  for (const edge of edges) {
    const belief = edge.belief ?? defaultBelief;
    const weight = edge.weight ?? 1.0;
    const variance = computeVarianceContribution(belief) * weight * weight;
    totalVariance += variance;
  }

  return Math.sqrt(totalVariance);
}

/**
 * Generate visualisation data for belief→spread curve
 *
 * @param weight - Reference weight for visualisation (default: 1.0)
 * @param points - Number of data points to generate (default: 21)
 * @returns Array of visualisation data points
 */
export function generateBeliefSpreadCurve(
  weight: number = 1.0,
  points: number = 21
): BeliefSpreadPoint[] {
  const data: BeliefSpreadPoint[] = [];

  for (let i = 0; i < points; i++) {
    const belief = i / (points - 1);
    const varianceContribution = computeVarianceContribution(belief);
    const spread = computeSpreadFromBelief(belief, weight);

    // Approximate p10/p90 bounds for spread
    // Using ±1.28 standard deviations for 80% interval
    const spreadP10 = spread * 0.5; // Lower bound approximation
    const spreadP90 = spread * 1.5; // Upper bound approximation

    data.push({
      belief: Math.round(belief * 100) / 100,
      spread: Math.round(spread * 1000) / 1000,
      spread_p10: Math.round(spreadP10 * 1000) / 1000,
      spread_p90: Math.round(spreadP90 * 1000) / 1000,
      inclusion_probability: belief,
      variance_contribution: Math.round(varianceContribution * 1000) / 1000,
    });
  }

  return data;
}

/**
 * Get belief spread capability information for API response
 *
 * @returns Capability information including formula and visualisation
 */
export function getBeliefSpreadCapability(): BeliefSpreadCapability {
  return {
    current_version: CURRENT_BELIEF_SPREAD_VERSION,
    formula: BELIEF_SPREAD_FORMULAS[CURRENT_BELIEF_SPREAD_VERSION],
    visualisation_data: generateBeliefSpreadCurve(),
    supported_versions: Object.keys(BELIEF_SPREAD_FORMULAS) as BeliefSpreadVersion[],
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Interpret belief level in human terms
 *
 * @param belief - Belief value [0, 1]
 * @returns Human-readable interpretation
 */
export function interpretBeliefLevel(belief: number): {
  level: 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';
  label: string;
  description: string;
} {
  if (belief < 0.2) {
    return {
      level: 'very_low',
      label: 'Very Low Confidence',
      description: 'Edge rarely contributes to outcome. High uncertainty.',
    };
  }
  if (belief < 0.4) {
    return {
      level: 'low',
      label: 'Low Confidence',
      description: 'Edge sometimes contributes. Significant uncertainty.',
    };
  }
  if (belief < 0.6) {
    return {
      level: 'moderate',
      label: 'Moderate Confidence',
      description: 'Edge contributes about half the time. Maximum variance.',
    };
  }
  if (belief < 0.8) {
    return {
      level: 'high',
      label: 'High Confidence',
      description: 'Edge usually contributes. Moderate uncertainty.',
    };
  }
  return {
    level: 'very_high',
    label: 'Very High Confidence',
    description: 'Edge almost always contributes. Low uncertainty.',
  };
}

/**
 * Recommend belief value based on evidence strength
 *
 * @param evidenceStrength - Description of evidence strength
 * @returns Recommended belief value
 */
export function recommendBeliefFromEvidence(
  evidenceStrength: 'none' | 'weak' | 'moderate' | 'strong' | 'definitive'
): number {
  const recommendations: Record<string, number> = {
    none: 0.3,
    weak: 0.5,
    moderate: 0.7,
    strong: 0.85,
    definitive: 0.95,
  };
  return recommendations[evidenceStrength] ?? 0.7;
}

// ============================================================================
// Documentation Export
// ============================================================================

/**
 * Complete documentation for belief→spread mapping
 */
export const BELIEF_SPREAD_DOCUMENTATION = {
  title: 'Belief→Spread Mapping Documentation',
  version: CURRENT_BELIEF_SPREAD_VERSION,
  overview: `
How Belief Affects Inference Uncertainty
=========================================

In PLoT Engine, edge belief values control how uncertain we are about
causal relationships. This uncertainty propagates through inference
to create distributions of outcomes.

Key Concepts:
-------------
1. Belief is the probability that an edge exists in the true causal graph
2. During Monte Carlo sampling, edges are randomly included/excluded
3. High belief means consistent edge inclusion → narrow outcome distribution
4. Low belief means random edge inclusion → wide outcome distribution

The relationship is NOT linear:
- Maximum uncertainty at belief = 0.5 (coin flip)
- Minimum uncertainty at belief = 0 or 1 (certain)
- Variance follows: v = belief × (1 - belief)
`,
  formula: BELIEF_SPREAD_FORMULAS[CURRENT_BELIEF_SPREAD_VERSION],
  visualisation_endpoint: '/v1/capabilities (belief_spread field)',
  related_parameters: {
    SCM_LITE_BELIEF_DEFAULT: 'Default belief for edges without explicit belief (default: 0.7)',
    K_SAMPLES: 'Number of Monte Carlo samples (affects convergence)',
  },
};
