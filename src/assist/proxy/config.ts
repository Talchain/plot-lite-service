/**
 * Assistants Proxy Configuration
 *
 * Central configuration for proxying /assist/* routes to the standalone
 * olumi-assistants-service. Validates env vars on boot and provides
 * typed access to proxy settings.
 */

/**
 * Proxy configuration with validated env vars
 */
export interface ProxyConfig {
  enabled: boolean;
  baseUrl: string;
  timeoutMs: number;
  sseTimeoutMs: number;
  maxResponseBytes: number;
  retries: number;
  healthCheckCacheTtlMs: number;
}

/**
 * Health check status
 */
export interface UpstreamHealth {
  status: 'ok' | 'degraded' | 'down';
  lastCheckedMs: number;
}

export type UpstreamStatus = 'ok' | 'degraded' | 'down';

let cachedConfig: ProxyConfig | null = null;

/**
 * Get proxy configuration from environment variables.
 * Validates required vars when enabled and fails fast on boot if misconfigured.
 *
 * @throws Error if ASSISTANTS_ENABLED=1 but ASSISTANTS_BASE_URL is missing/invalid
 */
export function getProxyConfig(): ProxyConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const enabled = process.env.ASSISTANTS_ENABLED === '1';

  // If disabled, return minimal config
  if (!enabled) {
    cachedConfig = {
      enabled: false,
      baseUrl: '',
      timeoutMs: 0,
      sseTimeoutMs: 0,
      maxResponseBytes: 0,
      retries: 0,
      healthCheckCacheTtlMs: 0,
    };
    return cachedConfig;
  }

  // When enabled, ASSISTANTS_BASE_URL is required
  const baseUrl = process.env.ASSISTANTS_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      'ASSISTANTS_ENABLED=1 requires ASSISTANTS_BASE_URL environment variable. ' +
      'Example: ASSISTANTS_BASE_URL=https://olumi-assistants-service.onrender.com'
    );
  }

  // Validate base URL format
  try {
    new URL(baseUrl);
  } catch (err) {
    throw new Error(
      `Invalid ASSISTANTS_BASE_URL: ${baseUrl}. Must be a valid HTTP(S) URL.`
    );
  }

  // Remove trailing slash for consistency
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  cachedConfig = {
    enabled: true,
    baseUrl: normalizedBaseUrl,
    timeoutMs: parseInt(process.env.ASSISTANTS_TIMEOUT_MS || '12000', 10),
    sseTimeoutMs: parseInt(process.env.ASSISTANTS_SSE_TIMEOUT_MS || '20000', 10),
    maxResponseBytes: parseInt(process.env.ASSISTANTS_MAX_RESPONSE_BYTES || '1000000', 10),
    retries: parseInt(process.env.ASSISTANTS_RETRIES || '1', 10),
    healthCheckCacheTtlMs: 60000, // 60s cache for health checks
  };

  return cachedConfig;
}

/**
 * Validate proxy configuration on boot.
 * Call this early in createServer() to fail fast if misconfigured.
 */
export function validateProxyConfig(): void {
  const config = getProxyConfig();

  if (!config.enabled) {
    return; // Nothing to validate when disabled
  }

  // Sanity check numeric values
  if (config.timeoutMs < 1000 || config.timeoutMs > 60000) {
    throw new Error(`ASSISTANTS_TIMEOUT_MS must be between 1000-60000, got ${config.timeoutMs}`);
  }

  if (config.sseTimeoutMs < 1000 || config.sseTimeoutMs > 120000) {
    throw new Error(`ASSISTANTS_SSE_TIMEOUT_MS must be between 1000-120000, got ${config.sseTimeoutMs}`);
  }

  if (config.maxResponseBytes < 10000 || config.maxResponseBytes > 10000000) {
    throw new Error(`ASSISTANTS_MAX_RESPONSE_BYTES must be between 10000-10000000, got ${config.maxResponseBytes}`);
  }

  if (config.retries < 0 || config.retries > 3) {
    throw new Error(`ASSISTANTS_RETRIES must be between 0-3, got ${config.retries}`);
  }
}

// Cached health status
let cachedHealth: UpstreamHealth | null = null;

/**
 * Get cached upstream health status.
 * Non-blocking; returns last known status or 'down' if never checked.
 */
export function getCachedUpstreamHealth(): UpstreamHealth {
  if (!cachedHealth) {
    return {
      status: 'down',
      lastCheckedMs: 0,
    };
  }

  const config = getProxyConfig();
  const age = Date.now() - cachedHealth.lastCheckedMs;

  // If cache expired, mark as stale but don't block
  if (age > config.healthCheckCacheTtlMs) {
    return {
      status: 'degraded',
      lastCheckedMs: cachedHealth.lastCheckedMs,
    };
  }

  return cachedHealth;
}

/**
 * Update cached upstream health status.
 * Called by health check background task.
 */
export function updateUpstreamHealth(status: 'ok' | 'degraded' | 'down'): void {
  cachedHealth = {
    status,
    lastCheckedMs: Date.now(),
  };
}
