/**
 * ISL Translator for V3 Engine
 *
 * Translates from internal EngineGraphV3 format to ISL wire format.
 * ISL expects a flattened format with different field names.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import type {
  EngineGraphV3,
  EngineNodeV3,
  EngineEdgeV3,
  OptionV3,
  InterventionValueV3,
} from '../../types/engine-v3.js';

// -----------------------------------------------------------------------------
// ISL Wire Format Types
// -----------------------------------------------------------------------------

/**
 * ISL node format.
 */
export interface ISLNodeV3 {
  id: string;
  kind?: string;
  label?: string;
  observed_state?: {
    value?: number;
    baseline?: number;
    unit?: string;
  };
  intercept?: number;
}

/**
 * ISL edge format.
 */
export interface ISLEdgeV3 {
  from: string;
  to: string;
  exists_probability: number;
  strength: {
    mean: number;
    std: number;
  };
}

/**
 * ISL option format - interventions are flattened to Record<string, number>.
 */
export interface ISLOptionV3 {
  id: string;
  label?: string;
  interventions: Record<string, number>;
}

/**
 * ISL robustness request format.
 */
export interface ISLRobustnessRequestV3 {
  request_id: string;
  graph: {
    nodes: ISLNodeV3[];
    edges: ISLEdgeV3[];
  };
  options: ISLOptionV3[];
  goal_node_id: string;
  n_samples?: number;
  confidence_level?: number;
  analysis_types: Array<'comparison' | 'sensitivity' | 'robustness'>;
  parameter_uncertainties?: Array<{
    node_id: string;
    distribution: 'normal';
    mean: number;
    std: number;
  }>;
  /**
   * User-defined success threshold for goal.
   * When provided, ISL returns probability_of_goal per option.
   */
  goal_threshold?: number;
}

// -----------------------------------------------------------------------------
// Translation Functions
// -----------------------------------------------------------------------------

/**
 * Translate internal node to ISL format.
 */
export function toISLNode(node: EngineNodeV3): ISLNodeV3 {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    observed_state: node.observed_state,
    intercept: node.intercept ?? 0.0,
  };
}

/**
 * Translate internal edge to ISL format.
 *
 * Preserves structural uncertainty via exists_probability field.
 * The edge.exists_probability has already been normalized from legacy
 * fields (belief, belief_exists) by the graph normalizer.
 */
export function toISLEdge(edge: EngineEdgeV3): ISLEdgeV3 {
  return {
    from: edge.from,
    to: edge.to,
    // Use actual exists_probability (defaults to 1.0 if not set during normalization)
    exists_probability: edge.exists_probability,
    strength: {
      mean: edge.strength.mean,
      std: edge.strength.std,
    },
  };
}

/**
 * Flatten interventions from InterventionValueV3 to simple number values.
 *
 * ISL wire format uses Record<string, number> for interventions.
 * The source metadata is stripped for the wire format.
 *
 * @param interventions Internal intervention format
 * @returns Flattened interventions for ISL
 * @throws Error if any intervention value is invalid
 */
export function toISLInterventions(
  interventions: Record<string, InterventionValueV3>
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [nodeId, intervention] of Object.entries(interventions)) {
    if (typeof intervention.value !== 'number' || !Number.isFinite(intervention.value)) {
      throw new Error(`Invalid intervention value for node '${nodeId}'`);
    }
    result[nodeId] = intervention.value;
  }

  return result;
}

/**
 * Translate internal option to ISL format.
 */
export function toISLOption(option: OptionV3): ISLOptionV3 {
  return {
    id: option.id,
    label: option.label,
    interventions: toISLInterventions(option.interventions),
  };
}

/**
 * Build parameter uncertainties from factor nodes with observed_state.
 *
 * For each factor node with an observed value, create a parameter uncertainty
 * specification for ISL.
 *
 * @param nodes Graph nodes
 * @returns Parameter uncertainties for ISL
 */
export function buildParameterUncertaintiesV3(
  nodes: EngineNodeV3[]
): ISLRobustnessRequestV3['parameter_uncertainties'] {
  const uncertainties: NonNullable<ISLRobustnessRequestV3['parameter_uncertainties']> = [];

  for (const node of nodes) {
    if (node.kind === 'factor' && node.observed_state?.value !== undefined) {
      const value = node.observed_state.value;
      // Default uncertainty: 10% coefficient of variation
      const std = Math.max(0.1, Math.abs(value) * 0.1);

      uncertainties.push({
        node_id: node.id,
        distribution: 'normal',
        mean: value,
        std,
      });
    }
  }

  return uncertainties.length > 0 ? uncertainties : undefined;
}

/**
 * Translate full request to ISL robustness request format.
 *
 * @param graph Internal graph format
 * @param options Internal options format
 * @param goalNodeId Goal node ID
 * @param requestId Request ID for correlation
 * @param nSamples Number of samples (optional)
 * @param goalThreshold Goal threshold for probability_of_goal computation (optional)
 * @returns ISL robustness request
 */
export function toISLRobustnessRequest(
  graph: EngineGraphV3,
  options: OptionV3[],
  goalNodeId: string,
  requestId: string,
  nSamples?: number,
  goalThreshold?: number
): ISLRobustnessRequestV3 {
  const request: ISLRobustnessRequestV3 = {
    request_id: requestId,
    graph: {
      nodes: graph.nodes.map(toISLNode),
      edges: graph.edges.map(toISLEdge),
    },
    options: options.map(toISLOption),
    goal_node_id: goalNodeId,
    n_samples: nSamples,
    analysis_types: ['comparison', 'sensitivity', 'robustness'],
    parameter_uncertainties: buildParameterUncertaintiesV3(graph.nodes),
  };

  // Only include goal_threshold if provided (omit entirely when absent)
  if (goalThreshold !== undefined) {
    request.goal_threshold = goalThreshold;
  }

  return request;
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/**
 * Validate ISL request before sending.
 *
 * Catches issues that would cause ISL to reject the request.
 *
 * @param request ISL request to validate
 * @returns Array of error messages (empty if valid)
 */
export function validateISLRequest(request: ISLRobustnessRequestV3): string[] {
  const errors: string[] = [];

  // Check graph
  if (!request.graph.nodes || request.graph.nodes.length === 0) {
    errors.push('Graph has no nodes');
  }

  // Check options
  if (!request.options || request.options.length === 0) {
    errors.push('No options provided');
  }

  for (const option of request.options ?? []) {
    if (!option.interventions || Object.keys(option.interventions).length === 0) {
      errors.push(`Option '${option.id}' has no interventions`);
    }
  }

  // Check goal node exists
  const nodeIds = new Set(request.graph.nodes?.map((n) => n.id) ?? []);
  if (!nodeIds.has(request.goal_node_id)) {
    errors.push(`Goal node '${request.goal_node_id}' not in graph`);
  }

  // Check intervention targets exist
  for (const option of request.options ?? []) {
    for (const targetId of Object.keys(option.interventions ?? {})) {
      if (!nodeIds.has(targetId)) {
        errors.push(`Option '${option.id}' intervention target '${targetId}' not in graph`);
      }
    }
  }

  return errors;
}
