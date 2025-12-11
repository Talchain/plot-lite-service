/**
 * Model-of-Inference Engine
 *
 * Meta-reasoning about inference quality. This engine:
 * 1. Runs standard inference via model_based
 * 2. Evaluates quality metrics (confidence, identifiability, graph quality)
 * 3. Provides diagnostic metadata about inference reliability
 * 4. Suggests improvements when quality is below threshold
 *
 * The meta-reasoning approach treats the inference process itself as an object
 * of analysis, enabling automated quality assessment and self-improvement suggestions.
 */

import type { Graph } from '../trust/types.js';
import type { InferenceEngine, InferenceConfig, InferenceResult } from './types.js';
import { modelBasedInference } from './model_based.js';
import { calculateConfidence, type ConfidenceInputs } from '../trust/confidence.js';
import { checkIdentifiability, type IdentifiabilityInputs } from '../trust/identifiability.js';
import { computeGraphQuality, type GraphQualityParams } from '../trust/graph-quality.js';
import { checkLinearity } from '../trust/linearity.js';

export interface MetaReasoningResult extends InferenceResult {
  meta_reasoning: {
    quality_assessment: {
      overall_score: number; // 0-1
      confidence_level: 'high' | 'medium' | 'low';
      identifiable: boolean;
      in_linear_range: boolean;
      graph_quality: number;
    };
    diagnostics: {
      issues: string[];
      warnings: string[];
      suggestions: string[];
    };
    reliability: {
      estimate_stability: 'stable' | 'moderate' | 'volatile';
      sensitivity_flag: boolean;
      convergence_status: 'converged' | 'marginal' | 'not_converged';
    };
  };
}

/**
 * Assess estimate stability based on band spread
 */
function assessStability(conservative: number, optimistic: number, mostLikely: number): 'stable' | 'moderate' | 'volatile' {
  if (mostLikely === 0) return 'volatile';

  const spread = Math.abs(optimistic - conservative);
  const relativeSpread = spread / Math.abs(mostLikely);

  // Stable: spread < 10%, Moderate: 10-30%, Volatile: >30%
  if (relativeSpread < 0.1) return 'stable';
  if (relativeSpread < 0.3) return 'moderate';
  return 'volatile';
}

/**
 * Determine convergence status from meta
 */
function getConvergenceStatus(meta?: InferenceResult['meta']): 'converged' | 'marginal' | 'not_converged' {
  if (!meta) return 'marginal';

  // If K_converged is explicitly set
  if (meta.K_converged === true) return 'converged';
  if (meta.K_converged === false) return 'not_converged';

  // Infer from K_evaluated vs K_requested
  if (meta.K_evaluated && meta.K_requested) {
    const ratio = meta.K_evaluated / meta.K_requested;
    if (ratio >= 0.95) return 'converged';
    if (ratio >= 0.7) return 'marginal';
    return 'not_converged';
  }

  // Check sign stability as proxy
  if (meta.sign_stability !== undefined) {
    if (meta.sign_stability >= 0.95) return 'converged';
    if (meta.sign_stability >= 0.8) return 'marginal';
    return 'not_converged';
  }

  return 'marginal';
}

/**
 * Generate improvement suggestions based on diagnostics
 */
function generateSuggestions(
  identifiable: boolean,
  inLinearRange: boolean,
  graphQuality: number,
  kSamples: number,
  stability: 'stable' | 'moderate' | 'volatile',
  convergence: 'converged' | 'marginal' | 'not_converged'
): string[] {
  const suggestions: string[] = [];

  if (!identifiable) {
    suggestions.push('Add instrumental variables or adjust confounders to improve identifiability');
  }

  if (!inLinearRange) {
    suggestions.push('Consider scenario forking for non-linear effects');
  }

  if (graphQuality < 0.5) {
    suggestions.push('Strengthen graph with additional evidence or relationships');
  }

  if (kSamples < 1000) {
    suggestions.push(`Increase sample count from ${kSamples} to at least 1000 for more robust estimates`);
  }

  if (stability === 'volatile') {
    suggestions.push('High estimate variance detected - consider adding constraints or priors');
  }

  if (convergence === 'not_converged') {
    suggestions.push('Inference did not converge - increase K or simplify model');
  }

  return suggestions;
}

export class ModelOfInferenceEngine implements InferenceEngine {
  name = 'model_of_inference';

  run(graph: Graph, config: InferenceConfig): MetaReasoningResult {
    // Step 1: Run base inference
    const baseResult = modelBasedInference.run(graph, config);

    // Step 2: Compute quality metrics
    const issues: string[] = [];
    const warnings: string[] = [];

    // 2a. Identifiability check
    // Use first node as treatment if not specified (heuristic for meta-reasoning)
    const treatmentNode = graph.nodes[0]?.id || 'unknown';
    const identInputs: IdentifiabilityInputs = {
      graph,
      treatment_node: treatmentNode,
      outcome_node: config.outcome_node,
    };
    const identResult = checkIdentifiability(identInputs);

    if (!identResult.identifiable) {
      issues.push(`Identifiability issue: ${identResult.reason || 'unknown'}`);
    }

    // 2b. Linearity check
    const linearityResult = checkLinearity({
      baseline_value: config.baseline_value,
      current_value: baseResult.most_likely.outcome,
    });

    if (linearityResult.outside_range) {
      warnings.push(linearityResult.recommendation);
    }

    // 2c. Graph quality
    const edgesWithProvenance = graph.edges.filter(
      (e) => (e as any).provenance || (e as any).evidence
    ).length;

    const qualityParams: GraphQualityParams = {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      edges_with_provenance: edgesWithProvenance,
      critique_issues: issues.length,
      identifiable: identResult.identifiable,
    };
    const graphQuality = computeGraphQuality(qualityParams);

    // 2d. Confidence calculation
    const confInputs: ConfidenceInputs = {
      graph,
      identifiable: identResult.identifiable,
      in_linear_range: !linearityResult.outside_range,
      k_samples: config.k_samples,
    };
    const confidence = calculateConfidence(confInputs);

    // Step 3: Assess reliability
    const stability = assessStability(
      baseResult.conservative.outcome,
      baseResult.optimistic.outcome,
      baseResult.most_likely.outcome
    );

    const convergence = getConvergenceStatus(baseResult.meta);

    // Check for sensitivity issues (high variance relative to mean)
    const range = baseResult.optimistic.outcome - baseResult.conservative.outcome;
    const sensitivityFlag = baseResult.most_likely.outcome !== 0
      ? Math.abs(range / baseResult.most_likely.outcome) > 0.25
      : range > 0;

    if (sensitivityFlag) {
      warnings.push('High sensitivity detected: estimates vary significantly across scenarios');
    }

    // Step 4: Generate suggestions
    const suggestions = generateSuggestions(
      identResult.identifiable,
      !linearityResult.outside_range,
      graphQuality.score,
      config.k_samples,
      stability,
      convergence
    );

    // Step 5: Compute overall quality score (weighted combination)
    // Weights: confidence (40%), graph quality (30%), convergence (30%)
    const convergenceScore = convergence === 'converged' ? 1.0 : convergence === 'marginal' ? 0.6 : 0.3;
    const overallScore = Number(
      (confidence.score * 0.4 + graphQuality.score * 0.3 + convergenceScore * 0.3).toFixed(2)
    );

    // Step 6: Build enriched result
    return {
      ...baseResult,
      meta: {
        ...baseResult.meta,
        // Add meta-reasoning engine marker
        engine: 'model_of_inference',
      },
      meta_reasoning: {
        quality_assessment: {
          overall_score: overallScore,
          confidence_level: confidence.level,
          identifiable: identResult.identifiable,
          in_linear_range: !linearityResult.outside_range,
          graph_quality: graphQuality.score,
        },
        diagnostics: {
          issues,
          warnings,
          suggestions,
        },
        reliability: {
          estimate_stability: stability,
          sensitivity_flag: sensitivityFlag,
          convergence_status: convergence,
        },
      },
    };
  }
}

export const modelOfInferenceEngine = new ModelOfInferenceEngine();
