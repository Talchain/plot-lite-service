/**
 * Critique Humaniser — deterministic template-based user_message generation.
 *
 * Maps each CritiqueV3.code to a human-readable message for UI display.
 * The existing `message` field is preserved for logging/debug bundles.
 *
 * @see PLoT brief: critique message humanisation
 */

import type { CritiqueV3, EngineGraphV3, OptionV3 } from './types/engine-v3.js';

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
  const node = graph.nodes.find((n) => n.id === nodeId);
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
    const node = graph.nodes.find((n) => n.id === optionId);
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
    const node = nodeId ? g.nodes.find((n) => n.id === nodeId) : undefined;
    const kind = node?.kind ?? 'non-causal';
    return `The selected goal is a ${kind} node, which can't be used as an analysis target. Choose a factor, outcome, risk, or goal node instead.`;
  },

  NO_OPTIONS:
    'At least 2 options are needed to compare. Add more options to your model.',

  TOO_MANY_OPTIONS:
    'Too many options provided. Reduce the number of options to stay within the limit.',

  TOO_MANY_CONSTRAINTS:
    'Too many constraints provided. Reduce the number of constraints to stay within the limit.',

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
    // Resolve from affected_node_ids first, then fall back to regex extraction from message
    const nodeId = c.affected_node_ids?.[0];
    if (nodeId) {
      const label = resolveNodeLabel(nodeId, g);
      return `${label} is an option and was excluded from factor analysis. This is expected.`;
    }
    const extracted = extractIdFromMessage(c.message);
    if (extracted) {
      return `${humaniseId(extracted)} is an option and was excluded from factor analysis. This is expected.`;
    }
    return 'A node was adjusted during model normalisation. This is expected.';
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

  NOMINAL_INTERVENTION_NOT_SUPPORTED: (c, g, opts) => {
    const label = resolveOptionLabel(
      c.affected_option_ids?.[0] ?? c.affected_node_ids?.[0], opts, g,
    );
    return `${label} targets a categorical factor, which isn't supported yet. Reframe as a numeric estimate.`;
  },

  POC_NODE_LIMIT:
    'Model exceeds the 50-factor limit. Simplify by merging or removing less important factors.',

  POC_EDGE_LIMIT:
    'Model exceeds the 100-connection limit. Remove less important connections.',

  POC_CONSTRAINT_LIMIT:
    'Model exceeds the 20-constraint limit. Remove less important constraints.',
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
  return critiques.map((c) => ({
    ...c,
    user_message: humaniseCritique(c, graph, options),
  }));
}

/**
 * Export the set of all known critique codes (codes with explicit templates).
 * Used in template-coverage tests to ensure the map stays in sync.
 */
export function getKnownCodes(): string[] {
  return Object.keys(TEMPLATE_MAP);
}
