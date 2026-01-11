/**
 * Consolidated Auth Guard Middleware
 *
 * Single source of truth for authentication across all routes.
 * Replaces both v1AuthGuard and checkAuth implementations.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { replyWithAppError } from '../errors.js';
import { isDemoMode } from './demo-mode.js';

export interface AuthGuardOptions {
  /** Allow demo mode bypass (for SSE streaming routes) */
  allowDemoBypass?: boolean;
  /** Skip auth check entirely (for health checks, public endpoints) */
  skipAuth?: boolean;
}

/**
 * Check if auth is globally enabled
 */
export function isAuthEnabled(): boolean {
  return process.env.AUTH_ENABLED === '1';
}

/**
 * Consolidated auth guard for all routes.
 *
 * Returns `true` if request is authorized (or auth disabled/bypassed).
 * Returns `false` and sends error response if unauthorized.
 *
 * @example
 * // In a route handler
 * if (!(await authGuard(req, reply))) return;
 *
 * @example
 * // With demo bypass for streaming routes
 * if (!(await authGuard(req, reply, { allowDemoBypass: true }))) return;
 *
 * @example
 * // Skip auth for public endpoints
 * if (!(await authGuard(req, reply, { skipAuth: true }))) return;
 */
export async function authGuard(
  req: FastifyRequest,
  reply: FastifyReply,
  options: AuthGuardOptions = {}
): Promise<boolean> {
  // Skip auth if not enabled globally
  if (!isAuthEnabled()) {
    return true;
  }

  // Skip auth if explicitly requested (health checks, etc.)
  if (options.skipAuth) {
    return true;
  }

  // Demo mode bypass (opt-in per route)
  if (options.allowDemoBypass && isDemoMode(req)) {
    return true;
  }

  // Get authorization header
  const headers = req.headers || {};
  const authHeader = String(headers.authorization || headers.Authorization || '');
  const expectedToken = String(process.env.AUTH_TOKEN || '').trim();

  // Check for Bearer token
  if (!authHeader.startsWith('Bearer ')) {
    try {
      reply.header('WWW-Authenticate', 'Bearer');
    } catch (err) {
      req.log?.error?.({
        evt: 'auth_header_failed',
        reqId: req.id,
        header: 'WWW-Authenticate',
        error: err instanceof Error ? err.message : String(err),
      }, 'Failed to set WWW-Authenticate header on 401 response');
    }

    await replyWithAppError(reply, {
      type: 'BAD_INPUT',
      statusCode: 401,
      message: 'Missing bearer token',
      fields: { code: 'UNAUTHORIZED' },
    });
    return false;
  }

  // Extract and validate token
  const providedToken = authHeader.slice('Bearer '.length).trim();

  // Check token length first (prevent timing attacks)
  if (!expectedToken || providedToken.length !== expectedToken.length) {
    await replyWithAppError(reply, {
      type: 'BAD_INPUT',
      statusCode: 403,
      message: 'Invalid token',
      fields: { code: 'FORBIDDEN' },
    });
    return false;
  }

  // Timing-safe comparison
  if (!timingSafeEqual(Buffer.from(providedToken), Buffer.from(expectedToken))) {
    await replyWithAppError(reply, {
      type: 'BAD_INPUT',
      statusCode: 403,
      message: 'Invalid token',
      fields: { code: 'FORBIDDEN' },
    });
    return false;
  }

  return true;
}

/**
 * Fastify preHandler hook for auth.
 * Use this to protect route prefixes.
 *
 * @example
 * app.addHook('preHandler', createAuthPreHandler({ allowDemoBypass: true }));
 */
export function createAuthPreHandler(options: AuthGuardOptions = {}) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const authorized = await authGuard(req, reply, options);
    // P1 fix: Return early if auth failed (response already sent)
    // This prevents route handler from executing after auth rejection
    if (!authorized) {
      return reply;
    }
  };
}
