import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

export function validateEnv(): void {
  const errors: string[] = [];

  // AUTH validation
  if (process.env.AUTH_ENABLED === '1' && !process.env.AUTH_TOKEN) {
    errors.push('AUTH_ENABLED=1 requires AUTH_TOKEN to be set');
  }

  // PORT validation
  const portStr = process.env.PORT || '4311';
  const port = Number(portStr);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT: ${portStr} (must be 1-65535)`);
  }

  // REQUEST_TIMEOUT_MS validation
  if (process.env.REQUEST_TIMEOUT_MS) {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS);
    if (isNaN(timeout) || timeout < 100) {
      errors.push(`Invalid REQUEST_TIMEOUT_MS: ${process.env.REQUEST_TIMEOUT_MS} (must be >= 100)`);
    }
  }

  // RATE_LIMIT_RPM validation
  if (process.env.RATE_LIMIT_RPM) {
    const rpm = Number(process.env.RATE_LIMIT_RPM);
    if (isNaN(rpm) || rpm < 1) {
      errors.push(`Invalid RATE_LIMIT_RPM: ${process.env.RATE_LIMIT_RPM} (must be >= 1)`);
    }
  }

  // RATE_LIMIT_PER_MIN validation (legacy)
  if (process.env.RATE_LIMIT_PER_MIN) {
    const rpm = Number(process.env.RATE_LIMIT_PER_MIN);
    if (isNaN(rpm) || rpm < 1) {
      errors.push(`Invalid RATE_LIMIT_PER_MIN: ${process.env.RATE_LIMIT_PER_MIN} (must be >= 1)`);
    }
  }

  // CORS_ORIGINS validation
  if (process.env.CORS_ORIGINS) {
    const origins = process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
    for (const origin of origins) {
      try {
        new URL(origin);
      } catch {
        errors.push(`Invalid CORS_ORIGINS entry: "${origin}" (must be valid URL)`);
      }
    }
  }

  // STREAM_HEARTBEAT_SEC validation
  if (process.env.STREAM_HEARTBEAT_SEC) {
    const hb = Number(process.env.STREAM_HEARTBEAT_SEC);
    if (isNaN(hb) || hb < 1) {
      errors.push(`Invalid STREAM_HEARTBEAT_SEC: ${process.env.STREAM_HEARTBEAT_SEC} (must be >= 1)`);
    }
  }

  if (errors.length > 0) {
    logger.fatal({ errors, env: process.env.NODE_ENV }, 'Environment validation failed');
    console.error('\n❌ ENVIRONMENT VALIDATION FAILED:\n');
    errors.forEach(err => console.error(`  - ${err}`));
    console.error('\nPlease fix the above errors and restart the server.\n');
    process.exit(1);
  }

  logger.info({ 
    port: Number(portStr), 
    nodeEnv: process.env.NODE_ENV || 'development',
    authEnabled: process.env.AUTH_ENABLED === '1',
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== '0',
    testRoutes: process.env.TEST_ROUTES === '1',
  }, 'Environment validation passed');
}
