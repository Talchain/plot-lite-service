export type ErrorType =
  // NEW (A2)
  | 'BAD_INPUT'
  | 'LIMIT_EXCEEDED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'SERVER_ERROR'
  // OLD (temporary, deprecated)
  | 'TIMEOUT'
  | 'BLOCKED_CONTENT'
  | 'RETRYABLE'
  | 'INTERNAL'
  | 'RATE_LIMIT'
  | 'BREAKER_OPEN';

export interface ApiError {
  error: {
    type: ErrorType;
    message: string;
    hint?: string;
    fields?: Record<string, any>;
    retry_after?: number;
  };
}

export function errorResponse(type: ErrorType, message: string, hint?: string, fields?: Record<string, any>): any {
  return { error: message };
}

export function errorTypeToStatus(type: ErrorType): number {
  switch (type) {
    // New
    case 'BAD_INPUT': return 400;
    case 'LIMIT_EXCEEDED': return 400;
    case 'RATE_LIMITED': return 429;
    case 'UNAUTHORIZED': return 401;
    case 'SERVER_ERROR': return 500;
    // Legacy
    case 'TIMEOUT': return 504;
    case 'RETRYABLE': return 503;
    case 'RATE_LIMIT': return 429;
    case 'BREAKER_OPEN': return 503;
    case 'BLOCKED_CONTENT': return 401;
    case 'INTERNAL': return 500;
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

  const publicMessage = args.message || 'Something went wrong';

  return reply.code(args.statusCode).send(
    errorResponse(args.type, publicMessage, args.hint, args.fields)
  );
}
