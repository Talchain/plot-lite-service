/**
 * THE logger boundary — Wave1-L1.
 *
 * Every log record leaving this service passes through here, so a log site is
 * safe WITHOUT its author doing anything. That is the whole point: the previous
 * three rounds required the author to remember `sha8(...)` at each of 364 call
 * sites, and each round found more sites that forgot.
 *
 * TWO ARMS, because PLoT has TWO log channels (verified by enumeration at
 * staging 8e6f8eb):
 *   1. pino / Fastify — 272 sites (`req.log.*`, `app.log.*`, and the bare
 *      `logger?.*` params, which are `req.log` passed down). Covered by
 *      `redactLogRecord` installed as pino `formatters.log`. VERIFIED by probe
 *      that formatters.log fires for CHILD loggers (req.log), not just the root
 *      — that is what makes this a boundary rather than another partial fix.
 *   2. console.* — 86 sites, which bypass pino entirely (e.g. v2/run.ts:579
 *      `console.warn('[FACTOR_SENSITIVITY_MISSING_NUMERIC]', ...)` leaks a raw
 *      node id and was missed by all three review rounds). Covered by
 *      `installConsoleBoundary`.
 * A pino-only mechanism would have left arm 2 open, which is how this class of
 * defect keeps surviving "complete" fixes.
 *
 * BLAST RADIUS IS DELIBERATELY NARROW: both arms are no-ops unless a request
 * scope has registered tokens (see decision-tokens.ts). Boot logs, tool output
 * and test logs outside a request are byte-identical to before.
 */

import { sha8 } from '../util/pii-redact.js';
import { getScrubber, isRegisteredToken, getDecisionTokenScope } from './decision-tokens.js';

/**
 * Keys whose VALUES are author-written service vocabulary (enums/constants),
 * never decision content.
 *
 * These are skipped by the content scrubber so that a decision label which
 * happens to collide with service vocabulary cannot rewrite an event name and
 * break dashboards/alerts. Kept deliberately tiny — every entry is a hole, so
 * each one must be a literal the author typed, never an interpolation.
 */
const LITERAL_VALUE_KEYS = new Set(['evt', 'event', 'level', 'route', 'method', 'reason', 'hostname', 'name']);

/**
 * Decision-domain key names whose values are ALWAYS digested, whatever their
 * entropy.
 *
 * WHY THIS EXISTS AND WHAT IT IS NOT: this is the *supplementary* layer. The
 * content scrubber cannot catch low-entropy scalars (a threshold of `5`), so
 * this catches them at known keys. It is a denylist and therefore fails OPEN
 * for a key name nobody listed — it is NOT the guarantee. The guarantee for new
 * sites is the content scrubber. Do not "improve" this list into the mechanism;
 * that is the per-call-site habit wearing a hat.
 */
const DECISION_DOMAIN_KEYS = new Set([
  'node', 'node_id', 'nodeId', 'node_ids', 'nodeIds',
  'option', 'option_id', 'optionId', 'option_ids', 'optionIds',
  'from', 'to', 'source', 'target',
  'label', 'labels', 'factor_label',
  'value', 'val', 'min', 'max', 'threshold', 'auto_threshold',
  'mean', 'std', 'range_min', 'range_max',
  'outcome_p90', 'raw_probability_of_joint_goal', 'raw_constraint_probabilities',
]);

/** pino's own envelope keys — never rewrite these or the log stops parsing. */
const PINO_RESERVED = new Set(['level', 'time', 'pid', 'hostname', 'v']);

const MAX_DEPTH = 12;

/**
 * An already-digested leaf. Both arms of the pino hook (logMethod, then
 * formatters.log) see the same record, so redaction MUST be idempotent:
 * without this guard the key layer would digest its own output on the second
 * pass, and equal inputs would stop producing equal digests — destroying the
 * within-process correlation the digests exist to preserve.
 */
const ALREADY_DIGESTED = /^sha8:[0-9a-f]{8}$/;

function scrubString(text: string, scrub: (t: string) => string): string {
  return scrub(text);
}

/**
 * Deep, shape-preserving redaction of ONE log record against the active
 * request's registered decision tokens.
 *
 * Shape is preserved (same keys where structural, same nesting, same array
 * lengths) so log processors keep working; only decision content is replaced.
 */
function redactValue(value: unknown, scrub: (t: string) => string, depth: number): unknown {
  if (depth > MAX_DEPTH) return value;
  if (value === null || value === undefined || typeof value === 'boolean') return value;

  if (typeof value === 'string') return scrubString(value, scrub);

  if (typeof value === 'number') {
    // Whole-value match only: a number cannot contain a token as a substring in
    // any meaningful sense, and substring-matching numerics would corrupt
    // unrelated metrics.
    return Number.isFinite(value) && isRegisteredToken(String(value)) ? sha8(value) : value;
  }

  if (Array.isArray(value)) return value.map((v) => redactValue(v, scrub, depth + 1));

  if (typeof value === 'object') {
    // Errors keep message/stack on NON-enumerable props, so the generic object
    // walk below would silently drop them. Rebuild explicitly.
    //
    // Own enumerable props are carried over (scrubbed): a future author writing
    // `req.log.error(err)` must not silently lose err.code / err.statusCode —
    // this mechanism exists so new sites are safe AND still debuggable, and a
    // redactor that quietly eats diagnostic fields would earn its own removal.
    if (value instanceof Error) {
      const scrubbed = new Error(scrubString(value.message, scrub));
      scrubbed.name = value.name;
      scrubbed.stack = value.stack ? scrubString(value.stack, scrub) : undefined;
      for (const [k, v] of Object.entries(value as unknown as Record<string, unknown>)) {
        if (k === 'message' || k === 'stack' || k === 'name') continue;
        (scrubbed as unknown as Record<string, unknown>)[k] = redactValue(v, scrub, depth + 1);
      }
      return scrubbed;
    }
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      // A KEY can itself be decision content (node-id keys of `interventions`).
      const outKey = !PINO_RESERVED.has(key) && isRegisteredToken(key) ? sha8(key) : key;

      if (PINO_RESERVED.has(key)) {
        out[outKey] = v;
      } else if (DECISION_DOMAIN_KEYS.has(key)) {
        // Supplementary key layer: digest scalars regardless of entropy.
        if (typeof v === 'string' && ALREADY_DIGESTED.test(v)) out[outKey] = v; // idempotent
        else if (typeof v === 'string' || typeof v === 'number') out[outKey] = sha8(v);
        else out[outKey] = redactValue(v, scrub, depth + 1);
      } else if (LITERAL_VALUE_KEYS.has(key) && typeof v === 'string') {
        out[outKey] = v;
      } else {
        out[outKey] = redactValue(v, scrub, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/**
 * pino `formatters.log` hook — installed in createServer.ts.
 *
 * Fires for the root logger AND every child (`req.log`), which is what makes it
 * the boundary. Returns the record unchanged when no request scope has tokens.
 */
export function redactLogRecord(record: Record<string, unknown>): Record<string, unknown> {
  const scope = getDecisionTokenScope();
  if (!scope) return record;
  const scrub = getScrubber(sha8);
  if (!scrub) {
    // Scope exists but nothing registered: the key layer alone still applies,
    // because low-entropy decision values do not register as tokens.
    return redactValue(record, (t) => t, 0) as Record<string, unknown>;
  }
  return redactValue(record, scrub, 0) as Record<string, unknown>;
}

/**
 * pino `hooks.logMethod` arm — installed in createServer.ts alongside
 * formatters.log. BOTH are required; neither alone is a boundary:
 *
 *  - `formatters.log` receives the merged log OBJECT but **NOT `msg`**
 *    (verified by probe: the formatter saw only {evt}, while
 *    `req.log.info({evt}, 'text')` and `req.log.info('text')` emitted their
 *    message RAW). A formatters-only mechanism leaks every interpolated
 *    message — and `req.log.error(meta, '...')` is a common shape here.
 *  - `logMethod` receives the raw call ARGS, so it covers `msg` in both
 *    shapes, but does NOT see child-logger BINDINGS (e.g. `.child({...})`),
 *    which formatters.log does cover.
 *
 * Together they cover object + msg + bindings. Redaction is idempotent
 * (ALREADY_DIGESTED), so the double pass is safe.
 *
 * VERIFIED: logMethod fires for CHILD loggers (req.log), not just the root.
 */
export function redactLogArgs(args: unknown[]): unknown[] {
  const scope = getDecisionTokenScope();
  if (!scope) return args;
  const scrub = getScrubber(sha8) ?? ((t: string) => t);
  return args.map((a) => redactValue(a, scrub, 0));
}

/**
 * Console arm of the boundary.
 *
 * console.* bypasses pino, so these 86 sites are otherwise unprotected. We
 * replace the methods once, at server construction, scrubbing every argument.
 * Idempotent: repeated createServer() calls (tests) must not stack wrappers.
 */
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
const INSTALLED = Symbol.for('plot.logBoundary.consoleInstalled');

export function installConsoleBoundary(target: Console = console): void {
  const anyTarget = target as unknown as Record<PropertyKey, unknown>;
  if (anyTarget[INSTALLED]) return;

  for (const method of CONSOLE_METHODS) {
    const original = target[method]?.bind(target);
    if (typeof original !== 'function') continue;
    (target as unknown as Record<string, unknown>)[method] = (...args: unknown[]): void => {
      const scope = getDecisionTokenScope();
      if (!scope) return original(...args);
      const scrub = getScrubber(sha8) ?? ((t: string) => t);
      original(...args.map((a) => redactValue(a, scrub, 0)));
    };
  }
  Object.defineProperty(target, INSTALLED, { value: true, enumerable: false, configurable: true });
}
