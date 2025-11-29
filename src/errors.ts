export type ErrorType =
  | 'BAD_INPUT'
  | 'TIMEOUT'
  | 'BLOCKED_CONTENT'
  | 'RETRYABLE'
  | 'INTERNAL'
  | 'RATE_LIMIT'
  | 'BREAKER_OPEN';

export interface OlumiErrorV1 {
  code: string;
  message: string;
  reason?: string;
  recovery?: {
    hints: string[];
    suggestion: string;
    example?: string;
  };
  retryable: boolean;
  source: string;
  request_id: string;
  degraded?: boolean;
  [key: string]: any;
}

export interface ApiError {
  error: {
    type: ErrorType;
    message: string;
    hint?: string;
    fields?: Record<string, any>;
  };
}

export function errorResponse(type: ErrorType, message: string, hint?: string, fields?: Record<string, any>, request_id?: string): any {
  // P1C-3C: Return error.v1 envelope with legacy back-compat shim
  const baseRetryable =
    type === 'TIMEOUT' ||
    type === 'RETRYABLE' ||
    type === 'RATE_LIMIT' ||
    type === 'BREAKER_OPEN' ||
    type === 'INTERNAL';
  const explicitRetryable = fields && typeof (fields as any).retryable === 'boolean'
    ? Boolean((fields as any).retryable)
    : undefined;
  const retryable = explicitRetryable !== undefined ? explicitRetryable : baseRetryable;
  const requestId = request_id || (fields as any)?.request_id || '';

  const olumi: OlumiErrorV1 = {
    code: String((fields as any)?.code || type),
    message,
    ...(fields && typeof (fields as any).reason === 'string' ? { reason: (fields as any).reason } : {}),
    ...(fields && (fields as any).recovery ? { recovery: (fields as any).recovery } : {}),
    retryable,
    source: 'plot',
    request_id: String(requestId),
    degraded: (fields as any)?.degraded === true,
  };

  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (!(k in olumi)) {
        (olumi as any)[k] = v;
      }
    }
  }

  const envelope: any = {
    schema: 'error.v1',
    ...olumi,
  };

  const legacyError: any = { type, message };
  if (hint) legacyError.hint = hint;
  if (fields) legacyError.fields = fields;
  envelope.error = legacyError;

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
  // P1.2: Extract request_id for tracing
  let request_id: string | undefined;
  try {
    const req = (reply as any)?.request;
    request_id = req?.id;
    if (process.env.NODE_ENV !== 'production') {
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
    errorResponse(args.type, publicMessage, args.hint, args.fields, request_id)
  );
}
