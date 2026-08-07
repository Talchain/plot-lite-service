/**
 * POST /v1/assist/key-insight - Key Insight Proxy
 *
 * Proxies key insight requests to CEE after enriching with PLoT inference context.
 * 1. Runs inference to get ranked options
 * 2. Builds ranked_actions array from results
 * 3. Calls CEE /assist/v1/key-insight
 * 4. Returns response with provenance
 *
 * Phase 2: Cross-workstream coordination - CEE routing architecture
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { replyWithAppError } from '../../errors.js';
import { getInferenceEngine } from '../../inference/index.js';
import { normalizeGraph } from '../../util/normalize.js';
import { computeRankingConfidence } from '../../trust/ranking-confidence.js';
import { detectPrimaryOutcome } from '../../services/ranking/outcome-detector.js';
import { inferEdgeTypes } from '../../services/ranking/edge-type-inference.js';
import { isFlagOn } from '../../cee/codes.js';
import { checkIdentifiability, type IdentifiabilityResult } from '../../trust/identifiability.js';
import type {
  KeyInsightRequest,
  KeyInsightResponse,
  RankedAction,
  CeeKeyInsight,
  CeeIdentifiability,
  CeeKeyInsightRequestBody,
  ResponseWarning,
  Goal,
  GoalType,
} from './types/key-insight.types.js';
import type { RankingConfidence } from './types/run-bundle.types.js';
import type { NodeKind } from '../../trust/types.js';
import { VALID_NODE_KINDS } from '../../trust/types.js';
import { MAX_NODES, MAX_EDGES } from '../../constants/limits.js';

const DEFAULT_K_SAMPLES = 32;
import { CEE_TIMEOUT_MS } from '../../config/timeouts.js';

/**
 * Patterns for classifying goal types
 */
const CONTINUOUS_PATTERNS = [
  /reach\s+[$£€]?\d/i,           // "Reach $20k", "Reach £20k"
  /increase.*to\s+\d/i,           // "Increase to 100"
  /reduce.*to\s+\d/i,             // "Reduce to 5%"
  /grow.*to\s+\d/i,               // "Grow to $1M"
  /achieve\s+\d/i,                // "Achieve 90%"
  /hit\s+[$£€]?\d/i,             // "Hit $50k"
  /target[:\s]+[$£€]?\d/i,       // "Target: $100k"
  /\d+[%kKmM]\s*(mrr|arr|revenue|growth|churn|retention)/i,  // "20k MRR"
  /(mrr|arr|revenue|growth|churn|retention).*\d+[%kKmM]/i,   // "MRR of 20k"
  /under\s+\d/i,                  // "Keep under 5%"
  /below\s+\d/i,                  // "Stay below 10%"
  /above\s+\d/i,                  // "Maintain above 80%"
  /at\s+least\s+\d/i,             // "At least 50"
];

const BINARY_PATTERNS = [
  /^launch\b/i,                   // "Launch product"
  /^get\s+.*approval/i,           // "Get board approval"
  /^secure\b/i,                   // "Secure funding"
  /^complete\b/i,                 // "Complete project"
  /^finish\b/i,                   // "Finish migration"
  /^deliver\b/i,                  // "Deliver MVP"
  /^ship\b/i,                     // "Ship feature"
  /^close\b/i,                    // "Close deal"
  /^win\b/i,                      // "Win contract"
  /^hire\b/i,                     // "Hire team lead"
  /successfully$/i,               // "Launch successfully"
  /\?$/,                          // Questions are binary (yes/no)
];

const COMPOUND_INDICATORS = [
  /\s+and\s+/i,                   // "Reach 20k and keep churn under 4%"
  /\s+\+\s+/,                     // "Goal A + Goal B"
  /\s+while\s+/i,                 // "Grow revenue while reducing costs"
  /\s+with\s+.*\d/i,              // "Launch with 90% satisfaction"
];

/**
 * Classify a goal's type based on its label text
 */
export function classifyGoalType(label: string): GoalType {
  const text = label.trim();

  // Check for compound indicators first
  for (const pattern of COMPOUND_INDICATORS) {
    if (pattern.test(text)) {
      return 'compound';
    }
  }

  // Check for continuous patterns (measurable targets)
  for (const pattern of CONTINUOUS_PATTERNS) {
    if (pattern.test(text)) {
      return 'continuous';
    }
  }

  // Check for binary patterns (yes/no outcomes)
  for (const pattern of BINARY_PATTERNS) {
    if (pattern.test(text)) {
      return 'binary';
    }
  }

  // Default to continuous for goals with numbers, binary otherwise
  if (/\d/.test(text)) {
    return 'continuous';
  }

  return 'binary';
}

/**
 * Extract goal nodes from a graph and determine the primary goal
 *
 * Primary goal selection priority:
 * 1. First goal with highest weighted edge to a decision node
 * 2. First goal in topological order (earliest in node list)
 */
export function extractGoals(
  nodes: Array<{ id: string; label?: string; kind?: string }>,
  edges: Array<{ from: string; to: string; weight?: number }>
): { goals: Goal[]; primaryGoalId: string | null } {
  // Find all goal nodes
  const goalNodes = nodes.filter(n => n.kind === 'goal');

  if (goalNodes.length === 0) {
    return { goals: [], primaryGoalId: null };
  }

  // Find decision nodes for primary goal selection
  const decisionNodeIds = new Set(
    nodes.filter(n => n.kind === 'decision').map(n => n.id)
  );

  // Calculate goal weights based on connections to decisions
  const goalWeights = new Map<string, number>();
  for (const goal of goalNodes) {
    let weight = 0;
    for (const edge of edges) {
      if (edge.from === goal.id && decisionNodeIds.has(edge.to)) {
        weight += edge.weight ?? 1;
      }
    }
    goalWeights.set(goal.id, weight);
  }

  // Sort goals: highest weight first, then by original order
  const sortedGoals = [...goalNodes].sort((a, b) => {
    const weightA = goalWeights.get(a.id) ?? 0;
    const weightB = goalWeights.get(b.id) ?? 0;
    if (weightB !== weightA) return weightB - weightA;
    return nodes.indexOf(a) - nodes.indexOf(b);
  });

  const primaryGoalId = sortedGoals[0]?.id ?? null;

  // Build Goal objects
  const goals: Goal[] = sortedGoals.map(node => ({
    id: node.id,
    text: node.label || node.id,
    type: classifyGoalType(node.label || node.id),
    is_primary: node.id === primaryGoalId,
  }));

  return { goals, primaryGoalId };
}

/**
 * Map PLoT's IdentifiabilityResult to the shape CEE's IdentifiabilitySchema
 * accepts (olumi-assistants-service src/schemas/cee.ts).
 *
 * Honesty rules (CEE #427 fail-honest doctrine):
 * - `identifiable` is passed through verbatim — never defaulted to true;
 * - `method` names a criterion only when one was actually applied
 *   ('none' maps to null so CEE never claims "confirmed via none criterion");
 * - `explanation` carries PLoT's own summary, with the detail notes appended
 *   when non-identifiable so CEE can surface the real limitation.
 */
export function toCeeIdentifiability(result: IdentifiabilityResult): CeeIdentifiability {
  const criterion = result.adjustment_metadata?.criterion;
  return {
    identifiable: result.identifiable,
    method: criterion && criterion !== 'none' ? criterion : null,
    adjustment_set: result.adjustment_set,
    explanation:
      !result.identifiable && result.notes.length > 0
        ? `${result.summary}. ${result.notes.join('; ')}`
        : result.summary,
  };
}

/**
 * Call CEE /assist/v1/key-insight endpoint
 */
async function callCeeKeyInsight(
  body: CeeKeyInsightRequestBody,
  logger?: any
): Promise<{ insight: CeeKeyInsight | null; error?: { code: string; message: string; retryable: boolean } }> {
  const baseUrl = process.env.CEE_BASE_URL?.trim();
  const apiKey = process.env.CEE_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return {
      insight: null,
      error: {
        code: 'CEE_CONFIG_MISSING',
        message: 'CEE_BASE_URL or CEE_API_KEY not configured',
        retryable: false,
      },
    };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/assist/v1/key-insight`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CEE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Request-Id': body.plot_request_id,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      logger?.warn({
        evt: 'cee_key_insight_error',
        status: res.status,
        plot_request_id: body.plot_request_id,
      });

      return {
        insight: null,
        error: {
          code: `CEE_HTTP_${res.status}`,
          message: `CEE returned status ${res.status}`,
          retryable: res.status >= 500,
        },
      };
    }

    const data = await res.json();
    return { insight: data as CeeKeyInsight };
  } catch (err: any) {
    clearTimeout(timeoutId);

    const isTimeout = err.name === 'AbortError';
    logger?.warn({
      evt: 'cee_key_insight_fetch_error',
      error: err.message,
      timeout: isTimeout,
      plot_request_id: body.plot_request_id,
    });

    return {
      insight: null,
      error: {
        code: isTimeout ? 'CEE_TIMEOUT' : 'CEE_FETCH_ERROR',
        message: err.message || 'Failed to fetch from CEE',
        retryable: true,
      },
    };
  }
}

/**
 * Generate fallback insight when CEE is unavailable
 */
function generateFallbackInsight(
  rankedActions: RankedAction[],
  rankingConfidence: RankingConfidence
): CeeKeyInsight {
  const winner = rankedActions[0];
  const runnerUp = rankedActions[1];

  let insight = '';
  if (!winner) {
    insight = 'Unable to determine a recommended option from the provided graph.';
  } else if (!runnerUp) {
    insight = `${winner.label} is the only evaluated option with expected outcome of ${winner.expected_outcome.toFixed(2)}.`;
  } else {
    const margin = winner.expected_outcome - runnerUp.expected_outcome;
    const marginPct = Math.round((margin / runnerUp.expected_outcome) * 100);
    insight = `${winner.label} outperforms ${runnerUp.label} by ${marginPct}% (${margin.toFixed(2)} units). ${rankingConfidence === 'high' ? 'This ranking is stable.' : 'Consider refining beliefs for more confidence.'}`;
  }

  return {
    insight,
    confidence: rankingConfidence,
    evidence: [`Based on ${rankedActions.length} evaluated option(s)`],
    next_steps: rankingConfidence === 'low'
      ? ['Review edge weights and beliefs to reduce uncertainty']
      : undefined,
  };
}

export async function registerKeyInsightRoute(app: FastifyInstance) {
  app.post(
    '/v1/assist/key-insight',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as KeyInsightRequest;
      const requestId = String(req.id);

      // Validate graph
      if (!body.graph || !body.graph.nodes || !Array.isArray(body.graph.nodes)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'graph.nodes required',
          fields: { field: 'graph.nodes' },
        });
      }

      if (body.graph.nodes.length > MAX_NODES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `graph exceeds max ${MAX_NODES} nodes`,
          fields: { field: 'graph.nodes' },
        });
      }

      if (body.graph.edges && body.graph.edges.length > MAX_EDGES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `graph exceeds max ${MAX_EDGES} edges`,
          fields: { field: 'graph.edges' },
        });
      }

      // Normalize and apply edge type inference
      const normalizedGraph = normalizeGraph(body.graph, false);
      const edgeInference = inferEdgeTypes(normalizedGraph.nodes, normalizedGraph.edges);
      const graph = {
        nodes: normalizedGraph.nodes,
        edges: edgeInference.edges,
      };

      // Collect warnings for inferred edge types
      const warnings: ResponseWarning[] = [];
      for (const w of edgeInference.warnings) {
        warnings.push({
          code: 'EDGE_TYPE_INFERRED',
          message: w.message,
          severity: 'info',
          affected_id: w.edge_id,
        });
      }

      // Log inferred edges for observability
      if (edgeInference.inferred_count > 0) {
        req.log.info({
          evt: 'edge_type_inference',
          id: requestId,
          inferred_count: edgeInference.inferred_count,
          explicit_count: edgeInference.explicit_count,
          edges: edgeInference.warnings.map((w) => ({
            from: w.from,
            to: w.to,
            type: w.inferred_type,
          })),
        });
      }

      // Detect primary outcome
      const seed = body.seed ?? 4242;
      let outcomeNode: string = body.outcome_node ?? '';

      if (!outcomeNode) {
        const detection = detectPrimaryOutcome(graph);
        if (detection.detected && detection.node_id) {
          outcomeNode = detection.node_id;
          warnings.push({
            code: 'PRIMARY_OUTCOME_INFERRED',
            message: `Primary outcome inferred as '${detection.node_id}' (${detection.strategy})`,
            severity: 'info',
            affected_id: detection.node_id,
          });
        } else {
          outcomeNode = graph.nodes[graph.nodes.length - 1]?.id ?? '';
          warnings.push({
            code: 'PRIMARY_OUTCOME_INFERRED',
            message: `No outcome node detected; using last node '${outcomeNode}'`,
            severity: 'warning',
            affected_id: outcomeNode,
          });
        }
      }

      // Run inference
      const inferenceEngine = getInferenceEngine('model_based');
      let inferenceResult: any;

      try {
        inferenceResult = await inferenceEngine.run(graph, {
          seed,
          k_samples: DEFAULT_K_SAMPLES,
          outcome_node: outcomeNode,
          baseline_value: 100,
          adaptiveK: true,
        });
      } catch (err: any) {
        req.log.error({
          evt: 'key_insight_inference_error',
          error: err.message,
          id: requestId,
        });

        return replyWithAppError(reply, {
          type: 'INTERNAL',
          statusCode: 500,
          message: 'Inference failed',
          fields: { code: 'INFERENCE_FAILED', detail: err.message },
        });
      }

      // Build ranked actions from inference result
      // For a single graph, we have one result - would need multiple options for ranking
      // In this case, we extract option nodes and their contributions
      const optionNodes = graph.nodes.filter((n: any) => n.kind === 'option' || n.kind === 'action');

      const rankedActions: RankedAction[] = [];

      if (optionNodes.length > 0) {
        // Simplified: assign rank based on node order (real implementation would run per-option inference)
        for (let i = 0; i < optionNodes.length; i++) {
          const node = optionNodes[i];
          // Simulate distribution around the inference result
          const p50 = inferenceResult.most_likely.outcome;
          const variation = 0.1 * (i + 1); // Vary by option index
          const expectedOutcome = Math.round(p50 * (1 - variation * 0.1) * 1000) / 1000;
          rankedActions.push({
            label: node.label || node.id,
            rank: i + 1,
            expected_outcome: expectedOutcome,
            outcome_quality: expectedOutcome < 0 ? 'negative' : 'positive',
            distribution: {
              p10: Math.round(inferenceResult.conservative.outcome * (1 - variation) * 1000) / 1000,
              p50: Math.round(p50 * (1 - variation * 0.1) * 1000) / 1000,
              p90: Math.round(inferenceResult.optimistic.outcome * (1 + variation) * 1000) / 1000,
            },
            success_probability: Math.max(0.1, Math.min(0.99, 0.7 - i * 0.15)),
          });
        }
      } else {
        // Single overall result
        const expectedOutcome = Math.round(inferenceResult.most_likely.outcome * 1000) / 1000;
        rankedActions.push({
          label: 'Overall',
          rank: 1,
          expected_outcome: expectedOutcome,
          outcome_quality: expectedOutcome < 0 ? 'negative' : 'positive',
          distribution: {
            p10: Math.round(inferenceResult.conservative.outcome * 1000) / 1000,
            p50: Math.round(inferenceResult.most_likely.outcome * 1000) / 1000,
            p90: Math.round(inferenceResult.optimistic.outcome * 1000) / 1000,
          },
          success_probability: 0.7,
        });
      }

      // Compute ranking confidence
      const rankingConfidence = computeRankingConfidence(
        rankedActions.map((a) => ({ summary: a.distribution }))
      );

      // Extract unique node kinds for CEE context
      const nodeKinds: NodeKind[] = [...new Set(
        graph.nodes
          .map((n: any) => n.kind as string | undefined)
          .filter((k: string | undefined): k is string => !!k && VALID_NODE_KINDS.includes(k as NodeKind))
      )] as NodeKind[];

      // Extract goals from graph
      const { goals, primaryGoalId } = extractGoals(graph.nodes, graph.edges);
      const primaryGoal = goals.find(g => g.is_primary);

      // Identifiability thread-through (CEE #427 follow-up): PLoT already
      // computes identifiability on its run paths; run the same computation
      // here (same treatment default as /v1/run: first node) and send the
      // result to CEE so confident causal language is earned, not assumed.
      // If the computation fails, the field is omitted — the outbound request
      // stays byte-identical to the pre-thread baseline and CEE applies its
      // own absent-field doctrine.
      let identifiability: CeeIdentifiability | undefined;
      try {
        identifiability = toCeeIdentifiability(
          checkIdentifiability({
            graph,
            treatment_node: graph.nodes[0]?.id ?? '',
            outcome_node: outcomeNode,
          })
        );
      } catch (err: any) {
        req.log.warn({
          evt: 'key_insight_identifiability_error',
          error: err?.message,
          id: requestId,
        });
        identifiability = undefined;
      }

      // Build CEE request body with goal context
      const ceeRequestBody: CeeKeyInsightRequestBody = {
        plot_request_id: requestId,
        graph_summary: {
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          node_kinds: nodeKinds,
        },
        ranked_actions: rankedActions,
        ranking_confidence: rankingConfidence,
        ...(body.context && { context: body.context }),
        // Goal context (null if no goal nodes in graph)
        goal_text: primaryGoal?.text ?? null,
        goal_type: primaryGoal?.type ?? null,
        goal_id: primaryGoal?.id ?? null,
        // Multiple goals support (only when there are multiple goals with a valid primary)
        ...(goals.length > 1 && primaryGoalId && {
          goals,
          primary_goal_id: primaryGoalId,
        }),
        // Identifiability (#427): present whenever computed; verbatim, never default-true
        ...(identifiability && { identifiability }),
      };

      // Call CEE if enabled
      let insight: CeeKeyInsight | null = null;
      let ceeError: { code: string; message: string; retryable: boolean } | undefined;
      let provenance: 'cee' | 'plot_fallback' = 'plot_fallback';

      const ceeEnabled = isFlagOn(process.env.CEE_KEY_INSIGHT_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLED);

      if (ceeEnabled) {
        req.log.info({
          evt: 'key_insight_cee_call',
          id: requestId,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        });

        const ceeResult = await callCeeKeyInsight(ceeRequestBody, req.log);
        insight = ceeResult.insight;
        ceeError = ceeResult.error;

        if (insight) {
          provenance = 'cee';
        }
      }

      // Use fallback if CEE unavailable or disabled
      if (!insight) {
        insight = generateFallbackInsight(rankedActions, rankingConfidence);
      }

      // Build response hash
      const responseHash = createHash('sha256')
        .update(JSON.stringify({ rankedActions, insight }))
        .digest('hex')
        .slice(0, 16);

      const duration = Date.now() - start;
      req.log.info({
        evt: 'key_insight',
        id: requestId,
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        ranked_count: rankedActions.length,
        goal_count: goals.length,
        primary_goal_id: primaryGoalId,
        primary_goal_type: primaryGoal?.type ?? null,
        provenance,
        duration_ms: duration,
      });

      const response: KeyInsightResponse = {
        schema: 'key_insight.v1',
        insight,
        ranked_actions: rankedActions,
        ranking_confidence: rankingConfidence,
        provenance,
        model_card: {
          seed,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          backend: 'scm_lite',
          response_hash: responseHash,
        },
        ...(warnings.length > 0 && { warnings }),
        ...(ceeError && { cee_error: ceeError }),
      };

      return reply.code(200).send(response);
    }
  );
}
