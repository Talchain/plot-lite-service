// A2: Closed error taxonomy (machine-checkable)
export type ErrorType =
  | 'BAD_INPUT'
  | 'LIMIT_EXCEEDED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'SERVER_ERROR';

export interface ApiError {
  error: {
    type: ErrorType;
    message: string;
    hint?: string;
    fields?: Record<string, any>;
    retry_after?: number;  // For RATE_LIMITED (seconds, clamped 1-60)
  };
}

export function errorResponse(type: ErrorType, message: string, hint?: string, fields?: Record<string, any>): any {
  // Return message as top-level error for backward compat with tests
  return { error: message };
}

export function errorTypeToStatus(type: ErrorType): number {
  switch (type) {
    case 'BAD_INPUT': return 400;
    case 'LIMIT_EXCEEDED': return 400;
    case 'RATE_LIMITED': return 429;
    case 'UNAUTHORIZED': return 401;
    case 'SERVER_ERROR':
    default: return 500;
  }
}

// A2: Clamp retry_after to 1-60 seconds
export function clampRetryAfter(seconds: number): number {
  return Math.max(1, Math.min(60, Math.floor(seconds)));
}

// Helper for RATE_LIMITED errors with retry_after
export function rateLimitedError(message: string, retryAfterSeconds: number = 10): ApiError {
  const clamped = clampRetryAfter(retryAfterSeconds);
  return {
    error: {
      type: 'RATE_LIMITED',
      message,
      hint: `Please retry after ${clamped} seconds`,
      retry_after: clamped
    }
  };
}

// Helper for LIMIT_EXCEEDED errors with field and max
export function limitExceededError(field: string, max: number, message?: string): ApiError {
  return {
    error: {
      type: 'LIMIT_EXCEEDED',
      message: message || `Limit exceeded for ${field}`,
      fields: { field, max }
    }
  };
}

// Normalised public error helper — preserves existing { error: {...} } shape
import { toPublicError } from './lib/error-normaliser.js';

type ReplyLike = { code: (n: number) => any; request?: any; send: (payload: any) => any };

export interface ReplyAppErrorArgs {
  type: ErrorType;
  statusCode: number;
  key?: string;            // optional catalogue key for specific phrases
  message?: string;        // optional explicit message to preserve legacy wording for non-catalogue cases
  hint?: string;           // existing optional hint (unchanged)
  fields?: Record<string, any>; // existing optional fields (unchanged)
  devDetail?: unknown;     // internal-only detail for logs in non-prod
  retryable?: boolean;
  code?: string | number;
}

export function replyWithAppError(reply: ReplyLike, args: ReplyAppErrorArgs) {
  try {
    if (process.env.NODE_ENV !== 'production') {
      const req = (reply as any)?.request;
      req?.log?.debug?.({ type: args.type, statusCode: args.statusCode, devDetail: args.devDetail }, 'validation detail (dev only)');
    }
  } catch {}

  const publicMessage = ((): string => {
    if (args.message) return args.message;
    const pub = toPublicError({ type: args.type, http: args.statusCode, key: args.key, retryable: args.retryable, code: args.code });
    return pub.message;
  })();

  return reply.code(args.statusCode).send(
    errorResponse(args.type, publicMessage, args.hint, args.fields)
  );
}
