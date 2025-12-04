/**
 * Network utilities - IPv6 canonicalization for rate limiting
 * C2: Prevent bypass via mixed IPv6 forms
 */

/**
 * Canonicalize IP address to prevent mixed-form bypass
 * - IPv4-mapped IPv6 (::ffff:a.b.c.d) → a.b.c.d
 * - Normalize IPv6 compression
 * - Fallback to original on parse failure
 */
export function canonicalizeRemote(remote: string): string {
  if (!remote) return 'unknown';
  
  const trimmed = remote.trim();
  
  // IPv4-mapped IPv6: ::ffff:192.0.2.1 → 192.0.2.1
  const ipv4MappedPattern = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
  const match = trimmed.match(ipv4MappedPattern);
  if (match) {
    return match[1];
  }
  
  // Try IPv6 normalization
  try {
    if (trimmed.includes(':')) {
      return normalizeIPv6(trimmed);
    }
  } catch {
    // Fallback to original on parse failure
  }
  
  return trimmed;
}

/**
 * Normalize IPv6 address to canonical form
 * Expands :: and lowercases hex digits
 */
function normalizeIPv6(addr: string): string {
  // Remove brackets if present
  const clean = addr.replace(/^\[|\]$/g, '');
  
  // Split by `::`
  const parts = clean.split('::');
  if (parts.length > 2) {
    throw new Error('Invalid IPv6: multiple ::');
  }
  
  if (parts.length === 2) {
    // Expand ::
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    const expanded = [...left, ...Array(missing).fill('0'), ...right];
    return expanded.map(p => p.padStart(4, '0')).join(':').toLowerCase();
  }
  
  // No compression
  const segments = clean.split(':');
  if (segments.length !== 8) {
    throw new Error('Invalid IPv6: wrong segment count');
  }
  
  return segments.map(p => p.padStart(4, '0')).join(':').toLowerCase();
}
