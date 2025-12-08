/**
 * P0: HMAC Secret Validation (Fail-Fast at Startup)
 */

export function validateHMACSecrets(): void {
  const errors: string[] = [];
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  
  // TOKEN_HMAC_SECRET validation
  const tokenSecret = process.env.TOKEN_HMAC_SECRET || '';
  if (!tokenSecret || tokenSecret === 'default-insecure-secret') {
    errors.push('TOKEN_HMAC_SECRET: missing or insecure');
  } else if (tokenSecret.length < 64) {
    errors.push(`TOKEN_HMAC_SECRET: too short (${tokenSecret.length} chars, need ≥64)`);
  }
  
  // PRINCIPAL_HMAC_SECRET validation (if circuit breaker enabled)
  const cbEnabled = process.env.RL_CB_ENABLE === '1';
  if (cbEnabled) {
    const principalSecret = process.env.PRINCIPAL_HMAC_SECRET_ACTIVE || process.env.PRINCIPAL_HMAC_SECRET || '';
    if (!principalSecret) {
      errors.push('PRINCIPAL_HMAC_SECRET: missing (required when RL_CB_ENABLE=1)');
    } else if (principalSecret.length < 64) {
      errors.push(`PRINCIPAL_HMAC_SECRET: too short (${principalSecret.length} chars, need ≥64)`);
    }
  }
  
  if (errors.length > 0 && !isTest) {
    console.error('\n[FATAL] HMAC Secret Validation Failed:');
    errors.forEach(e => console.error(`  ❌ ${e}`));
    console.error('\nGenerate strong secrets: openssl rand -hex 32');
    console.error('Set in environment: TOKEN_HMAC_SECRET=<64-char-hex>\n');
    process.exit(1);
  }
}

/**
 * P0: External Service URL Validation (Fail-Fast at Startup)
 * Ensures CEE and ISL base URLs use HTTPS in production.
 */
export function validateExternalServiceURLs(): void {
  const errors: string[] = [];
  const isProduction = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

  if (!isProduction || isTest) {
    return; // Only enforce in production
  }

  // CEE_BASE_URL validation
  const ceeBaseUrl = process.env.CEE_BASE_URL || '';
  if (ceeBaseUrl && !ceeBaseUrl.startsWith('https://')) {
    errors.push(`CEE_BASE_URL must use HTTPS in production (got: ${ceeBaseUrl.substring(0, 30)}...)`);
  }

  // ISL_BASE_URL validation
  const islBaseUrl = process.env.ISL_BASE_URL || '';
  if (islBaseUrl && !islBaseUrl.startsWith('https://')) {
    errors.push(`ISL_BASE_URL must use HTTPS in production (got: ${islBaseUrl.substring(0, 30)}...)`);
  }

  if (errors.length > 0) {
    console.error('\n[FATAL] External Service URL Validation Failed:');
    errors.forEach(e => console.error(`  ❌ ${e}`));
    console.error('\nAll external service URLs must use HTTPS in production.\n');
    process.exit(1);
  }
}
