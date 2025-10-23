/**
 * error.v1 — Canonical error envelope
 * Closed error taxonomy with machine-usable fields
 */

export type ErrorCode =
  | 'BAD_INPUT'
  | 'LIMIT_EXCEEDED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'SERVER_ERROR';

export interface ErrorV1 {
  schema: 'error.v1';
  code: ErrorCode;
  error: string;
  hint?: string;
  fields?: Record<string, any>;
  retry_after?: number; // seconds, clamped 1-60, only for RATE_LIMITED
}

export function clampRetryAfter(seconds: number): number {
  return Math.max(1, Math.min(60, Math.floor(seconds)));
}

export function rateLimitedError(message: string, retryAfterSeconds: number = 10, hint?: string): ErrorV1 {
  const clamped = clampRetryAfter(retryAfterSeconds);
  return {
    schema: 'error.v1',
    code: 'RATE_LIMITED',
    error: message,
    hint: hint || `Please retry after ${clamped} seconds.`,
    retry_after: clamped
  };
}

export function limitExceededError(
  field: 'graph.nodes' | 'graph.edges',
  max: number,
  message?: string,
  hint?: string
): ErrorV1 {
  return {
    schema: 'error.v1',
    code: 'LIMIT_EXCEEDED',
    error: message || `Limit exceeded for ${field}.`,
    hint: hint || `Please reduce the number of ${field.split('.')[1]} to ${max} or fewer.`,
    fields: { field, max }
  };
}

export function badInputError(message: string, hint?: string, fields?: Record<string, any>): ErrorV1 {
  return {
    schema: 'error.v1',
    code: 'BAD_INPUT',
    error: message,
    hint,
    fields
  };
}

export function unauthorizedError(message: string = 'Unauthorized', hint?: string): ErrorV1 {
  return {
    schema: 'error.v1',
    code: 'UNAUTHORIZED',
    error: message,
    hint
  };
}

export function serverError(message: string = 'Something went wrong', hint?: string): ErrorV1 {
  return {
    schema: 'error.v1',
    code: 'SERVER_ERROR',
    error: message,
    hint
  };
}

export function errorCodeToStatus(code: ErrorCode): number {
  switch (code) {
    case 'BAD_INPUT': return 400;
    case 'LIMIT_EXCEEDED': return 400;
    case 'RATE_LIMITED': return 429;
    case 'UNAUTHORIZED': return 401;
    case 'SERVER_ERROR': return 500;
    default: return 500;
  }
}

type ReplyLike = { 
  code: (n: number) => any; 
  header: (name: string, value: string | number) => any;
  request?: any; 
  send: (payload: any) => any 
};

export function replyWithError(reply: ReplyLike, err: ErrorV1) {
  const status = errorCodeToStatus(err.code);
  reply.code(status);
  
  // Add Retry-After header for RATE_LIMITED
  if (err.code === 'RATE_LIMITED' && err.retry_after) {
    reply.header('Retry-After', err.retry_after);
    // Optional X-RateLimit-Reset (epoch seconds)
    const resetEpoch = Math.floor(Date.now() / 1000) + err.retry_after;
    reply.header('X-RateLimit-Reset', resetEpoch);
  }
  
  return reply.send(err);
}

// Legacy compatibility layer (for gradual migration)
export type ErrorType = ErrorCode;
export interface ApiError { error: { type: ErrorType; message: string; hint?: string; fields?: Record<string, any>; retry_after?: number } }
export function errorResponse(type: ErrorType, message: string, hint?: string, fields?: Record<string, any>): any {
  return { error: message };
}
export function errorTypeToStatus(type: ErrorType): number { return errorCodeToStatus(type); }

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
  return reply.code(args.statusCode).send(errorResponse(args.type, publicMessage, args.hint, args.fields));
}
