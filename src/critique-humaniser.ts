/**
 * Critique Humaniser — deterministic template-based user_message generation.
 *
 * Maps each CritiqueV3.code to a human-readable message for UI display.
 * The existing `message` field is preserved for logging/debug bundles.
 *
 * @see PLoT brief: critique message humanisation
 */

import type { CritiqueV3 } from './types/engine-v3.js';

// ---------------------------------------------------------------------------
// Minimal graph shape for label resolution
// ---------------------------------------------------------------------------

/** Accepts both UpstreamGraph and EngineGraphV3 for label resolution. */
export interface GraphForLabels {
  nodes: ReadonlyArray<{ id: string; label?: string; kind?: string }>;
}

const EMPTY_GRAPH: GraphForLabels = { nodes: [] };

// ---------------------------------------------------------------------------
// Label Resolution
// ---------------------------------------------------------------------------

/**
 * Strip ID prefix (fac_, opt_, goal_, constraint_fac_, constraint_) and
 * convert to title case: `fac_customer_churn` → `Customer Churn`.
 */
export function humaniseId(id: string): string {
  const stripped = id.replace(/^(?:constraint_fac_|constraint_|fac_|opt_|goal_)/, '');
  return stripped
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Resolve a human-readable label for a node ID via the graph, with humanised fallback. */
export function resolveNodeLabel(
  nodeId: string | undefined,
  graph: GraphForLabels,
): string {
  if (!nodeId) return 'unknown';
  // `n?.id`: the /v2/run Ajv body schema types graph.nodes as `{ type: 'array' }`
  // — the container only, the ITEMS unvalidated (src/routes/v2/run.ts:1276) — so
  // `nodes: [null]` is a well-formed request. An unguarded `n.id` threw a
  // TypeError out of every 422 blocked path (buildBlockedResponse runs its
  // critiques through addUserMessages), replacing the precise blocker with a
  // masked PLOT_INTERNAL_ERROR. A malformed node is simply not a match.
  const node = graph.nodes.find((n) => n?.id === nodeId);
  if (node?.label) return node.label;
  return humaniseId(nodeId);
}

/** Resolve a human-readable label for an option ID via the options array. */
function resolveOptionLabel(
  optionId: string | undefined,
  options?: ReadonlyArray<{ id: string; label: string }>,
  graph?: GraphForLabels,
): string {
  if (!optionId) return 'unknown option';
  const option = options?.find((o) => o.id === optionId);
  if (option?.label) return option.label;
  // Fall back to graph lookup (option might be in nodes)
  if (graph) {
    // `n?.id` — same unvalidated-item hazard as resolveNodeLabel above. This is
    // the site the reviewer's corner reaches: an option with `label: ""` is
    // FALSY, so the option lookup falls through to this graph lookup.
    const node = graph.nodes.find((n) => n?.id === optionId);
    if (node?.label) return node.label;
  }
  return humaniseId(optionId);
}

/**
 * Extract a prefixed ID from a critique message string (last-resort safety net).
 * Returns the first match of fac_*, opt_*, goal_*, or constraint_* pattern.
 */
function extractIdFromMessage(message: string): string | undefined {
  const match = message.match(/(?:constraint_fac_|constraint_|fac_|opt_|goal_)[a-z][a-z0-9_]*/);
  return match?.[0];
}

// ---------------------------------------------------------------------------
// Template Map
// ---------------------------------------------------------------------------

type TemplateResolver = (
  critique: CritiqueV3,
  graph: GraphForLabels,
  options?: ReadonlyArray<{ id: string; label: string }>,
) => string;

type TemplateEntry = string | TemplateResolver;

// ---------------------------------------------------------------------------
// ROADMAP 2.645 — per-class copy for normalisation warnings
// ---------------------------------------------------------------------------

/**
 * Resolve the subject of a normalisation warning, or `undefined` when the
 * producer gave us nothing nameable.
 *
 * Unchanged from the pre-2.645 resolution order (`affected_node_ids` first,
 * then an id scraped out of the developer message) so the option class reads
 * exactly as it did before; only the SENTENCE around it is now class-specific.
 */
function resolveNormalisationSubject(
  critique: CritiqueV3,
  graph: GraphForLabels,
): string | undefined {
  const nodeId = critique.affected_node_ids?.[0];
  if (nodeId) return resolveNodeLabel(nodeId, graph);
  const extracted = extractIdFromMessage(critique.message);
  return extracted ? humaniseId(extracted) : undefined;
}

/**
 * User-facing copy per PRODUCER class, keyed by `NormalisationWarning.code`.
 *
 * ⚠ THE KEYS ARE THE PRODUCER'S OWN CODES, not critique codes. The domain was
 * derived at the bytes and confirmed by execution (`c03e36fe`): all nine
 * `warnings.push` sites in `normalisation/graph-normaliser.ts`, minus the ones
 * carrying `repair` — those are partitioned into `_meta.repairs_applied` by
 * `normaliseGraphWithRepairs` and NEVER become critiques. Exactly three classes
 * survive that partition, and each sentence below states what its own producer
 * does, not what the field seemed to mean (trap 13c).
 *
 * `tests/critique-humaniser.normalisation-classes.test.ts` holds two guards
 * that are deliberately not redundant (trap 12d): a corpus driving the REAL
 * normaliser (does each class read TRUE?) and a drift scan of the producer's
 * source (has a FOURTH class appeared with no copy?).
 */
export const NORMALISATION_WARNING_COPY: Record<
  string,
  (subject: string | undefined) => string
> = {
  /**
   * `graph-normaliser.ts` — the node arrived with `kind='option'`. Option nodes
   * are filtered out before factor analysis by design. The original copy: true
   * for this class, and only this one.
   */
  NORMALIZATION_WARNING: (subject) =>
    subject
      ? `${subject} is an option and was excluded from factor analysis. This is expected.`
      : 'An option was excluded from factor analysis. This is expected.',

  /**
   * `graph-normaliser.ts normaliseNode` — the node's kind is neither a valid
   * causal kind nor a known non-causal one. Note what the producer does NEXT:
   * `const kind = normalizedKind as EngineNodeKindV3` — the kind is forwarded
   * to the engine EXACTLY as supplied. Nothing is replaced, defaulted or
   * dropped, so the copy must not imply a repair happened.
   */
  UNKNOWN_NODE_KIND: (subject) =>
    subject
      ? `${subject} has a type this model does not recognise. It was passed to the engine unchanged — check its type if the results look wrong.`
      : 'A node has a type this model does not recognise. It was passed to the engine unchanged — check its type if the results look wrong.',

  /**
   * `graph-normaliser.ts normaliseNode` — a prior distribution was supplied on
   * a node whose category is not `external`. The producer's own declared
   * semantics, verbatim from its message: "Prior will be ignored." The prior is
   * not altered here, so the copy states the consequence, not a repair.
   */
  PRIOR_ON_NON_EXTERNAL: (subject) =>
    subject
      ? `${subject} was given a starting-value distribution, but those are only used on factors marked external, so it will be ignored.`
      : 'A factor was given a starting-value distribution, but those are only used on factors marked external, so it will be ignored.',
};

/**
 * Copy for a normalisation warning whose producer class is unknown — a critique
 * replayed from a saved debug bundle, or a class added upstream without copy.
 *
 * It deliberately claims NOTHING about what happened beyond the fact that a
 * note exists, because when the class is unknown, anything more specific is a
 * guess. This is the case the pre-2.645 code answered by asserting the option
 * class, which is how a false sentence reached users.
 */
const NORMALISATION_WARNING_GENERIC = (subject: string | undefined): string =>
  subject
    ? `A note was recorded about ${subject} while preparing your model for analysis. See the advanced details.`
    : 'A note was recorded while preparing your model for analysis. See the advanced details.';

/**
 * Complete template map keyed by critique code.
 * Includes all codes currently emitted by the codebase plus forward-compatibility
 * entries from the brief for codes not yet implemented.
 */
export const TEMPLATE_MAP: Record<string, TemplateEntry> = {
  // =========================================================================
  // Blockers
  // =========================================================================

  MISSING_GOAL_NODE:
    'No goal defined. Add a goal to your model before running analysis.',

  GOAL_NODE_NOT_IN_GRAPH:
    "The selected goal doesn't exist in the model. Choose an existing node as your goal.",

  GOAL_NODE_NOT_CAUSAL: (c, g) => {
    const nodeId = c.affected_node_ids?.[0];
    // `n?.id` — third site of the same unvalidated-item hazard (see :46).
    const node = nodeId ? g.nodes.find((n) => n?.id === nodeId) : undefined;
    const kind = node?.kind ?? 'non-causal';
    return `The selected goal is a ${kind} node, which can't be used as an analysis target. Choose a factor, outcome, risk, or goal node instead.`;
  },

  NO_OPTIONS:
    'At least 2 options are needed to compare. Add more options to your model.',

  TOO_MANY_OPTIONS:
    'Too many options provided. Reduce the number of options to stay within the limit.',

  TOO_MANY_CONSTRAINTS:
    'Too many constraints provided. Reduce the number of constraints to stay within the limit.',

  INVALID_CONSTRAINT_SHAPE:
    'A constraint is incomplete or malformed. Each constraint needs an identifier, a target node, a >= or <= comparison, and a numeric limit.',

  EMPTY_INTERVENTIONS: (c, g, opts) => {
    const label = resolveOptionLabel(c.affected_option_ids?.[0], opts, g);
    return `${label} has no effects defined. Each option needs at least one connection to a factor.`;
  },

  INVALID_INTERVENTION_TARGET: (c, g, opts) => {
    const label = resolveOptionLabel(c.affected_option_ids?.[0], opts, g);
    return `${label} targets a factor that doesn't exist in the model.`;
  },

  INVALID_INTERVENTION_VALUE: (c, g, opts) => {
    const label = resolveOptionLabel(c.affected_option_ids?.[0], opts, g);
    return `${label} has an invalid effect value. Each intervention must be a valid number.`;
  },

  NO_PATH_TO_GOAL: (c, g) => {
    // affected_node_ids[0] is the goal node ID (set by producer)
    const goalId = c.affected_node_ids?.[0];
    const goalLabel = goalId ? resolveNodeLabel(goalId, g) : 'the goal';
    return `No path connects your factors to the goal. Check that your model links factors through to ${goalLabel}.`;
  },

  GRAPH_TOO_LARGE:
    'Model exceeds the size limit. Simplify by merging or removing less important factors.',

  GRAPH_DENSE:
    'Your model has many connections. Analysis is slower and harder to interpret at this density — consider removing weaker links.',

  GRAPH_CYCLE_DETECTED:
    'Your model contains a circular dependency. Models must flow in one direction.',

  IDENTICAL_OPTIONS:
    'Some options have identical effects. Each option must define distinct interventions.',

  INVALID_NODE_ID_PATTERN:
    'A node has an invalid identifier. Node IDs must use only lowercase letters, numbers, underscores, colons, and hyphens.',

  INVALID_EDGE_ENDPOINT:
    'A connection references a node that doesn\'t exist in the model.',

  DUPLICATE_NODE_IDS:
    'Multiple nodes share the same identifier. Each node must have a unique ID.',

  IDENTIFIABILITY_ISSUE:
    'The causal model cannot be identified. Consider simplifying the model or adding more observations.',

  ISL_CANNOT_IDENTIFY:
    'The analysis engine cannot isolate the causal effect. Consider simplifying the model structure.',

  NORMALIZATION_ERROR:
    'The model could not be normalised. Check that all nodes and connections are correctly defined.',

  ISL_REQUEST_INVALID:
    'The analysis request was rejected by the inference engine. Check your model structure.',

  // =========================================================================
  // Constraint Blockers
  // =========================================================================

  CONSTRAINT_TARGET_NOT_FOUND:
    "A constraint references a factor that doesn't exist in the model.",

  CONSTRAINT_TARGET_NOT_IN_INFERENCE:
    "A constraint targets a node type that can't be constrained. Only factors, outcomes, and goals can have constraints.",

  CONSTRAINT_INVALID_OPERATOR:
    'A constraint uses an unrecognised comparison. Valid operators are >= and <=.',

  CONSTRAINT_DUPLICATE_ID:
    'Duplicate constraint found. Each constraint must be unique.',

  // =========================================================================
  // Errors
  // =========================================================================

  ISL_CALL_FAILED:
    'The analysis engine encountered an error. Please try again.',

  ISL_ERROR:
    'The analysis engine encountered an error. Please try again.',

  ISL_TIMEOUT:
    'The analysis took too long and timed out. This is usually temporary — try running it again.',

  ISL_NETWORK_ERROR:
    'We could not reach the analysis service. Try again shortly — if this keeps happening, the service may be down.',

  ISL_REJECTED:
    'The analysis service rejected this request, so the analysis could not run. Adjust the model and try again.',

  PLOT_INTERNAL_ERROR:
    'Something went wrong on our side while preparing the analysis. Your model is unaffected — try running the analysis again.',

  GRAPH_TOO_COMPLEX:
    'This model is too complex to analyse reliably. Reduce the number of factors or connections and re-run.',

  DUPLICATE_EDGE_CONFLICT:
    'The model has duplicate connections between the same factors with conflicting values. Keep one connection per relationship.',

  OPTION_ID_MISMATCH: (c, g, opts) => {
    const label = resolveOptionLabel(
      c.affected_option_ids?.[0] ?? c.affected_node_ids?.[0], opts, g,
    );
    return `Option "${label}" doesn't match any option in the model. Check option names.`;
  },

  INVALID_EXISTS_PROBABILITY: (c, g) => {
    const sourceLabel = resolveNodeLabel(c.affected_node_ids?.[0], g);
    const targetLabel = resolveNodeLabel(c.affected_node_ids?.[1], g);
    return `Connection from ${sourceLabel} to ${targetLabel} has an invalid probability. It must be between 0 and 1.`;
  },

  INVALID_STRENGTH_STD: (c, g) => {
    const sourceLabel = resolveNodeLabel(c.affected_node_ids?.[0], g);
    const targetLabel = resolveNodeLabel(c.affected_node_ids?.[1], g);
    return `Connection from ${sourceLabel} to ${targetLabel} has invalid uncertainty. Standard deviation must be positive.`;
  },

  INVALID_CONSTRAINT_TARGET:
    "A constraint references a factor that doesn't exist in the model.",

  INVALID_CONSTRAINT_VALUE:
    'A constraint has an invalid value. Check your constraint settings.',

  DUPLICATE_CONSTRAINT_ID:
    'Duplicate constraint found. Each constraint must be unique.',

  INVALID_CONSTRAINT_OPERATOR:
    'A constraint uses an unrecognised comparison. Valid operators are >=, <=, >, <, ==, !=.',

  // =========================================================================
  // Warnings
  // =========================================================================

  CONSTRAINT_VALUE_OUTSIDE_RANGE: (c, g) => {
    const label = resolveNodeLabel(c.affected_node_ids?.[0], g);
    return `The constraint on ${label} is outside the expected range. Check the constraint value is realistic.`;
  },

  CONSTRAINT_OUT_OF_DOMAIN: (c, g) => {
    const label = resolveNodeLabel(c.affected_node_ids?.[0], g);
    return `The constraint on ${label} is outside the expected range. Check the constraint value is realistic.`;
  },

  CONSTRAINT_DUPLICATE_TARGET:
    'Two constraints target the same factor with the same comparison. Only the stricter constraint was kept.',

  CONSTRAINT_TARGET_NO_OBSERVED_VALUE: (c, g) => {
    const label = resolveNodeLabel(c.affected_node_ids?.[0], g);
    return `The constraint on ${label} has no baseline value. Results may be unreliable without an estimate.`;
  },

  SCALE_MISMATCH_WARNING:
    'Intervention values span a wide range. Large magnitudes may dominate outcomes. Consider normalising values to similar scales.',

  INVALID_BIDIRECTED_EDGE:
    'A bidirected edge connects non-factor nodes. Unmeasured confounding is only meaningful between factors. This edge was ignored for identifiability analysis.',

  IDENTICAL_OPTIONS_DEDUPED:
    'Some options had identical effects and were merged. Analysis proceeds with the unique options.',

  IDENTIFIABILITY_WARNING:
    'Some causal relationships may not be identifiable. Results should be interpreted with caution.',

  UNMEASURED_CONFOUNDING_WARNING:
    'Unmeasured confounding may affect some results. The causal effect cannot be fully isolated using observed factors alone.',

  ISL_EMPTY_RESULTS:
    'The analysis engine returned no results. This may indicate a problem with the model structure.',

  STRENGTH_OUT_OF_RANGE: (c, g) => {
    const sourceLabel = resolveNodeLabel(c.affected_node_ids?.[0], g);
    const targetLabel = resolveNodeLabel(c.affected_node_ids?.[1], g);
    return `Connection from ${sourceLabel} to ${targetLabel} has an unusually strong effect. Consider whether this is realistic.`;
  },

  NO_COEFFICIENT_VARIATION:
    'All connections have the same strength. This usually means estimates need refining.',

  MISSING_FACTOR_VALUE: (c, g) => {
    const label = resolveNodeLabel(c.affected_node_ids?.[0], g);
    return `${label} has no baseline value set. Setting one improves result accuracy.`;
  },

  // =========================================================================
  // Info
  // =========================================================================

  CONSTRAINT_MISSING_RANGE: (c, g) => {
    const label = resolveNodeLabel(c.affected_node_ids?.[0], g);
    return `The constraint on ${label} cannot be range-checked. The constraint value will be used as-is.`;
  },

  CONSTRAINT_FILTERED_TEMPORAL: (c) => {
    // Derive count from affected_node_ids length or extract from message prefix
    const count = c.affected_node_ids?.length ||
      (() => {
        const m = c.message.match(/^(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      })();
    return `${count || 'Some'} time-based constraint(s) were excluded from analysis. Static models cannot evaluate deadlines.`;
  },

  NORMALIZATION_WARNING: (c, g) => {
    // ROADMAP 2.645. Every informational normalisation warning is emitted under
    // this one wire code, so the copy MUST be selected by the producer's own
    // class (`normalisation_code`), not by the wire code. See
    // NORMALISATION_WARNING_COPY below for the derivation of the class domain.
    const copy = NORMALISATION_WARNING_COPY[c.normalisation_code ?? ''];
    return (copy ?? NORMALISATION_WARNING_GENERIC)(resolveNormalisationSubject(c, g));
  },

  ISL_NOT_ENABLED:
    'The analysis engine is not currently available. Results are based on structural analysis only.',

  GOAL_THRESHOLD_SUPERSEDED:
    'Goal threshold ignored because explicit constraints are defined. Constraints take precedence.',

  INCONSISTENT_EFFECT_DIRECTION: (c, g) => {
    const sourceLabel = resolveNodeLabel(c.affected_node_ids?.[0], g);
    const targetLabel = resolveNodeLabel(c.affected_node_ids?.[1], g);
    return `Connection from ${sourceLabel} to ${targetLabel} has conflicting direction signals. The inferred direction was used.`;
  },

  INTERVENTION_EXTENDS_RANGE: (c, g, opts) => {
    const optLabel = resolveOptionLabel(c.affected_option_ids?.[0], opts, g);
    const factorLabel = resolveNodeLabel(c.affected_node_ids?.[0], g);
    return `${optLabel} pushes ${factorLabel} beyond its observed range. Results are extrapolated.`;
  },

  INBOUND_STRENGTH_SUM_EXCEEDED: (c, g) => {
    const label = resolveNodeLabel(c.affected_node_ids?.[0], g);
    return `${label} receives more combined influence than its range can absorb. Consider reducing edge strengths or reviewing the model structure.`;
  },

  MIXED_RANGE_DERIVATION:
    'Factors use different methods to determine their value ranges. Normalisation quality may vary.',

  // =========================================================================
  // Forward-compatibility (from brief — not yet emitted by codebase)
  // =========================================================================

  GRAPH_HAS_CYCLE:
    'Your model contains a circular dependency. Models must flow in one direction.',

  MISSING_OUTCOME_OR_RISK:
    'No outcome or risk factors found. Add at least one to your model.',

  NOMINAL_INTERVENTION_NOT_SUPPORTED: () => {
    // Audit C1-A. Factor-framed copy: previous version fronted the option
    // label (e.g. "UK targets a categorical factor…") which read as if the
    // option were the factor. New copy describes the factor's encoding
    // problem and gives a single consistent reframe path. The factor's
    // identity is carried structurally on `affected_node_ids`; the UI
    // critique panel can render the factor label adjacent to this message
    // without coupling the copy to the resolver.
    return 'This factor is being treated as a numeric scale, but its values are unordered categories. That makes one category appear stronger just because of its number. Replace it with one binary factor per category, with each option setting exactly one to 1.';
  },

  // Categorical integrity (audit C1-A). Generic, label-free copy.
  //
  // Rationale (post-merge review): the brief's "no raw user input in
  // critique messages" rule extends to this family because in CEE-driven
  // flows a factor or option label can be the category name verbatim
  // (e.g. an LLM may set the factor's label to "UK" rather than "Region").
  // Echoing labels via resolveNodeLabel/resolveOptionLabel would leak
  // the same content the brief forbids.
  //
  // Identifiers stay structural — `affected_node_ids` and
  // `affected_option_ids` carry the IDs for UI lookup. Other blocker
  // families (EMPTY_INTERVENTIONS, INVALID_INTERVENTION_TARGET, etc.)
  // continue to use the resolver pattern; this hardening is scoped to
  // the categorical-blocker family only.
  CATEGORICAL_DECOMPOSED: () =>
    'A one-hot encoded categorical group was detected. Its indicators are treated as a mutually exclusive set across options.',

  ONE_HOT_MUTEX_VIOLATION: () =>
    'An option does not satisfy mutual exclusivity within a categorical group. Each option must explicitly set every indicator in the group to 0 or 1, with exactly one indicator set to 1.',

  ONE_HOT_GROUPING_INCONSISTENT: () =>
    'A factor has inconsistent one-hot grouping metadata across options. To validate as a safe one-hot group, every option must place every indicator in the same group. Otherwise, remove the categorical encoding entirely so the factor is analysed as a regular numeric factor.',

  STRIPPED_FIELD_WARNING: () =>
    'Meaningful intervention metadata was stripped during normalisation on a passed-through factor. The factor was treated as a numeric value; if the dropped fields encoded categorical, unit, or scale semantics, the analysis may not match your intent.',

  POC_NODE_LIMIT:
    'Model exceeds the 50-factor limit. Simplify by merging or removing less important factors.',

  POC_EDGE_LIMIT:
    'Model exceeds the 100-connection limit. Remove less important connections.',

  POC_CONSTRAINT_LIMIT:
    'Model exceeds the 20-constraint limit. Remove less important constraints.',

  // ROADMAP 2.410 — ISL success-body coverage disclosure (critique.py:357).
  // ISL computes fine-grained switch detail for the most elastic fragile
  // edges only, bounded by its compute budget; retained values are computed
  // independently and are unaffected. Product copy: name the coverage limit
  // honestly, no internal jargon (field names / sample counts stay in
  // `message` for the debug surface).
  MARGINAL_SWITCH_TRUNCATED:
    'Tipping-point detail was computed for the most sensitive fragile connections only; ' +
    'the least sensitive were skipped to keep the analysis fast. All values shown are unaffected.',
};

// ---------------------------------------------------------------------------
// Banned Pattern Guard
// ---------------------------------------------------------------------------

/**
 * Regex matching raw internal IDs that must never appear in user_message.
 * Exported for use in tests.
 */
export const BANNED_PATTERN =
  /fac_[a-z_]+|opt_[a-z_]+|goal_[a-z_]+|constraint_fac_|observed_state\.|intercept=/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Fallback template for unrecognised codes. */
function fallbackMessage(code: string): string {
  return `An issue was detected in your model (${code}). Check the advanced details for more information.`;
}

/**
 * Generate a human-readable user_message for a single critique.
 *
 * Pure function — no side effects.
 */
export function humaniseCritique(
  critique: CritiqueV3,
  graph: GraphForLabels = EMPTY_GRAPH,
  options?: ReadonlyArray<{ id: string; label: string }>,
): string {
  const template = TEMPLATE_MAP[critique.code];

  let userMessage: string;
  if (template === undefined) {
    userMessage = fallbackMessage(critique.code);
  } else if (typeof template === 'string') {
    userMessage = template;
  } else {
    userMessage = template(critique, graph, options);
  }

  // Safety guard: if user_message leaks a banned pattern, fall back
  if (BANNED_PATTERN.test(userMessage)) {
    userMessage = fallbackMessage(critique.code);
  }

  return userMessage;
}

/** CritiqueV3 with user_message guaranteed present (post-humanisation). */
export type HumanisedCritique = CritiqueV3 & { user_message: string };

/**
 * Add `user_message` to each critique in an array.
 * Returns a new array — does not mutate the input.
 */
export function addUserMessages(
  critiques: CritiqueV3[],
  graph: GraphForLabels = EMPTY_GRAPH,
  options?: ReadonlyArray<{ id: string; label: string }>,
): HumanisedCritique[] {
  return critiques.map((c) => {
    // ROADMAP 2.645: `normalisation_code` is a PLoT-internal routing token that
    // exists only to reach the line above. Dropping it here is what keeps the
    // response bytes identical to before 2.645 — every /v2/run response path
    // runs its critiques through this function immediately before send.
    const { normalisation_code: _internalOnly, ...wire } = c;
    return {
      ...wire,
      user_message: humaniseCritique(c, graph, options),
    };
  });
}

/**
 * Export the set of all known critique codes (codes with explicit templates).
 * Used in template-coverage tests to ensure the map stays in sync.
 */
export function getKnownCodes(): string[] {
  return Object.keys(TEMPLATE_MAP);
}
