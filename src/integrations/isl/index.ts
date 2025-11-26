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

import { ISLClient, getISLClientConfig, type ISLClientConfig } from './client.js';
import { ISLTimeoutError } from './errors.js';
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
// P1.1: ISL metrics
import {
  recordIslValidation,
  recordIslSensitivity,
  observeIslLatency,
} from '../../metrics/registry.js';
import type {
  ISLValidationResponse,
  ISLSensitivityResponse,
  ISLCounterfactualResponse,
  ISLDAGStructure,
} from './types/isl-types.js';
import type {
  PLoTValidationResult,
  PLoTSensitivityResult,
  PLoTCounterfactualResult,
} from './types/plot-types.js';
import type { Graph } from '../../trust/types.js';

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
  ISLValidationResponse,
  ISLSensitivityResponse,
  ISLCounterfactualResponse,
} from './types/index.js';

export { ISLClient, type ISLClientConfig } from './client.js';
export { ISLHttpError } from './errors.js';
