/**
 * POST /v1/elicit/belief - Belief Elicitation Proxy
 *
 * Proxies belief elicitation requests to CEE /assist/v1/elicit-belief.
 * Enriches request with graph context (node label from graph if only node_id provided).
 *
 * Phase 2 Week 2: CEE routing architecture
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { isFlagOn } from '../../cee/codes.js';
import type {
  BeliefElicitationRequest,
  BeliefElicitationResponse,
  CeeBeliefElicitationResponse,
} from './types/proxy.types.js';
import type { NodeKind } from '../../trust/types.js';

const CEE_TIMEOUT_MS = Number(process.env.CEE_TIMEOUT_MS || 10_000);

/**
 * Call CEE /assist/v1/elicit-belief endpoint
 */
async function callCeeElicitBelief(
  body: {
    plot_request_id: string;
    node_id: string;
    node_label: string;
    node_kind?: NodeKind;
    current_belief?: number;
    context?: { question?: string; notes?: string };
  },
  logger?: any
): Promise<{ elicitation: CeeBeliefElicitationResponse | null; error?: { code: string; message: string; retryable: boolean } }> {
  const baseUrl = process.env.CEE_BASE_URL?.trim();
  const apiKey = process.env.CEE_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return {
      elicitation: null,
      error: {
        code: 'CEE_CONFIG_MISSING',
        message: 'CEE_BASE_URL or CEE_API_KEY not configured',
        retryable: false,
      },
    };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/assist/v1/elicit-belief`;
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
        evt: 'cee_elicit_belief_error',
        status: res.status,
        plot_request_id: body.plot_request_id,
      });

      return {
        elicitation: null,
        error: {
          code: `CEE_HTTP_${res.status}`,
          message: `CEE returned status ${res.status}`,
          retryable: res.status >= 500,
        },
      };
    }

    const data = await res.json();
    return { elicitation: data as CeeBeliefElicitationResponse };
  } catch (err: any) {
    clearTimeout(timeoutId);

    const isTimeout = err.name === 'AbortError';
    logger?.warn({
      evt: 'cee_elicit_belief_fetch_error',
      error: err.message,
      timeout: isTimeout,
      plot_request_id: body.plot_request_id,
    });

    return {
      elicitation: null,
      error: {
        code: isTimeout ? 'CEE_TIMEOUT' : 'CEE_FETCH_ERROR',
        message: err.message || 'Failed to fetch from CEE',
        retryable: true,
      },
    };
  }
}

/**
 * Generate fallback belief elicitation when CEE is unavailable
 */
function generateFallbackElicitation(
  nodeLabel: string,
  currentBelief?: number
): CeeBeliefElicitationResponse {
  // If no current belief, suggest a neutral 0.5
  // If current belief exists, validate it's reasonable
  const suggestedBelief = currentBelief ?? 0.5;

  return {
    suggested_belief: suggestedBelief,
    confidence: 'low',
    rationale: `Unable to connect to belief elicitation service. ${
      currentBelief !== undefined
        ? `Current belief of ${currentBelief} retained.`
        : 'Default neutral belief of 0.5 suggested.'
    }`,
    follow_up_questions: [
      `What evidence supports the likelihood of "${nodeLabel}"?`,
      'Are there historical examples or data to reference?',
      'What would change your confidence in this estimate?',
    ],
  };
}

export async function registerElicitBeliefRoute(app: FastifyInstance) {
  app.post(
    '/v1/elicit/belief',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as BeliefElicitationRequest;
      const requestId = String(req.id);

      // Validate node_id
      if (!body.node_id || typeof body.node_id !== 'string') {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'node_id is required',
          fields: { field: 'node_id' },
        });
      }

      // Enrich node context from graph if provided
      let nodeLabel = body.node_label || body.node_id;
      let nodeKind: NodeKind | undefined;

      if (body.graph?.nodes) {
        const node = body.graph.nodes.find((n) => n.id === body.node_id);
        if (node) {
          nodeLabel = node.label || nodeLabel;
          nodeKind = node.kind;
        }
      }

      // Validate current_belief if provided
      if (body.current_belief !== undefined) {
        if (typeof body.current_belief !== 'number' || body.current_belief < 0 || body.current_belief > 1) {
          return replyWithAppError(reply, {
            type: 'BAD_INPUT',
            statusCode: 400,
            message: 'current_belief must be a number between 0 and 1',
            fields: { field: 'current_belief' },
          });
        }
      }

      // Call CEE if enabled
      let elicitation: CeeBeliefElicitationResponse | null = null;
      let ceeError: { code: string; message: string; retryable: boolean } | undefined;
      let provenance: 'cee' | 'plot_fallback' = 'plot_fallback';

      const ceeEnabled = isFlagOn(process.env.CEE_ELICIT_BELIEF_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLE);

      if (ceeEnabled) {
        req.log.info({
          evt: 'elicit_belief_cee_call',
          id: requestId,
          node_id: body.node_id,
        });

        const ceeResult = await callCeeElicitBelief(
          {
            plot_request_id: requestId,
            node_id: body.node_id,
            node_label: nodeLabel,
            node_kind: nodeKind,
            current_belief: body.current_belief,
            context: body.context,
          },
          req.log
        );

        elicitation = ceeResult.elicitation;
        ceeError = ceeResult.error;

        if (elicitation) {
          provenance = 'cee';
        }
      }

      // Use fallback if CEE unavailable or disabled
      if (!elicitation) {
        elicitation = generateFallbackElicitation(nodeLabel, body.current_belief);
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'elicit_belief',
        id: requestId,
        node_id: body.node_id,
        provenance,
        duration_ms: duration,
      });

      const response: BeliefElicitationResponse = {
        schema: 'belief_elicitation.v1',
        elicitation,
        node_context: {
          node_id: body.node_id,
          node_label: nodeLabel,
          ...(nodeKind && { node_kind: nodeKind }),
        },
        provenance,
        ...(ceeError && { cee_error: ceeError }),
      };

      return reply.code(200).send(response);
    }
  );
}
