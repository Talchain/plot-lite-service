// src/lib/error-normaliser.ts
import { msg } from './error-messages.js';

export interface PublicError {
  type: string;              // taxonomy code (unchanged)
  message: string;           // legacy public phrase
  retryable?: boolean;       // pass-through if already present
  code?: string | number;    // pass-through if already present
}

interface NormaliserInput {
  type: string;              // taxonomy code e.g. BAD_INPUT, RATE_LIMIT
  http: number;              // status code (unchanged)
  devDetail?: unknown;       // internal details (schema paths, etc.)
  key?: string;              // optional specific catalogue key
  retryable?: boolean;
  code?: string | number;
}

export function toPublicError(input: NormaliserInput): PublicError {
  const { type, http, key, retryable, code } = input;

  // Prefer explicit mapping if key provided by the caller
  if (key) return { type, message: msg(key as any), retryable, code };

  switch (type) {
    case 'BAD_INPUT':
      // Fallback to generic legacy phrase unless the caller provides a specific key.
      return { type, message: msg('BAD_INPUT_SCHEMA'), retryable, code };

    case 'RETRYABLE':
      return { type, message: msg('RETRYABLE_UPSTREAM'), retryable: true, code };

    case 'RATE_LIMIT':
      return { type, message: msg('RATE_LIMIT_RPM'), retryable: true, code };

    case 'TIMEOUT':
      return { type, message: msg('TIMEOUT_UPSTREAM'), retryable: true, code };

    case 'BREAKER_OPEN':
      return { type, message: msg('BREAKER_OPEN'), retryable: true, code };

    case 'INTERNAL':
      return { type, message: msg('INTERNAL_UNEXPECTED'), retryable, code };

    default:
      // Preserve unknown types but don’t leak internal details
      return { type, message: msg('INTERNAL_UNEXPECTED'), retryable, code };
  }
}
