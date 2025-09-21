export type ErrorType = 'BAD_INPUT' | 'TIMEOUT' | 'BLOCKED_CONTENT' | 'RETRYABLE' | 'INTERNAL';

export interface ApiError {
  error: {
    type: ErrorType;
    message: string;
    hint?: string;
  };
}

export function errorResponse(type: ErrorType, message: string, hint?: string): ApiError {
  return { error: { type, message, hint } };
}