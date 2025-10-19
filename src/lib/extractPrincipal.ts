/**
 * PR-3: Secure Principal Extraction (Anti-Spoofing, No PII)
 * 
 * Derives an opaque, HMAC-based principal identifier from the request.
 * Prevents spoofing via X-Forwarded-For and ensures no PII leakage.
 */
import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { incPrincipalSecretFallback } from '../observability/principalSecretMetrics.js';

// Crypto helpers
function hmacHex(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function base64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8');
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// IP normalization
function normalizeIp(ip: string): string {
  try {
    return ip.toLowerCase().trim();
  } catch {
    return '0.0.0.0';
  }
}

/**
 * Extract canonical remote address, respecting trusted proxy configuration
 */
function getCanonicalRemoteAddr(
  req: FastifyRequest,
  opts: { trustProxy: boolean; hops: number }
): string {
  if (opts.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] ?? '');
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    
    // Take the rightmost N hops (trusted proxies)
    if (parts.length >= opts.hops) {
      const candidate = parts[parts.length - opts.hops];
      if (candidate) return normalizeIp(candidate);
    }
  }
  
  // Fallback: Fastify's canonical IP
  return normalizeIp(req.ip ?? (req.socket as any)?.remoteAddress ?? '0.0.0.0');
}

/**
 * Extract principal identifier from request
 * 
 * Priority:
 * 1. Authenticated principal (req.user.id or req.principal) → "auth:HMAC(secret, userId)"
 * 2. Anonymous fallback → "anon:HMAC(secret, canonicalRemote|sha256(UA))"
 * 
 * Returns opaque string with no PII.
 */
export function extractPrincipal(req: FastifyRequest): string {
  // P0-2: Dual-secret rotation support (backward-compatible)
  const secret = process.env.PRINCIPAL_HMAC_SECRET_ACTIVE || process.env.PRINCIPAL_HMAC_SECRET;
  const trustProxy = process.env.TRUST_PROXY === '1';
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? '1');
  
  // Priority 1: Authenticated principal
  const authId = (req as any).user?.id ?? (req as any).principal;
  if (authId && secret) {
    const hmac = hmacHex(secret, String(authId));
    return 'auth:' + base64url(Buffer.from(hmac, 'hex'));
  }
  
  // Priority 2: Anonymous fallback (canonical remote + UA hash)
  const remote = getCanonicalRemoteAddr(req, { trustProxy, hops });
  const ua = (req.headers['user-agent'] as string | undefined) ?? '';
  const data = `${remote}|${sha256Hex(ua)}`;
  
  // If no secret, use SHA256 fallback (still opaque, but not HMAC-protected)
  const mat = secret ? hmacHex(secret, data) : sha256Hex(`fallback:${data}`);
  return 'anon:' + base64url(Buffer.from(mat, 'hex'));
}

/**
 * Check if principal extraction is properly configured
 */
export function isPrincipalExtractionEnabled(): boolean {
  return Boolean(process.env.PRINCIPAL_HMAC_SECRET_ACTIVE || process.env.PRINCIPAL_HMAC_SECRET);
}

/**
 * Get principal extraction mode for observability
 */
export function getPrincipalExtractionMode(): 'auth' | 'fallback' | 'degraded' {
  const cbEnabled = process.env.RL_CB_ENABLE === '1';
  const hasSecret = Boolean(process.env.PRINCIPAL_HMAC_SECRET_ACTIVE || process.env.PRINCIPAL_HMAC_SECRET);
  
  if (cbEnabled && !hasSecret) {
    return 'degraded';
  }
  
  return hasSecret ? 'fallback' : 'degraded';
}

/**
 * Get principal extraction stats for health endpoint
 */
export function getPrincipalExtractionStats() {
  const trustProxy = process.env.TRUST_PROXY === '1';
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? '1');
  
  return {
    enabled: isPrincipalExtractionEnabled(),
    trust_proxy: trustProxy,
    hops: hops,
    mode: getPrincipalExtractionMode(),
    // P0-2: Expose rotation state
    secrets: {
      active: Boolean(process.env.PRINCIPAL_HMAC_SECRET_ACTIVE || process.env.PRINCIPAL_HMAC_SECRET),
      staged: Boolean(process.env.PRINCIPAL_HMAC_SECRET_STAGED),
    },
  };
}

/**
 * P0-2: Sign principal fingerprint (generation - uses ACTIVE only)
 */
export function signPrincipalFingerprint(fingerprint: string): string {
  const secret = process.env.PRINCIPAL_HMAC_SECRET_ACTIVE || process.env.PRINCIPAL_HMAC_SECRET;
  if (!secret) throw new Error('No PRINCIPAL_HMAC_SECRET configured');
  return hmacHex(secret, fingerprint);
}

/**
 * P0-2: Verify principal signature (verification - tries ACTIVE then STAGED)
 */
export function verifyPrincipalSignature(fingerprint: string, signature: string): boolean {
  const active = process.env.PRINCIPAL_HMAC_SECRET_ACTIVE || process.env.PRINCIPAL_HMAC_SECRET;
  const staged = process.env.PRINCIPAL_HMAC_SECRET_STAGED;
  
  if (!active) return false;
  
  // Try ACTIVE first
  const expActive = hmacHex(active, fingerprint);
  if (safeEq(signature, expActive)) {
    incPrincipalSecretFallback('active');
    return true;
  }
  
  // Then STAGED (if present)
  if (staged) {
    const expStaged = hmacHex(staged, fingerprint);
    if (safeEq(signature, expStaged)) {
      incPrincipalSecretFallback('staged');
      return true;
    }
  }
  
  return false;
}

function safeEq(aHex: string, bHex: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex'));
  } catch {
    return false;
  }
}
