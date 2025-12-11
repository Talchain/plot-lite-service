/**
 * POST /v1/explain/policy - Explain Policy Proxy
 *
 * Generates natural language explanations for policy trees,
 * forwarding to CEE /assist/v1/explain-policy.
 *
 * Phase 4: CEE narrative generation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { isFlagOn } from '../../cee/codes.js';
import { validateSequentialGraph, isSequentialGraph } from '../../util/sequential-validation.js';
import type {
  ExplainPolicyRequest,
  ExplainPolicyResponse,
  CeePolicyExplanation,
  IslPolicyTreeResponse,
  PolicyTreeNode,
} from './types/proxy.types.js';

const CEE_TIMEOUT_MS = Number(process.env.CEE_TIMEOUT_MS || 20_000);

/**
 * Call CEE /assist/v1/explain-policy endpoint
 */
async function callCeeExplainPolicy(
  body: ExplainPolicyRequest,
  requestId: string,
  logger?: any
): Promise<{
  explanation: CeePolicyExplanation | null;
  error?: { code: string; message: string; retryable: boolean };
}> {
  const baseUrl = process.env.CEE_BASE_URL?.trim();
  const apiKey = process.env.CEE_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return {
      explanation: null,
      error: {
        code: 'CEE_CONFIG_MISSING',
        message: 'CEE_BASE_URL or CEE_API_KEY not configured',
        retryable: false,
      },
    };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/assist/v1/explain-policy`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CEE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Request-Id': requestId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      logger?.warn({
        evt: 'cee_explain_policy_error',
        status: res.status,
        request_id: requestId,
      });

      return {
        explanation: null,
        error: {
          code: `CEE_HTTP_${res.status}`,
          message: `CEE returned status ${res.status}`,
          retryable: res.status >= 500,
        },
      };
    }

    const data = await res.json();
    return { explanation: data as CeePolicyExplanation };
  } catch (err: any) {
    clearTimeout(timeoutId);

    const isTimeout = err.name === 'AbortError';
    logger?.warn({
      evt: 'cee_explain_policy_fetch_error',
      error: err.message,
      timeout: isTimeout,
      request_id: requestId,
    });

    return {
      explanation: null,
      error: {
        code: isTimeout ? 'CEE_TIMEOUT' : 'CEE_FETCH_ERROR',
        message: err.message || 'Failed to fetch from CEE',
        retryable: true,
      },
    };
  }
}

/**
 * Extract stage explanations from policy tree
 */
function extractStageExplanations(
  tree: IslPolicyTreeResponse,
  graph: ExplainPolicyRequest['graph']
): CeePolicyExplanation['stage_explanations'] {
  // Group nodes by stage
  const nodesByStage = new Map<number, PolicyTreeNode[]>();
  for (const node of tree.nodes) {
    const stageNodes = nodesByStage.get(node.stage) ?? [];
    stageNodes.push(node);
    nodesByStage.set(node.stage, stageNodes);
  }

  const stages = [...nodesByStage.keys()].sort((a, b) => a - b);
  const stageExplanations: CeePolicyExplanation['stage_explanations'] = [];

  // Get stage labels from graph metadata
  const stageLabels = new Map<number, string>();
  if (graph.sequential_metadata?.stages) {
    for (const stage of graph.sequential_metadata.stages) {
      stageLabels.set(stage.index, stage.label);
    }
  }

  for (const stageIndex of stages) {
    const stageNodes = nodesByStage.get(stageIndex) ?? [];
    const stageLabel = stageLabels.get(stageIndex) ?? `Stage ${stageIndex}`;

    // Find best decision node at this stage
    const decisionNodes = stageNodes.filter((n) => n.type === 'decision');
    const bestDecision = decisionNodes.reduce(
      (best, node) => (node.expected_value > best.expected_value ? node : best),
      decisionNodes[0]
    );

    if (bestDecision) {
      stageExplanations.push({
        stage: stageIndex,
        stage_label: stageLabel,
        explanation: `At ${stageLabel}, the optimal action is ${bestDecision.action ?? bestDecision.label}.`,
        key_decision: bestDecision.action ?? bestDecision.label,
        rationale: `Expected value: ${bestDecision.expected_value.toFixed(2)}`,
      });
    }
  }

  return stageExplanations;
}

/**
 * Generate local fallback explanation when CEE is unavailable
 */
function generateFallbackExplanation(
  policyTree: IslPolicyTreeResponse,
  graph: ExplainPolicyRequest['graph']
): CeePolicyExplanation {
  const rootNode = policyTree.nodes.find((n) => n.id === policyTree.root_id);
  const stageExplanations = extractStageExplanations(policyTree, graph);

  // Generate summary
  const summary =
    stageExplanations.length > 0
      ? `This policy consists of ${stageExplanations.length} sequential decisions. ${policyTree.policy_summary}`
      : policyTree.policy_summary;

  // Identify risks from low expected value paths
  const risks: string[] = [];
  const terminalNodes = policyTree.nodes.filter((n) => n.children.length === 0);
  const avgTerminalValue =
    terminalNodes.reduce((sum, n) => sum + n.expected_value, 0) / terminalNodes.length;

  const lowValuePaths = terminalNodes.filter(
    (n) => n.expected_value < avgTerminalValue * 0.5
  );
  if (lowValuePaths.length > 0) {
    risks.push(
      `${lowValuePaths.length} potential paths lead to significantly below-average outcomes`
    );
  }

  if (policyTree.depth > 3) {
    risks.push('Multi-stage policy with inherent uncertainty accumulation');
  }

  // Identify assumptions
  const assumptions = [
    'Decision stages occur in the specified order',
    'Probabilities remain stable across stages',
    'No external factors alter the decision landscape',
  ];

  return {
    summary,
    stage_explanations: stageExplanations,
    risks,
    assumptions,
  };
}

export async function registerExplainPolicyRoute(app: FastifyInstance) {
  app.post(
    '/v1/explain/policy',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as ExplainPolicyRequest;
      const requestId = String(req.id);

      // Validate policy_tree
      if (!body.policy_tree || !body.policy_tree.nodes) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'policy_tree with nodes required',
          fields: { field: 'policy_tree' },
        });
      }

      if (!body.policy_tree.root_id) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'policy_tree.root_id required',
          fields: { field: 'policy_tree.root_id' },
        });
      }

      // Validate graph
      if (!body.graph || !body.graph.nodes) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'graph.nodes required for context',
          fields: { field: 'graph.nodes' },
        });
      }

      // Validate sequential structure if present (P0.3: consistent validation)
      const sequentialWarnings: string[] = [];
      if (isSequentialGraph(body.graph as any)) {
        const validation = validateSequentialGraph(body.graph as any);
        for (const issue of validation.issues) {
          if (issue.severity === 'error') {
            return replyWithAppError(reply, {
              type: 'BAD_INPUT',
              statusCode: 400,
              message: `Sequential validation failed: ${issue.message}`,
              fields: { field: 'graph.sequential_metadata', code: issue.code },
            });
          }
          sequentialWarnings.push(issue.message);
        }
      }

      // Call CEE if enabled
      let explanation: CeePolicyExplanation | null = null;
      let ceeError: { code: string; message: string; retryable: boolean } | undefined;
      let provenance: 'cee' | 'plot_fallback' = 'plot_fallback';

      const ceeEnabled = isFlagOn(
        process.env.CEE_EXPLAIN_POLICY_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLE
      );

      if (ceeEnabled) {
        req.log.info({
          evt: 'explain_policy_cee_call',
          id: requestId,
          tree_depth: body.policy_tree.depth,
          node_count: body.policy_tree.nodes.length,
        });

        const ceeResult = await callCeeExplainPolicy(body, requestId, req.log);

        explanation = ceeResult.explanation;
        ceeError = ceeResult.error;

        if (explanation) {
          provenance = 'cee';
        }
      }

      // Use fallback if CEE unavailable
      if (!explanation) {
        explanation = generateFallbackExplanation(body.policy_tree, body.graph);
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'explain_policy',
        id: requestId,
        tree_depth: body.policy_tree.depth,
        provenance,
        duration_ms: duration,
      });

      const response: ExplainPolicyResponse = {
        schema: 'explain_policy.v1',
        explanation,
        provenance,
        ...(ceeError && { cee_error: ceeError }),
        ...(sequentialWarnings.length > 0 && { sequential_warnings: sequentialWarnings }),
      };

      return reply.code(200).send(response);
    }
  );
}
