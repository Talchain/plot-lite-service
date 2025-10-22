/**
 * Stream Token Issuance & Validation
 * Short-lived, one-time, audience-scoped tokens for SSE
 */
import { createHmac, randomBytes } from 'node:crypto';

const SECRET = process.env.STREAM_TOKEN_SECRET || 'dev-secret-change-in-prod';
const TTL_SECONDS = Number(process.env.STREAM_TOKEN_TTL_S) || 180; // 3 min default

// One-time token store (LRU with TTL)
const usedTokens = new Map<string, number>(); // token -> expiry timestamp
const MAX_USED_TOKENS = 10000;

// Cleanup expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of usedTokens.entries()) {
    if (expiry < now) {
      usedTokens.delete(token);
    }
  }
}, 60000); // Every minute

export interface StreamToken {
  token: string;
  ttl_s: number;
}

export interface TokenPayload {
  aud: string; // audience: 'stream'
  iat: number; // issued at (ms)
  exp: number; // expires at (ms)
  jti: string; // unique token ID
}

/**
 * Issue a new stream token
 */
export function issueStreamToken(audience: string = 'stream'): StreamToken {
  const now = Date.now();
  const exp = now + (TTL_SECONDS * 1000);
  const jti = randomBytes(16).toString('hex');
  
  const payload: TokenPayload = {
    aud: audience,
    iat: now,
    exp,
    jti
  };
  
  // Create HMAC signature
  const data = JSON.stringify(payload);
  const hmac = createHmac('sha256', SECRET);
  hmac.update(data);
  const signature = hmac.digest('hex');
  
  // Token format: base64(payload).signature
  const token = `${Buffer.from(data).toString('base64')}.${signature}`;
  
  return {
    token,
    ttl_s: TTL_SECONDS
  };
}

/**
 * Validate and redeem a stream token (one-time use)
 */
export function redeemStreamToken(token: string): 
  { valid: true; payload: TokenPayload } | 
  { valid: false; reason: 'malformed' | 'invalid_signature' | 'expired' | 'reused' | 'wrong_audience' } {
  
  try {
    // Parse token
    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false, reason: 'malformed' };
    }
    
    const [payloadB64, signature] = parts;
    const data = Buffer.from(payloadB64, 'base64').toString('utf8');
    const payload: TokenPayload = JSON.parse(data);
    
    // Verify signature
    const hmac = createHmac('sha256', SECRET);
    hmac.update(data);
    const expectedSignature = hmac.digest('hex');
    
    if (signature !== expectedSignature) {
      return { valid: false, reason: 'invalid_signature' };
    }
    
    // Check expiry
    const now = Date.now();
    if (payload.exp < now) {
      return { valid: false, reason: 'expired' };
    }
    
    // Check audience
    if (payload.aud !== 'stream') {
      return { valid: false, reason: 'wrong_audience' };
    }
    
    // Check one-time use
    if (usedTokens.has(token)) {
      return { valid: false, reason: 'reused' };
    }
    
    // Mark as used
    usedTokens.set(token, payload.exp);
    
    // Enforce max size (LRU eviction)
    if (usedTokens.size > MAX_USED_TOKENS) {
      const oldestKey = usedTokens.keys().next().value;
      if (oldestKey) {
        usedTokens.delete(oldestKey);
      }
    }
    
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: 'malformed' };
  }
}

/**
 * Redact token for logging (show only first 8 chars)
 */
export function redactToken(token: string): string {
  if (!token || token.length < 8) return '***';
  return `${token.slice(0, 8)}...`;
}
