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
 * Routes whose published estimate was PLACEHOLDER ARITHMETIC over the request
 * inputs — no model was ever evaluated (`/v1/counterfactual`, ROADMAP 2.105).
 *
 * Distinct from FABRICATED_NUMERICS_REASON: those routes derived numbers from
 * the seed and array position, so the output at least varied with something.
 * Here the estimate was a fixed multiple of two request fields, with the graph
 * never read — and it shipped under a model card asserting ceteris paribus and
 * no spillover, plus a confidence badge built from hard-coded `identifiable`
 * and `in_linear_range` literals. The numbers were placeholders; the
 * credibility around them was not labelled as one.
 */
export const PLACEHOLDER_ESTIMATE_REASON =
  'route published placeholder arithmetic over request inputs, not a computed estimate — no model was evaluated and the graph was never read; see ROADMAP 2.105';

/**
 * Body-size ceiling for a withdrawn route, in bytes.
 *
 * WHY A WITHDRAWN ROUTE NEEDS ITS OWN LIMIT (efficiency review, 2026-07-30).
 * All ten withdrawn routes registered with NO route options, so the
 * server-wide `bodyLimit` (128KB) applied to every one of them. That is pure
 * waste on a path that reads no body at all: Fastify parses the ENTIRE payload
 * before any `preHandler` runs, so each spammed 128KB request cost roughly
 * 505µs of parsing and ~131KB of garbage to produce a response whose content
 * does not depend on a single byte of it.
 *
 * AND THE RATE LIMITER CANNOT SHIELD IT. The limiter is a `preHandler`, so its
 * 429 is decided AFTER the parse has already happened — the cost is paid before
 * the request can be rejected. A route-level limit is the only control that
 * acts at the parser, which is where the cost is. This is the same posture the
 * live routes already take (`/v1/diff`, `/v1/critique`: `bodyLimit: 64 * 1024`);
 * withdrawn routes can be far tighter because they read nothing.
 *
 * WHY 1KB RATHER THAN 0. A withdrawn route should still answer its typed 501 to
 * an ordinary, well-formed probe — that refusal, and the caller telemetry it
 * records, is the entire reason the path is still mounted. 1KB admits a normal
 * probe and turns a spammed oversized body into a cheap 413 at the parser.
 *
 * A CONSEQUENCE WORTH KNOWING: above this limit a withdrawn route answers 413,
 * not the 501 refusal, and `recordRefusal` does NOT run for it — the request
 * never reaches the handler. That is the correct trade (the caller learns the
 * body was rejected, and an oversized body is not a capability probe), but it
 * does mean the refusal counters undercount abusive traffic by construction.
 * Pinned by the bodyLimit block in tests/analysis-routes.refusal.test.ts.
 */
export const WITHDRAWN_ROUTE_BODY_LIMIT_BYTES = 1024;

/**
 * Shared Fastify route options for every withdrawn route.
 *
 * ONE object, ten registrations — deliberately not ten copies of the same
 * literal. A hand-repeated limit is a mirror that drifts the moment one route is
 * edited; importing a single const means the value cannot disagree with itself,
 * and the test can assert against the same const rather than a copy of it.
 */
export const WITHDRAWN_ROUTE_OPTIONS = {
  bodyLimit: WITHDRAWN_ROUTE_BODY_LIMIT_BYTES,
} as const;

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
