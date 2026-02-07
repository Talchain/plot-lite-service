/**
 * POST /v1/elicit/risk-tolerance - Risk Tolerance Elicitation Proxy
 *
 * Proxies risk tolerance elicitation requests to CEE /assist/v1/elicit-risk-tolerance.
 * Two modes: 'get_questions' returns questions, 'process_responses' returns risk profile.
 *
 * Phase 2 Week 2: CEE routing architecture
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { isFlagOn } from '../../cee/codes.js';
import type {
  RiskToleranceRequest,
  RiskToleranceResponse,
  CeeRiskToleranceResponse,
  RiskToleranceQuestion,
  ProxyError,
} from './types/proxy.types.js';

import { CEE_TIMEOUT_MS } from '../../config/timeouts.js';

/**
 * Call CEE /assist/v1/elicit-risk-tolerance endpoint
 */
async function callCeeElicitRiskTolerance(
  body: {
    plot_request_id: string;
    mode: 'get_questions' | 'process_responses';
    context?: 'product' | 'business';
    responses?: Array<{ question_id: string; answer: string | number }>;
    graph_summary?: { nodes: number; edges: number };
  },
  logger?: any
): Promise<{ elicitation: CeeRiskToleranceResponse | null; error?: ProxyError }> {
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

  const url = `${baseUrl.replace(/\/$/, '')}/assist/v1/elicit-risk-tolerance`;
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
        evt: 'cee_elicit_risk_tolerance_error',
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
    return { elicitation: data as CeeRiskToleranceResponse };
  } catch (err: any) {
    clearTimeout(timeoutId);

    const isTimeout = err.name === 'AbortError';
    logger?.warn({
      evt: 'cee_elicit_risk_tolerance_fetch_error',
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
 * Generate fallback questions when CEE is unavailable
 */
function generateFallbackQuestions(context?: 'product' | 'business'): RiskToleranceQuestion[] {
  const baseQuestions: RiskToleranceQuestion[] = [
    {
      question_id: 'risk_scenario_1',
      question_text: 'Given a choice between a guaranteed outcome and a risky option with higher potential, which do you prefer?',
      question_type: 'choice',
      options: [
        { value: 'guaranteed', label: 'Guaranteed outcome (lower value)' },
        { value: 'risky', label: 'Risky option (higher potential)' },
        { value: 'depends', label: 'It depends on the specific values' },
      ],
    },
    {
      question_id: 'risk_scale_1',
      question_text: 'On a scale of 1-10, how comfortable are you with uncertainty in outcomes?',
      question_type: 'scale',
      scale_min: 1,
      scale_max: 10,
    },
    {
      question_id: 'risk_scenario_2',
      question_text: 'Would you prefer a 50% chance of gaining 100 or a guaranteed gain of 40?',
      question_type: 'choice',
      options: [
        { value: '50_100', label: '50% chance of 100' },
        { value: 'guaranteed_40', label: 'Guaranteed 40' },
      ],
    },
  ];

  if (context === 'business') {
    baseQuestions.push({
      question_id: 'business_risk_1',
      question_text: 'How does your organization typically approach strategic risk?',
      question_type: 'choice',
      options: [
        { value: 'conservative', label: 'Conservative - minimize downside' },
        { value: 'balanced', label: 'Balanced - weigh risks and rewards' },
        { value: 'aggressive', label: 'Aggressive - maximize upside potential' },
      ],
    });
  }

  return baseQuestions;
}

/**
 * Generate fallback risk profile when CEE is unavailable
 */
function generateFallbackRiskProfile(): CeeRiskToleranceResponse {
  return {
    risk_profile: {
      risk_attitude: 'risk_neutral',
      risk_coefficient: 0,
      confidence: 'low',
      rationale: 'Default risk-neutral profile applied. Connect to risk elicitation service for personalized assessment.',
    },
    follow_up_questions: [
      'What is your primary concern: avoiding losses or maximizing gains?',
      'How would you describe your past risk-taking decisions?',
    ],
  };
}

/**
 * Generate risk profile from preset
 */
function generatePresetRiskProfile(
  preset: 'risk_averse' | 'neutral' | 'risk_seeking'
): CeeRiskToleranceResponse {
  const profiles: Record<
    'risk_averse' | 'neutral' | 'risk_seeking',
    CeeRiskToleranceResponse
  > = {
    risk_averse: {
      risk_profile: {
        risk_attitude: 'risk_averse',
        risk_coefficient: -0.5,
        confidence: 'high',
        rationale: 'Risk-averse preset: prioritizes downside protection and certainty over potential upside.',
      },
    },
    neutral: {
      risk_profile: {
        risk_attitude: 'risk_neutral',
        risk_coefficient: 0,
        confidence: 'high',
        rationale: 'Risk-neutral preset: evaluates options based on expected value without risk adjustment.',
      },
    },
    risk_seeking: {
      risk_profile: {
        risk_attitude: 'risk_seeking',
        risk_coefficient: 0.5,
        confidence: 'high',
        rationale: 'Risk-seeking preset: willing to accept higher variance for potential upside.',
      },
    },
  };

  return profiles[preset];
}

export async function registerElicitRiskToleranceRoute(app: FastifyInstance) {
  app.post(
    '/v1/elicit/risk-tolerance',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as RiskToleranceRequest;
      const requestId = String(req.id);

      // Handle preset mode (quick risk profile selection)
      if (body.preset) {
        const validPresets = ['risk_averse', 'neutral', 'risk_seeking'] as const;
        if (!validPresets.includes(body.preset as any)) {
          return replyWithAppError(reply, {
            type: 'BAD_INPUT',
            statusCode: 400,
            message: "preset must be 'risk_averse', 'neutral', or 'risk_seeking'",
            fields: { field: 'preset' },
          });
        }

        const elicitation = generatePresetRiskProfile(body.preset as 'risk_averse' | 'neutral' | 'risk_seeking');

        req.log.info({
          evt: 'elicit_risk_tolerance_preset',
          id: requestId,
          preset: body.preset,
        });

        const response: RiskToleranceResponse = {
          schema: 'risk_tolerance.v1',
          mode: 'preset',
          elicitation,
          provenance: 'plot_fallback',
        };

        return reply.code(200).send(response);
      }

      // Validate mode (required if no preset)
      if (!body.mode || !['get_questions', 'process_responses'].includes(body.mode)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: "mode must be 'get_questions' or 'process_responses', or provide a preset",
          fields: { field: 'mode' },
        });
      }

      // Validate responses if mode is 'process_responses'
      if (body.mode === 'process_responses') {
        if (!body.responses || !Array.isArray(body.responses) || body.responses.length === 0) {
          return replyWithAppError(reply, {
            type: 'BAD_INPUT',
            statusCode: 400,
            message: 'responses array required when mode is process_responses',
            fields: { field: 'responses' },
          });
        }
      }

      // Build graph summary if graph provided
      const graphSummary = body.graph?.nodes
        ? { nodes: body.graph.nodes.length, edges: body.graph.edges?.length ?? 0 }
        : undefined;

      // Call CEE if enabled
      let elicitation: CeeRiskToleranceResponse | null = null;
      let ceeError: ProxyError | undefined;
      let provenance: 'cee' | 'plot_fallback' = 'plot_fallback';

      const ceeEnabled = isFlagOn(process.env.CEE_RISK_TOLERANCE_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLED);

      if (ceeEnabled) {
        req.log.info({
          evt: 'elicit_risk_tolerance_cee_call',
          id: requestId,
          mode: body.mode,
          context: body.context,
        });

        const ceeResult = await callCeeElicitRiskTolerance(
          {
            plot_request_id: requestId,
            mode: body.mode,
            context: body.context,
            responses: body.responses,
            graph_summary: graphSummary,
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
        if (body.mode === 'get_questions') {
          elicitation = {
            questions: generateFallbackQuestions(body.context),
          };
        } else {
          elicitation = generateFallbackRiskProfile();
        }
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'elicit_risk_tolerance',
        id: requestId,
        mode: body.mode,
        context: body.context,
        provenance,
        duration_ms: duration,
      });

      const response: RiskToleranceResponse = {
        schema: 'risk_tolerance.v1',
        mode: body.mode,
        elicitation,
        provenance,
        ...(ceeError && { cee_error: ceeError }),
      };

      return reply.code(200).send(response);
    }
  );
}
