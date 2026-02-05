/**
 * Compound Goal Extraction from Natural Language Briefs
 *
 * Extracts compound goals (multiple success criteria) from brief text and
 * emits GoalConstraint entries and/or constraint nodes.
 *
 * This is a CEE extension for multi-constraint analysis (Phase 3).
 * Single-goal briefs pass through unchanged for backward compatibility.
 *
 * @see Multi-Constraint Analysis Phase 3 Spec
 */

import type { EngineNodeV3, EngineEdgeV3, GoalConstraint } from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Extracted compound goal from brief.
 */
export interface ExtractedGoal {
  /** Target metric name (may need node ID resolution) */
  target: string;
  /** Comparison operator */
  operator: '>=' | '<=';
  /** Threshold value in user units */
  value: number;
  /** Original text snippet that triggered extraction */
  source_text: string;
  /** Whether this is the primary goal (first stated) */
  is_primary: boolean;
  /** Confidence in extraction (0-1) */
  confidence: number;
  /** Goal type */
  type: 'quantitative' | 'temporal' | 'qualitative_proxy';
  /** Optional unit from text */
  unit?: string;
  /** Metadata for temporal goals */
  temporal_metadata?: {
    deadline_date?: string; // ISO format
    reference_date?: string;
    assumed_reference_date?: boolean;
  };
  /** Metadata for qualitative proxies */
  proxy_metadata?: {
    original_qualitative: string;
    proxy_mapping: string;
  };
  /** State space range for proxy nodes (enables stable normalization) */
  state_space_range?: {
    min: number;
    max: number;
  };
}

/**
 * Result of compound goal extraction.
 */
export interface CompoundGoalExtractionResult {
  /** Extracted goals */
  goals: ExtractedGoal[];
  /** Primary goal for goal_node_id (first stated outcome) */
  primary_goal: ExtractedGoal | null;
  /** Secondary constraints (subordinate clause goals) */
  constraints: ExtractedGoal[];
  /** Whether brief has compound structure */
  is_compound: boolean;
  /** Extraction diagnostics */
  diagnostics: {
    patterns_matched: string[];
    ambiguities: string[];
  };
}

/**
 * Constraint node generation result.
 */
export interface ConstraintNodeGenerationResult {
  /** Generated constraint nodes */
  nodes: EngineNodeV3[];
  /** Generated edges (from target to constraint) */
  edges: EngineEdgeV3[];
  /** Generated GoalConstraint entries */
  goal_constraints: GoalConstraint[];
}

// -----------------------------------------------------------------------------
// Trigger Patterns
// -----------------------------------------------------------------------------

/**
 * Patterns for extracting compound goals from briefs.
 * Order matters - more specific patterns first.
 */

// Primary goal verbs (identify first stated outcome)
const PRIMARY_GOAL_VERBS = /\b(achieve|reach|grow|maximise|maximize|increase|boost|hit|attain|double|triple|raise|get|acquire|gain|expand|launch|complete|ship|deliver)\b/i;

// Subordinate clause markers (introduce constraints)
// Matches patterns like:
// - "while keeping X under/below/above Y"
// - "while maintaining X below/under Y"
// - "while ensuring X stays above/below Y"
// - "without exceeding X"
// - "by Q1/Q2/Q3/Q4"
// - "within N months/weeks"
const CONSTRAINT_MARKERS = /\b(while\s+(?:keeping|maintaining|ensuring)|without\s+(?:exceeding|going\s+over|breaking)|(?:keep(?:ing)?|maintain(?:ing)?|ensur(?:e|ing)?)\s+\w+\s+(?:under|below|above|at\s+(?:least|most)|stays?\s+(?:under|below|above))|(?:maintaining|keeping)\s+\w+\s+(?:under|below|above|low|high)|by\s+(?:Q[1-4]|the\s+end\s+of)|within\s+\d+\s+(?:months?|weeks?|days?|years?))\b/i;

// Quantitative value patterns
const QUANTITATIVE_PATTERNS = {
  // Currency patterns: £50k, $1.5M, €100,000
  currency: /([£$€])(\d+(?:\.\d+)?)\s*(k|K|m|M|bn|BN|thousand|million|billion)?/,
  // Percentage patterns: 5%, 0.05, 5 percent
  percentage: /(\d+(?:\.\d+)?)\s*(%|percent|pct)/i,
  // Plain numbers with optional units
  number: /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(users?|customers?|employees?|people|hires?|months?|weeks?|days?)?/i,
};

// Operator patterns - map to >= or <=
const OPERATOR_PATTERNS: Array<{ pattern: RegExp; operator: '>=' | '<=' }> = [
  // >= operators
  { pattern: /\b(at\s+least|no\s+less\s+than|minimum|reach|exceed|above|over|more\s+than)\b/i, operator: '>=' },
  // <= operators
  { pattern: /\b(at\s+most|no\s+more\s+than|maximum|under|below|less\s+than|within|not\s+exceeding|ceiling|cap(?:ped)?)\b/i, operator: '<=' },
  // Implicit >= from goal verbs
  { pattern: /\b(grow|increase|boost|raise|achieve|hit|reach|attain)\b/i, operator: '>=' },
  // Implicit <= from constraint verbs
  { pattern: /\b(keep(?:ing)?|maintain(?:ing)?|limit(?:ing)?|restrict(?:ing)?)\b/i, operator: '<=' },
];

// Temporal patterns
const TEMPORAL_PATTERNS = {
  quarter: /\bby\s+Q([1-4])(?:\s+(\d{4}))?\b/i,
  endOfQuarter: /\bby\s+(?:the\s+)?end\s+of\s+Q([1-4])(?:\s+(\d{4}))?\b/i,
  withinMonths: /\bwithin\s+(\d+)\s+months?\b/i,
  withinWeeks: /\bwithin\s+(\d+)\s+weeks?\b/i,
  beforeDate: /\bbefore\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\w+\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})\b/i,
};

// Qualitative goal patterns with proxy mappings
// Include state_space_range for stable normalization (prevents heuristic fallback)
const QUALITATIVE_PROXIES: Array<{
  pattern: RegExp;
  proxy_node_id: string;
  proxy_label: string;
  default_operator: '>=' | '<=';
  default_value: number;
  unit?: string;
  state_space_range: { min: number; max: number };
}> = [
  {
    pattern: /\b(work[\s-]?life\s+balance|healthy\s+hours|sustainable\s+workload)\b/i,
    proxy_node_id: 'weekly_hours',
    proxy_label: 'Weekly working hours',
    default_operator: '<=',
    default_value: 45,
    unit: 'hours/week',
    state_space_range: { min: 0, max: 80 },
  },
  {
    pattern: /\b(team\s+morale|employee\s+satisfaction|staff\s+happiness)\b/i,
    proxy_node_id: 'team_satisfaction_score',
    proxy_label: 'Team satisfaction score',
    default_operator: '>=',
    default_value: 7,
    unit: 'score (1-10)',
    state_space_range: { min: 1, max: 10 },
  },
  {
    pattern: /\b(product\s+quality|quality\s+standards?|high\s+quality)\b/i,
    proxy_node_id: 'defect_rate',
    proxy_label: 'Defect rate',
    default_operator: '<=',
    default_value: 0.02,
    unit: 'ratio',
    state_space_range: { min: 0, max: 1 },
  },
  {
    pattern: /\b(customer\s+satisfaction|user\s+happiness|client\s+satisfaction)\b/i,
    proxy_node_id: 'customer_satisfaction',
    proxy_label: 'Customer satisfaction score',
    default_operator: '>=',
    default_value: 4,
    unit: 'score (1-5)',
    state_space_range: { min: 1, max: 5 },
  },
  {
    pattern: /\b(sustainable\s+growth|healthy\s+burn|cash\s+runway)\b/i,
    proxy_node_id: 'burn_rate_ratio',
    proxy_label: 'Burn rate as ratio of revenue',
    default_operator: '<=',
    default_value: 1.2,
    unit: 'ratio',
    state_space_range: { min: 0, max: 5 },
  },
];

// -----------------------------------------------------------------------------
// Value Parsing
// -----------------------------------------------------------------------------

/**
 * Parse a value from text with optional multipliers.
 */
function parseValue(text: string): number | null {
  // Currency with multiplier
  const currencyMatch = text.match(QUANTITATIVE_PATTERNS.currency);
  if (currencyMatch) {
    let value = parseFloat(currencyMatch[2]);
    const multiplier = currencyMatch[3]?.toLowerCase();
    if (multiplier === 'k' || multiplier === 'thousand') value *= 1000;
    else if (multiplier === 'm' || multiplier === 'million') value *= 1_000_000;
    else if (multiplier === 'bn' || multiplier === 'billion') value *= 1_000_000_000;
    return value;
  }

  // Percentage
  const percentMatch = text.match(QUANTITATIVE_PATTERNS.percentage);
  if (percentMatch) {
    const value = parseFloat(percentMatch[1]);
    // Return as decimal if > 1 (e.g., 5% -> 0.05)
    return value > 1 ? value / 100 : value;
  }

  // Plain number
  const numberMatch = text.match(QUANTITATIVE_PATTERNS.number);
  if (numberMatch) {
    return parseFloat(numberMatch[1].replace(/,/g, ''));
  }

  return null;
}

/**
 * Detect operator from surrounding text.
 */
function detectOperator(text: string, defaultOp: '>=' | '<=' = '>='): '>=' | '<=' {
  for (const { pattern, operator } of OPERATOR_PATTERNS) {
    if (pattern.test(text)) {
      return operator;
    }
  }
  return defaultOp;
}

// -----------------------------------------------------------------------------
// Temporal Extraction
// -----------------------------------------------------------------------------

/**
 * Get months from reference date to end of quarter.
 */
function getMonthsToQuarterEnd(quarter: number, year?: number): { months: number; deadline_date: string } {
  const now = new Date();
  const targetYear = year ?? now.getFullYear();

  // Quarter end months: Q1=3 (March), Q2=6, Q3=9, Q4=12
  const endMonth = quarter * 3;
  const deadline = new Date(targetYear, endMonth, 0); // Last day of end month

  // If the deadline is in the past, assume next year
  let finalDeadline = deadline;
  if (deadline < now && !year) {
    finalDeadline = new Date(targetYear + 1, endMonth, 0);
  }

  const monthsDiff = (finalDeadline.getFullYear() - now.getFullYear()) * 12 +
    (finalDeadline.getMonth() - now.getMonth());

  return {
    months: Math.max(1, monthsDiff),
    deadline_date: finalDeadline.toISOString().split('T')[0],
  };
}

/**
 * Extract temporal constraint from text.
 */
function extractTemporalConstraint(text: string): ExtractedGoal | null {
  const now = new Date();
  const referenceDate = now.toISOString().split('T')[0];

  // Check for quarter patterns
  const quarterMatch = text.match(TEMPORAL_PATTERNS.quarter) || text.match(TEMPORAL_PATTERNS.endOfQuarter);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1], 10);
    const year = quarterMatch[2] ? parseInt(quarterMatch[2], 10) : undefined;
    const { months, deadline_date } = getMonthsToQuarterEnd(quarter, year);

    return {
      target: 'delivery_time_months',
      operator: '<=',
      value: months,
      source_text: quarterMatch[0],
      is_primary: false,
      confidence: 0.9,
      type: 'temporal',
      unit: 'months',
      temporal_metadata: {
        deadline_date,
        reference_date: referenceDate,
        assumed_reference_date: !year,
      },
      // Reasonable range for project timelines (0-36 months)
      state_space_range: { min: 0, max: 36 },
    };
  }

  // Check for "within N months"
  const monthsMatch = text.match(TEMPORAL_PATTERNS.withinMonths);
  if (monthsMatch) {
    const months = parseInt(monthsMatch[1], 10);
    const deadline = new Date(now);
    deadline.setMonth(deadline.getMonth() + months);

    return {
      target: 'delivery_time_months',
      operator: '<=',
      value: months,
      source_text: monthsMatch[0],
      is_primary: false,
      confidence: 0.95,
      type: 'temporal',
      unit: 'months',
      temporal_metadata: {
        deadline_date: deadline.toISOString().split('T')[0],
        reference_date: referenceDate,
        assumed_reference_date: false,
      },
      // Reasonable range for project timelines (0-36 months)
      state_space_range: { min: 0, max: 36 },
    };
  }

  // Check for "within N weeks"
  const weeksMatch = text.match(TEMPORAL_PATTERNS.withinWeeks);
  if (weeksMatch) {
    const weeks = parseInt(weeksMatch[1], 10);
    const months = weeks / 4; // Approximate (note: month diff is approximate, see feedback)
    const deadline = new Date(now);
    deadline.setDate(deadline.getDate() + weeks * 7);

    return {
      target: 'delivery_time_months',
      operator: '<=',
      value: Math.ceil(months * 10) / 10, // Round to 1 decimal
      source_text: weeksMatch[0],
      is_primary: false,
      confidence: 0.9,
      type: 'temporal',
      unit: 'months',
      temporal_metadata: {
        deadline_date: deadline.toISOString().split('T')[0],
        reference_date: referenceDate,
        assumed_reference_date: false,
      },
      // Reasonable range for project timelines (0-36 months)
      state_space_range: { min: 0, max: 36 },
    };
  }

  return null;
}

// -----------------------------------------------------------------------------
// Qualitative Extraction
// -----------------------------------------------------------------------------

/**
 * Extract qualitative goal and convert to proxy.
 */
function extractQualitativeProxy(text: string): ExtractedGoal | null {
  for (const proxy of QUALITATIVE_PROXIES) {
    const match = text.match(proxy.pattern);
    if (match) {
      return {
        target: proxy.proxy_node_id,
        operator: proxy.default_operator,
        value: proxy.default_value,
        source_text: match[0],
        is_primary: false,
        confidence: 0.7, // Lower confidence for qualitative proxies
        type: 'qualitative_proxy',
        unit: proxy.unit,
        proxy_metadata: {
          original_qualitative: match[0],
          proxy_mapping: proxy.proxy_label,
        },
        state_space_range: proxy.state_space_range,
      };
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Main Extraction
// -----------------------------------------------------------------------------

/**
 * Extract quantitative constraint from a clause.
 *
 * @param clause Text clause to analyze
 * @param isPrimary Whether this is a primary goal clause
 */
function extractQuantitativeGoal(clause: string, isPrimary: boolean): ExtractedGoal | null {
  const value = parseValue(clause);
  if (value === null) return null;

  // Try to identify target from context
  // Common metric keywords
  const metricPatterns: Array<{ pattern: RegExp; target: string; unit?: string }> = [
    { pattern: /\b(MRR|monthly\s+recurring\s+revenue)\b/i, target: 'monthly_recurring_revenue', unit: 'currency' },
    { pattern: /\b(ARR|annual\s+recurring\s+revenue)\b/i, target: 'annual_recurring_revenue', unit: 'currency' },
    { pattern: /\bchurn\s*(?:rate)?\b/i, target: 'monthly_churn_rate', unit: 'ratio' },
    { pattern: /\brevenues?\b/i, target: 'revenue', unit: 'currency' },
    { pattern: /\bprofits?\b/i, target: 'profit', unit: 'currency' },
    { pattern: /\bbudgets?\b/i, target: 'budget', unit: 'currency' },
    { pattern: /\bcosts?\b/i, target: 'cost', unit: 'currency' },
    { pattern: /\busers?\b/i, target: 'user_count', unit: 'count' },
    { pattern: /\bcustomers?\b/i, target: 'customer_count', unit: 'count' },
    { pattern: /\bconversion\s*(?:rate)?\b/i, target: 'conversion_rate', unit: 'ratio' },
    { pattern: /\bretention\s*(?:rate)?\b/i, target: 'retention_rate', unit: 'ratio' },
    { pattern: /\bNPS\b/i, target: 'nps_score', unit: 'score' },
    { pattern: /\bsales\b/i, target: 'sales', unit: 'currency' },
    { pattern: /\bgrowth\b/i, target: 'growth_rate', unit: 'ratio' },
    { pattern: /\bhires?\b/i, target: 'new_hires', unit: 'count' },
    { pattern: /\bheadcount\b/i, target: 'headcount', unit: 'count' },
    { pattern: /\bmargins?\b/i, target: 'profit_margin', unit: 'ratio' },
    { pattern: /\bquality\b/i, target: 'quality_score', unit: 'score' },
    { pattern: /\bCAC\b/i, target: 'customer_acquisition_cost', unit: 'currency' },
  ];

  let target = 'unknown_metric';
  let unit: string | undefined;

  for (const { pattern, target: t, unit: u } of metricPatterns) {
    if (pattern.test(clause)) {
      target = t;
      unit = u;
      break;
    }
  }

  // Heuristic: "exceeding $X" without a metric keyword implies budget/cost
  if (target === 'unknown_metric' && /\b(exceed(?:ing)?|not\s+exceed(?:ing)?)\b/i.test(clause)) {
    target = 'budget';
    unit = 'currency';
  }

  // Detect operator
  const operator = detectOperator(clause, isPrimary ? '>=' : '<=');

  return {
    target,
    operator,
    value,
    source_text: clause.trim(),
    is_primary: isPrimary,
    confidence: target === 'unknown_metric' ? 0.5 : 0.85,
    type: 'quantitative',
    unit,
  };
}

/**
 * Split brief into primary goal clause and constraint clauses.
 *
 * Approach:
 * 1. Find all split points (while, without, by Q1, etc.)
 * 2. Extract each segment as a constraint clause
 * 3. Primary clause is everything before the first split point
 */
function splitBriefIntoClauses(brief: string): { primaryClause: string; constraintClauses: string[] } {
  // Split markers - patterns that introduce constraint/subordinate clauses
  const splitPatterns = [
    /\bwhile\s+(?:keeping|maintaining|ensuring)\b/i,
    /\bwithout\s+(?:exceeding|going\s+over|breaking)\b/i,
    /\bnot\s+exceeding\b/i,
    /\band\s+(?:keep(?:ing)?|maintain(?:ing)?)\b/i,
    /\bby\s+Q[1-4](?:\s+\d{4})?\b/i,
    /\bby\s+(?:the\s+)?end\s+of\s+Q[1-4]\b/i,
    /\bwithin\s+\d+\s+(?:months?|weeks?|days?)\b/i,
    /\bbefore\s+\w+/i,
  ];

  // Find all split points
  const splitPoints: Array<{ index: number; text: string }> = [];

  for (const pattern of splitPatterns) {
    const regex = new RegExp(pattern.source, 'gi');
    let match;
    while ((match = regex.exec(brief)) !== null) {
      splitPoints.push({ index: match.index, text: match[0] });
    }
  }

  // Sort by index
  splitPoints.sort((a, b) => a.index - b.index);

  // Deduplicate overlapping matches (keep the first one)
  const deduped: typeof splitPoints = [];
  for (const point of splitPoints) {
    const overlaps = deduped.some(
      (existing) => point.index >= existing.index && point.index < existing.index + existing.text.length
    );
    if (!overlaps) {
      deduped.push(point);
    }
  }

  // No split points - return the whole brief as primary
  if (deduped.length === 0) {
    return { primaryClause: brief.trim(), constraintClauses: [] };
  }

  // Extract primary clause (before first split point)
  const primaryClause = brief.substring(0, deduped[0].index).trim();

  // Extract constraint clauses (from each split point to the next)
  const constraintClauses: string[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const start = deduped[i].index;
    const end = i + 1 < deduped.length ? deduped[i + 1].index : brief.length;
    const clause = brief.substring(start, end).trim();
    if (clause) {
      constraintClauses.push(clause);
    }
  }

  return { primaryClause, constraintClauses };
}

/**
 * Extract compound goals from a brief.
 *
 * Conservative extraction: only extracts when patterns are clear.
 * Ambiguous briefs return is_compound=false.
 *
 * @param brief Natural language brief text
 * @returns Extraction result with goals and constraints
 */
export function extractCompoundGoals(brief: string): CompoundGoalExtractionResult {
  const goals: ExtractedGoal[] = [];
  const patternsMatched: string[] = [];
  const ambiguities: string[] = [];

  if (!brief || typeof brief !== 'string' || brief.trim().length === 0) {
    return {
      goals: [],
      primary_goal: null,
      constraints: [],
      is_compound: false,
      diagnostics: { patterns_matched: [], ambiguities: ['empty_brief'] },
    };
  }

  const normalizedBrief = brief.trim();

  // Check if this looks like a compound goal brief
  const hasCompoundStructure = CONSTRAINT_MARKERS.test(normalizedBrief);

  // Split into clauses
  const { primaryClause, constraintClauses } = splitBriefIntoClauses(normalizedBrief);

  // Extract primary goal from main clause
  if (primaryClause && PRIMARY_GOAL_VERBS.test(primaryClause)) {
    const primaryGoal = extractQuantitativeGoal(primaryClause, true);
    if (primaryGoal && primaryGoal.target !== 'unknown_metric') {
      goals.push(primaryGoal);
      patternsMatched.push(`primary:${primaryGoal.target}`);
    } else if (primaryGoal) {
      ambiguities.push('primary_goal_target_unclear');
    }
  }

  // Handle simple constraint briefs (e.g., "Keep churn under 5%", "Maintain costs below $50k")
  // These briefs don't have compound structure but should still extract the constraint
  const CONSTRAINT_VERB_PATTERN = /\b(keep(?:ing)?|maintain(?:ing)?|limit(?:ing)?|cap(?:ping)?)\b/i;
  if (constraintClauses.length === 0 && CONSTRAINT_VERB_PATTERN.test(primaryClause)) {
    const constraintGoal = extractQuantitativeGoal(primaryClause, false);
    if (constraintGoal && constraintGoal.target !== 'unknown_metric') {
      goals.push(constraintGoal);
      patternsMatched.push(`constraint:${constraintGoal.target}`);
    }
  }

  // Extract constraint goals from subordinate clauses
  for (const clause of constraintClauses) {
    // Try temporal first
    const temporal = extractTemporalConstraint(clause);
    if (temporal) {
      goals.push(temporal);
      patternsMatched.push(`temporal:${temporal.target}`);
      continue;
    }

    // Try qualitative proxy
    const qualitative = extractQualitativeProxy(clause);
    if (qualitative) {
      goals.push(qualitative);
      patternsMatched.push(`qualitative:${qualitative.target}`);
      continue;
    }

    // Try quantitative
    const quantitative = extractQuantitativeGoal(clause, false);
    if (quantitative && quantitative.target !== 'unknown_metric') {
      goals.push(quantitative);
      patternsMatched.push(`constraint:${quantitative.target}`);
    } else if (quantitative) {
      ambiguities.push(`constraint_target_unclear:${clause.substring(0, 30)}`);
    }
  }

  // Also scan full brief for qualitative patterns not in subordinate clauses
  const qualitative = extractQualitativeProxy(normalizedBrief);
  if (qualitative && !goals.some((g) => g.target === qualitative.target)) {
    goals.push(qualitative);
    patternsMatched.push(`qualitative:${qualitative.target}`);
  }

  // Also scan for temporal constraints anywhere in brief
  const temporal = extractTemporalConstraint(normalizedBrief);
  if (temporal && !goals.some((g) => g.target === 'delivery_time_months')) {
    goals.push(temporal);
    patternsMatched.push(`temporal:${temporal.target}`);
  }

  // Separate primary and constraints
  const primary = goals.find((g) => g.is_primary) ?? null;
  const constraints = goals.filter((g) => !g.is_primary);

  // Determine if compound (multiple goals or explicit compound structure)
  const isCompound = goals.length > 1 || (hasCompoundStructure && goals.length >= 1);

  return {
    goals,
    primary_goal: primary,
    constraints,
    is_compound: isCompound,
    diagnostics: {
      patterns_matched: patternsMatched,
      ambiguities,
    },
  };
}

// -----------------------------------------------------------------------------
// Node/Constraint Generation
// -----------------------------------------------------------------------------

/**
 * Generate constraint nodes and GoalConstraint entries from extracted goals.
 *
 * @param extraction Extraction result from extractCompoundGoals
 * @param existingNodes Existing graph nodes (for ID resolution)
 * @returns Generated constraint infrastructure
 */
export function generateConstraintInfrastructure(
  extraction: CompoundGoalExtractionResult,
  existingNodes: EngineNodeV3[]
): ConstraintNodeGenerationResult {
  const nodes: EngineNodeV3[] = [];
  const edges: EngineEdgeV3[] = [];
  const goalConstraints: GoalConstraint[] = [];

  // Build node lookup for ID resolution
  const nodeByLabel = new Map<string, EngineNodeV3>();
  const nodeById = new Map<string, EngineNodeV3>();
  for (const node of existingNodes) {
    nodeById.set(node.id, node);
    if (node.label) {
      nodeByLabel.set(node.label.toLowerCase(), node);
    }
  }

  /**
   * Resolve target to existing node ID or create new node.
   */
  function resolveTargetNode(goal: ExtractedGoal): { node_id: string; node?: EngineNodeV3 } {
    // Try direct ID match
    if (nodeById.has(goal.target)) {
      return { node_id: goal.target };
    }

    // Try label match
    const labelNode = nodeByLabel.get(goal.target.toLowerCase().replace(/_/g, ' '));
    if (labelNode) {
      return { node_id: labelNode.id };
    }

    // For known canonical targets, check if similar exists
    const canonicalToPatterns: Record<string, RegExp[]> = {
      monthly_recurring_revenue: [/mrr/i, /recurring.*revenue/i],
      annual_recurring_revenue: [/arr/i, /annual.*revenue/i],
      monthly_churn_rate: [/churn/i],
      delivery_time_months: [/delivery/i, /time.*months?/i, /timeline/i],
      team_satisfaction_score: [/satisfaction/i, /morale/i],
      defect_rate: [/defect/i, /quality/i, /bug.*rate/i],
    };

    const patterns = canonicalToPatterns[goal.target];
    if (patterns) {
      for (const node of existingNodes) {
        const searchText = `${node.id} ${node.label ?? ''}`.toLowerCase();
        if (patterns.some((p) => p.test(searchText))) {
          return { node_id: node.id };
        }
      }
    }

    // Need to create new node (for temporal/qualitative proxies)
    if (goal.type === 'temporal' || goal.type === 'qualitative_proxy') {
      const newNode: EngineNodeV3 = {
        id: goal.target,
        kind: 'factor',
        label: goal.type === 'temporal' ? 'Time to delivery (months)' : goal.proxy_metadata?.proxy_mapping ?? goal.target,
        observed_state: goal.type === 'temporal' ? { value: 0, unit: 'months' } : undefined,
        // Include state_space for proxy nodes to enable stable normalization
        state_space: goal.state_space_range ? { range: goal.state_space_range } : undefined,
      };
      return { node_id: goal.target, node: newNode };
    }

    return { node_id: goal.target };
  }

  // Process each constraint goal
  for (const goal of extraction.constraints) {
    const { node_id: targetNodeId, node: newNode } = resolveTargetNode(goal);

    // Add new node if needed
    if (newNode && !nodeById.has(newNode.id)) {
      nodes.push(newNode);
      nodeById.set(newNode.id, newNode);
    }

    // Generate constraint ID
    const operatorShorthand = goal.operator === '>=' ? 'gte' : 'lte';
    const constraintId = `cee_${targetNodeId}_${operatorShorthand}`;

    // Create GoalConstraint entry
    const constraint: GoalConstraint = {
      constraint_id: constraintId,
      node_id: targetNodeId,
      operator: goal.operator,
      value: goal.value,
      label: goal.source_text.length < 100 ? goal.source_text : undefined,
    };
    goalConstraints.push(constraint);

    // Create constraint node (for graph visualization)
    // Note: We use type assertion for the constraint node since 'constraint' kind
    // and 'data' field are PLoT-specific extensions not in the base type
    const constraintNodeId = `constraint_${targetNodeId}_${operatorShorthand}`;
    const constraintNode = {
      id: constraintNodeId,
      kind: 'constraint',
      label: `Target: ${goal.operator === '>=' ? '≥' : '≤'} ${goal.value}${goal.unit ? ` ${goal.unit}` : ''}`,
      observed_state: {
        value: goal.value,
        unit: goal.unit,
        metadata: {
          operator: goal.operator, // REQUIRED - ASCII only
          original_value: goal.value,
          provenance: 'cee_extraction',
          extraction_confidence: goal.confidence,
          extraction_type: goal.type,
          ...(goal.temporal_metadata ?? {}),
          ...(goal.proxy_metadata ?? {}),
        },
      },
      data: {
        operator: goal.operator, // Redundant but ensures PLoT finds it
      },
    } as unknown as EngineNodeV3;
    nodes.push(constraintNode);

    // Create edge from target to constraint
    const edge: EngineEdgeV3 = {
      from: targetNodeId,
      to: constraintNodeId,
      exists_probability: 1.0,
      strength: { mean: 1.0, std: 0.0 }, // Definitional link
    };
    edges.push(edge);
  }

  return { nodes, edges, goal_constraints: goalConstraints };
}

// -----------------------------------------------------------------------------
// Integration Entry Point
// -----------------------------------------------------------------------------

/**
 * Process brief for compound goal extraction and generate infrastructure.
 *
 * This is the main entry point for CEE integration.
 *
 * @param brief Natural language brief
 * @param existingNodes Existing graph nodes
 * @returns Extraction result with generated infrastructure, or null if no compound goals
 */
export function processCompoundGoals(
  brief: string | undefined,
  existingNodes: EngineNodeV3[]
): {
  extraction: CompoundGoalExtractionResult;
  infrastructure: ConstraintNodeGenerationResult | null;
} | null {
  if (!brief) {
    return null;
  }

  const extraction = extractCompoundGoals(brief);

  // If no compound structure or all ambiguous, return null (single-goal path)
  if (!extraction.is_compound || extraction.constraints.length === 0) {
    return {
      extraction,
      infrastructure: null,
    };
  }

  const infrastructure = generateConstraintInfrastructure(extraction, existingNodes);

  return {
    extraction,
    infrastructure,
  };
}

/**
 * Check if a brief contains compound goal patterns.
 * Used for quick filtering before full extraction.
 */
export function hasCompoundGoalPatterns(brief: string | undefined): boolean {
  if (!brief) return false;
  return CONSTRAINT_MARKERS.test(brief);
}
