/**
 * Request-scoped decision-token registry — Wave1-L1 logger boundary.
 *
 * WHY THIS EXISTS (read before changing anything here):
 *
 * Three review rounds tried to close PLoT's decision-input log leaks by editing
 * the leaking call sites. Every round found more sites. There are **364 log
 * emission sites in src/** and any new one re-opens the hole, because staying
 * safe depends on the author remembering to wrap the value. That is not a
 * mechanism, it is a habit — and ROADMAP 2.56 ruled it out: "HOLISTIC FIX =
 * one SHARED decision-input minimiser … NOT 6 line-edits."
 *
 * THE MECHANISM: don't try to recognise the *shape* of a leak (key names,
 * regexes over source, "does this look like a node id?"). Instead track the
 * *actual* decision values this request carried, and scrub exactly those,
 * wherever they surface — any key, any nesting, any prose, including keys that
 * did not exist when this file was written.
 *
 * This is the same lesson the coaching-honesty guard learned after five regex
 * rounds: pattern-matching natural language is structurally brittle. Matching
 * known content is not.
 *
 * FLOW:
 *   ingress  -> beginDecisionTokenScope() + registerDecisionTokens(req.body)
 *   log call -> src/logging/log-boundary.ts consults getScrubber()
 *
 * FAIL-SAFE DIRECTION: over-scrubbing costs debuggability; under-scrubbing
 * costs privacy. Every ambiguous case here resolves toward scrubbing.
 *
 * DELIBERATE RESIDUAL — read this before trusting the guarantee:
 * low-entropy scalars cannot be scrubbed by content. A constraint threshold of
 * `5` cannot be distinguished from `durationMs: 5`; registering "5" would
 * rewrite every log line in the service. Tokens therefore have an entropy
 * floor (MIN_TOKEN_LEN). Low-entropy values at *known* decision-domain keys are
 * caught by the key layer in log-boundary.ts instead. A low-entropy value at a
 * brand-new unknown key is the one residual this mechanism does NOT close; see
 * DECISION_DOMAIN_KEYS.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { STRUCTURAL_KEYS } from '../util/structural-keys.generated.js';

/**
 * Minimum characters for a token to be registered.
 *
 * 4 is the smallest length at which scrubbing does not routinely collide with
 * service vocabulary and numeric metrics. Below it, matching does more damage
 * to the logs than it prevents (see "DELIBERATE RESIDUAL" above).
 */
const MIN_TOKEN_LEN = 4;

/**
 * Hard cap on registered tokens per request.
 *
 * The scrubber compiles tokens into one alternation RegExp; an unbounded graph
 * would build an unbounded pattern and make logging a DoS vector. On overflow
 * we keep the LONGEST tokens: long tokens are the label-derived ids and precise
 * values that actually identify a decision, while short ones are the least
 * identifying and the most collision-prone.
 */
const MAX_TOKENS = 500;

/** Depth cap — defends against hostile/cyclic nesting during harvest. */
const MAX_HARVEST_DEPTH = 12;

export interface DecisionTokenScope {
  tokens: Set<string>;
  /** Lazily compiled matcher; invalidated whenever tokens change. */
  matcher?: RegExp | null;
}

const storage = new AsyncLocalStorage<DecisionTokenScope>();

/**
 * Enter a decision-token scope for the current async context.
 *
 * Uses enterWith so a Fastify onRequest hook can establish the scope for the
 * whole remainder of the request without wrapping the handler chain.
 *
 * SEMANTICS, VERIFIED (two real sequential HTTP requests against a live Fastify
 * instance, not app.inject):
 *  - each request sees ONLY its own tokens — no cross-request bleed;
 *  - the server's own async context stays clean after the requests complete.
 * The isolation comes from each inbound request running in its own async
 * resource tree, so enterWith is bounded by that tree.
 *
 * CAVEAT for callers: `app.inject()` runs the request in the CALLER's async
 * context, so enterWith persists into the caller afterwards. That is an inject
 * artifact, not a server behaviour. Tests that need a scope-free context must
 * use runOutsideDecisionTokenScope().
 */
export function beginDecisionTokenScope(): DecisionTokenScope {
  const scope: DecisionTokenScope = { tokens: new Set(), matcher: null };
  storage.enterWith(scope);
  return scope;
}

/** Run `fn` inside a fresh scope (used by tests and non-Fastify callers). */
export function withDecisionTokenScope<T>(fn: (scope: DecisionTokenScope) => T): T {
  return storage.run({ tokens: new Set(), matcher: null }, () => fn(storage.getStore()!));
}

/**
 * Run `fn` with NO active scope — i.e. exactly what boot logs, tools and
 * non-request code see. Lets a test assert the boundary's no-op path even after
 * an app.inject() has contaminated the ambient context (see caveat above).
 */
export function runOutsideDecisionTokenScope<T>(fn: () => T): T {
  return storage.exit(fn);
}

export function getDecisionTokenScope(): DecisionTokenScope | undefined {
  return storage.getStore();
}

/**
 * Should this string be treated as decision content?
 *
 * Excludes contract-declared key names: those are service vocabulary that
 * appears in every graph ("options", "nodes", "value"), so registering them
 * would rewrite structural log text without protecting anything — the decision
 * is in the *operands*, never in the contract's own nouns.
 */
function isRegistrableString(s: string): boolean {
  if (s.length < MIN_TOKEN_LEN) return false;
  if (STRUCTURAL_KEYS.has(s)) return false;
  return true;
}

function addToken(scope: DecisionTokenScope, raw: string): void {
  if (!isRegistrableString(raw)) return;
  if (scope.tokens.has(raw)) return;
  scope.tokens.add(raw);
  scope.matcher = null; // invalidate compiled matcher
}

/**
 * Harvest every decision-derived scalar and data-derived KEY out of a request
 * payload and register it for scrubbing.
 *
 * KEYS ARE CONTENT TOO: `interventions` / `priors` are Records keyed BY NODE
 * ID, and node ids are label-derived slugs. A harvest that only walked values
 * would leave the decision in the key — the exact residual review 3 found.
 */
export function registerDecisionTokens(payload: unknown, depth = 0): void {
  const scope = storage.getStore();
  if (!scope) return; // outside a request: nothing to protect, stay a no-op
  harvest(scope, payload, depth);
}

function harvest(scope: DecisionTokenScope, payload: unknown, depth: number): void {
  if (depth > MAX_HARVEST_DEPTH) return;
  if (payload === null || payload === undefined) return;

  if (typeof payload === 'string') {
    addToken(scope, payload);
    return;
  }
  if (typeof payload === 'number') {
    if (Number.isFinite(payload)) addToken(scope, String(payload));
    return;
  }
  if (typeof payload === 'boolean') return; // 2 bits: never identifying
  if (Array.isArray(payload)) {
    for (const item of payload) harvest(scope, item, depth + 1);
    return;
  }
  if (typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      // A key the contract does not declare is data-derived => decision content.
      if (!STRUCTURAL_KEYS.has(key)) addToken(scope, key);
      harvest(scope, value, depth + 1);
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile (and memoise) the alternation matcher for this scope.
 *
 * Longest-first so a token that is a prefix of another cannot be partially
 * rewritten (e.g. "acquire-fintechco" must not eat "acquire-fintechco-for-50m").
 */
function getMatcher(scope: DecisionTokenScope): RegExp | null {
  if (scope.matcher !== null && scope.matcher !== undefined) return scope.matcher;
  if (scope.tokens.size === 0) {
    scope.matcher = null;
    return null;
  }
  const ordered = [...scope.tokens].sort((a, b) => b.length - a.length).slice(0, MAX_TOKENS);
  scope.matcher = new RegExp(ordered.map(escapeRegExp).join('|'), 'g');
  return scope.matcher;
}

/**
 * Returns a scrubbing function for the active request scope, or undefined when
 * there is no scope / nothing registered.
 *
 * `digest` is injected so this module stays free of crypto policy — the single
 * digest primitive lives in util/pii-redact.ts.
 */
export function getScrubber(digest: (v: string) => string): ((text: string) => string) | undefined {
  const scope = storage.getStore();
  if (!scope) return undefined;
  const matcher = getMatcher(scope);
  if (!matcher) return undefined;
  return (text: string): string => {
    matcher.lastIndex = 0;
    if (!matcher.test(text)) return text;
    matcher.lastIndex = 0;
    return text.replace(matcher, (m) => digest(m));
  };
}

/** Is `text` exactly a registered token? (used for whole-value / key matches) */
export function isRegisteredToken(text: string): boolean {
  const scope = storage.getStore();
  return scope ? scope.tokens.has(text) : false;
}
