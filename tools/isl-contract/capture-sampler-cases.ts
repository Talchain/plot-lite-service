/**
 * Regenerate the FACTOR-SAMPLER pairing's input cases.
 *
 * Two kinds of case live in `cases.json`, and the difference matters:
 *
 *   DERIVED  — built by calling PLoT's REAL `buildParameterUncertaintiesV3`, so
 *              the transcript is bound to what this repo actually emits today.
 *              `tests/isl-factor-sampler-centre.contract.test.ts` re-derives
 *              these and fails if the committed bytes have gone stale.
 *
 *   PINNED   — historical artefacts and negative controls, written as literals
 *              here and NEVER regenerated from live code. A control pinned to
 *              "whatever the code emits now" decays into a tautology the first
 *              time the code changes; the legacy case below exists precisely to
 *              keep the defect's own wire measurable after it is fixed.
 *
 *   npx tsx tools/isl-contract/capture-sampler-cases.ts
 *
 * Then re-run the replay driver (see tests/fixtures/isl-sampler-pinned/PIN.json).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildParameterUncertaintiesV3 } from '../../src/integrations/isl/translator-v3.js';
import type { EngineNodeV3 } from '../../src/types/engine-v3.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../tests/fixtures/isl-sampler-pinned/cases.json');

/** The node id every case uses. Must satisfy ISL's `^[a-z0-9_:-]+$`. */
export const SAMPLER_CASE_NODE_ID = 'ext_regulatory_easing';

/** The prior the DERIVED prior-only case is built from. */
export const SAMPLER_CASE_PRIOR = { distribution: 'uniform', range_min: 0.6, range_max: 1.0 } as const;

/** Sampling depth + seed the driver uses. 20k draws ⇒ SE ≈ 0.0008 on this prior. */
export const SAMPLER_N_SAMPLES = 20000;
export const SAMPLER_SEED = 4242;

/** The ISL graph node for a PRIOR-ONLY external factor: no `observed_state` at all. */
export const PRIOR_ONLY_ISL_NODE = {
  id: SAMPLER_CASE_NODE_ID,
  kind: 'factor',
  label: 'Regulatory easing',
} as const;

/**
 * The PLoT engine node the DERIVED prior-only case is built from.
 * Exported so the standing test re-derives from the same input, never from a
 * second copy that could drift.
 */
export const PRIOR_ONLY_ENGINE_NODE: EngineNodeV3 = {
  id: SAMPLER_CASE_NODE_ID,
  kind: 'factor',
  label: 'Regulatory easing',
  category: 'external',
  prior: { ...SAMPLER_CASE_PRIOR },
} as unknown as EngineNodeV3;

/** A factor WITH an observed value — the untouched main path, and the pairing's discrimination control. */
export const OBSERVED_STATE_ENGINE_NODE: EngineNodeV3 = {
  id: SAMPLER_CASE_NODE_ID,
  kind: 'factor',
  label: 'Regulatory easing',
  category: 'observable',
  observed_state: { value: 0.75, std: 0.1 },
} as unknown as EngineNodeV3;

export const OBSERVED_STATE_ISL_NODE = {
  id: SAMPLER_CASE_NODE_ID,
  kind: 'factor',
  label: 'Regulatory easing',
  observed_state: { value: 0.75 },
} as const;

/**
 * A second root factor that states NOTHING — no observed_state, no prior. It is
 * the detector arm's live control: ISL must keep warning about it, in the SAME
 * run in which it correctly stays silent about the specified factor.
 */
export const DEFAULTED_ROOT_NODE_ID = 'ext_unstated_driver';

/** Minimal graph the detector arm runs a real analysis over. */
function detectorRequest(
  parameterUncertainties: Array<Record<string, unknown>>,
  includeDefaultedRoot: boolean,
): Record<string, unknown> {
  const nodes: Array<Record<string, unknown>> = [
    { id: SAMPLER_CASE_NODE_ID, kind: 'factor', label: 'Regulatory easing' },
    { id: 'lever_spend', kind: 'factor', label: 'Spend', observed_state: { value: 0.5 } },
    { id: 'goal_growth', kind: 'outcome', label: 'Growth' },
  ];
  const edges: Array<Record<string, unknown>> = [
    { from: SAMPLER_CASE_NODE_ID, to: 'goal_growth', exists_probability: 0.9, strength: { mean: 0.4, std: 0.1 } },
    { from: 'lever_spend', to: 'goal_growth', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
  ];
  if (includeDefaultedRoot) {
    nodes.push({ id: DEFAULTED_ROOT_NODE_ID, kind: 'factor', label: 'Unstated driver' });
    edges.push({
      from: DEFAULTED_ROOT_NODE_ID,
      to: 'goal_growth',
      exists_probability: 0.9,
      strength: { mean: 0.2, std: 0.1 },
    });
  }
  return {
    request_id: 'sampler-pairing-detector',
    graph: { nodes, edges },
    options: [
      { id: 'opt_hold', label: 'Hold', interventions: { lever_spend: 0.5 } },
      { id: 'opt_push', label: 'Push', interventions: { lever_spend: 0.9 } },
    ],
    goal_node_id: 'goal_growth',
    n_samples: 200,
    seed: SAMPLER_SEED,
    analysis_types: ['comparison'],
    parameter_uncertainties: parameterUncertainties,
  };
}

function derivePu(node: EngineNodeV3): Record<string, unknown> {
  const built = buildParameterUncertaintiesV3([node]);
  if (!built || built.length !== 1) {
    throw new Error(
      `buildParameterUncertaintiesV3 produced ${built?.length ?? 0} entries for ${node.id}, expected exactly 1`,
    );
  }
  return built[0] as unknown as Record<string, unknown>;
}

export function buildSamplerCasesDoc(): Record<string, unknown> {
  return {
    _README: [
      'INPUT to tools/isl-contract/replay-factor-sampler.py. Regenerate with',
      '  npx tsx tools/isl-contract/capture-sampler-cases.ts',
      'then re-run the driver. Each case is one {graph node, parameter_uncertainties entry}',
      'pair handed to ISL\'s OWN FactorSampler; the transcript records where the draws land.',
      'kind=derived cases are re-derived by the standing test from live PLoT code.',
      'kind=pinned cases are historical artefacts and negative controls — never regenerate them.',
    ],
    n_samples: SAMPLER_N_SAMPLES,
    seed: SAMPLER_SEED,
    cases: [
      {
        name: 'legacy_prior_only__normal_width_only',
        kind: 'pinned',
        why: [
          'THE DEFECT, pinned to the historical artefact. This is the exact wire PLoT',
          'emitted for a prior-only external factor at staging tip f677c9cb (deployed',
          '2026-08-08): distribution=normal carrying only the width width/sqrt(12), with',
          'no channel for the prior midpoint. The stated prior is Uniform[0.6,1.0], so an',
          'honest sampler centres near 0.8; ISL centres on observed_state.value, which a',
          'prior-only factor does not have, so it defaults to 0.0. Pinned as a LITERAL and',
          'never regenerated: once the emission is fixed, this is the only remaining way to',
          'measure what the defect actually did.',
        ],
        node: PRIOR_ONLY_ISL_NODE,
        parameter_uncertainty: {
          node_id: SAMPLER_CASE_NODE_ID,
          distribution: 'normal',
          std: 0.11547005383792516,
        },
      },
      {
        name: 'current_prior_only__as_emitted',
        kind: 'derived',
        why: [
          'The wire PLoT emits TODAY for the same prior-only external factor, taken from',
          'the real buildParameterUncertaintiesV3. Paired with the legacy case above, the',
          'two form the discriminating pair: same ISL sampler, same node, two wires, and',
          'the sample mean must move from ~0.0 to the prior midpoint 0.8.',
        ],
        node: PRIOR_ONLY_ISL_NODE,
        parameter_uncertainty: derivePu(PRIOR_ONLY_ENGINE_NODE),
      },
      {
        name: 'bad_centre__uniform_without_range',
        kind: 'pinned',
        why: [
          'NEGATIVE CONTROL: a uniform entry whose centre information is ABSENT must fail',
          'LOUD, never sample somewhere plausible. ISL\'s ParameterUncertainty validator',
          'rejects it, and the transcript records the rejection as a first-class outcome.',
          'Without this case the pairing could not tell "the centre is right" from "the',
          'sampler will accept anything".',
        ],
        node: PRIOR_ONLY_ISL_NODE,
        parameter_uncertainty: {
          node_id: SAMPLER_CASE_NODE_ID,
          distribution: 'uniform',
        },
      },
      {
        name: 'bad_centre__normal_with_wrong_observed_state',
        kind: 'pinned',
        why: [
          'NEGATIVE CONTROL: the same width, but the centre supplied through the channel',
          'ISL actually reads (observed_state.value) and set to a WRONG value, 0.2. The',
          'sampler must land on 0.2, proving the harness measures the centre rather than',
          'rubber-stamping any payload that parses. If this case ever reported ~0.8 the',
          'instrument would be measuring nothing.',
        ],
        node: {
          id: SAMPLER_CASE_NODE_ID,
          kind: 'factor',
          label: 'Regulatory easing',
          observed_state: { value: 0.2 },
        },
        parameter_uncertainty: {
          node_id: SAMPLER_CASE_NODE_ID,
          distribution: 'normal',
          std: 0.11547005383792516,
        },
      },
      {
        name: 'unchanged_main_path__observed_state_normal',
        kind: 'derived',
        why: [
          'REGRESSION + DISCRIMINATION control. A factor WITH observed_state takes the',
          'first pass in buildParameterUncertaintiesV3 and must keep emitting a normal',
          'centred on its observed value — untouched by the prior-only fix. Its expected',
          'answer (0.75) DIFFERS from every other case, so a blind instrument returning the',
          'same number everywhere cannot fake agreement here.',
        ],
        node: OBSERVED_STATE_ISL_NODE,
        parameter_uncertainty: derivePu(OBSERVED_STATE_ENGINE_NODE),
      },
    ],
    detector_cases: [
      {
        name: 'legacy_wire__silences_the_root_default_disclosure',
        kind: 'pinned',
        why: [
          'THE UNCAVEATED HALF OF THE DEFECT. ISL suppresses ROOT_NODE_DEFAULT_VALUE on the',
          'mere PRESENCE of a ParameterUncertainty entry, so the old centre-less normal',
          'bought silence it had not earned: the factor sampled at 0.0 AND nothing warned.',
          'Pinned to the historical wire so the silence stays measurable after the fix.',
        ],
        request: detectorRequest(
          [{ node_id: SAMPLER_CASE_NODE_ID, distribution: 'normal', std: 0.11547005383792516 }],
          false,
        ),
      },
      {
        name: 'fixed_wire__silent_where_specified_LOUD_where_defaulted',
        kind: 'derived',
        why: [
          'BOTH halves of the detector claim, settled inside ONE run so they cannot be',
          'confused. The prior-only factor now carries a fully-specified uniform, so no',
          'warning is the CORRECT answer rather than a suppression artefact. A second root',
          'factor states nothing at all and must STILL be warned about — a fix that quietly',
          'disabled the alarm would look identical from the outside, which is why the',
          'detector is required to fire here and to fire for exactly one node.',
        ],
        request: detectorRequest([derivePu(PRIOR_ONLY_ENGINE_NODE)], true),
      },
    ],
  };
}

function main(): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(buildSamplerCasesDoc(), null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath}`);
  console.log('\nNow re-run, from inside the ISL clone at the PIN sha:');
  console.log('  poetry run python <plot>/tools/isl-contract/replay-factor-sampler.py --isl-repo <isl-clone>');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
