/**
 * A realistic ISL `/health` payload for tests that stand up a FAKE ISL server.
 *
 * ⚠ WHY THIS EXISTS (ROADMAP 2.356). Fake-ISL harnesses answered `{}` on every
 * endpoint other than the one under test, including `/health`. That was
 * harmless while PLoT's response to an unreadable advertisement was to plan
 * conservatively and carry on; since 2.356 it is a typed 503, so a stub ISL
 * that never advertises its compute gate now refuses every analysis and the
 * test measures the refusal instead of the behaviour it was written for.
 *
 * Serving this instead is also simply MORE FAITHFUL: a real ISL always
 * advertises `compute_admission`, and a harness whose ISL does not is modelling
 * a deployment that does not exist. Tests that specifically want the
 * unadvertised state should say so explicitly rather than inherit it from a
 * stub's catch-all.
 *
 * The values are the live v5 block captured from isl-staging on 2026-08-01 —
 * the same dated capture the handshake suite pins. It is deliberately NOT
 * "whatever ISL advertises now": a fixture that tracks live decays into a
 * tautology the first time live moves (programme trap 12b).
 */
export const ISL_HEALTH_COMPUTE_ADMISSION = {
  max_cost_units: 24_000_000,
  complexity_formula_version: 'v5-factor-flips-2026-08-01',
  weights: {
    base_per_sample_per_option_per_struct: 1,
    evpi_sample_cap: 2000,
    evpc_coef: 1,
    evppi_full_coef: 1,
    evppi_null_permutations: 16,
    factor_flip_coef: 1,
    influence_walk_pool: 400_000,
    sensitivity_coef: 4,
    evalue_coef: 20,
    bands_coef: 200,
    path_coef: 1,
    max_decomposition_paths: 20_000,
  },
  caps: {
    max_options: 10,
    max_nodes: 50,
    max_edges: 200,
    max_parameter_uncertainties: 50,
    max_control_candidates: 5,
    max_control_values: 7,
  },
  formula_parameters: {
    factor_flips: { max_candidates: 10, stability_seeds: 10 },
    sensitivity: { subsample_cap: 100, subsample_divisor: 10 },
  },
} as const;

/** The whole `/health` body a fake ISL should serve. */
export const ISL_HEALTH_BODY = {
  status: 'healthy',
  compute_admission: ISL_HEALTH_COMPUTE_ADMISSION,
} as const;
