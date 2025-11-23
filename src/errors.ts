export type ErrorType =
  | 'BAD_INPUT'
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
  };
}

export function errorResponse(type: ErrorType, message: string, hint?: string, fields?: Record<string, any>): any {
  // P1C-3C: Return error.v1 envelope with legacy back-compat shim
  const envelope: any = {
    schema: 'error.v1',
    code: type,
    message,
  };
  if (hint) envelope.hint = hint;
  
  // Spread additional fields at top level (e.g., field, path from validation)
  if (fields) {
    Object.assign(envelope, fields);
  }
  
  // Legacy back-compat: also include top-level { error: { type, message } } for old tests
  envelope.error = { type, message };
  if (hint) envelope.error.hint = hint;
  if (fields) envelope.error.fields = fields;
  
  return envelope;
}

export function errorTypeToStatus(type: ErrorType): number {
  switch (type) {
    case 'BAD_INPUT': return 400;
    case 'TIMEOUT': return 504;
    case 'RETRYABLE': return 503;
    case 'RATE_LIMIT': return 429;
    case 'BREAKER_OPEN': return 503;
    case 'INTERNAL':
    default: return 500;
  }
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
  } catch (err) {
    console.warn('[errors] Failed to log debug validation detail:', err);
  }

  const publicMessage = ((): string => {
    if (args.message) return args.message;
    const pub = toPublicError({ type: args.type, http: args.statusCode, key: args.key, retryable: args.retryable, code: args.code });
    return pub.message;
  })();

  return reply.code(args.statusCode).send(
    errorResponse(args.type, publicMessage, args.hint, args.fields)
  );
}
