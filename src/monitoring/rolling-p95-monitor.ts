/**
 * Rolling P95 Monitor
 * Warns if engine_p95_ms_rolling > threshold for consecutive minutes
 */

export interface MonitorConfig {
  thresholdMs: number;
  consecutiveMinutes: number;
  checkIntervalMs: number;
}

export interface MonitorState {
  consecutiveHighCount: number;
  lastCheckTime: number;
  lastWarningTime: number;
}

const DEFAULT_CONFIG: MonitorConfig = {
  thresholdMs: 100,
  consecutiveMinutes: 5,
  checkIntervalMs: 60 * 1000, // 1 minute
};

let state: MonitorState = {
  consecutiveHighCount: 0,
  lastCheckTime: 0,
  lastWarningTime: 0,
};

let config: MonitorConfig = { ...DEFAULT_CONFIG };
let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Get current rolling p95 metric
 * Override this function in tests to inject mock values
 */
export let getRollingP95Ms: () => number = () => {
  // Default implementation: try to import from metrics module
  try {
    // Dynamic import to avoid circular dependencies
    const metricsModule = require('../metrics.js');
    if (typeof metricsModule.getEngineP95MsRolling === 'function') {
      return metricsModule.getEngineP95MsRolling() || 0;
    }
  } catch {}
  return 0;
};

/**
 * Log warning function
 * Override this in tests to capture warnings
 */
export let logWarning: (data: any, message: string) => void = (data, message) => {
  console.warn(JSON.stringify({ level: 'warn', ...data, msg: message }));
};

/**
 * Check if rolling p95 exceeds threshold
 * Returns true if warning should be logged
 */
export function checkThreshold(): boolean {
  const now = Date.now();
  const rollingP95 = getRollingP95Ms();
  
  if (rollingP95 > config.thresholdMs) {
    state.consecutiveHighCount++;
    
    // Log warning if threshold breached for consecutive minutes
    if (state.consecutiveHighCount >= config.consecutiveMinutes) {
      // Only log once per hour to avoid spam
      const hoursSinceLastWarning = (now - state.lastWarningTime) / (60 * 60 * 1000);
      if (hoursSinceLastWarning >= 1) {
        logWarning(
          {
            rolling_p95_ms: rollingP95,
            threshold_ms: config.thresholdMs,
            consecutive_minutes: state.consecutiveHighCount,
          },
          `engine_p95 high for ${state.consecutiveHighCount}m`
        );
        state.lastWarningTime = now;
        return true;
      }
    }
  } else {
    // Reset counter if below threshold
    state.consecutiveHighCount = 0;
  }
  
  state.lastCheckTime = now;
  return false;
}

/**
 * Start monitoring (called once at server startup)
 */
export function startMonitoring(customConfig?: Partial<MonitorConfig>): void {
  if (intervalHandle) {
    return; // Already started
  }
  
  // Merge custom config
  if (customConfig) {
    config = { ...config, ...customConfig };
  }
  
  // Start periodic checks
  intervalHandle = setInterval(() => {
    try {
      checkThreshold();
    } catch (e) {
      // Silently ignore errors to avoid crashing the server
    }
  }, config.checkIntervalMs);
  
  // Don't block process exit
  if (intervalHandle.unref) {
    intervalHandle.unref();
  }
}

/**
 * Stop monitoring (for tests/cleanup)
 */
export function stopMonitoring(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  state = {
    consecutiveHighCount: 0,
    lastCheckTime: 0,
    lastWarningTime: 0,
  };
}

/**
 * Get current state (for tests/debugging)
 */
export function getState(): Readonly<MonitorState> {
  return { ...state };
}

/**
 * Reset state (for tests)
 */
export function resetState(): void {
  state = {
    consecutiveHighCount: 0,
    lastCheckTime: 0,
    lastWarningTime: 0,
  };
}

/**
 * Override functions for testing
 */
export function setTestOverrides(overrides: {
  getRollingP95Ms?: () => number;
  logWarning?: (data: any, message: string) => void;
}): void {
  if (overrides.getRollingP95Ms) {
    getRollingP95Ms = overrides.getRollingP95Ms;
  }
  if (overrides.logWarning) {
    logWarning = overrides.logWarning;
  }
}
