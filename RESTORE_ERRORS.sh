#!/bin/bash
# Phase 0: Restore errors.ts
cat > src/errors.ts << 'EOF'
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
  return { error: message };
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

import { toPublicError } from './lib/error-normaliser.js';

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
EOF

# Restore routes
git checkout HEAD -- src/routes/v1/index.ts 2>/dev/null || true
git checkout HEAD -- src/routes/v1/stream.ts 2>/dev/null || true

# Build
npm run build

echo "✅ Phase 0 complete"
