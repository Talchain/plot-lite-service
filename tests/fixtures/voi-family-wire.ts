/**
 * THE canonical VOI-family wire fixtures (lane L45, S5 typed surface).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS: THE OLD FIXTURES WERE INVENTED, AND THE PIN THEY BACKED
 * PROVED TRANSPORT OF A BODY THIS REPO'S OWN EGRESS GUARD REJECTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Before this lane, `tests/factor-correlation-forwarding.test.ts` carried three
 * hand-written constants as its passthrough proof:
 *
 *     const DECISION_EVPI    = { value: 0.042, method: 'joint_samples', units: 'outcome' };
 *     const FACTOR_EVPPI     = [{ factor_id: 'fac_dev_headcount', evppi: 0.031, method: 'strong_oakley' }];
 *     const P_WIN_SENSITIVITY= [{ factor_id: 'fac_dev_headcount', p_win_sensitivity: 0.12 }];
 *     const CORRELATION_MODEL= { model: 'gaussian_copula', psd: {…}, tail_independence_disclosed: true };
 *
 * NONE of those is a shape ISL emits, and the first is one the shared contract
 * REJECTS. Measured at PLoT `3177fd3` / schemas 0.31.0 / ISL `80aa83f`:
 *
 *   · `AnalysisEnrichmentSchema.safeParse` on a body carrying that
 *     `decision_evpi` → `success: false`, issue `{path:'decision_evpi',
 *     code:'invalid_type'}`. The contract types it `z.number().nullable()
 *     .optional()`; ISL's producer declares `self.decision_evpi:
 *     Optional[float]` (`src/utils/response_builder.py:157`) and the live
 *     guest-walk capture carries the bare float `0.0789680300194515`.
 *   · Run through the REAL `/v2/run` route, the response body those constants
 *     produced carried `_meta.evidence.enrichment_contract_ok: false` and an
 *     `ENRICHMENT_CONTRACT_MISMATCH` inference warning — and the test passed
 *     8/8 green, because nothing asserted on either.
 *   · `correlation_model`'s real key set is `{method, active,
 *     correlated_factors, n_pairs, tail_dependence, tail_dependence_note,
 *     psd_projection, suppressed_attributions, suppression_reason}`
 *     (ISL `_build_correlation_disclosure`,
 *     `src/services/robustness_analyzer_v2.py:2770`). The old constant shared
 *     not one key name with it.
 *   · a real `factor_evppi` row carries `status` — and the LICENSED CONSUMER
 *     (`DecisionGuideAI/src/components/results/voi/voiRanking.ts`) DROPS any row
 *     whose `status` is absent or outside `{resolved, below_resolution}`. So the
 *     old fixture's rows would have been dropped one hop later and the ranking
 *     would have collapsed to its honest gate. The transport pin could not see
 *     that, because it never asked whether the thing transported was readable.
 *
 * Two guards in this repo — the passthrough pin and the egress contract guard —
 * were looking at the SAME response body and disagreeing about it, and nothing
 * introduced them. That is trap 19 (a pin that passes on the wrong object) sitting
 * inside the one chain S5 exists to make honest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVENANCE OF EVERY VALUE BELOW — INCLUDING WHAT IS CONSTRUCTED
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ READ THIS BEFORE THE SENTENCE AFTER IT. Every row SHAPE, and most values,
 * come from the live capture. THREE THINGS ARE CONSTRUCTED, and saying so first
 * is the point of this file:
 *
 *   1. THE TWO `status: 'resolved'` ROWS AND THEIR `evppi` HEADLINE VALUES
 *      (`fac_market_demand` 0.0184, `fac_current_arr` 0.0002, and the
 *      `conditional_max_expected_utility` figures that follow from them) ARE
 *      CONSTRUCTED. The real capture carries `below_resolution` on EVERY row
 *      with `evppi: 0`, so the resolved band cannot be taken from it at all —
 *      and a fixture that exercised only one band would let N4 pass without
 *      ever meeting a `resolved` row (which is why N4b asserts BOTH bands are
 *      present). Constructed to be internally consistent with the capture's own
 *      audit legs: same `baseline_max_expected_utility`, same `method`,
 *      `n_samples`, `regression_degree`, and each `evppi` above its row's real
 *      `noise_floor` — the condition ISL uses to stamp `resolved`.
 *   2. `VOI_CORRELATION_MODEL_ACTIVE` — the capture ran INDEPENDENT
 *      (`correlation_model: null`), so the whole block is built from the ISL
 *      producer at `80aa83f`, field by field, referenced per value below.
 *   3. `VOI_TRANSPORT_ALL_FOUR`'s combination — see the ⚠ below.
 *
 * Everything else — the `below_resolution` row, both `p_win_sensitivity` rows,
 * `VOI_DECISION_EVPI`, and every row shape — is verbatim from the live
 * guest-walk capture
 * `DecisionGuideAI/src/canvas/compare-tab/__tests__/__fixtures__/
 * v5GuestWalkAnalysisBlocks.json` (`created_at 2026-08-03T07:55:35.688Z`,
 * `runA.enrichment`) — a real CEE turn payload, i.e. those bytes have actually
 * crossed ISL → PLoT → CEE → UI.
 *
 * ⚠ ONE FIXTURE IS A TRANSPORT FIXTURE AND SAYS SO: `VOI_TRANSPORT_ALL_FOUR`
 * presents all four keys together to prove `buildResponse` drops none of them.
 * ISL does NOT emit that combination — under active correlation it SUPPRESSES
 * `p_win_sensitivity` entirely and names it in
 * `correlation_model.suppressed_attributions`
 * (`robustness_analyzer_v2.py:2431-2434`). The two SEMANTICALLY real
 * combinations are `VOI_INDEPENDENT_RUN` and `VOI_CORRELATED_RUN`, and the
 * suppression discriminator is pinned on those. Labelling the transport fixture
 * as a transport claim is the point: the defect this file repairs was a fixture
 * that made a semantic claim nobody had checked.
 */

/** ISL `CORRELATION_METHOD` (`src/utils/correlation.py:37`). */
export const ISL_CORRELATION_METHOD = 'gaussian_copula_v1';

/** ISL `_CORRELATION_SUPPRESSION_REASON` (`robustness_analyzer_v2.py:154`). */
export const ISL_CORRELATION_SUPPRESSION_REASON = 'not_separable_under_correlation';

/** ISL `SUPPRESSED_ATTR_P_WIN_SENSITIVITY` (`src/models/response_v2.py:1351`). */
export const ISL_SUPPRESSED_ATTR_P_WIN_SENSITIVITY = 'p_win_sensitivity';

/**
 * Whole-decision EVPI, OUTCOME units, a BARE FLOAT.
 * Live capture `runA.enrichment.decision_evpi`.
 */
export const VOI_DECISION_EVPI = 0.0789680300194515;

/**
 * Per-factor Strong–Oakley regression EVPPI rows, in PRODUCER RANK ORDER
 * (`evppi` descending — the contract's `EnrichmentFactorEvppiEntrySchema`
 * docstring: "PRODUCER RANK ORDER IS THE CONTRACT").
 *
 * ⚠ ROWS 1 AND 2 ARE CONSTRUCTED, ROW 3 IS THE CAPTURE'S. The live run produced
 * `below_resolution` on every row, so the `resolved` band had to be built or the
 * consumer's two bands could never both be exercised (N4b pins that they are).
 * The construction is disciplined, not invented freely: same
 * `baseline_max_expected_utility` / `method` / `n_samples` / `regression_degree`
 * as the capture, `conditional_max_expected_utility = baseline + evppi` exactly,
 * each row's real `noise_floor` kept, and each `evppi` set ABOVE its own
 * `noise_floor` — which is the condition ISL uses to stamp `resolved`
 * (`robustness_analyzer_v2.py:6464`: `below_resolution = evppi <= est.noise_floor`,
 * stamped at `:6500`). Row 3 keeps `evppi: 0` with `noise_floor: 0`, which
 * satisfies `<=` and is why the capture's own row reads `below_resolution`.
 * `factor_id`s are distinct so any order assertion binds by IDENTITY rather
 * than by a value another row could satisfy.
 */
export const VOI_FACTOR_EVPPI = [
  {
    factor_id: 'fac_market_demand',
    evppi: 0.0184,
    evppi_raw: 0.0184,
    baseline_max_expected_utility: 0.252812,
    conditional_max_expected_utility: 0.271212,
    units: 'outcome',
    method: 'regression_evppi_v1',
    regression_degree: 4,
    n_samples: 10000,
    clamped_low: false,
    clamped_high: false,
    noise_floor: 0.000006,
    status: 'resolved',
    correlation_active: false,
  },
  {
    factor_id: 'fac_current_arr',
    evppi: 0.0002,
    evppi_raw: 0.0002,
    baseline_max_expected_utility: 0.252812,
    conditional_max_expected_utility: 0.253012,
    units: 'outcome',
    method: 'regression_evppi_v1',
    regression_degree: 4,
    n_samples: 10000,
    clamped_low: false,
    clamped_high: false,
    noise_floor: 0.000017,
    status: 'resolved',
    correlation_active: false,
  },
  {
    factor_id: 'fac_budget',
    evppi: 0,
    evppi_raw: 0,
    baseline_max_expected_utility: 0.252812,
    conditional_max_expected_utility: 0.252812,
    units: 'outcome',
    method: 'regression_evppi_v1',
    regression_degree: 4,
    n_samples: 10000,
    clamped_low: false,
    clamped_high: false,
    noise_floor: 0,
    status: 'below_resolution',
    correlation_active: false,
  },
] as const;

/**
 * Win-probability sensitivity rows — the ONLY VOI quantity in CHANCE units.
 * Live capture `runA.enrichment.p_win_sensitivity` (first two rows verbatim).
 *
 * `current_metric` → `perfect_metric` is the pair a plain-language surface
 * renders as "from 53% to 55%". ⚠ The ROW SHAPE IS UNTYPED BY THE CONTRACT at
 * 0.31.0 (`p_win_sensitivity: z.array(z.record(z.string(), z.unknown()))`), so
 * no consumer may render these members until the contract types them — that is
 * the minimal contract delta this lane hands over, not something to ship
 * through the untyped passthrough.
 */
export const VOI_P_WIN_SENSITIVITY = [
  {
    factor_id: 'fac_market_demand',
    metric_type: 'p_win_recommended',
    method: 'p_win_delta_at_mean_v1',
    current_metric: 0.53275,
    perfect_metric: 0.547458,
    p_win_delta: 0.014708,
    p_win_delta_percentage_points: 1.47,
    noise_floor: 0.03099,
    noise_floor_method: 'z95_worst_case_bernoulli_diff',
    n_samples: 2000,
    clamped: false,
    labelling_doctrine: 'provisional_doctrine_v0',
    status: 'below_resolution',
  },
  {
    factor_id: 'fac_content_spend',
    metric_type: 'p_win_recommended',
    method: 'p_win_delta_at_mean_v1',
    current_metric: 0.53275,
    perfect_metric: 0.5405,
    p_win_delta: 0.00775,
    p_win_delta_percentage_points: 0.78,
    noise_floor: 0.03099,
    noise_floor_method: 'z95_worst_case_bernoulli_diff',
    n_samples: 2000,
    clamped: false,
    labelling_doctrine: 'provisional_doctrine_v0',
    status: 'below_resolution',
  },
] as const;

/**
 * The ACTIVE correlation disclosure, shaped from ISL
 * `_build_correlation_disclosure` (`robustness_analyzer_v2.py:2770-2781`).
 * It NAMES `p_win_sensitivity` in `suppressed_attributions` — that naming is
 * what makes an absent `p_win_sensitivity` readable as a SUPPRESSION VERDICT
 * rather than as "never computed" (schemas 0.31.0, `enrichment.js:898-906`).
 */
export const VOI_CORRELATION_MODEL_ACTIVE = {
  method: ISL_CORRELATION_METHOD,
  active: true,
  correlated_factors: ['fac_market_demand', 'fac_content_spend'],
  n_pairs: 1,
  tail_dependence: 'none',
  // ISL `_CORRELATION_TAIL_NOTE` VERBATIM (`robustness_analyzer_v2.py:147-152`).
  // This was a PARAPHRASE on first submission — nothing asserts on the string, so
  // the paraphrase could not have failed anything, which is exactly why it needed
  // fixing rather than disclosing: an unasserted value in a fixture whose whole
  // claim is "these are the producer's bytes" is where the next invented shape
  // starts.
  tail_dependence_note:
    'The Gaussian copula has zero tail dependence: it does not model factors ' +
    'moving to their extremes together, so joint tail (worst-case) co-movements ' +
    'may be understated. Downside metrics (CVaR, p05, expected_regret) can be ' +
    'optimistic when correlated factors are strongly dependent.',
  psd_projection: null,
  suppressed_attributions: [ISL_SUPPRESSED_ATTR_P_WIN_SENSITIVITY],
  suppression_reason: ISL_CORRELATION_SUPPRESSION_REASON,
} as const;

/**
 * SEMANTIC case 1 — an INDEPENDENT run (the live capture's own shape).
 * `correlation_model` is explicitly `null`, and `p_win_sensitivity` is present.
 */
export const VOI_INDEPENDENT_RUN = {
  correlation_model: null,
  decision_evpi: VOI_DECISION_EVPI,
  factor_evppi: VOI_FACTOR_EVPPI,
  p_win_sensitivity: VOI_P_WIN_SENSITIVITY,
} as const;

/**
 * SEMANTIC case 2 — a CORRELATED run. `p_win_sensitivity` is ABSENT (ISL
 * suppresses it at the skip site) while `factor_evppi` stays EMITTED (it is
 * honest under correlation: the retained samples are joint copula draws —
 * `robustness_analyzer_v2.py:2489-2494`), with `correlation_active: true` on
 * each row.
 */
export const VOI_CORRELATED_RUN = {
  correlation_model: VOI_CORRELATION_MODEL_ACTIVE,
  decision_evpi: VOI_DECISION_EVPI,
  factor_evppi: VOI_FACTOR_EVPPI.map((r) => ({ ...r, correlation_active: true })),
} as const;

/**
 * TRANSPORT fixture — all four keys together, to prove `buildResponse`'s
 * field-by-field rebuild drops none of them. Deliberately NOT a semantic claim:
 * see the file header. Uses the INDEPENDENT run's real shapes plus an active
 * disclosure block, which is why it must never be read as "what ISL sends".
 */
export const VOI_TRANSPORT_ALL_FOUR = {
  correlation_model: VOI_CORRELATION_MODEL_ACTIVE,
  decision_evpi: VOI_DECISION_EVPI,
  factor_evppi: VOI_FACTOR_EVPPI,
  p_win_sensitivity: VOI_P_WIN_SENSITIVITY,
} as const;
