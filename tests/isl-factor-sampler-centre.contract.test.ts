/**
 * PLoT → ISL FACTOR-SAMPLER CENTRE pairing.
 *
 * WHAT THIS ANSWERS THAT THE REQUEST-DRIFT PAIRING CANNOT.
 * `isl-request-drift-pairing.contract.test.ts` proves ISL PARSES the keys PLoT
 * sends. It is structurally blind to a key that parses cleanly while ISL samples
 * somewhere else entirely — which is exactly what happened here: PLoT converted a
 * declared Uniform[0.6, 1.0] prior into a centre-less `{distribution:'normal',
 * std: width/sqrt(12)}`, ISL parsed it happily, and then centred the draws on 0.0
 * because a prior-only factor has no `observed_state.value` to read
 * (robustness_analyzer_v2.py:1080-1086 @ 47f20068). Measured at 20,000 draws
 * through ISL's real sampler: mean -0.000434, and NOT ONE of the 20,000 samples
 * landed inside the declared support (min -0.4276, max 0.4658). Win probability,
 * robustness, sensitivity, flip thresholds and EVPPI all consumed those numbers,
 * and the root-default detector stayed silent because a ParameterUncertainty
 * entry was PRESENT (robustness_analyzer_v2.py:1826-1834) — wrong AND uncaveated.
 *
 * THE ORACLE IS ISL'S OWN SAMPLER, NEVER A COPY OF IT.
 * Everything asserted below comes from a transcript produced by executing ISL's
 * `FactorSampler` in a verified clone at the pinned sha
 * (tools/isl-contract/replay-factor-sampler.py). A re-implementation here could
 * agree with a wrong expectation forever; a mutant kit over one would score
 * perfectly on the wrong exam.
 *
 * WHY THE PAIRS. Every claim is settled by a DISCRIMINATION, not by a single
 * reading:
 *   - fixed vs legacy wire, same sampler, same node → the mean must MOVE;
 *   - a wrong centre supplied through the channel ISL really reads → must land on
 *     the WRONG value, proving the harness measures the centre at all;
 *   - a uniform with no range → must be REJECTED, not quietly sampled;
 *   - an observed_state factor → must land somewhere DIFFERENT from all of the
 *     above, so a blind instrument returning one number everywhere cannot fake
 *     agreement.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalDigest, sha256File } from './helpers/isl-pinned-artifacts.js';
import {
  buildSamplerCasesDoc,
  DEFAULTED_ROOT_NODE_ID,
  SAMPLER_CASE_NODE_ID,
  SAMPLER_CASE_PRIOR,
  SAMPLER_N_SAMPLES,
} from '../tools/isl-contract/capture-sampler-cases.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');
const PINNED_DIR = resolve(REPO_ROOT, 'tests/fixtures/isl-sampler-pinned');

const REGEN =
  'Regenerate with:\n' +
  '  npx tsx tools/isl-contract/capture-sampler-cases.ts\n' +
  '  cd <isl-clone at PIN.json sha> && poetry run python <plot>/tools/isl-contract/replay-factor-sampler.py --isl-repo <isl-clone>';

interface SampledResult {
  name: string;
  node: { id: string; observed_state?: { value?: number } };
  parameter_uncertainty: Record<string, unknown>;
  outcome: 'sampled' | 'model_rejected';
  n_samples?: number;
  sample_mean?: number;
  sample_std?: number;
  sample_min?: number;
  sample_max?: number;
  error_types?: string[];
}

interface DetectorResult {
  name: string;
  parameter_uncertainties: Array<Record<string, unknown>> | null;
  root_default_warned_node_ids: string[];
  all_warning_codes: string[];
}

interface Transcript {
  pin_digest: string;
  cases_sha256: string;
  isl_sha: string;
  runtime: { python: string; pydantic: string };
  n_samples: number;
  seed: number;
  results: SampledResult[];
  detector_results: DetectorResult[];
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(resolve(PINNED_DIR, relPath), 'utf8')) as T;
}

const pin = readJson<{ isl: { sha: string }; source_sha256: Record<string, string> }>('PIN.json');
const casesDoc = readJson<{
  n_samples: number;
  seed: number;
  cases: Array<Record<string, any>>;
  detector_cases: Array<Record<string, any>>;
}>('cases.json');
const transcript = readJson<Transcript>('sampler-transcript.json');

/**
 * Bind by IDENTITY (the exact case name), never by a value predicate another
 * case could satisfy — four of the five cases here are deliberately similar
 * payloads, so a "find the normal one" lookup would match the wrong object.
 */
function result(name: string): SampledResult {
  const found = transcript.results.filter((r) => r.name === name);
  expect(
    found.length,
    `transcript has ${found.length} results named '${name}', expected exactly 1. ${REGEN}`,
  ).toBe(1);
  return found[0]!;
}

function detector(name: string): DetectorResult {
  const found = transcript.detector_results.filter((r) => r.name === name);
  expect(
    found.length,
    `transcript has ${found.length} detector results named '${name}', expected exactly 1. ${REGEN}`,
  ).toBe(1);
  return found[0]!;
}

/**
 * 20,000 draws from Uniform[0.6, 1.0]: sigma = 0.4/sqrt(12) = 0.11547, so the
 * standard error of the mean is 0.11547/sqrt(20000) = 0.000816. This tolerance is
 * ~6 SE — wide enough that a correct sampler never trips it, and ~1000x tighter
 * than the 0.8 error the defect produced.
 */
const MEAN_TOLERANCE = 0.005;
const PRIOR_MIDPOINT = (SAMPLER_CASE_PRIOR.range_min + SAMPLER_CASE_PRIOR.range_max) / 2;

describe('PLoT → ISL factor-sampler centre pairing', () => {
  describe('pinned-artifact integrity — the transcript describes THESE bytes', () => {
    it('the transcript was generated against the committed PIN', () => {
      expect(
        transcript.pin_digest,
        `PIN.json has moved since the transcript was generated. ${REGEN}`,
      ).toBe(canonicalDigest(pin));
    });

    it('the transcript was generated against the committed cases', () => {
      expect(
        transcript.cases_sha256,
        `cases.json has moved since the transcript was generated. ${REGEN}`,
      ).toBe(sha256File('tests/fixtures/isl-sampler-pinned/cases.json'));
    });

    it('the transcript names the pinned ISL sha and the pinned runtime', () => {
      expect(transcript.isl_sha).toBe(pin.isl.sha);
      expect(transcript.runtime.pydantic).toBe('2.6.1');
      expect(transcript.runtime.python.startsWith('3.11')).toBe(true);
    });

    it('POSITIVE CONTROL: the transcript actually ran a sampler, at the declared depth', () => {
      // An empty or shallow transcript would let every assertion below pass by
      // testing nothing. Zero results is silence, never success.
      expect(transcript.results.length).toBe(casesDoc.cases.length);
      expect(transcript.n_samples).toBe(SAMPLER_N_SAMPLES);
      const sampled = transcript.results.filter((r) => r.outcome === 'sampled');
      expect(sampled.length).toBeGreaterThan(0);
      for (const r of sampled) {
        expect(r.n_samples, `${r.name} recorded a different depth than the run declared`).toBe(
          SAMPLER_N_SAMPLES,
        );
      }
    });

    it('POSITIVE CONTROL: the instrument DISCRIMINATES — the sampled means are not all the same', () => {
      // Trap-20 corollary: a probe that has silently stopped discriminating
      // returns identical answers for inputs that ought to differ, and each
      // individual reading still looks well-formed. Keeping cases whose
      // expected answers DIFFER is what makes that visible.
      const means = transcript.results
        .filter((r) => r.outcome === 'sampled')
        .map((r) => r.sample_mean!);
      expect(new Set(means.map((m) => m.toFixed(3))).size).toBeGreaterThan(1);
    });
  });

  describe('the DERIVED cases still match what PLoT emits today', () => {
    it('every derived case is re-derived from live translator code and agrees', () => {
      // Without this, the transcript could describe a wire the repo stopped
      // emitting months ago and every behavioural claim below would be about
      // bytes that no longer leave this service.
      const live = buildSamplerCasesDoc() as { cases: Array<Record<string, any>> };
      const derivedNames = casesDoc.cases.filter((c) => c.kind === 'derived').map((c) => c.name);
      expect(derivedNames.length, 'no derived cases — the pairing would be pinned to nothing').toBeGreaterThan(0);
      for (const name of derivedNames) {
        const committed = casesDoc.cases.find((c) => c.name === name)!;
        const fresh = live.cases.find((c) => c.name === name);
        expect(fresh, `live capture no longer produces case '${name}'. ${REGEN}`).toBeDefined();
        expect(
          fresh!.parameter_uncertainty,
          `case '${name}' is STALE: live PLoT code emits a different parameter_uncertainties entry ` +
            `than the transcript was generated from. ${REGEN}`,
        ).toEqual(committed.parameter_uncertainty);
      }
    });
  });

  describe('THE CLAIM — a prior-only external factor is sampled inside its stated prior', () => {
    it('the wire PLoT emits today declares the uniform ISL supports, with both bounds', () => {
      const r = result('current_prior_only__as_emitted');
      expect(
        r.parameter_uncertainty,
        'PLoT must send ISL a distribution that can CARRY the prior. A normal entry has no ' +
          'channel for the centre, and ISL then defaults it to 0.0.',
      ).toEqual({
        node_id: r.node.id,
        distribution: 'uniform',
        range_min: SAMPLER_CASE_PRIOR.range_min,
        range_max: SAMPLER_CASE_PRIOR.range_max,
      });
    });

    it('the node carries NO observed_state — so the centre can only come from the wire', () => {
      // Pins the precondition in-test. If a future fixture quietly gained an
      // observed_state, the mean below would be right for the wrong reason and
      // this pairing would certify a defect it can no longer see.
      const r = result('current_prior_only__as_emitted');
      expect(r.node.observed_state).toBeUndefined();
    });

    it("ISL's own sampler centres the draws on the prior midpoint", () => {
      const r = result('current_prior_only__as_emitted');
      expect(r.outcome).toBe('sampled');
      expect(r.sample_mean!).toBeCloseTo(PRIOR_MIDPOINT, 2);
      expect(Math.abs(r.sample_mean! - PRIOR_MIDPOINT)).toBeLessThan(MEAN_TOLERANCE);
    });

    it('every draw lands INSIDE the declared support (the defect put all 20,000 outside it)', () => {
      const r = result('current_prior_only__as_emitted');
      expect(r.sample_min!).toBeGreaterThanOrEqual(SAMPLER_CASE_PRIOR.range_min);
      expect(r.sample_max!).toBeLessThanOrEqual(SAMPLER_CASE_PRIOR.range_max);
    });
  });

  describe('DISCRIMINATING PAIR — the fix is load-bearing at ISL, not just at the wire', () => {
    it('the legacy centre-less wire still samples at ~0.0 through the same sampler', () => {
      // Pinned to the historical artefact, never to "current" (trap 12b): this
      // case is the only remaining way to measure what the defect did, and it
      // must keep failing in the old way forever.
      const legacy = result('legacy_prior_only__normal_width_only');
      expect(legacy.outcome).toBe('sampled');
      expect(Math.abs(legacy.sample_mean!)).toBeLessThan(0.01);
    });

    it('fixed and legacy wires, same sampler and node, land ~a full prior-width apart', () => {
      const fixed = result('current_prior_only__as_emitted');
      const legacy = result('legacy_prior_only__normal_width_only');
      expect(fixed.node.id).toBe(legacy.node.id);
      expect(fixed.parameter_uncertainty).not.toEqual(legacy.parameter_uncertainty);
      expect(fixed.sample_mean! - legacy.sample_mean!).toBeGreaterThan(0.5);
    });
  });

  describe('NEGATIVE CONTROLS — a wrong or absent centre must not pass quietly', () => {
    it('a uniform entry with no range is REJECTED by ISL, not sampled somewhere plausible', () => {
      const r = result('bad_centre__uniform_without_range');
      expect(
        r.outcome,
        "ISL's ParameterUncertainty validator must refuse a uniform with no bounds. If this " +
          'ever becomes "sampled", PLoT could ship a rangeless uniform and ISL would invent a centre.',
      ).toBe('model_rejected');
      expect(r.error_types).toContain('value_error');
    });

    it('a WRONG centre lands on the wrong value — the harness measures the centre, not the shape', () => {
      // If this case reported the prior midpoint, every "mean is correct"
      // assertion above would be vacuous: the instrument would be blessing any
      // payload that merely parses.
      const r = result('bad_centre__normal_with_wrong_observed_state');
      expect(r.outcome).toBe('sampled');
      expect(r.node.observed_state?.value).toBe(0.2);
      expect(r.sample_mean!).toBeCloseTo(0.2, 2);
      expect(Math.abs(r.sample_mean! - PRIOR_MIDPOINT)).toBeGreaterThan(0.5);
    });
  });

  describe("ROOT-DEFAULT DETECTOR — the fix must not buy silence, and must not break the alarm", () => {
    it('the legacy wire bought silence it had not earned — wrong AND uncaveated', () => {
      // Pinned to the historical wire. ISL suppresses ROOT_NODE_DEFAULT_VALUE on
      // the mere PRESENCE of an entry (robustness_analyzer_v2.py:1826-1834), so
      // the centre-less normal sampled a declared Uniform[0.6,1.0] at 0.0 while
      // the product said nothing at all. This is why the defect is P0 rather
      // than a precision complaint.
      const d = detector('legacy_wire__silences_the_root_default_disclosure');
      expect(d.root_default_warned_node_ids).toEqual([]);
    });

    it('a properly-specified uniform is silent because it is SPECIFIED, not suppressed', () => {
      const d = detector('fixed_wire__silent_where_specified_LOUD_where_defaulted');
      expect(d.root_default_warned_node_ids).not.toContain(SAMPLER_CASE_NODE_ID);
    });

    it('the alarm STILL FIRES for a genuinely defaulted root, in that same run', () => {
      // The discrimination that makes the assertion above mean anything: a fix
      // that silently disabled the detector would satisfy "no warning for the
      // specified factor" perfectly. Binding both halves to ONE run removes the
      // "different conditions" escape.
      const d = detector('fixed_wire__silent_where_specified_LOUD_where_defaulted');
      expect(d.root_default_warned_node_ids).toEqual([DEFAULTED_ROOT_NODE_ID]);
      expect(d.all_warning_codes).toContain('ROOT_NODE_DEFAULT_VALUE');
    });

    it('the derived detector case still matches what PLoT emits today', () => {
      const live = buildSamplerCasesDoc() as { detector_cases: Array<Record<string, any>> };
      const derivedNames = casesDoc.detector_cases
        .filter((c) => c.kind === 'derived')
        .map((c) => c.name);
      expect(derivedNames.length).toBeGreaterThan(0);
      for (const name of derivedNames) {
        const committed = casesDoc.detector_cases.find((c) => c.name === name)!;
        const fresh = live.detector_cases.find((c) => c.name === name);
        expect(fresh, `live capture no longer produces detector case '${name}'. ${REGEN}`).toBeDefined();
        expect(
          fresh!.request.parameter_uncertainties,
          `detector case '${name}' is STALE against live PLoT code. ${REGEN}`,
        ).toEqual(committed.request.parameter_uncertainties);
      }
    });
  });

  describe('REGRESSION — the observed_state path is untouched', () => {
    it('a factor with an observed value still gets a normal centred on that value', () => {
      const r = result('unchanged_main_path__observed_state_normal');
      expect(r.parameter_uncertainty.distribution).toBe('normal');
      expect(r.parameter_uncertainty.range_min).toBeUndefined();
      expect(r.parameter_uncertainty.range_max).toBeUndefined();
      expect(r.outcome).toBe('sampled');
      expect(r.sample_mean!).toBeCloseTo(0.75, 2);
    });
  });
});
