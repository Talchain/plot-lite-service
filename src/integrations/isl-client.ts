/**
 * ISL (Inference Service Layer) Client Stub
 *
 * Sprint N Feature 4: Prepare integration points for ISL service
 *
 * This stub provides the interface and fallback behavior for ISL integration.
 * When ISL is not available, operations return graceful fallbacks.
 */

/**
 * ISL configuration from environment
 */
export interface ISLConfig {
  /** Base URL for ISL service */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Enable ISL integration */
  enabled: boolean;
}

/**
 * ISL inference request
 */
export interface ISLInferenceRequest {
  /** Graph nodes */
  nodes: Array<{ id: string; label?: string }>;
  /** Graph edges with weights and beliefs */
  edges: Array<{
    from: string;
    to: string;
    weight?: number;
    belief?: number;
  }>;
  /** Target node for inference */
  targetNode: string;
  /** Random seed for reproducibility */
  seed: number;
  /** Number of samples */
  kSamples: number;
}

/**
 * ISL inference response
 */
export interface ISLInferenceResponse {
  /** Quantile estimates */
  quantiles: {
    p10: number;
    p50: number;
    p90: number;
  };
  /** Confidence indicator */
  confidence: 'low' | 'medium' | 'high';
  /** Response hash for verification */
  hash: string;
  /** ISL version */
  version: string;
}

/**
 * ISL client result - either success or fallback
 */
export interface ISLResult<T> {
  /** Was ISL called successfully? */
  success: boolean;
  /** Result data (from ISL or fallback) */
  data: T;
  /** Source of the data */
  source: 'isl' | 'fallback';
  /** Error if ISL call failed */
  error?: {
    code: string;
    message: string;
  };
  /** Latency in milliseconds */
  latencyMs?: number;
}

/**
 * Get ISL configuration from environment
 */
export function getISLConfig(): ISLConfig {
  const baseUrl = String(process.env.ISL_BASE_URL ?? '').trim();
  const apiKey = String(process.env.ISL_API_KEY ?? '').trim();
  const timeoutMs = Number(process.env.ISL_TIMEOUT_MS ?? 5000);
  const enabled = String(process.env.ISL_ENABLE ?? '').toLowerCase() === '1';

  return {
    baseUrl,
    apiKey,
    timeoutMs,
    enabled: enabled && baseUrl.length > 0 && apiKey.length > 0,
  };
}

/**
 * Check if ISL is configured and enabled
 */
export function isISLEnabled(): boolean {
  const config = getISLConfig();
  return config.enabled;
}

/**
 * ISL Client class (stub implementation)
 *
 * This is a stub that provides fallback behavior.
 * Replace with actual ISL API calls when service is available.
 */
export class ISLClient {
  private config: ISLConfig;

  constructor(config?: Partial<ISLConfig>) {
    const envConfig = getISLConfig();
    this.config = {
      ...envConfig,
      ...config,
    };
  }

  /**
   * Check if ISL is available
   */
  isAvailable(): boolean {
    return this.config.enabled;
  }

  /**
   * Run inference via ISL or return fallback
   *
   * @param request - Inference request parameters
   * @param fallback - Fallback data if ISL is unavailable
   * @returns ISL result with data and source
   */
  async runInference(
    request: ISLInferenceRequest,
    fallback: ISLInferenceResponse
  ): Promise<ISLResult<ISLInferenceResponse>> {
    // If ISL is not enabled, return fallback immediately
    if (!this.config.enabled) {
      return {
        success: false,
        data: fallback,
        source: 'fallback',
        error: {
          code: 'ISL_DISABLED',
          message: 'ISL integration is not enabled',
        },
      };
    }

    // STUB: In actual implementation, this would make an HTTP call to ISL
    // For now, simulate ISL being unavailable to demonstrate fallback
    const startTime = performance.now();

    try {
      // Placeholder for actual ISL API call
      // const response = await fetch(`${this.config.baseUrl}/v1/inference`, {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'Authorization': `Bearer ${this.config.apiKey}`,
      //   },
      //   body: JSON.stringify(request),
      //   signal: AbortSignal.timeout(this.config.timeoutMs),
      // });

      // STUB: Return fallback with ISL_STUB code
      return {
        success: false,
        data: fallback,
        source: 'fallback',
        error: {
          code: 'ISL_STUB',
          message: 'ISL client is a stub - actual implementation pending',
        },
        latencyMs: Math.round(performance.now() - startTime),
      };
    } catch (err: any) {
      return {
        success: false,
        data: fallback,
        source: 'fallback',
        error: {
          code: 'ISL_ERROR',
          message: err?.message ?? 'Unknown ISL error',
        },
        latencyMs: Math.round(performance.now() - startTime),
      };
    }
  }

  /**
   * Health check for ISL service
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    if (!this.config.enabled) {
      return { healthy: false, latencyMs: 0, error: 'ISL not configured' };
    }

    const startTime = performance.now();

    // STUB: Return unhealthy since stub is not connected
    return {
      healthy: false,
      latencyMs: Math.round(performance.now() - startTime),
      error: 'ISL client is a stub',
    };
  }
}

/**
 * Get a singleton ISL client instance
 */
let _islClient: ISLClient | null = null;

export function getISLClient(): ISLClient {
  if (!_islClient) {
    _islClient = new ISLClient();
  }
  return _islClient;
}

/**
 * Reset ISL client (for testing)
 */
export function resetISLClient(): void {
  _islClient = null;
}
