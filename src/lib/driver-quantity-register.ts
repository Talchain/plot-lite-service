/**
 * The DRIVER-QUANTITY REGISTER — every number a driver-bearing row carries,
 * with the four things a TypeScript type cannot state about it.
 *
 * Family 4, amendment §3.2. The amendment's own quantity census dropped items
 * between two sections of one document, and named the lesson:
 *
 * > *"The census dropped items between two sections of one document, written in
 * > one sitting, by one author who was actively looking for them. That is not a
 * > criticism of the lane — it is the trap-12 proof obligation discharged in
 * > miniature: a list a human must remember to sync WILL drift, and the drift
 * > reads as complete."*
 * > ⇒ **"The authority table must not ship as a table. It must ship as a DERIVED
 * > REGISTER with a fail-loud gate."**
 *
 * ## ⭐ HOW THIS AVOIDS BEING THE MIRROR IT REPLACES
 *
 * The **domain** — *which* fields must appear below — is NOT written here. It is
 * extracted by AST from the contract type declarations themselves
 * (`tools/derive-driver-quantities.mjs`), and
 * `tests/driver-quantity-register.derived.test.ts` fails on ANY drift in either
 * direction:
 *
 *   · a numeric field with no entry ⇒ RED (a new quantity cannot arrive silently);
 *   · an entry naming a field that no longer exists ⇒ RED (a stale row cannot
 *     linger and make the register read as complete);
 *   · an unparseable derivation ⇒ RED, never an empty domain that passes by
 *     testing nothing.
 *
 * What a human supplies is only what a type genuinely cannot: what the number
 * MEANS. That is the irreducible manual part, and it is the part a reviewer can
 * actually check.
 *
 * ## Why `unit` and `sign` are here rather than on the schema
 *
 * The base design's R-3 is right that `z.number().optional()` cannot detect a
 * unit substitution — and this family's sharpest live defect was exactly that
 * (`elasticity` published under the name `sensitivity_score`: opposite sign,
 * 2.84× apart, same field name, same response). A register that records the
 * unit and the sign makes the next such substitution a diff rather than an
 * archaeology exercise.
 */

/**
 * What KIND of claim the number is, under the four-role model
 * (ISL measures · PLoT orders + attests · CEE permits · UI renders).
 *
 * - `'measurement'` — an estimate of something in the world. Has a unit and a
 *   sampling story.
 * - `'designation'` — a producer's assignment over a set (a rank). Carries no
 *   magnitude information beyond the ordering it encodes.
 * - `'derived'` — computed from other members of this same register; its
 *   honesty is inherited from theirs.
 * - `'diagnostic'` — a property of the ESTIMATION, not of the decision
 *   (bootstrap spread, flip rate). Never a driver's importance.
 */
export type DriverQuantityRole = 'measurement' | 'designation' | 'derived' | 'diagnostic';

/**
 * What the producer DOES with it on the public wire.
 *
 * - `'published'` — emitted as measured.
 * - `'published_lever_suppressed'` — emitted, but forced to 0 or withheld for
 *   option-controlled levers (`LEVER_SUPPRESSION_FIELDS` doctrine).
 * - `'published_lever_unsuppressed'` — emitted at its true value even for a
 *   lever, deliberately: it is a STRUCTURE measurement, not an importance claim.
 * - `'internal'` — carried on the type but not part of the ranked surface a
 *   consumer crowns on.
 */
export type DriverQuantityDisposition =
  | 'published'
  | 'published_lever_suppressed'
  | 'published_lever_unsuppressed'
  | 'internal';

export interface DriverQuantityEntry {
  role: DriverQuantityRole;
  disposition: DriverQuantityDisposition;
  /**
   * The unit, stated so a substitution is visible. `'dimensionless'` is a real
   * answer; `'unknown'` is NOT permitted — if nobody can say what the number
   * measures, that is the finding.
   */
  unit: string;
  /** The sign convention. `'signed'` means the sign carries direction. */
  sign: 'non_negative' | 'signed' | 'positive_ordinal';
  /** One line a reviewer can check against the bytes. */
  note: string;
}

/**
 * The register. Keys are `"<TypeName>.<field>"` — the exact join key
 * `deriveDriverQuantityKeys()` produces.
 */
export const DRIVER_QUANTITY_REGISTER: Readonly<Record<string, DriverQuantityEntry>> = {
  // ── FactorSensitivityResultV3 ──────────────────────────────────────────────
  'FactorSensitivityResultV3.influence_score': {
    role: 'measurement',
    disposition: 'published_lever_unsuppressed',
    unit: 'normalised_influence_0_1',
    sign: 'non_negative',
    note: '|influence| / maxAbsInfluence over the graph path analysis — normalised BY THE MAX ROW, so an absolute gap between two rows is moved by a third row outside the pair. A lever keeps its true value here: this is structure, not importance.',
  },
  'FactorSensitivityResultV3.influence_rank': {
    role: 'designation',
    disposition: 'published_lever_unsuppressed',
    unit: 'rank_ordinal',
    sign: 'positive_ordinal',
    note: 'The RAW structural influence order, 1 = most influential. A lever legitimately tops it. NOT the importance order — see importance_rank.',
  },
  'FactorSensitivityResultV3.sensitivity_score': {
    role: 'measurement',
    disposition: 'published_lever_suppressed',
    unit: 'goal_units_per_factor_unit',
    sign: 'signed',
    note: 'Graph raw total causal effect. SIGNED — the family-4 slice-0 defect was elasticity being fed into this name (−0.175 vs +0.497 on one response). Forced to 0 for option-controlled levers.',
  },
  'FactorSensitivityResultV3.elasticity': {
    role: 'measurement',
    disposition: 'published_lever_suppressed',
    unit: 'normalised_influence_0_1_on_graph_path',
    sign: 'signed',
    note: '⚠ TWO PRODUCERS, ONE NAME: the graph path sets elasticity = normalised_influence (always ≥ 0); ISL publishes a signed MC elasticity. Read importance_basis before interpreting the sign.',
  },
  'FactorSensitivityResultV3.importance_rank': {
    role: 'designation',
    disposition: 'published',
    unit: 'rank_ordinal',
    sign: 'positive_ordinal',
    note: "PLoT's ONE importance order — lever-aware (every non-lever precedes every lever) and parallel to the emitted array (Rule S3). driver_order.ranked_factor_ids IS this order.",
  },
  'FactorSensitivityResultV3.value_of_information': {
    role: 'measurement',
    disposition: 'published_lever_suppressed',
    unit: 'voi_score_dimensionless',
    sign: 'non_negative',
    note: 'ISL MC VOI (sanitised non-negative), or |sensitivity| × (1 − confidence) × decision_fragility on the graph fallback. A legitimate 0 exists. NOT the coaching evidence_gaps voi_score — different quantity, same word.',
  },
  'FactorSensitivityResultV3.evpi_percentage_points': {
    role: 'derived',
    disposition: 'published_lever_suppressed',
    unit: 'win_probability_percentage_points',
    sign: 'non_negative',
    note: 'HEURISTIC only: value_of_information × win_probability_spread × 100, clamped ≥ 0 (Howard 1966). Not a counterfactual EVPI; self-disclosed via evpi_method. Withheld entirely for levers so a lever never ranks as an investigation priority.',
  },
  'FactorSensitivityResultV3.confidence': {
    role: 'diagnostic',
    disposition: 'published',
    unit: 'probability_0_1',
    sign: 'non_negative',
    note: "PLoT's unified confidence, NOT ISL's (which is discarded). The active formula is disclosed by confidence_provenance.formula_version.",
  },
  'FactorSensitivityResultV3.elasticity_std': {
    role: 'diagnostic',
    disposition: 'published_lever_suppressed',
    unit: 'same_units_as_isl_elasticity',
    sign: 'non_negative',
    note: "ISL bootstrap standard deviation. ISL-sourced rows only — graph and ISL elasticity are on different scales, so this must never be cross-attached to a graph row.",
  },
  'FactorSensitivityResultV3.rank_flip_rate': {
    role: 'diagnostic',
    disposition: 'published',
    unit: 'proportion_of_bootstrap_samples_0_1',
    sign: 'non_negative',
    note: "ISL bootstrap rank instability. A SEPARABILITY input, never an importance claim — aggregated into driver_order.rank_stability.max_rank_flip_rate.",
  },
  'FactorSensitivityResultV3.confidence_components.structural_certainty': {
    role: 'diagnostic',
    disposition: 'published',
    unit: 'probability_0_1',
    sign: 'non_negative',
    note: 'mean(exists_probability) over incoming edges, or 0.5 when the factor has none. A progressive-disclosure component of `confidence`, not an independent measurement.',
  },
  'FactorSensitivityResultV3.confidence_components.sampling_stability': {
    role: 'diagnostic',
    disposition: 'published',
    unit: 'band_score_0_1',
    sign: 'non_negative',
    note: "attribution_stability collapsed to {0, 0.25, 0.5, 1.0}. NULL when ISL supplied no bootstrap — null means unavailable, never 'unstable'.",
  },

  // ── EdgeSensitivityResultV3 ────────────────────────────────────────────────
  'EdgeSensitivityResultV3.elasticity': {
    role: 'measurement',
    disposition: 'published',
    unit: 'goal_units_per_edge_strength_unit',
    sign: 'signed',
    note: "ISL's edge elasticity, forwarded. Disambiguated by sensitivity_type ('existence' vs 'magnitude') — two formulas in one sorted array, so the discriminator must be read before comparing two rows.",
  },
  'EdgeSensitivityResultV3.importance_rank': {
    role: 'designation',
    disposition: 'published',
    unit: 'rank_ordinal',
    sign: 'positive_ordinal',
    note: "ISL's edge importance order, forwarded verbatim. NOT lever-aware and NOT the factor order — edges have no lever partition.",
  },
};

/**
 * EXEMPTIONS — quantities considered and deliberately EXCLUDED from the
 * register, emitted as data rather than argued in prose (§3.2 point 3).
 *
 * > *"A prose exclusion cannot distinguish 'considered and excluded' from
 * > 'never found'."*
 *
 * Empty today, and that emptiness is itself the claim: at these bytes every
 * numeric field on every driver-bearing row is registered. The mechanism exists
 * so the first `causal_structure`-class field has somewhere honest to go.
 */
export const DRIVER_QUANTITY_EXEMPTIONS: Readonly<Record<string, { reason: string }>> = {};
