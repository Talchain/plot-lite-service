/**
 * Categorical integrity detector.
 *
 * Detects nominal categorical interventions at PLoT request parse,
 * BEFORE normalisation and BEFORE any ISL call. The detector ensures the
 * system either accepts an explicitly safe one-hot representation OR blocks
 * with an actionable critique. No silent ordinal-encoding path may remain.
 *
 * Audit context: row C1-A (P0) in
 *   ~/Documents/Olumi/audits/2026-05-truth-table/truth-table.md
 * Verified live on staging that integer-encoded categoricals (value: 0/1/2 with
 * value_type: "categorical") were silently normalised to 0/0.4167/0.8333,
 * producing EU=0.926 win-probability driven by integer-2-doubles-effect-of-1
 * ordinal bias the CEE prompt explicitly warns against. Zero critiques fired.
 *
 * Detection rules (a factor is treated as nominal-categorical when AT LEAST ONE):
 *   1. Explicit `value_type: "categorical"` on any intervention referencing the factor
 *      across options. BYPASSED for binary categorical (≤ 2 distinct values across
 *      options AND encoding_map size ≤ 2).
 *   2. Non-empty `encoding_map` with size ≥ 3.
 *   3. Integer-coded interventions across 3+ options on the same factor AND the
 *      factor carries categorical metadata (rule 1 metadata, rule 2 map, OR
 *      `raw_value` is a non-numeric string). Value-shape alone is INSUFFICIENT.
 *   4. (Future) Known categorical field names emitted by CEE — currently empty;
 *      see `detectByCEEFieldNames` below for the wiring point.
 *   5. Explicit nominal markers — `type: "nominal"` or non-empty `categories[]`.
 *      No binary-categorical bypass: the LLM is asserting "this factor IS nominal"
 *      regardless of how the values are encoded. The conservative contract treats
 *      it as a deliberate declaration that the factor cannot be analysed on a
 *      single numeric scale. Bypassed only by explicit ordinal markers or
 *      validated one-hot grouping.
 *
 * Ordinal pass condition: explicit type:"ordinal", ordered_categories[], or
 * ordinal_scale: true. None of these markers exist in CEE today; the check is
 * implemented as a wiring point for when CEE adds ordinal support.
 *
 * One-hot validation: a group of indicators is treated as safe one-hot only when
 * grouped by EXPLICIT shared metadata (`categorical_group_id`) AND every option
 * explicitly sets every indicator in the group to 0 or 1, with exactly one set
 * to 1. Options that omit any group member raise ONE_HOT_MUTEX_VIOLATION
 * (kind: missing_indicator_in_option). Options that omit the group entirely
 * are also treated as a violation: status-quo or unrelated options must
 * declare their position on the categorical explicitly via observed_state on
 * the node, not via selective omission.
 *
 * Inconsistent group_id metadata across options (different IDs on the same
 * factor, or some options omit it while others don't) raises
 * ONE_HOT_GROUPING_INCONSISTENT. Naming-pattern inference is intentionally
 * NOT supported. The grouping field does not exist in CEE today; CEE follow-up
 * brief lands the metadata. Until then, `validateOneHotGrouping` actively
 * returns no validated groups and any multi-option categorical flows into the
 * block path via rules 1–5.
 *
 * STRIPPED_FIELD_WARNING is emitted only when scientifically-meaningful fields
 * were dropped on a passed-through (non-blocked) factor. Triggers:
 *   - `value_type` (any value)
 *   - non-empty `encoding_map`
 *   - `raw_value` ONLY when co-occurring with `value_type: "categorical"` or
 *     non-empty `encoding_map`. `raw_value` alone is often display metadata for
 *     numeric/currency factors and does NOT trigger.
 * Display-only and unknown extension fields do NOT trigger the warning.
 *
 * The detector is pure: no I/O, no env reads, deterministic for a given input.
 * The route layer reads the env feature flag and decides whether to invoke.
 *
 * Type safety: input is `unknown`, narrowed via type guards. No `any`. The
 * shape of `body.options` at the route entry is permissive (Record<string, any>
 * for interventions — see runV3Schema in run.ts) which is why we narrow here.
 */

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type CategoricalTrigger =
  | 'value_type_categorical'
  | 'encoding_map_size_3plus'
  | 'integer_coded_3plus_with_categorical_metadata'
  | 'explicit_nominal_type'
  | 'explicit_categories_field';

export type GroupingViolation =
  | 'mutex_count_not_one'
  | 'non_binary_indicator_value'
  | 'missing_indicator_in_option'
  | 'inconsistent_group_id_across_options'
  | 'partial_group_id_coverage';

export type StrippedFieldName = 'value_type' | 'raw_value' | 'encoding_map';

export interface CategoricalFactorDetection {
  /** Factor (intervention key) that triggered detection. */
  factor_id: string;
  /** Which rule fired. */
  trigger: CategoricalTrigger;
  /** Distinct intervention values across options for this factor. */
  distinct_value_count: number;
  /** Option ids that intervened on this factor. */
  options_referencing_factor: ReadonlyArray<string>;
  // Note: a `raw_values_sample` field used to live here for trace/debug.
  // Removed (post-merge review P2): it was unused by every consumer and
  // was a footgun for future telemetry — populating raw user input on a
  // public type invites accidental logging. Keep raw_value content out
  // of detector outputs entirely.
}

export interface OneHotMutexViolation {
  group_id: string;
  option_id: string;
  /** Which sub-rule fired. Internal — keep out of user-facing copy. */
  kind: GroupingViolation;
  /** Internal-only diagnostic; not echoed to user copy verbatim. */
  reason: string;
}

/**
 * A factor whose `categorical_group_id` is inconsistent across options
 * (different IDs on different options, or some options omit it). Conservative
 * contract: any inconsistency blocks. Distinct from per-option mutex
 * violations within an already-consistent group.
 */
export interface OneHotGroupingInconsistency {
  factor_id: string;
  kind: 'inconsistent_group_id_across_options' | 'partial_group_id_coverage';
  /**
   * Internal trace: the distinct group_id values seen on this factor across
   * options (or 'undefined' for options that omitted it). User-facing copy
   * must NOT echo these values.
   */
  observed_group_ids: ReadonlyArray<string | null>;
  options_referencing_factor: ReadonlyArray<string>;
}

export interface OneHotValidatedGroup {
  group_id: string;
  factor_ids: ReadonlyArray<string>;
}

export interface StrippedFieldRecord {
  option_id: string;
  factor_id: string;
  field: StrippedFieldName;
}

export interface CategoricalDetectionResult {
  /** Factors that must block analysis. */
  blocked_factors: ReadonlyArray<CategoricalFactorDetection>;
  /** Explicitly grouped one-hot factor groups that passed validation. */
  one_hot_validated_groups: ReadonlyArray<OneHotValidatedGroup>;
  /** Mutex violations within explicit groups (per-option). */
  one_hot_mutex_violations: ReadonlyArray<OneHotMutexViolation>;
  /** Factors whose group_id metadata is inconsistent across options (block). */
  one_hot_grouping_inconsistencies: ReadonlyArray<OneHotGroupingInconsistency>;
  /** Scientifically-meaningful fields that will be silently stripped on passed-through factors. */
  stripped_meaningful_fields: ReadonlyArray<StrippedFieldRecord>;
}

// -----------------------------------------------------------------------------
// Type guards (narrowing unknown → typed inputs)
// -----------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Normalise a known-enum metadata string for case-insensitive comparison.
 * Returns trimmed lowercase form, or undefined if input isn't a string.
 *
 * Used for `value_type`, `type`, and similar enum-shaped fields where
 * upstream variants ("Categorical", "NOMINAL", " ordinal ") should match
 * the canonical lowercase form. Free-text fields (raw_value, labels) are
 * NOT normalised — those are user content, not enums.
 */
function asNormalisedEnum(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed.toLowerCase();
}

interface NarrowedIntervention {
  value: number | undefined;
  value_type: string | undefined;
  raw_value: unknown;
  encoding_map: Record<string, unknown> | undefined;
  /**
   * Explicit one-hot grouping metadata. Does not exist in CEE today; CEE
   * follow-up brief will populate it. When set on every option's intervention
   * for a given factor (uniformly), `validateOneHotGrouping` validates the
   * group as safe one-hot.
   */
  categorical_group_id: string | undefined;
  /**
   * Explicit factor type. Two values are recognised:
   *   - 'nominal' → triggers nominal-categorical block (no binary bypass)
   *   - 'ordinal' → bypasses block (factor declares an ordered scale)
   * Any other value is ignored.
   */
  type: string | undefined;
  /**
   * Explicit list of categorical values. Non-empty → nominal categorical
   * (block) unless explicitly ordinal or in a validated one-hot group.
   */
  categories: ReadonlyArray<unknown> | undefined;
  ordered_categories: ReadonlyArray<unknown> | undefined;
  ordinal_scale: boolean | undefined;
}

function narrowIntervention(raw: unknown): NarrowedIntervention | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return {
      value: raw,
      value_type: undefined,
      raw_value: undefined,
      encoding_map: undefined,
      categorical_group_id: undefined,
      type: undefined,
      categories: undefined,
      ordered_categories: undefined,
      ordinal_scale: undefined,
    };
  }
  if (!isObject(raw)) return undefined;
  const value = isFiniteNumber(raw.value) ? raw.value : undefined;
  // value_type and type are enum-shaped — normalise for case-insensitive
  // comparison (post-merge review P2: future schema variants like
  // "Categorical" / "NOMINAL" / " ordinal " should not false-negative).
  const value_type = asNormalisedEnum(raw.value_type);
  const type = asNormalisedEnum(raw.type);
  // raw_value is free-form user content — NEVER normalise.
  const raw_value = raw.raw_value;
  const encoding_map = isObject(raw.encoding_map) ? raw.encoding_map : undefined;
  // categorical_group_id is an opaque identifier; trim only (preserve case
  // so equality across options matches what the producer wrote).
  const groupRaw = asStringOrUndefined(raw.categorical_group_id);
  const categorical_group_id = groupRaw !== undefined && groupRaw.trim().length > 0
    ? groupRaw.trim()
    : undefined;
  const categories = Array.isArray(raw.categories) ? raw.categories : undefined;
  const ordered_categories = Array.isArray(raw.ordered_categories) ? raw.ordered_categories : undefined;
  const ordinal_scale = typeof raw.ordinal_scale === 'boolean' ? raw.ordinal_scale : undefined;
  return {
    value,
    value_type,
    raw_value,
    encoding_map,
    categorical_group_id,
    type,
    categories,
    ordered_categories,
    ordinal_scale,
  };
}

interface NarrowedOption {
  id: string;
  label: string | undefined;
  interventions: Map<string, NarrowedIntervention>;
}

function narrowOption(raw: unknown): NarrowedOption | undefined {
  if (!isObject(raw)) return undefined;
  const id = asStringOrUndefined(raw.id);
  if (id === undefined) return undefined;
  const label = asStringOrUndefined(raw.label);
  const intervBag = raw.interventions;
  if (!isObject(intervBag)) return undefined;
  const interventions = new Map<string, NarrowedIntervention>();
  for (const [factorId, val] of Object.entries(intervBag)) {
    const narrowed = narrowIntervention(val);
    if (narrowed) interventions.set(factorId, narrowed);
  }
  return { id, label, interventions };
}

// -----------------------------------------------------------------------------
// Per-rule detection helpers
// -----------------------------------------------------------------------------

interface FactorAggregate {
  factor_id: string;
  /** ordered: each entry corresponds to one option that intervenes on this factor */
  per_option: ReadonlyArray<{ option_id: string; intervention: NarrowedIntervention }>;
}

function aggregateFactors(options: ReadonlyArray<NarrowedOption>): ReadonlyArray<FactorAggregate> {
  const map = new Map<string, Array<{ option_id: string; intervention: NarrowedIntervention }>>();
  for (const opt of options) {
    for (const [factorId, intervention] of opt.interventions) {
      const arr = map.get(factorId) ?? [];
      arr.push({ option_id: opt.id, intervention });
      map.set(factorId, arr);
    }
  }
  return Array.from(map.entries()).map(([factor_id, per_option]) => ({ factor_id, per_option }));
}

function distinctValues(per_option: ReadonlyArray<{ intervention: NarrowedIntervention }>): ReadonlyArray<number> {
  const set = new Set<number>();
  for (const { intervention } of per_option) {
    if (intervention.value !== undefined) set.add(intervention.value);
  }
  return Array.from(set);
}

/**
 * True when the factor has consistent ordinal metadata AND no contradicting
 * nominal metadata. Mixed ordinal+nominal is treated as ambiguous and falls
 * through to nominal detection (which will block).
 *
 * Hardened (post-merge review P1): the previous version returned true if ANY
 * option declared ordinal, ignoring nominal markers on other options. That
 * let an LLM accidentally bypass the categorical block by setting
 * `type:"ordinal"` on one option even when other options for the same
 * factor declared `type:"nominal"` or `categories[]`. Conservative-block
 * contract requires ambiguity to block.
 */
function isUnambiguouslyOrdinal(per_option: ReadonlyArray<{ intervention: NarrowedIntervention }>): boolean {
  let hasOrdinalMarker = false;
  let hasNominalMarker = false;
  for (const { intervention } of per_option) {
    if (intervention.type === 'ordinal') hasOrdinalMarker = true;
    if (intervention.ordinal_scale === true) hasOrdinalMarker = true;
    if (intervention.ordered_categories && intervention.ordered_categories.length > 0) hasOrdinalMarker = true;
    if (intervention.type === 'nominal') hasNominalMarker = true;
    if (intervention.categories && intervention.categories.length > 0) hasNominalMarker = true;
    // value_type:"categorical" is treated as nominal-leaning for this check
    // (it asserts the data type is unordered-categorical, which contradicts
    // an ordinal claim on the same factor).
    if (intervention.value_type === 'categorical') hasNominalMarker = true;
  }
  return hasOrdinalMarker && !hasNominalMarker;
}

/**
 * Rule 1 — explicit `value_type: "categorical"`. BYPASSED only for the
 * canonical safe-binary-indicator pattern (distinct ⊆ {0,1}).
 * Returns trigger if rule fires; undefined otherwise.
 */
function rule1ValueTypeCategorical(agg: FactorAggregate): CategoricalTrigger | undefined {
  const hasCategoricalMarker = agg.per_option.some(({ intervention }) => intervention.value_type === 'categorical');
  if (!hasCategoricalMarker) return undefined;
  const distinct = distinctValues(agg.per_option);
  // Binary categorical bypass — safety carve-out for the case where CEE
  // marks per-category one-hot indicators as `value_type:"categorical"`
  // with strictly binary {0, 1} values. Tightened (post-merge review P1 #4):
  // the previous version accepted "≤ 2 distinct values" which would let
  // arbitrary 2-value nominal encodings ({0, 2}, {1, 2}, ...) bypass.
  // Now require every distinct value to be exactly 0 or 1, so only the
  // canonical safe-binary-indicator shape passes.
  const maxEncodingMapSize = agg.per_option.reduce((acc, { intervention }) => {
    const size = intervention.encoding_map ? Object.keys(intervention.encoding_map).length : 0;
    return Math.max(acc, size);
  }, 0);
  const allValuesAreCanonicalBinary = distinct.length > 0 && distinct.every((v) => v === 0 || v === 1);
  if (allValuesAreCanonicalBinary && distinct.length <= 2 && maxEncodingMapSize <= 2) {
    return undefined;
  }
  return 'value_type_categorical';
}

/**
 * Rule 2 — non-empty encoding_map with size ≥ 3.
 */
function rule2EncodingMap(agg: FactorAggregate): CategoricalTrigger | undefined {
  for (const { intervention } of agg.per_option) {
    if (intervention.encoding_map && Object.keys(intervention.encoding_map).length >= 3) {
      return 'encoding_map_size_3plus';
    }
  }
  return undefined;
}

/**
 * Rule 3 — integer-coded interventions across 3+ options on the same factor
 * AND carries categorical metadata (value_type:"categorical" OR non-empty
 * encoding_map OR `raw_value` is a non-numeric string). Value-shape alone
 * (3+ integers without metadata) does NOT trigger.
 */
function rule3IntegerCodedWithMetadata(agg: FactorAggregate): CategoricalTrigger | undefined {
  if (agg.per_option.length < 3) return undefined;
  const values = agg.per_option
    .map(({ intervention }) => intervention.value)
    .filter((v): v is number => v !== undefined);
  if (values.length < 3) return undefined;
  // Distinct check
  const distinct = new Set(values);
  if (distinct.size < 3) return undefined;
  // Integer check (every value must be an integer)
  const allIntegers = values.every((v) => Number.isInteger(v));
  if (!allIntegers) return undefined;
  // Categorical metadata required
  const hasMeta = agg.per_option.some(({ intervention }) => {
    if (intervention.value_type === 'categorical') return true;
    if (intervention.encoding_map && Object.keys(intervention.encoding_map).length > 0) return true;
    if (typeof intervention.raw_value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(intervention.raw_value)) {
      return true;
    }
    return false;
  });
  if (!hasMeta) return undefined;
  return 'integer_coded_3plus_with_categorical_metadata';
}

/**
 * Rule 4 — known categorical field names emitted by CEE.
 *
 * Per Phase 1 audit (2026-05): CEE today emits {value_type, encoding_map,
 * raw_value} only — all already covered by rules 1–3. This function is the
 * wiring point for future CEE field additions; today returns no extra triggers.
 */
function detectByCEEFieldNames(_agg: FactorAggregate): CategoricalTrigger | undefined {
  // Today: no additional CEE-specific categorical field names beyond rules 1–3.
  // When CEE emits new fields (e.g. `nominal: true`, `categorical_kind: "..."`),
  // add those checks here.
  return undefined;
}

/**
 * Rule 5 — explicit nominal markers: `type: "nominal"` or non-empty
 * `categories` array. Stronger semantic claim than `value_type:"categorical"`
 * — the LLM is asserting "this factor IS a nominal variable", regardless of
 * how the values are encoded. No binary-categorical bypass: the conservative
 * contract treats this as a deliberate declaration that the factor cannot be
 * compared on a single numeric scale.
 *
 * Bypassed only by the explicit ordinal pass condition (handled at the call
 * site) or by validated one-hot grouping (also handled at the call site).
 */
function rule5ExplicitNominal(agg: FactorAggregate): CategoricalTrigger | undefined {
  for (const { intervention } of agg.per_option) {
    if (intervention.type === 'nominal') return 'explicit_nominal_type';
    if (intervention.categories && intervention.categories.length > 0) return 'explicit_categories_field';
  }
  return undefined;
}

// -----------------------------------------------------------------------------
// One-hot grouping
// -----------------------------------------------------------------------------

/**
 * Validate explicitly-grouped one-hot indicator factors.
 *
 * Returns:
 *   - `groups`: groups that pass full validation (consistent group_id across
 *              every option that mentions any group member, every option
 *              explicitly sets every member to 0 or 1, with exactly one 1).
 *   - `mutex_violations`: per-option mutex failures within an otherwise-
 *              consistent group (count != 1, non-binary values, or missing
 *              member).
 *   - `inconsistencies`: factors whose `categorical_group_id` is inconsistent
 *              across options (different IDs, or some options omit it).
 *              Distinct from mutex violations: the structural grouping itself
 *              is malformed.
 *
 * Conservative-block contract: any inconsistency or violation prevents
 * validation. Without a validated group, multi-option categoricals fall into
 * the block path via rules 1–5.
 *
 * Naming-pattern inference (e.g. `fac_market_uk` + `fac_market_us`) is
 * intentionally NOT supported — it would re-introduce the silent-strip class
 * of bug this guard prevents (audit C1-A).
 *
 * No CEE emit site populates `categorical_group_id` today. CEE follow-up
 * brief lands the metadata; this function honours it without any other
 * code change.
 */
function validateOneHotGrouping(options: ReadonlyArray<NarrowedOption>): {
  groups: ReadonlyArray<OneHotValidatedGroup>;
  mutex_violations: ReadonlyArray<OneHotMutexViolation>;
  inconsistencies: ReadonlyArray<OneHotGroupingInconsistency>;
} {
  // -- Step 1: Collect, per factor, the group_id observed on each option that
  //    mentions that factor. `null` means "option mentions the factor but does
  //    not set categorical_group_id". This lets us detect both inconsistency
  //    (different IDs) and partial coverage (some options set, some don't).
  type GroupIdObservation = { option_id: string; group_id: string | null };
  const factorObservations = new Map<string, GroupIdObservation[]>();
  for (const opt of options) {
    for (const [factorId, intervention] of opt.interventions) {
      const gid = intervention.categorical_group_id;
      const observation: GroupIdObservation = {
        option_id: opt.id,
        group_id: gid !== undefined && gid.length > 0 ? gid : null,
      };
      const arr = factorObservations.get(factorId) ?? [];
      arr.push(observation);
      factorObservations.set(factorId, arr);
    }
  }

  // -- Step 2: Classify each factor's grouping consistency.
  //    Three terminal states:
  //      - "no_grouping": no option sets group_id → factor not part of any
  //                       validated group; falls through to per-rule checks.
  //      - "consistent":  every observation sets the SAME non-null group_id →
  //                       factor is a candidate for one-hot validation.
  //      - "inconsistent" / "partial": block (emit OneHotGroupingInconsistency).
  const factorToConsistentGroup = new Map<string, string>();
  const inconsistencies: OneHotGroupingInconsistency[] = [];
  for (const [factorId, observations] of factorObservations) {
    const distinctIds = new Set<string | null>();
    for (const obs of observations) distinctIds.add(obs.group_id);
    // No grouping anywhere — factor doesn't participate in one-hot validation.
    if (distinctIds.size === 1 && distinctIds.has(null)) continue;
    // Consistent grouping — every option sets the same non-null group_id.
    if (distinctIds.size === 1) {
      const onlyId = [...distinctIds][0];
      if (onlyId !== null) {
        factorToConsistentGroup.set(factorId, onlyId);
        continue;
      }
    }
    // Otherwise: ambiguous — either conflicting IDs or partial coverage.
    const observedIds = Array.from(distinctIds);
    const partial = observedIds.includes(null) && observedIds.some((id) => id !== null);
    inconsistencies.push({
      factor_id: factorId,
      kind: partial ? 'partial_group_id_coverage' : 'inconsistent_group_id_across_options',
      observed_group_ids: observedIds,
      options_referencing_factor: observations.map((o) => o.option_id),
    });
  }

  if (factorToConsistentGroup.size === 0) {
    // Either no grouping anywhere, or every grouping attempt was ambiguous.
    return { groups: [], mutex_violations: [], inconsistencies };
  }

  // -- Step 3: Group consistent factors by their group_id.
  const groupMembers = new Map<string, Set<string>>();
  for (const [factorId, groupId] of factorToConsistentGroup) {
    const set = groupMembers.get(groupId) ?? new Set<string>();
    set.add(factorId);
    groupMembers.set(groupId, set);
  }

  // -- Step 4: For each group, validate per-option mutex AND completeness:
  //    every option must explicitly set every group member to 0 or 1, with
  //    exactly one set to 1. Missing indicator = violation. Options that omit
  //    the group entirely are also a violation — selective omission is not
  //    treated as "I'm not in this group" because that creates structural
  //    ambiguity (which value does the factor take for that option?). The
  //    expected pattern for a status-quo or unrelated option is: explicitly
  //    set every indicator to its baseline value, OR encode the baseline via
  //    `observed_state.value` on the node (not through intervention omission).
  const mutexViolations: OneHotMutexViolation[] = [];
  for (const [groupId, members] of groupMembers) {
    for (const opt of options) {
      let onesCount = 0;
      let nonBinarySeen = false;
      let missingSeen = false;
      for (const factorId of members) {
        const intervention = opt.interventions.get(factorId);
        if (!intervention) {
          missingSeen = true;
          continue;
        }
        const v = intervention.value;
        if (v === 1) onesCount += 1;
        else if (v === 0) {
          // OK — explicit zero.
        } else {
          // Either undefined (no value) or a non-{0,1} number.
          nonBinarySeen = true;
        }
      }

      if (missingSeen) {
        mutexViolations.push({
          group_id: groupId,
          option_id: opt.id,
          kind: 'missing_indicator_in_option',
          reason: 'Option does not explicitly set every indicator in the group; missing indicators must be 0.',
        });
      } else if (nonBinarySeen) {
        mutexViolations.push({
          group_id: groupId,
          option_id: opt.id,
          kind: 'non_binary_indicator_value',
          reason: 'Option set a non-binary value on an indicator; expected 0 or 1 only.',
        });
      } else if (onesCount !== 1) {
        mutexViolations.push({
          group_id: groupId,
          option_id: opt.id,
          kind: 'mutex_count_not_one',
          reason: `Option set ${onesCount} indicators to 1; expected exactly 1.`,
        });
      }
    }
  }

  // -- Step 5: A group is validated iff zero mutex violations on any option.
  const groups: OneHotValidatedGroup[] = [];
  for (const [groupId, members] of groupMembers) {
    const groupHasViolation = mutexViolations.some((v) => v.group_id === groupId);
    if (!groupHasViolation) {
      groups.push({ group_id: groupId, factor_ids: Array.from(members) });
    }
  }
  return { groups, mutex_violations: mutexViolations, inconsistencies };
}

// -----------------------------------------------------------------------------
// Stripped-field detection
// -----------------------------------------------------------------------------

/**
 * Compute stripped-meaningful-field records for factors that PASSED detection.
 *
 * Triggers (per brief correction #3):
 *   - `value_type` (any value, e.g. "boolean" preserved as binary numeric — strip warns)
 *   - non-empty `encoding_map`
 *   - `raw_value` ONLY when co-occurring with `value_type: "categorical"` OR
 *     non-empty `encoding_map`. `raw_value` alone is often display metadata
 *     for numeric/currency factors (e.g. raw_value: "$180,000") and does NOT
 *     trigger the warning.
 */
function detectStrippedFields(
  options: ReadonlyArray<NarrowedOption>,
  blockedFactorIds: ReadonlySet<string>,
  validatedGroupFactorIds: ReadonlySet<string>,
): ReadonlyArray<StrippedFieldRecord> {
  const out: StrippedFieldRecord[] = [];
  for (const opt of options) {
    for (const [factorId, intervention] of opt.interventions) {
      // Skip blocked factors — their critique is the primary signal.
      if (blockedFactorIds.has(factorId)) continue;
      // Skip validated one-hot members — they're explicitly accepted; the strip
      // is expected (we keep what we need, drop display metadata).
      if (validatedGroupFactorIds.has(factorId)) continue;
      const hasMeaningfulCategoricalMeta =
        intervention.value_type === 'categorical' ||
        (intervention.encoding_map !== undefined && Object.keys(intervention.encoding_map).length > 0);
      // value_type — any non-undefined value triggers warning
      if (intervention.value_type !== undefined) {
        out.push({ option_id: opt.id, factor_id: factorId, field: 'value_type' });
      }
      // encoding_map — non-empty triggers
      if (intervention.encoding_map !== undefined && Object.keys(intervention.encoding_map).length > 0) {
        out.push({ option_id: opt.id, factor_id: factorId, field: 'encoding_map' });
      }
      // raw_value — only triggers when paired with categorical metadata
      if (intervention.raw_value !== undefined && hasMeaningfulCategoricalMeta) {
        out.push({ option_id: opt.id, factor_id: factorId, field: 'raw_value' });
      }
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Main entry point
// -----------------------------------------------------------------------------

/**
 * Detect categorical integrity issues across a request's raw options.
 *
 * Pure function. Pass `body.options` directly (untyped — narrowed internally).
 *
 * @param rawOptions Untyped request-body options array. Each element narrowed
 *                   via type guards. Malformed entries are skipped silently
 *                   (existing route validation handles malformed shapes).
 * @returns Detection result with blockers, validated groups, mutex violations,
 *          and stripped-field records.
 */
export function detectCategoricalIssues(rawOptions: ReadonlyArray<unknown>): CategoricalDetectionResult {
  const options: NarrowedOption[] = [];
  for (const raw of rawOptions) {
    const narrowed = narrowOption(raw);
    if (narrowed) options.push(narrowed);
  }

  const factors = aggregateFactors(options);

  // One-hot grouping runs first so:
  //   - validated groups bypass per-rule detection
  //   - inconsistencies (conflict/partial coverage) become their own blockers
  //   - mutex violations are surfaced separately
  const {
    groups: validatedGroups,
    mutex_violations: mutexViolations,
    inconsistencies: groupingInconsistencies,
  } = validateOneHotGrouping(options);

  const validatedFactorIds = new Set<string>();
  for (const g of validatedGroups) {
    for (const fid of g.factor_ids) validatedFactorIds.add(fid);
  }

  const blocked: CategoricalFactorDetection[] = [];
  for (const agg of factors) {
    // Validated one-hot members are NOT blocked.
    if (validatedFactorIds.has(agg.factor_id)) continue;
    // Explicit ordinal pass condition: ordinal markers present AND no
    // contradicting nominal markers on the same factor (post-merge review
    // P1 #3 — mixed ordinal+nominal must not silently let ordinal win).
    if (isUnambiguouslyOrdinal(agg.per_option)) continue;

    const trigger =
      rule1ValueTypeCategorical(agg) ??
      rule2EncodingMap(agg) ??
      rule3IntegerCodedWithMetadata(agg) ??
      detectByCEEFieldNames(agg) ??
      rule5ExplicitNominal(agg);
    if (!trigger) continue;

    const distinct = distinctValues(agg.per_option);
    blocked.push({
      factor_id: agg.factor_id,
      trigger,
      distinct_value_count: distinct.length,
      options_referencing_factor: agg.per_option.map((p) => p.option_id),
    });
  }

  const blockedIds = new Set(blocked.map((b) => b.factor_id));
  // Inconsistent grouping factors are not in `blocked` (they're in their own
  // bucket) — exclude them from stripped-field warnings to avoid double-
  // signalling on the same factor.
  for (const inc of groupingInconsistencies) blockedIds.add(inc.factor_id);
  const stripped = detectStrippedFields(options, blockedIds, validatedFactorIds);

  return {
    blocked_factors: blocked,
    one_hot_validated_groups: validatedGroups,
    one_hot_mutex_violations: mutexViolations,
    one_hot_grouping_inconsistencies: groupingInconsistencies,
    stripped_meaningful_fields: stripped,
  };
}
