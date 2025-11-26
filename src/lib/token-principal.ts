/**
 * Token principal extraction with HMAC (F2)
 *
 * Security: Requires TOKEN_HMAC_SECRET to be set when TOKEN_RL_ENABLE=1.
 * Falls back to IP-based principal extraction if secret is missing or weak.
 */
import { createHmac } from 'crypto';
import { canonicalizeRemote } from './net.js';

// Cache validated secret to avoid repeated validation per request
let validatedSecret: string | null = null;
let secretValidationDone = false;

function getTokenSecret(): string | null {
  if (secretValidationDone) return validatedSecret;

  const secret = process.env.TOKEN_HMAC_SECRET;
  if (!secret) {
    // No secret configured - token-based rate limiting disabled
    secretValidationDone = true;
    return null;
  }

  // Validate secret strength (must be ≥64 hex chars = 32 bytes)
  if (secret.length < 64) {
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    if (!isTest) {
      console.error('[token-principal] TOKEN_HMAC_SECRET must be ≥64 hex chars (32 bytes). Token-based rate limiting disabled.');
    }
    secretValidationDone = true;
    return null;
  }

  validatedSecret = secret;
  secretValidationDone = true;
  return validatedSecret;
}

export function extractPrincipal(req: any): string {
  if (process.env.TOKEN_RL_ENABLE === '1') {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      const secret = getTokenSecret();
      if (secret) {
        const token = auth.slice(7);
        const h = createHmac('sha256', secret).update(token).digest('hex');
        return 'token:' + h;
      }
      // Fall through to IP-based if secret not configured or weak
    }
  }

  return 'ip:' + canonicalizeRemote(req.ip || 'unknown');
}

// Reset cached secret (for testing)
export function __resetTokenSecret(): void {
  validatedSecret = null;
  secretValidationDone = false;
}
