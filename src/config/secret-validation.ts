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
