/**
 * Payload scrubbing utility to redact sensitive information from payloads
 * before logging or storing for debugging purposes.
 */

// Common patterns for credential keys
const CREDENTIAL_PATTERNS = [
  /^(api[_-]?key|apikey)$/i,
  /^(secret|password|passwd|pwd)$/i,
  /^(auth|authorization|bearer)$/i,
  /^(token|access[_-]?token|refresh[_-]?token)$/i,
  /^(private[_-]?key|priv[_-]?key)$/i,
  /^(cert|certificate)$/i,
  /^(credentials?|creds?)$/i,
  /^(session[_-]?id|sessionid)$/i,
  /.*(key|secret|password|token|auth|credential).*$/i,
];

// Value patterns that look like credentials
const VALUE_PATTERNS = [
  /^sk-[a-zA-Z0-9]+$/, // OpenAI API keys
  /^Bearer\s+/i, // Bearer tokens
  /^[A-Za-z0-9+/]{20,}={0,2}$/, // Base64 encoded strings (20+ chars)
  /^[a-f0-9]{32,}$/i, // Hex strings (32+ chars)
  /^[A-Z0-9]{20,}$/i, // All caps alphanumeric (20+ chars)
];

const REDACTED_VALUE = '[REDACTED]';

export interface ScrubOptions {
  /** Maximum depth to traverse when scrubbing nested objects */
  maxDepth?: number;
  /** Custom patterns to match credential keys */
  customKeyPatterns?: RegExp[];
  /** Custom patterns to match credential values */
  customValuePatterns?: RegExp[];
  /** Whether to scrub based on value patterns (default: true) */
  scrubByValue?: boolean;
}

/**
 * Recursively scrub sensitive data from an object or array
 */
export function scrubPayload(payload: unknown, options: ScrubOptions = {}): unknown {
  const {
    maxDepth = 10,
    customKeyPatterns = [],
    customValuePatterns = [],
    scrubByValue = true,
  } = options;

  const keyPatterns = [...CREDENTIAL_PATTERNS, ...customKeyPatterns];
  const valuePatterns = [...VALUE_PATTERNS, ...customValuePatterns];

  function scrubRecursive(obj: unknown, depth: number): unknown {
    // Prevent infinite recursion
    if (depth > maxDepth) {
      return '[MAX_DEPTH_EXCEEDED]';
    }

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => scrubRecursive(item, depth + 1));
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(obj)) {
        // Check if key matches credential patterns
        const isCredentialKey = keyPatterns.some(pattern => pattern.test(key));

        if (isCredentialKey) {
          result[key] = REDACTED_VALUE;
        } else if (typeof value === 'string' && scrubByValue) {
          // Check if value looks like a credential
          const isCredentialValue = valuePatterns.some(pattern => pattern.test(value));
          result[key] = isCredentialValue ? REDACTED_VALUE : value;
        } else {
          result[key] = scrubRecursive(value, depth + 1);
        }
      }

      return result;
    }

    // For primitive values, check if they look like credentials
    if (typeof obj === 'string' && scrubByValue) {
      const isCredentialValue = valuePatterns.some(pattern => pattern.test(obj));
      return isCredentialValue ? REDACTED_VALUE : obj;
    }

    return obj;
  }

  return scrubRecursive(payload, 0);
}

/**
 * Create a scrubbed version of a payload for safe logging
 */
export function createLoggablePayload(payload: unknown, options?: ScrubOptions): string {
  try {
    const scrubbed = scrubPayload(payload, options);
    return JSON.stringify(scrubbed, null, 2);
  } catch (error) {
    return `[PAYLOAD_SCRUB_ERROR: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

/**
 * Check if a key name appears to contain sensitive information
 */
export function isCredentialKey(key: string): boolean {
  return CREDENTIAL_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Check if a value appears to be a credential
 */
export function isCredentialValue(value: string): boolean {
  return VALUE_PATTERNS.some(pattern => pattern.test(value));
}