/**
 * Rolling P95 Alert Monitor
 * Warns if engine_p95_ms_rolling > threshold for sustained period
 */

const THRESHOLD_MS = 100;
const SUSTAINED_MINUTES = 5;
const WARN_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

let consecutiveHighCount = 0;
let lastWarnTime = 0;

export function checkP95Alert(p95Rolling: number, logger?: any): void {
  if (p95Rolling > THRESHOLD_MS) {
    consecutiveHighCount++;
    
    if (consecutiveHighCount >= SUSTAINED_MINUTES) {
      const now = Date.now();
      const sinceLastWarn = now - lastWarnTime;
      
      if (sinceLastWarn >= WARN_COOLDOWN_MS) {
        const msg = `Performance alert: engine_p95_ms_rolling (${p95Rolling}ms) > ${THRESHOLD_MS}ms for ${SUSTAINED_MINUTES}+ minutes`;
        
        if (logger) {
          logger.warn({ p95Rolling, threshold: THRESHOLD_MS, consecutiveMinutes: consecutiveHighCount }, msg);
        } else {
          console.warn(msg);
        }
        
        lastWarnTime = now;
      }
    }
  } else {
    consecutiveHighCount = 0;
  }
}

// Test-only reset
export function __resetP95Alert(): void {
  if (process.env.NODE_ENV !== 'test') return;
  consecutiveHighCount = 0;
  lastWarnTime = 0;
}

// Test-only getters
export function __getP95AlertState() {
  if (process.env.NODE_ENV !== 'test') return null;
  return { consecutiveHighCount, lastWarnTime };
}
