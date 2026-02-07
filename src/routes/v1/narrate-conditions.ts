/**
 * POST /v1/narrate/conditions - Narrate Conditions Proxy
 *
 * Generates natural language narratives for conditional recommendations,
 * forwarding to CEE /assist/v1/narrate-conditions.
 *
 * Phase 4: CEE narrative generation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { isFlagOn } from '../../cee/codes.js';
import type {
  NarrateConditionsRequest,
  NarrateConditionsResponse,
  CeeNarratedConditions,
  RecommendationCondition,
} from './types/proxy.types.js';

import { CEE_TIMEOUT_MS } from '../../config/timeouts.js';
const MAX_CONDITIONS = 20;

/**
 * Call CEE /assist/v1/narrate-conditions endpoint
 */
async function callCeeNarrateConditions(
  body: NarrateConditionsRequest,
  requestId: string,
  logger?: any
): Promise<{
  narration: CeeNarratedConditions | null;
  error?: { code: string; message: string; retryable: boolean };
}> {
  const baseUrl = process.env.CEE_BASE_URL?.trim();
  const apiKey = process.env.CEE_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return {
      narration: null,
      error: {
        code: 'CEE_CONFIG_MISSING',
        message: 'CEE_BASE_URL or CEE_API_KEY not configured',
        retryable: false,
      },
    };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/assist/v1/narrate-conditions`;
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
        evt: 'cee_narrate_conditions_error',
        status: res.status,
        request_id: requestId,
      });

      return {
        narration: null,
        error: {
          code: `CEE_HTTP_${res.status}`,
          message: `CEE returned status ${res.status}`,
          retryable: res.status >= 500,
        },
      };
    }

    const data = await res.json();
    return { narration: data as CeeNarratedConditions };
  } catch (err: any) {
    clearTimeout(timeoutId);

    const isTimeout = err.name === 'AbortError';
    logger?.warn({
      evt: 'cee_narrate_conditions_fetch_error',
      error: err.message,
      timeout: isTimeout,
      request_id: requestId,
    });

    return {
      narration: null,
      error: {
        code: isTimeout ? 'CEE_TIMEOUT' : 'CEE_FETCH_ERROR',
        message: err.message || 'Failed to fetch from CEE',
        retryable: true,
      },
    };
  }
}

/**
 * Get operator description for narrative
 */
function getOperatorDescription(operator: RecommendationCondition['operator']): string {
  switch (operator) {
    case 'eq':
      return 'equals';
    case 'gt':
      return 'is greater than';
    case 'lt':
      return 'is less than';
    case 'gte':
      return 'is at least';
    case 'lte':
      return 'is at most';
    case 'in':
      return 'is one of';
    case 'not_in':
      return 'is not one of';
    default:
      return 'matches';
  }
}

/**
 * Format value for narrative
 */
function formatValue(value: RecommendationCondition['value']): string {
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).join(', ');
  }
  return String(value);
}

/**
 * Generate local fallback narration when CEE is unavailable
 */
function generateFallbackNarration(
  conditions: RecommendationCondition[],
  graph: NarrateConditionsRequest['graph']
): CeeNarratedConditions {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  const conditionExplanations = conditions.map((condition, index) => {
    const node = nodeMap.get(condition.node_id);
    const label = node?.label ?? condition.node_id;
    const operator = getOperatorDescription(condition.operator);
    const value = formatValue(condition.value);

    return {
      condition_index: index,
      explanation: `${label} ${operator} ${value}`,
    };
  });

  const narrativeParts = conditionExplanations.map((e) => e.explanation);
  const narrative =
    conditions.length === 1
      ? `Assuming ${narrativeParts[0]}.`
      : `Assuming the following conditions: ${narrativeParts.join('; ')}.`;

  const interpretation =
    conditions.length === 0
      ? 'No conditions specified.'
      : conditions.length === 1
        ? 'This recommendation is conditional on a single assumption.'
        : `This recommendation is conditional on ${conditions.length} assumptions being met.`;

  return {
    narrative,
    condition_explanations: conditionExplanations,
    interpretation,
  };
}

export async function registerNarrateConditionsRoute(app: FastifyInstance) {
  app.post(
    '/v1/narrate/conditions',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as NarrateConditionsRequest;
      const requestId = String(req.id);

      // Validate conditions
      if (!body.conditions || !Array.isArray(body.conditions)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'conditions array required',
          fields: { field: 'conditions' },
        });
      }

      if (body.conditions.length > MAX_CONDITIONS) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `conditions exceeds max ${MAX_CONDITIONS}`,
          fields: { field: 'conditions' },
        });
      }

      // Validate graph
      if (!body.graph || !body.graph.nodes) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'graph.nodes required for node label resolution',
          fields: { field: 'graph.nodes' },
        });
      }

      // Call CEE if enabled
      let narration: CeeNarratedConditions | null = null;
      let ceeError: { code: string; message: string; retryable: boolean } | undefined;
      let provenance: 'cee' | 'plot_fallback' = 'plot_fallback';

      const ceeEnabled = isFlagOn(
        process.env.CEE_NARRATE_CONDITIONS_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLED
      );

      if (ceeEnabled) {
        req.log.info({
          evt: 'narrate_conditions_cee_call',
          id: requestId,
          condition_count: body.conditions.length,
        });

        const ceeResult = await callCeeNarrateConditions(body, requestId, req.log);

        narration = ceeResult.narration;
        ceeError = ceeResult.error;

        if (narration) {
          provenance = 'cee';
        }
      }

      // Use fallback if CEE unavailable
      if (!narration) {
        narration = generateFallbackNarration(body.conditions, body.graph);
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'narrate_conditions',
        id: requestId,
        condition_count: body.conditions.length,
        provenance,
        duration_ms: duration,
      });

      const response: NarrateConditionsResponse = {
        schema: 'narrate_conditions.v1',
        narration,
        conditions_count: body.conditions.length,
        provenance,
        ...(ceeError && { cee_error: ceeError }),
      };

      return reply.code(200).send(response);
    }
  );
}
