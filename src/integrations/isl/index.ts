/**
 * ISL (Inference Service Layer) Integration
 *
 * Main entry point for ISL integration. Provides a service interface
 * for causal validation, sensitivity analysis, and counterfactual computation.
 *
 * @example
 * ```typescript
 * import { islService } from './integrations/isl';
 *
 * if (islService.isEnabled()) {
 *   const result = await islService.validateCausal(graph, 'treatment', 'outcome', 'req-123');
 *   if (result.source === 'isl') {
 *     // Use ISL result
 *   }
 * }
 * ```
 */

import { ISLClient, getISLClientConfig } from './client.js';
import { ISLTimeoutError, ISLNetworkError, isRetryableError } from './errors.js';
import {
  adaptValidationResponse,
  createFallbackValidation,
} from './adapters/validation.js';
import {
  adaptSensitivityResponse,
  createFallbackSensitivity,
} from './adapters/sensitivity.js';
import {
  adaptCounterfactualResponse,
  createFallbackCounterfactual,
} from './adapters/counterfactual.js';
import {
  adaptFactorSensitivityResponse,
  createFallbackFactorSensitivity,
} from './adapters/factor-sensitivity.js';
// P1.1: ISL metrics
import {
  recordIslValidation,
  recordIslSensitivity,
  recordIslFactorSensitivity,
  observeIslLatency,
} from '../../metrics/registry.js';
import type {
  ISLValidationResponse,
  ISLSensitivityResponse,
  ISLCounterfactualResponse,
  ISLFactorSensitivityResponse,
  ISLParameterUncertainty,
  ISLDAGStructure,
} from './types/isl-types.js';
import type {
  PLoTValidationResult,
  PLoTSensitivityResult,
  PLoTCounterfactualResult,
  PLoTFactorSensitivityResult,
} from './types/plot-types.js';
import type { Graph } from '../../trust/types.js';

/**
 * Result from generic analysis endpoint calls
 * Used by /v1/analysis/* routes that call ISL /api/v1/analysis/* endpoints
 */
export interface ISLAnalysisResult<T> {
  /** Parsed response data, or null if request failed */
  data: T | null;
  /** Error information if request failed */
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  /** Request latency in milliseconds */
  latency_ms: number;
}

/**
 * ISL Service interface
 */
export interface ISLService {
  /** Check if ISL is enabled and configured */
  isEnabled(): boolean;
  /** Check if ISL service is currently available */
  isAvailable(): Promise<boolean>;
  /** Validate causal identifiability */
  validateCausal(
    graph: Graph,
    treatment: string,
    outcome: string,
    requestId: string
  ): Promise<PLoTValidationResult>;
  /** Analyse parameter sensitivity */
  analyseSensitivity(
    graph: Graph,
    treatment: string,
    outcome: string,
    requestId: string
  ): Promise<PLoTSensitivityResult>;
  /** Compute counterfactual estimate */
  computeCounterfactual(
    graph: Graph,
    intervention: Record<string, number>,
    target: string,
    requestId: string
  ): Promise<PLoTCounterfactualResult>;
  /**
   * Analyse factor sensitivity via /api/v1/robustness/analyze/v2
   *
   * Returns sensitivity scores for factor nodes showing how outcome
   * is affected by changes in factor values.
   *
   * @param graph - Graph with factor nodes containing observed_state
   * @param parameterUncertainties - Uncertainty specs for factors
   * @param goalNodeId - Target goal node ID
   * @param options - Option nodes for analysis
   * @param requestId - Request ID for tracing
   * @returns Factor sensitivity result
   */
  analyseFactorSensitivity(
    graph: Graph,
    parameterUncertainties: ISLParameterUncertainty[],
    goalNodeId: string,
    options: Array<{ id: string; label?: string; interventions?: Record<string, number> }>,
    requestId: string
  ): Promise<PLoTFactorSensitivityResult>;
  /**
   * Generic analysis endpoint call for /api/v1/analysis/* routes
   *
   * Uses consistent auth (X-API-Key), timeout, and retry logic.
   * Analysis routes should use this instead of direct fetch() calls.
   *
   * @param endpoint - ISL endpoint path (e.g., '/api/v1/analysis/pareto')
   * @param body - Request body
   * @param requestId - Request ID for tracing
   * @returns Result with data or error
   *
   * @example
   * ```typescript
   * const result = await islService.callAnalysisEndpoint<ParetoResponse>(
   *   '/api/v1/analysis/pareto',
   *   { options: [...] },
   *   requestId
   * );
   * if (result.data) {
   *   // Use ISL result
   * } else {
   *   // Fall back to local computation
   * }
   * ```
   */
  callAnalysisEndpoint<T>(
    endpoint: string,
    body: unknown,
    requestId: string
  ): Promise<ISLAnalysisResult<T>>;
}

/**
 * Create the ISL service
 */
export function createISLService(): ISLService {
  const config = getISLClientConfig();
  const enabled = process.env.ISL_ENABLE === '1';
  const client = new ISLClient(config);

  return {
    isEnabled(): boolean {
      return enabled && config.baseUrl.length > 0 && config.apiKey.length > 0;
    },

    async isAvailable(): Promise<boolean> {
      if (!this.isEnabled()) return false;
      return client.healthCheck();
    },

    async validateCausal(
      graph: Graph,
      treatment: string,
      outcome: string,
      requestId: string
    ): Promise<PLoTValidationResult> {
      if (!this.isEnabled()) {
        // P1.1: Record fallback (ISL not enabled)
        recordIslValidation('fallback', 'ok');
        return createFallbackValidation('ISL not enabled');
      }

      const startMs = Date.now();
      try {
        const dag = graphToISLDAG(graph);

        const response = await client.request<ISLValidationResponse>({
          endpoint: '/api/v1/causal/validate',
          body: { dag, treatment, outcome },
          requestId,
        });

        // P1.1: Record ISL success
        const durationMs = Date.now() - startMs;
        recordIslValidation('isl', 'ok');
        observeIslLatency('validation', 'ok', durationMs);

        return adaptValidationResponse(response);
      } catch (error) {
        // P1.1: Record ISL error with timeout distinction
        const durationMs = Date.now() - startMs;
        const result = error instanceof ISLTimeoutError ? 'timeout' : 'error';
        recordIslValidation('isl', result);
        observeIslLatency('validation', 'error', durationMs);

        logError('isl_validation_failed', error, requestId);
        return createFallbackValidation((error as Error).message);
      }
    },

    async analyseSensitivity(
      graph: Graph,
      treatment: string,
      outcome: string,
      requestId: string
    ): Promise<PLoTSensitivityResult> {
      if (!this.isEnabled()) {
        // P1.1: Record fallback (ISL not enabled)
        recordIslSensitivity('fallback', 'ok');
        return createFallbackSensitivity('ISL not enabled');
      }

      const startMs = Date.now();
      try {
        const dag = graphToISLDAG(graph);

        const response = await client.request<ISLSensitivityResponse>({
          endpoint: '/api/v1/causal/sensitivity/detailed',
          body: { dag, treatment, outcome },
          requestId,
        });

        // P1.1: Record ISL success
        const durationMs = Date.now() - startMs;
        recordIslSensitivity('isl', 'ok');
        observeIslLatency('sensitivity', 'ok', durationMs);

        return adaptSensitivityResponse(response);
      } catch (error) {
        // P1.1: Record ISL error with timeout distinction
        const durationMs = Date.now() - startMs;
        const result = error instanceof ISLTimeoutError ? 'timeout' : 'error';
        recordIslSensitivity('isl', result);
        observeIslLatency('sensitivity', 'error', durationMs);

        logError('isl_sensitivity_failed', error, requestId);
        return createFallbackSensitivity((error as Error).message);
      }
    },

    async computeCounterfactual(
      graph: Graph,
      intervention: Record<string, number>,
      target: string,
      requestId: string
    ): Promise<PLoTCounterfactualResult> {
      if (!this.isEnabled()) {
        return createFallbackCounterfactual('ISL not enabled');
      }

      try {
        const dag = graphToISLDAG(graph);

        const response = await client.request<ISLCounterfactualResponse>({
          endpoint: '/api/v1/causal/counterfactual',
          body: { dag, intervention, target },
          requestId,
        });

        return adaptCounterfactualResponse(response);
      } catch (error) {
        logError('isl_counterfactual_failed', error, requestId);
        return createFallbackCounterfactual((error as Error).message);
      }
    },

    async analyseFactorSensitivity(
      graph: Graph,
      parameterUncertainties: ISLParameterUncertainty[],
      goalNodeId: string,
      options: Array<{ id: string; label?: string; interventions?: Record<string, number> }>,
      requestId: string
    ): Promise<PLoTFactorSensitivityResult> {
      if (!this.isEnabled()) {
        recordIslFactorSensitivity('fallback', 'ok');
        return createFallbackFactorSensitivity('ISL not enabled');
      }

      // Skip if no parameter uncertainties provided
      if (!parameterUncertainties || parameterUncertainties.length === 0) {
        recordIslFactorSensitivity('fallback', 'ok');
        return createFallbackFactorSensitivity('No parameter uncertainties provided');
      }

      const startMs = Date.now();
      try {
        // Build ISL request payload
        const requestPayload = {
          request_id: requestId,
          graph: {
            nodes: graph.nodes.map((n) => ({
              id: n.id,
              kind: n.kind,
              label: n.label,
              observed_state: n.observed_state,
            })),
            edges: graph.edges.map((e) => ({
              from: e.from,
              to: e.to,
              weight: e.weight,
              belief_exists: e.belief_exists ?? e.belief,
              belief_strength: e.belief_strength,
            })),
          },
          options: options.map((o) => ({
            id: o.id,
            label: o.label,
            interventions: o.interventions,
          })),
          goal_node_id: goalNodeId,
          analysis_types: ['sensitivity', 'robustness'] as const,
          parameter_uncertainties: parameterUncertainties,
        };

        const response = await client.request<ISLFactorSensitivityResponse>({
          endpoint: '/api/v1/robustness/analyze/v2',
          body: requestPayload,
          requestId,
        });

        const durationMs = Date.now() - startMs;
        recordIslFactorSensitivity('isl', 'ok');
        observeIslLatency('factor_sensitivity', 'ok', durationMs);

        return adaptFactorSensitivityResponse(response, durationMs);
      } catch (error) {
        const durationMs = Date.now() - startMs;
        const result = error instanceof ISLTimeoutError ? 'timeout' : 'error';
        recordIslFactorSensitivity('isl', result);
        observeIslLatency('factor_sensitivity', 'error', durationMs);

        logError('isl_factor_sensitivity_failed', error, requestId);
        return createFallbackFactorSensitivity((error as Error).message);
      }
    },

    async callAnalysisEndpoint<T>(
      endpoint: string,
      body: unknown,
      requestId: string
    ): Promise<ISLAnalysisResult<T>> {
      const startMs = Date.now();

      // Check config dynamically (for test compatibility and runtime config changes)
      const currentEnabled = process.env.ISL_ENABLE === '1';
      const currentConfig = getISLClientConfig();
      const fullyEnabled = currentEnabled && currentConfig.baseUrl.length > 0 && currentConfig.apiKey.length > 0;

      if (!fullyEnabled) {
        return {
          data: null,
          error: {
            code: 'ISL_NOT_ENABLED',
            message: 'ISL service is not enabled',
            retryable: false,
          },
          latency_ms: Date.now() - startMs,
        };
      }

      // Create client with current config (handles dynamic env var changes)
      const currentClient = new ISLClient(currentConfig);

      try {
        const response = await currentClient.request<T>({
          endpoint,
          body,
          requestId,
        });

        return {
          data: response,
          latency_ms: Date.now() - startMs,
        };
      } catch (error) {
        const err = error as Error;
        const isTimeout = err instanceof ISLTimeoutError;
        const isNetwork = err instanceof ISLNetworkError;

        logError(`isl_analysis_failed:${endpoint}`, error, requestId);

        // Determine error code based on error type
        let code = 'ISL_ERROR';
        if (isTimeout) {
          code = 'ISL_TIMEOUT';
        } else if (isNetwork) {
          code = 'ISL_NETWORK_ERROR';
        }

        return {
          data: null,
          error: {
            code,
            message: err.message || 'ISL analysis request failed',
            retryable: isRetryableError(error),
          },
          latency_ms: Date.now() - startMs,
        };
      }
    },
  };
}

/**
 * Transform PLoT Graph to ISL DAG structure
 */
function graphToISLDAG(graph: Graph): ISLDAGStructure {
  return {
    nodes: graph.nodes.map((n) => n.id),
    edges: graph.edges.map((e) => [e.from, e.to] as [string, string]),
  };
}

/**
 * Log an error (structured)
 */
function logError(event: string, error: unknown, requestId: string): void {
  const entry = {
    level: 'error',
    time: Date.now(),
    event,
    error: (error as Error).message,
    request_id: requestId,
  };
  console.error(JSON.stringify(entry));
}

// Singleton instance
let _islService: ISLService | null = null;

/**
 * Get the singleton ISL service instance
 */
export function getISLService(): ISLService {
  if (!_islService) {
    _islService = createISLService();
  }
  return _islService;
}

/**
 * Reset ISL service (for testing)
 */
export function resetISLService(): void {
  _islService = null;
}

/**
 * Singleton export for convenience
 */
export const islService = getISLService();

// Re-export types for consumers
export type {
  PLoTValidationResult,
  PLoTSensitivityResult,
  PLoTCounterfactualResult,
  PLoTFactorSensitivityResult,
  FactorSensitivityEntry,
  VOIEntry,
  ISLValidationResponse,
  ISLSensitivityResponse,
  ISLCounterfactualResponse,
  ISLFactorSensitivityResponse,
  ISLParameterUncertainty,
} from './types/index.js';

// Note: ISLAnalysisResult is already exported via interface definition above

export { ISLClient, type ISLClientConfig } from './client.js';
export { ISLHttpError } from './errors.js';
