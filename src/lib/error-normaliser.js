// src/lib/error-normaliser.ts
import { msg } from './error-messages.js';
export function toPublicError(input) {
    const { type, http, key, retryable, code } = input;
    // Prefer explicit mapping if key provided by the caller
    if (key)
        return { type, message: msg(key), retryable, code };
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
