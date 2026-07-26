/**
 * Instrumented typed refusal for routes that cannot compute what they claim.
 *
 * A route reaches this helper when its published numbers were shown not to be
 * derived from the request — either because they could not discriminate
 * between the options being compared (the seven `/v1/analysis/*` routes ruled
 * VACUOUS by the authenticity matrix of 2026-07-26) or because they were a
 * closed-form function of the seed and array position (`/v1/sensitivity`,
 * `/v1/score`, per the numerics science review of the same date).
 *
 * WHY REFUSE RATHER THAN DELETE
 * -----------------------------
 * Deleting the route would answer 404, which is indistinguishable from a typo
 * and tells an integrator nothing. A typed 501 says: this capability existed,
 * it was withdrawn, here is why, and retrying will not help. It also keeps the
 * path mounted long enough to MEASURE who was calling it — which is the
 * evidence the deletion decision needs and which a 404 would destroy.
 *
 * WHY 501
 * -------
 * The server understood the request and is declining to implement it.
 * `retryable: false` — an identical retry produces an identical refusal.
 *
 * The refusal is unconditional and happens BEFORE any request validation. That
 * is deliberate: no input is "valid" for a capability that does not exist, and
 * returning 400 for a malformed body would imply that a well-formed one would
 * have been answered.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { callerClass, recordRefusal } from '../../observability/routeCallerTelemetry.js';

/** Wire code for every withdrawn-capability refusal. */
export const ANALYSIS_UNAVAILABLE = 'ANALYSIS_UNAVAILABLE';

/** The seven routes whose option dimension was provably inert. */
export const VACUOUS_ANALYSIS_REASON =
  'route computed no option-discriminating output; see authenticity matrix 2026-07-26';

/** Routes whose numbers were a closed-form function of the seed and array index. */
export const FABRICATED_NUMERICS_REASON =
  'route published seed-derived numerics not computed from the request graph; see numerics science review 2026-07-26';

/**
 * Refuse, and record who asked.
 *
 * Instrumentation is the point of keeping the route mounted, so it happens
 * first and unconditionally. The caller class is derived by the SAME function
 * the request counters use, so a log line and a counter can be joined without
 * a second derivation that might drift. It contains no secret: an API key is
 * represented by a one-way digest, never its value.
 */
export function refuseUnavailable(
  req: FastifyRequest,
  reply: FastifyReply,
  route: string,
  reason: string
) {
  const caller = callerClass(req as unknown as { headers?: Record<string, unknown> });

  try {
    recordRefusal(route);
  } catch { /* instrumentation must never break the refusal */ }

  req.log.warn(
    {
      evt: 'analysis_unavailable',
      id: String(req.id),
      route,
      // Coarse caller identity: one-way key digest | origin | user-agent.
      // Never a token, never a body, never an IP.
      caller_class: caller,
      code: ANALYSIS_UNAVAILABLE,
      reason,
      ts: new Date().toISOString(),
    },
    'refused: withdrawn analysis capability'
  );

  return replyWithAppError(reply, {
    type: 'INTERNAL',
    statusCode: 501,
    message: `${route} has been withdrawn: ${reason}`,
    fields: {
      code: ANALYSIS_UNAVAILABLE,
      reason,
      retryable: false,
    },
  });
}
