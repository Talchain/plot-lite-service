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

import { CEE_TIMEOUT_MS } from '../../config/timeouts.js';

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
 * Validate the untrusted `policy_tree` down to the fields this handler reads.
 *
 * ## Why this exists
 *
 * The route casts `req.body as ExplainPolicyRequest` and previously validated
 * only that `policy_tree`, `policy_tree.nodes` and `policy_tree.root_id` were
 * *truthy*. Everything below that was read as if the TypeScript types were
 * enforced at the wire, and they are not: a node without `children` reached
 * `n.children.length` and the resulting TypeError surfaced to callers as an
 * opaque 500 "Something went wrong". Reproduced live on staging build
 * `220739b` with `{"policy_tree":{"root_id":"r","depth":2,"nodes":[{"id":"r"}]}}`.
 *
 * This is the same defect class PR #265 fixed for `sequential_metadata`.
 * That fix made `validateSequentialGraph` total; `policy_tree` was left
 * unhardened, and this route also re-reads `sequential_metadata.stages`
 * directly (see `readStageLabels`), on a path the validator does not cover.
 *
 * ## The rule for anyone editing this file
 *
 * Every field of `policy_tree` or `graph` that the handler reads must either
 * be validated here (typed 400) or be read totally (no throw, no fabricated
 * output) at the point of use. Malformed input must produce an honest
 * envelope, never a 500.
 *
 * Load-bearing fields are validated because the analysis is genuinely
 * uncomputable without them:
 * - `nodes[].stage`          — the grouping key, and a required response field
 * - `nodes[].expected_value` — arithmetic input; also `.toFixed()` in the output
 * - `nodes[].children`       — the sole terminal-node discriminator
 * Cosmetic fields (`type`, `label`, `action`, `policy_summary`) are read
 * totally instead, so a request that succeeds today keeps succeeding.
 */
function validatePolicyTreeShape(
  policyTree: IslPolicyTreeResponse
): { code: string; field: string; message: string } | null {
  if (!Array.isArray(policyTree.nodes)) {
    return {
      code: 'INVALID_POLICY_TREE',
      field: 'policy_tree.nodes',
      message: `policy_tree.nodes must be an array of policy tree nodes, received ${policyTree.nodes === null ? 'null' : typeof policyTree.nodes}.`,
    };
  }

  for (let i = 0; i < policyTree.nodes.length; i++) {
    const node = policyTree.nodes[i] as unknown;

    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return {
        code: 'INVALID_POLICY_TREE_NODE',
        field: `policy_tree.nodes[${i}]`,
        message: `policy_tree.nodes[${i}] is not a policy tree node — expected an object, received ${node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node}.`,
      };
    }

    const n = node as Record<string, unknown>;

    if (typeof n.id !== 'string' || n.id.length === 0) {
      return {
        code: 'INVALID_POLICY_TREE_NODE',
        field: `policy_tree.nodes[${i}].id`,
        message: `policy_tree.nodes[${i}] is missing a non-empty string "id".`,
      };
    }

    if (typeof n.stage !== 'number' || !Number.isFinite(n.stage)) {
      return {
        code: 'INVALID_POLICY_TREE_NODE',
        field: `policy_tree.nodes[${i}].stage`,
        message: `policy_tree.nodes[${i}] ("${n.id}") has "stage" of type ${n.stage === null ? 'null' : typeof n.stage}, expected a finite number. Stage explanations are grouped by this value.`,
      };
    }

    if (typeof n.expected_value !== 'number' || !Number.isFinite(n.expected_value)) {
      return {
        code: 'INVALID_POLICY_TREE_NODE',
        field: `policy_tree.nodes[${i}].expected_value`,
        message: `policy_tree.nodes[${i}] ("${n.id}") has "expected_value" of type ${n.expected_value === null ? 'null' : typeof n.expected_value}, expected a finite number. Risk and rationale figures are computed from it.`,
      };
    }

    if (!Array.isArray(n.children)) {
      return {
        code: 'INVALID_POLICY_TREE_NODE',
        field: `policy_tree.nodes[${i}].children`,
        message: `policy_tree.nodes[${i}] ("${n.id}") has "children" of type ${n.children === null ? 'null' : typeof n.children}, expected an array of child node IDs. Terminal nodes are identified by an empty "children" array.`,
      };
    }
  }

  return null;
}

/**
 * Read stage labels from `graph.sequential_metadata.stages` without trusting
 * its shape.
 *
 * `validateSequentialGraph` is total and rejects a malformed `stages` with a
 * typed 400 — but only when the graph declares `is_sequential: true` (or a
 * node carries `stage`). A graph with `is_sequential: false` and a malformed
 * `stages` skips that validator entirely and used to reach `for...of` on a
 * non-iterable here. Labels are cosmetic, so a malformed entry is skipped
 * rather than refused: this path must not invent a refusal the validator
 * itself would not raise.
 */
function readStageLabels(graph: ExplainPolicyRequest['graph']): Map<number, string> {
  const stageLabels = new Map<number, string>();
  const rawStages: unknown = graph?.sequential_metadata?.stages;

  if (!Array.isArray(rawStages)) return stageLabels;

  for (const stage of rawStages) {
    if (stage === null || typeof stage !== 'object') continue;
    const { index, label } = stage as { index?: unknown; label?: unknown };
    if (typeof index !== 'number' || !Number.isFinite(index)) continue;
    if (typeof label !== 'string' || label.length === 0) continue;
    stageLabels.set(index, label);
  }

  return stageLabels;
}

/** Describe a decision node without emitting "undefined" into user-facing prose. */
function decisionText(node: PolicyTreeNode): string {
  if (typeof node.action === 'string' && node.action.length > 0) return node.action;
  if (typeof node.label === 'string' && node.label.length > 0) return node.label;
  return node.id;
}

/**
 * Extract stage explanations from policy tree
 *
 * Precondition: `tree` has passed `validatePolicyTreeShape`, so `nodes` is an
 * array of objects with finite `stage` and `expected_value`. `graph` is NOT
 * validated — read it totally.
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

  // Get stage labels from graph metadata (untrusted — see readStageLabels)
  const stageLabels = readStageLabels(graph);

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
      const action = decisionText(bestDecision);
      stageExplanations.push({
        stage: stageIndex,
        stage_label: stageLabel,
        explanation: `At ${stageLabel}, the optimal action is ${action}.`,
        key_decision: action,
        rationale: `Expected value: ${bestDecision.expected_value.toFixed(2)}`,
      });
    }
  }

  return stageExplanations;
}

/**
 * Generate local fallback explanation when CEE is unavailable
 *
 * Precondition: `policyTree` has passed `validatePolicyTreeShape`.
 */
function generateFallbackExplanation(
  policyTree: IslPolicyTreeResponse,
  graph: ExplainPolicyRequest['graph']
): CeePolicyExplanation {
  const stageExplanations = extractStageExplanations(policyTree, graph);

  // Generate summary. `policy_summary` is declared required but is not
  // validated at the wire; interpolating it unchecked emitted the literal
  // string "undefined", or dropped `explanation.summary` from the response
  // entirely (JSON.stringify omits undefined) — a required response field
  // silently absent. Read it totally instead.
  const treeSummary = typeof policyTree.policy_summary === 'string' ? policyTree.policy_summary : '';
  const summary =
    stageExplanations.length > 0
      ? `This policy consists of ${stageExplanations.length} sequential decisions. ${treeSummary}`.trim()
      : treeSummary;

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

      // Validate the policy tree down to the fields the handler reads. Without
      // this, a node missing `children` reached `n.children.length` and 500'd.
      //
      // Deliberately the LAST validator: a body that is malformed in both its
      // graph and its policy_tree keeps reporting the graph code it reported
      // before this change (e.g. INVALID_STAGE_DEFINITION, pinned by #265's
      // live evidence). This check therefore only ever converts a 500 into a
      // 400 — it never renames a 400 that callers already receive.
      //
      // It runs before the CEE call so the route answers a malformed tree the
      // same way whoever narrates it — CEE or the local fallback.
      const treeIssue = validatePolicyTreeShape(body.policy_tree);
      if (treeIssue) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Policy tree validation failed: ${treeIssue.message}`,
          fields: { field: treeIssue.field, code: treeIssue.code },
        });
      }

      // Call CEE if enabled
      let explanation: CeePolicyExplanation | null = null;
      let ceeError: { code: string; message: string; retryable: boolean } | undefined;
      let provenance: 'cee' | 'plot_fallback' = 'plot_fallback';

      const ceeEnabled = isFlagOn(
        process.env.CEE_EXPLAIN_POLICY_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLED
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
