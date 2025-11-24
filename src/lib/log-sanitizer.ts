/**
 * Log sanitization utilities for PII/secret protection
 * Ensures URLs, query parameters, and bodies are safely logged without exposing sensitive data
 */

/**
 * Sanitize a URL by:
 * - Truncating to maxLength
 * - Removing query parameters (they may contain tokens/keys)
 * - Preserving path for debugging
 */
export function sanitizeUrl(url: string, maxLength = 100): string {
  if (!url) return '';

  try {
    // Parse URL and strip query/hash
    const parsed = new URL(url, 'http://localhost');
    const sanitized = parsed.pathname;

    // Truncate if needed
    return sanitized.length > maxLength
      ? sanitized.slice(0, maxLength) + '...'
      : sanitized;
  } catch {
    // If URL parsing fails, just truncate the string
    const truncated = url.slice(0, maxLength);
    return truncated.length < url.length ? truncated + '...' : truncated;
  }
}

/**
 * Sanitize query parameters by masking sensitive-looking values
 * Preserves keys for debugging, masks values that look like secrets
 */
export function sanitizeQueryParams(params: Record<string, any>): Record<string, string> {
  const result: Record<string, string> = {};

  // Patterns that indicate sensitive data
  const sensitiveKeys = /^(token|key|secret|password|auth(orization)?|bearer|api[-_]?key|access[-_]?token)$/i;
  // Long alphanumeric with variety (not just repeated chars)
  const looksLikeSensitive = (str: string) => {
    if (str.length < 20) return false;
    // Must have variety: check if >90% of chars are the same
    const charCounts = new Map<string, number>();
    for (const char of str) {
      charCounts.set(char, (charCounts.get(char) || 0) + 1);
    }
    const maxRepeat = Math.max(...charCounts.values());
    return maxRepeat / str.length < 0.9 && /^[A-Za-z0-9_\-+/=]+$/.test(str);
  };

  for (const [key, value] of Object.entries(params)) {
    const strValue = String(value);

    // Mask if key name is sensitive OR value looks like a secret
    if (sensitiveKeys.test(key) || looksLikeSensitive(strValue)) {
      result[key] = '[REDACTED]';
    } else {
      // Truncate long values to prevent log spam
      result[key] = strValue.length > 100
        ? strValue.slice(0, 100) + '...'
        : strValue;
    }
  }

  return result;
}

/**
 * Sanitize request body for logging (for rare error scenarios only)
 * Returns metadata only - never log actual content
 */
export function sanitizeBody(body: any): {
  type: string;
  size: number;
  hasKeys?: string[];
} {
  if (!body) {
    return { type: 'null', size: 0 };
  }

  const type = Array.isArray(body) ? 'array' : typeof body;

  if (type === 'object') {
    const keys = Object.keys(body);
    return {
      type: 'object',
      size: keys.length,
      hasKeys: keys.slice(0, 5) // Only first 5 keys
    };
  }

  if (type === 'string') {
    return {
      type: 'string',
      size: (body as string).length
    };
  }

  return {
    type,
    size: JSON.stringify(body).length
  };
}
