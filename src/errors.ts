// A2: Closed error taxonomy
import { toPublicError } from './lib/error-normaliser.js';

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

export function clampRetryAfter(seconds: number): number {
  return Math.max(1, Math.min(60, Math.floor(seconds)));
}

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

export function limitExceededError(field: string, max: number, message?: string): ApiError {
  return {
    error: {
      type: 'LIMIT_EXCEEDED',
      message: message || `Limit exceeded for ${field}`,
      fields: { field, max }
    }
  };
}

type ReplyLike = { code: (n: number) => any; request?: any; send: (payload: any) => any };

export interface ReplyAppErrorArgs {
  type: ErrorType;
  statusCode: number;
  key?: string;
  message?: string;
  hint?: string;
  fields?: Record<string, any>;
  devDetail?: unknown;
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
