/**
 * POST /v1/recommend/generate - Generate Recommendation Proxy
 *
 * Generates natural language recommendations based on analysis results,
 * forwarding to CEE /assist/v1/generate-recommendation.
 *
 * Phase 4: CEE narrative generation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { isFlagOn } from '../../cee/codes.js';
import type {
  GenerateRecommendationRequest,
  GenerateRecommendationResponse,
  CeeGeneratedRecommendation,
} from './types/proxy.types.js';

import { CEE_TIMEOUT_MS } from '../../config/timeouts.js';

/**
 * Call CEE /assist/v1/generate-recommendation endpoint
 */
async function callCeeGenerateRecommendation(
  body: GenerateRecommendationRequest,
  requestId: string,
  logger?: any
): Promise<{
  recommendation: CeeGeneratedRecommendation | null;
  error?: { code: string; message: string; retryable: boolean };
}> {
  const baseUrl = process.env.CEE_BASE_URL?.trim();
  const apiKey = process.env.CEE_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return {
      recommendation: null,
      error: {
        code: 'CEE_CONFIG_MISSING',
        message: 'CEE_BASE_URL or CEE_API_KEY not configured',
        retryable: false,
      },
    };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/assist/v1/generate-recommendation`;
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
        evt: 'cee_generate_recommendation_error',
        status: res.status,
        request_id: requestId,
      });

      return {
        recommendation: null,
        error: {
          code: `CEE_HTTP_${res.status}`,
          message: `CEE returned status ${res.status}`,
          retryable: res.status >= 500,
        },
      };
    }

    const data = await res.json();
    return { recommendation: data as CeeGeneratedRecommendation };
  } catch (err: any) {
    clearTimeout(timeoutId);

    const isTimeout = err.name === 'AbortError';
    logger?.warn({
      evt: 'cee_generate_recommendation_fetch_error',
      error: err.message,
      timeout: isTimeout,
      request_id: requestId,
    });

    return {
      recommendation: null,
      error: {
        code: isTimeout ? 'CEE_TIMEOUT' : 'CEE_FETCH_ERROR',
        message: err.message || 'Failed to fetch from CEE',
        retryable: true,
      },
    };
  }
}

/**
 * Generate local fallback recommendation when CEE is unavailable
 */
function generateFallbackRecommendation(
  analysisResults: GenerateRecommendationRequest['analysis_results']
): CeeGeneratedRecommendation {
  const winner = analysisResults.winner_label ?? analysisResults.winner ?? 'the leading option';
  const p50 = analysisResults.winner_p50;
  const margin = analysisResults.margin;
  const confidence = analysisResults.ranking_confidence ?? 'medium';

  let recommendation = `Based on the analysis, **${winner}** is the recommended choice`;
  if (p50 !== undefined) {
    recommendation += ` with an expected outcome of ${p50.toFixed(2)}`;
  }
  recommendation += '.';

  const supportingPoints: string[] = [];
  if (margin !== undefined && margin > 0) {
    supportingPoints.push(`Leads by a margin of ${margin.toFixed(2)} over alternatives`);
  }
  if (confidence === 'high') {
    supportingPoints.push('Analysis shows high confidence in this ranking');
  }

  const risks: string[] = [];
  if (confidence === 'low') {
    risks.push('Low confidence in ranking - alternatives may be viable');
  }
  if (analysisResults.alternatives && analysisResults.alternatives.length > 0) {
    risks.push(
      `Consider alternatives: ${analysisResults.alternatives.map((a) => a.label).join(', ')}`
    );
  }

  const nextSteps = [
    'Validate key assumptions underlying the analysis',
    'Consider sensitivity to uncertain parameters',
    'Review with stakeholders before final decision',
  ];

  return {
    recommendation,
    confidence,
    supporting_points: supportingPoints,
    risks,
    next_steps: nextSteps,
  };
}

export async function registerGenerateRecommendationRoute(app: FastifyInstance) {
  app.post(
    '/v1/recommend/generate',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as GenerateRecommendationRequest;
      const requestId = String(req.id);

      // Validate required fields
      if (!body.analysis_results) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'analysis_results required',
          fields: { field: 'analysis_results' },
        });
      }

      // Call CEE if enabled
      let recommendation: CeeGeneratedRecommendation | null = null;
      let ceeError: { code: string; message: string; retryable: boolean } | undefined;
      let provenance: 'cee' | 'plot_fallback' = 'plot_fallback';

      const ceeEnabled = isFlagOn(
        process.env.CEE_GENERATE_RECOMMENDATION_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLED
      );

      if (ceeEnabled) {
        req.log.info({
          evt: 'generate_recommendation_cee_call',
          id: requestId,
        });

        const ceeResult = await callCeeGenerateRecommendation(body, requestId, req.log);

        recommendation = ceeResult.recommendation;
        ceeError = ceeResult.error;

        if (recommendation) {
          provenance = 'cee';
        }
      }

      // Use fallback if CEE unavailable
      if (!recommendation) {
        recommendation = generateFallbackRecommendation(body.analysis_results);
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'generate_recommendation',
        id: requestId,
        provenance,
        duration_ms: duration,
      });

      const response: GenerateRecommendationResponse = {
        schema: 'generate_recommendation.v1',
        recommendation,
        provenance,
        ...(ceeError && { cee_error: ceeError }),
      };

      return reply.code(200).send(response);
    }
  );
}
