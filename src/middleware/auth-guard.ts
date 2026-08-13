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
import { getExpectedAuthToken, getStagedAuthToken } from '../config/auth-token.js';
import { incAuthTokenMatch } from '../observability/authTokenMetrics.js';

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
 * Scope flag extending the Bearer gate to /v2/* (ROADMAP 3.4 required-login,
 * PLoT service-tier half — see parallel-briefs/PLATFORM-LOGIN-AUDIT-2026-07-10.md).
 *
 * Default OFF (dark ship): /v2 stays ungated exactly as today. Enforcement
 * requires BOTH flags — AUTH_ENABLED is the global auth kill-switch,
 * AUTH_V2_ENABLED widens its scope to /v2. Flipped at required-login
 * rollout, together with the UI-side authenticated proxy for /v2 calls.
 */
export function isV2AuthEnabled(): boolean {
  return process.env.AUTH_V2_ENABLED === '1';
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
  // The ACTIVE secret: PLOT_AUTH_TOKEN (the caller-facing name every live caller
  // — CEE PLoTClient, the staging smoke + load-probe workflows — already sends,
  // and the only auth var provisioned on staging), resolved through one function
  // rather than a hand-maintained two-var mirror. Reached only after the
  // AUTH_ENABLED early-return above, so it stays inert until the auth flip.
  //
  // ⚠ It is no longer the ONLY accepted value: an optional STAGED secret is
  // accepted alongside it during a rotation (see below). This comment used to say
  // "single source of truth", which the code beneath it now contradicts — the
  // single source of truth is the RESOLVER, not the number of accepted secrets.
  const expectedToken = getExpectedAuthToken();

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

  // ── DUAL ACCEPTANCE: ACTIVE, then optional STAGED ────────────────────────
  //
  // ⚠ EACH CANDIDATE IS LENGTH-CHECKED AND COMPARED INDEPENDENTLY, AND BOTH ARE
  // EVALUATED UNCONDITIONALLY. Do not "simplify" this to `matches(active) ||
  // matches(staged)`, and do not hoist a single length check above the pair.
  //
  // The length test exists only because `timingSafeEqual` THROWS on unequal
  // lengths — it is a precondition, not a security check. With two candidates a
  // single hoisted length test (against ACTIVE) returns 403 before STAGED is ever
  // considered, which is wrong twice over:
  //
  //   1. FUNCTIONALLY — a staged token of a different length is rejected, so
  //      rotation fails for the exact case it exists to serve. A genuinely NEW
  //      secret will not share the old one's length.
  //   2. AS A DISCLOSURE — the work performed would vary with WHICH candidate the
  //      provided token matched on length, making the guard's behaviour a function
  //      of a property of the secrets. A rotation mechanism that leaks which of two
  //      secrets you hold is worse than the manual cutover it replaces.
  //
  // A `||` short-circuit has the same defect in the other direction: it skips the
  // second comparison whenever the first matches, so the work depends on which
  // secret was presented. Both are computed, then the outcome is chosen.
  //
  // Pinned by tests/auth.dual-acceptance.test.ts, whose staged fixture is
  // deliberately a DIFFERENT LENGTH from the active one — an equal-length fixture
  // would pass against the single-check version and prove nothing.
  const stagedToken = getStagedAuthToken();

  const activeMatch = tokenMatches(providedToken, expectedToken);
  const stagedMatch = tokenMatches(providedToken, stagedToken);

  if (activeMatch) {
    incAuthTokenMatch('active');
    return true;
  }
  if (stagedMatch) {
    // Still on the old secret's replacement path — the counter is what tells an
    // operator when ACTIVE has stopped being used and may safely be removed.
    incAuthTokenMatch('staged');
    return true;
  }

  await replyWithAppError(reply, {
    type: 'BAD_INPUT',
    statusCode: 403,
    message: 'Invalid token',
    fields: { code: 'FORBIDDEN' },
  });
  return false;
}

/**
 * Constant-shape comparison of one candidate.
 *
 * Returns false for an absent candidate (unset STAGED is the normal state) and for
 * a length mismatch — the latter because `timingSafeEqual` throws on unequal
 * lengths, so the check is a precondition of calling it, not a security decision.
 * Never throws, never logs, never returns anything derived from the secret.
 */
function tokenMatches(provided: string, candidate: string): boolean {
  if (!candidate) return false;
  if (provided.length !== candidate.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(candidate));
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
