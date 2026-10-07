/**
 * Sentry error reporting for PLoT — system S-H (observability).
 *
 * The contract every Olumi service holds (CEE, PLoT, ISL, UI):
 *   1. environment = SENTRY_ENVIRONMENT when set (blank = unset), else
 *      NODE_ENV. Production PLoT runs with NODE_ENV=staging, so without the
 *      override every production event would be labelled "staging".
 *   2. release = the full 40-char build SHA (util/build-id.ts getReleaseSha),
 *      never the package version.
 *   3. every event carries the tag service=plot.
 *   4. NO user decision content leaves the process:
 *      - request bodies are never read by the SDK (Http integration
 *        maxIncomingRequestBodySize 'none'), so they cannot ride on any event;
 *      - ONE filter (scrubSentryEvent) runs on errors AND transactions: it
 *        drops request body / cookies / query string, strips credential
 *        headers, strips queries everywhere (request url, referer,
 *        transaction / span names, url span attributes), cuts breadcrumbs to
 *        their shape (console crumbs dropped), treats extra and contexts as
 *        ALLOWLISTS, redacts decision-content keys in span data, and digests
 *        this request's registered decision tokens (labels, ids, values —
 *        logging/decision-tokens.ts, the log boundary's mechanism) in the
 *        message and exception text;
 *      - captureServerError digests the error's message and stack against the
 *        request's tokens SYNCHRONOUSLY, inside the request scope, before the
 *        SDK sees them.
 *
 * Off unless SENTRY_DSN is set. Errors only by default (tracing is opt-in via
 * SENTRY_TRACES_SAMPLE_RATE).
 */

import * as Sentry from '@sentry/node';
import type { Breadcrumb, Event as SentryEvent } from '@sentry/node';
import { getDecisionTokenScope, getScrubber } from '../logging/decision-tokens.js';
import { sha8 } from '../util/pii-redact.js';
import { getReleaseSha } from '../util/build-id.js';

export const SENTRY_SERVICE_TAG = 'plot';

/** Header-name fragments that mark a credential or session header. */
const SENSITIVE_HEADER_SNIPPETS = ['auth', 'key', 'token', 'secret', 'cookie', 'session', 'signature', 'password'];

/**
 * Key names whose values are decision content or payloads, wherever they sit
 * in extra / contexts. Substring match on the lower-cased key.
 */
const SENSITIVE_KEY_SNIPPETS = [
  'label', 'brief', 'prompt', 'message', 'statement', 'headline', 'goal',
  'graph', 'nodes', 'edges', 'payload', 'body', 'content', 'parse_text',
  'interventions', 'priors', 'token', 'secret', 'password', 'api_key', 'apikey',
];

const REDACTED = '[Redacted]';

/**
 * `extra` is an ALLOWLIST: PLoT sets no extra itself (captureServerError uses
 * tags), so every extra value is redacted; the key survives for diagnosis.
 */
const ALLOWED_EXTRA_KEYS: ReadonlySet<string> = new Set<string>();

/** Contexts the SDK fills with runtime facts; any context set by code is dropped. */
const ALLOWED_CONTEXTS: ReadonlySet<string> = new Set([
  'runtime', 'os', 'device', 'app', 'culture', 'cloud_resource', 'trace', 'response', 'otel',
]);

/** Span / trace attribute keys that ARE a query or fragment: dropped. */
const QUERY_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set(['http.query', 'url.query', 'http.fragment', 'url.fragment']);

/** Span / trace attribute keys holding a URL: kept with the query stripped. */
function isUrlAttributeKey(key: string): boolean {
  return key === 'url' || key === 'http.url' || key === 'url.full' || key === 'http.target' || key.endsWith('referer');
}

/** Remove every `?query` / `#fragment` run inside free text (span names). */
export function stripQueriesInText(text: string): string {
  return text.replace(/[?#]\S*/g, '');
}

/** The honest release when no build SHA is derivable. */
export const UNIDENTIFIED_RELEASE = 'unidentified';
const LONG_STRING = 200;
const MAX_DEPTH = 8;

let initialised = false;

function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_HEADER_SNIPPETS.some((s) => lower.includes(s));
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_SNIPPETS.some((s) => lower.includes(s));
}

function redactTree(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === 'string') return value.length > LONG_STRING ? REDACTED : value;
  if (Array.isArray(value)) return value.map((v) => redactTree(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redactTree(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** A URL with its query string and fragment removed (queries can carry content). */
function stripQuery(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * A breadcrumb keeps only its SHAPE, never free text: console crumbs are
 * dropped; every other crumb loses `message` and keeps only the HTTP data
 * shape { method, url (query stripped), status_code }.
 */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === 'console') return null;
  const out: Breadcrumb = { type: crumb.type, category: crumb.category, level: crumb.level, timestamp: crumb.timestamp };
  const data = crumb.data;
  if (data && typeof data === 'object') {
    const kept: Record<string, unknown> = {};
    if (typeof data.method === 'string') kept.method = data.method;
    if (data.url !== undefined) kept.url = stripQuery(data.url);
    if (typeof data.status_code === 'number') kept.status_code = data.status_code;
    out.data = kept;
  }
  return out;
}

/** Span / trace data: key-class redaction, query attributes dropped, URLs query-stripped. */
function scrubSpanData(data: Record<string, unknown>): Record<string, unknown> {
  const out = redactTree(data) as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (QUERY_ATTRIBUTE_KEYS.has(key)) delete out[key];
    else if (isUrlAttributeKey(key)) out[key] = stripQuery(out[key]);
  }
  return out;
}

/**
 * Digest this request's decision tokens inside `text`. Outside a request
 * scope (boot, tools) there are no tokens and the text is returned as is.
 */
function digestTokens(text: string): string {
  const scrub = getScrubber(sha8);
  return scrub ? scrub(text) : text;
}

/**
 * The single privacy filter for every PLoT event type. Mutates and returns the
 * event. Exported for tests.
 */
export function scrubSentryEvent<E extends SentryEvent>(input: E): E {
  const event: SentryEvent = input;

  if (event.request) {
    event.request.data = undefined;
    event.request.cookies = undefined;
    event.request.query_string = undefined;
    if (typeof event.request.url === 'string') event.request.url = stripQuery(event.request.url) as string;
    const headers = event.request.headers;
    if (headers) {
      for (const name of Object.keys(headers)) {
        if (isSensitiveHeader(name)) delete headers[name];
        else if (name.toLowerCase() === 'referer') headers[name] = stripQuery(headers[name]) as string;
      }
    }
  }
  if (typeof event.transaction === 'string') event.transaction = stripQueriesInText(event.transaction);

  if (event.extra) {
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(event.extra)) extra[k] = ALLOWED_EXTRA_KEYS.has(k) ? redactTree(v) : REDACTED;
    event.extra = extra;
  }

  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) {
      if (!ALLOWED_CONTEXTS.has(key) || isSensitiveKey(key)) delete event.contexts[key];
      else if (event.contexts[key] && typeof event.contexts[key] === 'object') {
        event.contexts[key] = redactTree(event.contexts[key]) as Record<string, unknown>;
      }
    }
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is Breadcrumb => b !== null);
  }

  if (event.contexts?.trace?.data) {
    event.contexts.trace.data = scrubSpanData(event.contexts.trace.data) as typeof event.contexts.trace.data;
  }
  for (const span of event.spans ?? []) {
    if (span.data) span.data = scrubSpanData(span.data) as typeof span.data;
    if (typeof span.description === 'string') span.description = stripQueriesInText(span.description);
  }

  // Token arm: when a request scope is live, digest registered decision
  // tokens in the remaining free text (message, exception values).
  // Same mechanism as the log boundary; no-op outside a scope.
  if (getDecisionTokenScope()) {
    if (typeof event.message === 'string') event.message = digestTokens(event.message);
    for (const ex of event.exception?.values ?? []) {
      if (typeof ex.value === 'string') ex.value = digestTokens(ex.value);
    }
  }

  return input;
}

/** SENTRY_ENVIRONMENT wins; blank counts as unset; else NODE_ENV. */
export function resolveSentryEnvironment(env: NodeJS.ProcessEnv): string {
  const explicit = env.SENTRY_ENVIRONMENT?.trim();
  if (explicit) return explicit;
  return env.NODE_ENV || 'development';
}

/** The options PLoT passes to Sentry.init. Exported for tests. */
export function buildSentryOptions(env: NodeJS.ProcessEnv): Sentry.NodeOptions {
  return {
    dsn: env.SENTRY_DSN,
    environment: resolveSentryEnvironment(env),
    // Never undefined: the SDK would then infer a release from SENTRY_RELEASE
    // or other env, which names something other than this build.
    release: getReleaseSha(env) ?? UNIDENTIFIED_RELEASE,
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE) || 0,
    sendDefaultPii: false,
    // Pinned, not defaulted: frame locals hold parsed graphs.
    includeLocalVariables: false,
    // Errors only: no auto-instrumentation, so do not install the ESM loader
    // hook (import-in-the-middle) over PLoT's many dynamic import() calls.
    registerEsmLoaderHooks: false,
    initialScope: { tags: { service: SENTRY_SERVICE_TAG } },
    // Replaces the default Http integration (same name): request bodies are
    // never read into the scope, so they cannot ride on any event type.
    integrations: [
      Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' }),
      // ONE capture path for server failures: the global error handler's 500
      // fallback (captureServerError). On Fastify 5 the SDK would otherwise
      // also capture every thrown route error from the diagnostics channel —
      // including ones PLoT's handler maps to a typed 4xx / 501 / 504.
      Sentry.fastifyIntegration({ shouldHandleError: () => false }),
    ],
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  };
}

/** Initialise Sentry. No-op (returns false) when SENTRY_DSN is not set. */
export function initSentry(
  env: NodeJS.ProcessEnv = process.env,
  testOverrides: Pick<Sentry.NodeOptions, 'transport'> = {},
): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({ ...buildSentryOptions(env), ...testOverrides });
  initialised = true;
  return true;
}

/**
 * Report an unexplained server failure (the 500 fallback of the global error
 * handler). Call INSIDE the request: the message and stack are digested
 * against this request's decision tokens before the SDK sees them.
 */
export function captureServerError(err: unknown, ctx: { route: string; requestId: string }): void {
  if (!initialised) return;
  const original = err instanceof Error ? err : new Error(String(err));
  const safe = new Error(digestTokens(original.message));
  safe.name = original.name;
  if (typeof original.stack === 'string') safe.stack = digestTokens(original.stack);
  Sentry.withScope((scope) => {
    scope.setTag('route', ctx.route);
    scope.setTag('request_id', ctx.requestId);
    Sentry.captureException(safe);
  });
}

/** Test seam: reset the module's init flag. */
export function resetSentryForTests(): void {
  initialised = false;
}

/** For callers that need to know (e.g. boot log). */
export function isSentryEnabled(): boolean {
  return initialised;
}

