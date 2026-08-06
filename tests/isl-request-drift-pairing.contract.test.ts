/**
 * PLoT → ISL REQUEST DRIFT PAIRING  (contract step-2, slice 2)
 *
 * WHAT ROW 1.236(d) ASKED FOR, AND WHAT THIS IS
 * ---------------------------------------------
 * Slice 6 (PR #274) removed three keys ISL never declared and, where it could
 * not delete, DISCLOSED: `toISLObservedState()`'s allowlist is a hand-maintained
 * mirror of another repo's model, and `PLOT_TO_ISL_CONTRACT.knownUndeclared`
 * names two keys PLoT still sends that ISL does not declare. Both disclosures
 * end with the same sentence — *this cannot fail loud from inside PLoT today;
 * the mechanism that makes it fail loud is slice 2*. This file is that
 * mechanism.
 *
 * It makes three kinds of drift RED, by name:
 *   (a) PLoT emits a key ISL's pinned model does not declare, and the key is not
 *       in `knownUndeclared`;
 *   (b) a `knownUndeclared` entry goes stale — ISL adopted it, or PLoT stopped
 *       sending it, or it names a path ISL's model tree cannot contain;
 *   (c) the pairing is derived against stale bytes — the ISL pin moved, or the
 *       producers changed, without the pinned-model replay being re-run.
 *
 * TWO INDEPENDENT DERIVATIONS, AND WHY (trap 12: derive, don't mirror)
 * --------------------------------------------------------------------
 * METHOD 1 — EXECUTED MODEL. `tools/isl-contract/replay-through-pinned-model.py`
 *   feeds each body to ISL's OWN `RobustnessRequestV2` / `CounterfactualRequest`
 *   under ISL's pinned interpreter and pydantic (3.11 / 2.6.1), and records the
 *   model's return value (`model_dump(by_alias=True, exclude_unset=True)`).
 *   Rejected paths are then `input paths − parsed-dump paths`. Nothing about
 *   "what ISL declares" is re-stated anywhere: the answer is ISL's own output.
 * METHOD 2 — PINNED ARTIFACT. A walk over ISL's committed, machine-generated
 *   `openapi.json` (FastAPI's `app.openapi()`, i.e. pydantic's own schema),
 *   vendored here by content hash.
 *
 * The two must AGREE on every body. That agreement is the control: a walker
 * with a bug, or a transcript generated from the wrong bytes, breaks it. Neither
 * method is a hand-written copy of ISL's field list — the defect class this
 * whole step exists to retire.
 *
 * WHY IT NEEDS NO PYTHON AT TEST TIME. The transcript is committed and chained
 * by hash to (i) the pin, (ii) the exact wire bytes every producer emits. The
 * suite RE-DERIVES the bytes from the live producers on every run, so a producer
 * change breaks the chain and demands a re-run. The hermetic tier is the
 * guarantee; Python is only the generator.
 *
 * STATED LIMIT, up front. The pin is a SHA, not a deployment. This proves what
 * ISL declares at `PIN.json.isl.sha`; it proves nothing about what is deployed.
 * Re-pinning is a deliberate act with a four-step procedure in PIN.json, and
 * skipping any step is RED.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { PLOT_TO_ISL_CONTRACT } from '../src/contracts/plot-to-isl.contract.js';
import {
  PRODUCERS,
  installEgressCapture,
  uninstallEgressCapture,
  sha256,
  type ProducerSpec,
} from './helpers/isl-egress-producers.js';
import {
  REPO_ROOT,
  canonicalDigest,
  jsonPaths,
  loadEgressFixtures,
  loadOpenApi,
  loadPin,
  loadTranscript,
  schemaPathStatus,
  sha256File,
  undeclaredPaths,
  type OpenApiDoc,
  type ReplayEntry,
} from './helpers/isl-pinned-artifacts.js';

const PIN = loadPin();
const OPENAPI = loadOpenApi();
const TRANSCRIPT = loadTranscript();
const FIXTURES = loadEgressFixtures();

const REGENERATE =
  'Re-run BOTH generators, in order:\n' +
  '  npx tsx tools/isl-contract/capture-egress.ts\n' +
  '  tools/isl-contract/replay-through-pinned-model.py --isl-repo <ISL clone at PIN.json sha>';

// =============================================================================
// The endpoint manifest — derived, then pinned
// =============================================================================

type Reachability =
  /** Driven end-to-end to the fetch boundary by tests/helpers/isl-egress-producers.ts. */
  | 'captured-at-wire'
  /** A real call site, but its body is built inside a route handler and is not
   *  reachable without standing the whole route up. Source-level claim only. */
  | 'call-site-not-captured'
  /** Appears in src/ only inside comments/JSDoc at this tip. */
  | 'docs-only';

interface ManifestRow {
  endpoint: string;
  reachability: Reachability;
  /** Does a live PLoT code path reach this call at this tip? */
  plotLiveness: 'live' | 'dead-no-caller' | 'no-call-site';
  /** Does ISL MOUNT this path at PIN.json's sha? Checked against the pinned OpenAPI. */
  islMounted: boolean;
  why: string;
}

/**
 * Every `/api/v1/...` literal that occurs anywhere in `src/**\/*.ts`, classified.
 * The scan below asserts this list is EXHAUSTIVE, so a new ISL endpoint cannot be
 * added without a row here saying whether ISL mounts it.
 *
 * `islMounted` is not typed by hand into a belief — the test derives it from the
 * vendored OpenAPI path list and asserts it matches. The value here is the
 * CLAIM; the assertion is the derivation.
 */
const ENDPOINT_MANIFEST: ManifestRow[] = [
  {
    endpoint: '/api/v1/robustness/analyze/v2',
    reachability: 'captured-at-wire',
    plotLiveness: 'live',
    islMounted: true,
    why:
      'The only endpoint PLoT both calls live and ISL mounts. EIGHT producers over four call sites target it: ' +
      'routes/v2/run.ts (base; caller-supplied constraint weight; and the two goal-stamped shapes added by ' +
      'ROADMAP 2.762 — frame "level" and frame "delta"), analysis/flip-thresholds.ts (both probe branches), ' +
      'integrations/isl/index.ts analyseRobustness (from routes/v1/run.ts), and the dead analyseFactorSensitivity.',
  },
  {
    endpoint: '/api/v1/causal/validate',
    reachability: 'captured-at-wire',
    plotLiveness: 'live',
    islMounted: false,
    why:
      'FINDING. routes/v1/run.ts:978 calls islService.validateCausal on every non-quick /v1/run when ISL is enabled, ' +
      'but ISL mounts only `counterfactual_router` under /causal at the pin — the `router` carrying /validate is ' +
      'never included (src/api/main.py:774, commented). A live producer against an unmounted path: 404, absorbed by ' +
      "validateCausal's catch into createFallbackValidation. Reported, NOT fixed here (this slice is test-only).",
  },
  {
    endpoint: '/api/v1/analysis/thresholds',
    reachability: 'call-site-not-captured',
    plotLiveness: 'live',
    islMounted: false,
    why:
      'FINDING. routes/v2/run.ts:6881 calls it on the request-gated thresholds phase; ISL comments out ' +
      'threshold_router (src/api/main.py:787). Its payload is built inline in the /v2/run handler, so it cannot be ' +
      'driven to the wire from a unit harness — and there is no mounted request model to pair its keys against ' +
      'anyway. The claim carried here is the CALL SITE, asserted at the source below.',
  },
  {
    endpoint: '/api/v1/causal/counterfactual',
    reachability: 'captured-at-wire',
    plotLiveness: 'dead-no-caller',
    islMounted: true,
    why:
      'integrations/isl/index.ts computeCounterfactual has no caller outside its own module. Mounted, so pairable — ' +
      'and the pairing finds a total mismatch (see the FINDINGS block).',
  },
  {
    endpoint: '/api/v1/causal/sensitivity/detailed',
    reachability: 'captured-at-wire',
    plotLiveness: 'dead-no-caller',
    islMounted: false,
    why:
      'integrations/isl/index.ts analyseSensitivity has no caller (routes/v1/run.ts:975-980 records it was replaced ' +
      'by analyseRobustness). ISL does not mount it either. Dead on both sides.',
  },
  {
    endpoint: '/api/v1/analysis/pareto',
    reachability: 'docs-only',
    plotLiveness: 'no-call-site',
    islMounted: false,
    why:
      'Occurs once, in the JSDoc example on callAnalysisEndpoint (integrations/isl/index.ts:191). PLoT\'s own ' +
      '/v1/analysis/pareto route was withdrawn to a typed 501 on 2026-07-26 and its compute internals deleted, so ' +
      'no call site remains. NOTE: PR #274\'s body listed this endpoint (x2) in PLoT\'s ISL endpoint set — true at ' +
      'a80390c7, stale by 06c750d4.',
  },
  {
    endpoint: '/api/v1/analysis',
    reachability: 'docs-only',
    plotLiveness: 'no-call-site',
    islMounted: false,
    why:
      'Not an endpoint: the prefix as it appears in prose ("/api/v1/analysis/*") across comments in client.ts, ' +
      'index.ts and the withdrawn v1 analysis routes. Listed so the exhaustiveness scan below has a home for it ' +
      'rather than being loosened to ignore it.',
  },
];

const manifestByEndpoint = new Map(ENDPOINT_MANIFEST.map((r) => [r.endpoint, r]));

/**
 * Producers with no caller at this tip, pinned to their EXACT undeclared set
 * rather than to zero. Reported, not fixed — slice 2 is test-only, and deleting
 * or repairing dead ISL producers is a separate decision with its own owner.
 */
const DARK_PRODUCER_UNDECLARED: Record<string, { paths: string[]; why: string }> = {
  'factor-sensitivity-dead': {
    paths: [],
    why:
      'Sends nothing undeclared — its problem is the opposite: it OMITS the required edge `strength`, ' +
      'so the pinned model rejects it outright. Pinned in the FINDINGS block.',
  },
  'causal-counterfactual-dead': {
    paths: ['dag', 'target'],
    why:
      "PLoT sends {dag, intervention, target}; ISL's mounted CounterfactualRequest declares " +
      '{model, intervention, outcome, context, preferences, user_context} and REQUIRES model + outcome. ' +
      'A total mismatch, invisible until now because nothing calls it.',
  },
};

function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = resolve(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith('.ts')) out.push(p);
    }
  };
  walk(resolve(REPO_ROOT, 'src'));
  return out.sort();
}

// =============================================================================

describe('PLoT → ISL request drift pairing (contract step-2 slice 2)', () => {
  // ---------------------------------------------------------------------------
  // (c) The pairing cannot be derived against stale bytes
  // ---------------------------------------------------------------------------
  describe('pinned-artifact integrity', () => {
    it('the vendored ISL OpenAPI artifact hashes to what PIN.json records', () => {
      expect(sha256File('tests/fixtures/isl-pinned/isl-openapi.json')).toBe(
        PIN.artifacts.isl_openapi_json.sha256,
      );
    });

    it('POSITIVE CONTROL: the vendored artifact is a real document describing the pinned surface', () => {
      // An empty or truncated artifact would make every "not declared" reading
      // below vacuously true (trap 13). Prove it has content first.
      expect(Object.keys(OPENAPI.components.schemas).length).toBeGreaterThan(50);
      expect(Object.keys(OPENAPI.paths).length).toBeGreaterThan(0);
      expect(OPENAPI.components.schemas.RobustnessRequestV2).toBeDefined();
      expect(
        Object.keys(OPENAPI.components.schemas.RobustnessRequestV2!.properties as object),
      ).toContain('parameter_uncertainties');
    });

    it('the replay transcript was generated against THIS pin — not an earlier one', () => {
      // canonicalDigest here MUST equal the driver's canonical_pin_digest().
      // Bumping PIN.json without re-running the driver lands right here.
      expect(TRANSCRIPT.pin_digest).toBe(canonicalDigest(PIN));
      expect(TRANSCRIPT.isl_sha).toBe(PIN.isl.sha);
    });

    it('the transcript ran under the pinned pydantic and interpreter', () => {
      expect(TRANSCRIPT.pydantic_version).toBe(PIN.runtime.pydantic.split(' ')[0]);
      expect(TRANSCRIPT.python_version.startsWith('3.11')).toBe(true);
    });

    it('the vendored artifact IS the executed model’s own member set (method 1 ≡ method 2 at the source)', () => {
      // Proven by the driver, which compared openapi.json's schema closure with
      // `Model.model_json_schema()` class by class. Without this, method 2 would
      // be reading a document that merely LOOKS like the model.
      for (const [path, agreement] of Object.entries(TRANSCRIPT.schema_agreement)) {
        expect(
          agreement.agrees,
          `${path} (${agreement.model}): vendored artifact and executed model disagree\n` +
            `only_in_artifact ${JSON.stringify(agreement.only_in_artifact)}\n` +
            `only_in_model    ${JSON.stringify(agreement.only_in_model)}`,
        ).toBe(true);
        expect(agreement.classes_compared.length).toBeGreaterThan(1);
      }
      expect(Object.keys(TRANSCRIPT.schema_agreement).sort()).toEqual(
        Object.keys(PIN.mounted_request_models)
          .filter((k) => !k.startsWith('_'))
          .sort(),
      );
    });

    it('every captured-live body the transcript replayed still hashes to what it replayed', () => {
      const entries = Object.entries(TRANSCRIPT.captured_live);
      expect(entries.length).toBe(5); // the five authentic captures in the tree
      for (const [rel, entry] of entries) {
        expect(sha256File(rel), `${rel} changed since the replay. ${REGENERATE}`).toBe(
          entry.file_sha256,
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // The endpoint manifest
  // ---------------------------------------------------------------------------
  describe('endpoint manifest', () => {
    it('is exhaustive over every /api/v1 literal in src/ — a new ISL endpoint cannot slip in unclassified', () => {
      const found = new Map<string, string[]>();
      for (const file of srcFiles()) {
        const text = readFileSync(file, 'utf8');
        for (const hit of text.match(/\/api\/v1\/[A-Za-z0-9/_-]+/g) ?? []) {
          const key = hit.replace(/\/+$/, '');
          if (!found.has(key)) found.set(key, []);
          found.get(key)!.push(file.replace(`${REPO_ROOT}/`, ''));
        }
      }
      // POSITIVE CONTROL: the scan actually scanned something.
      expect(srcFiles().length).toBeGreaterThan(100);
      expect(found.size).toBeGreaterThan(0);

      const unclassified = [...found.keys()].filter((e) => !manifestByEndpoint.has(e)).sort();
      const stale = ENDPOINT_MANIFEST.map((r) => r.endpoint).filter((e) => !found.has(e)).sort();
      expect(
        { unclassified, stale },
        'ENDPOINT_MANIFEST is out of date. Every /api/v1 literal in src/ needs a row saying ' +
          'whether ISL mounts it and whether PLoT still calls it.',
      ).toEqual({ unclassified: [], stale: [] });
    });

    it('every row’s ISL mount status is DERIVED from the pinned OpenAPI path list, not asserted by hand', () => {
      const mounted = new Set(Object.keys(OPENAPI.paths));
      // POSITIVE CONTROL: the path list is populated and contains the one
      // endpoint we know is live, so `mounted.has(...)` is not vacuously false.
      expect(mounted.has('/api/v1/robustness/analyze/v2')).toBe(true);

      const derived = ENDPOINT_MANIFEST.map((r) => ({ endpoint: r.endpoint, islMounted: mounted.has(r.endpoint) }));
      const claimed = ENDPOINT_MANIFEST.map((r) => ({ endpoint: r.endpoint, islMounted: r.islMounted }));
      expect(derived).toEqual(claimed);
    });

    it('every unmounted-at-this-pin endpoint PIN.json names is a row here, and vice versa', () => {
      const fromPin = Object.keys(PIN.unmounted_at_this_pin).filter((k) => !k.startsWith('_')).sort();
      const fromManifest = ENDPOINT_MANIFEST.filter(
        (r) => !r.islMounted && r.plotLiveness !== 'no-call-site',
      )
        .map((r) => r.endpoint)
        .sort();
      expect(fromManifest).toEqual(fromPin);
    });

    it('the endpoints reached by DRIVING the producers match their manifest rows (trap 16: wire, not grep)', () => {
      const captured = new Set(PRODUCERS.map((p) => p.endpoint));
      for (const endpoint of captured) {
        const row = manifestByEndpoint.get(endpoint);
        expect(row, `producer targets ${endpoint} with no manifest row`).toBeDefined();
        expect(row!.reachability).toBe('captured-at-wire');
      }
      const declaredCaptured = ENDPOINT_MANIFEST.filter((r) => r.reachability === 'captured-at-wire')
        .map((r) => r.endpoint)
        .sort();
      expect([...captured].sort()).toEqual(declaredCaptured);
    });

    it('the one call site that cannot be driven is asserted AT THE SOURCE, and labelled as such', () => {
      const runV2 = readFileSync(resolve(REPO_ROOT, 'src/routes/v2/run.ts'), 'utf8');
      // The claim is narrow and explicit: this literal is the first argument to a
      // callAnalysisEndpoint call. That is a source claim, not a wire claim, and
      // the manifest row says so.
      expect(runV2).toMatch(/callAnalysisEndpoint<IslThresholdResponse>\(\s*\n?\s*'\/api\/v1\/analysis\/thresholds'/);
      expect(manifestByEndpoint.get('/api/v1/analysis/thresholds')!.reachability).toBe(
        'call-site-not-captured',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // The pairing itself
  // ---------------------------------------------------------------------------
  describe('egress bytes, executed-model pairing, and schema pairing', () => {
    beforeEach(() => installEgressCapture());
    afterEach(() => uninstallEgressCapture());

    /** Re-derive one producer's body at the fetch boundary. */
    async function derive(producer: ProducerSpec): Promise<{ bodyText: string; body: unknown }> {
      const captures = await producer.run();
      expect(captures, `${producer.name} put ${captures.length} bodies on the wire`).toHaveLength(1);
      return { bodyText: captures[0]!.bodyText, body: captures[0]!.body };
    }

    it('POSITIVE CONTROL: every producer is committed as a fixture, and every fixture has a producer', () => {
      expect(PRODUCERS.length).toBeGreaterThan(0);
      expect([...FIXTURES.keys()].sort()).toEqual(PRODUCERS.map((p) => p.name).sort());
      expect(Object.keys(TRANSCRIPT.egress).sort()).toEqual(PRODUCERS.map((p) => p.name).sort());
    });

    for (const producer of PRODUCERS) {
      describe(`${producer.name} → ${producer.endpoint}`, () => {
        const fixture = FIXTURES.get(producer.name);
        const entry = TRANSCRIPT.egress[producer.name];

        /**
         * ⚠ FAIL LOUD, NOT AT THE COLLECTOR (ROADMAP 2.762).
         *
         * These two lookups used to be non-null-asserted and dereferenced HERE,
         * at collection time. A producer added without its artefacts therefore
         * killed the whole FILE with `TypeError: Cannot read properties of
         * undefined (reading 'model')` and **zero tests collected** — vitest
         * pointing at a line in this harness instead of at the missing fixture,
         * and every assertion below silently not running. Measured, not
         * theorised: it is what 2.762 hit on adding the first new producer since
         * the slice was written.
         *
         * The bijection is NOT relaxed — it is still required, and the
         * POSITIVE CONTROL above asserts it over the whole set. This guard only
         * changes an unreadable collector crash into a NAMED red that says which
         * producer and which artefact, which is the difference between a gate
         * that reports a gap and a gate that looks broken.
         */
        if (fixture === undefined || entry === undefined) {
          it('BIJECTION: this producer has no committed fixture and/or no replay entry', () => {
            expect(
              { committedFixture: fixture !== undefined, replayEntry: entry !== undefined },
              `${producer.name} is listed in PRODUCERS but its committed artefacts are missing. ` +
                `The pairing cannot say anything about a producer it has never replayed.\n${REGENERATE}`,
            ).toEqual({ committedFixture: true, replayEntry: true });
          });
          return;
        }

        it('re-derived wire bytes are the exact bytes the pinned model was fed', async () => {
          const { bodyText, body } = await derive(producer);

          // POSITIVE CONTROL first: real bytes at the right endpoint.
          expect(bodyText.length).toBeGreaterThan(50);
          expect(fixture.endpoint).toBe(producer.endpoint);

          // Producer → committed fixture → transcript. Break any link and the
          // replay verdicts below are stale; that is exactly when this goes RED.
          expect(sha256(bodyText), `${producer.name} egress changed. ${REGENERATE}`).toBe(
            fixture.wire_bytes_sha256,
          );
          expect(entry.wire_bytes_sha256).toBe(fixture.wire_bytes_sha256);
          expect(body).toEqual(fixture.body);
        });

        const modelName = entry.model;

        if (modelName && producer.liveness !== 'live') {
          it('DARK PRODUCER: its undeclared set is pinned EXACTLY, so rot is visible while it is dark', async () => {
            // A dead producer cannot be held to "zero undeclared" — two of them
            // are already broken (see FINDINGS), and pretending otherwise would
            // either land this suite red or force the defect to be hidden. What
            // it CAN be held to is an exact, named set: any change — a key added,
            // a key removed, or the producer being revived — moves this and says
            // so. The number is a debt, and it is written down.
            const { body } = await derive(producer);
            const undeclared = [
              ...new Set(undeclaredPaths(body, modelName, OPENAPI).map((h) => h.normalised)),
            ].sort();
            expect(undeclared).toEqual(DARK_PRODUCER_UNDECLARED[producer.name]!.paths);
          });
        }

        if (modelName && producer.liveness === 'live') {
          it('LIVE PAIRING: the body derived RIGHT NOW carries no unexplained undeclared key', async () => {
            // Deliberately NOT read from the committed fixture. The two tests
            // either side of this one are chain links — they say "the fixture is
            // still what the producer emits" and "the transcript describes that
            // fixture". This one asks the question directly of today's code, so
            // a producer regression is named by PATH on the first run, not
            // reported as "regenerate your fixtures" and diagnosed on the second.
            const { body } = await derive(producer);
            const undeclared = [
              ...new Set(undeclaredPaths(body, modelName, OPENAPI).map((h) => h.normalised)),
            ];
            const unexplained = undeclared.filter(
              (p) => !(PLOT_TO_ISL_CONTRACT.knownUndeclared ?? []).includes(p),
            );
            expect(
              unexplained,
              `${producer.name} (${producer.site}) puts ${unexplained.length} key(s) on the wire that ISL's ` +
                `pinned ${modelName} does not declare, and PLOT_TO_ISL_CONTRACT.knownUndeclared does not exempt. ` +
                'ISL drops them silently under extra:"ignore", so nothing else in the estate will tell you.',
            ).toEqual([]);
          });
        }

        if (modelName && entry.parses === true) {
          it('METHOD 1 (executed model): the only rejected paths are the declared exemptions', () => {
            const rejected = rejectedPaths(fixture.body, entry);
            const unexplained = rejected.filter(
              (p) => !(PLOT_TO_ISL_CONTRACT.knownUndeclared ?? []).includes(p),
            );
            expect(
              unexplained,
              `${producer.name} sends ${unexplained.length} key(s) ISL's pinned ${modelName} does not declare ` +
                'and PLOT_TO_ISL_CONTRACT.knownUndeclared does not exempt. Either stop sending them, or add them ' +
                'to knownUndeclared with a named reason and a resolution.',
            ).toEqual([]);
          });

          it('METHOD 2 (pinned artifact) agrees with METHOD 1 — neither derivation is alone', () => {
            const fromExecutedModel = rejectedPaths(fixture.body, entry).sort();
            const fromSchema = [
              ...new Set(undeclaredPaths(fixture.body, modelName, OPENAPI).map((h) => h.normalised)),
            ].sort();
            expect(fromSchema, `${producer.name}: the two derivations disagree`).toEqual(
              fromExecutedModel,
            );
          });
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // The historical captures are the instrument's presence proof (trap 13 / 12b)
  // ---------------------------------------------------------------------------
  describe('authentic live captures — pinned to the historical artefact, never to "current"', () => {
    it('replay through the pinned model, and every one still parses', () => {
      const entries = Object.values(TRANSCRIPT.captured_live);
      expect(entries.length).toBe(5);
      for (const entry of entries) {
        expect(entry.parses, `${entry.fixture} no longer parses`).toBe(true);
      }
    });

    it('PRESENCE PROOF: the pre-slice-6 captures still show `parameter_uncertainties[].mean` REJECTED', () => {
      // These fixtures are frozen bytes from 6-8 Jul 2026 — before the key was
      // removed. If the pairing ever stopped reporting `mean` here, the
      // instrument would have gone blind, and every "0 undeclared" reading above
      // would be worthless. A control pinned to "whatever is current" would have
      // decayed into a tautology the moment the producer was fixed (trap 12b);
      // this one cannot, because its inputs are historical and immutable.
      const seen: string[] = [];
      for (const [rel, entry] of Object.entries(TRANSCRIPT.captured_live)) {
        const body = JSON.parse(readFileSync(resolve(REPO_ROOT, rel), 'utf8'));
        const rejected = rejectedPaths(body, entry);
        expect(rejected, `${rel} should still show the historical undeclared key`).toContain(
          'parameter_uncertainties[].mean',
        );
        seen.push(rel);

        // And the two derivations agree on the historical bodies too.
        const fromSchema = [
          ...new Set(undeclaredPaths(body, entry.model!, OPENAPI).map((h) => h.normalised)),
        ].sort();
        expect(fromSchema).toEqual([...rejected].sort());
      }
      expect(seen.length).toBe(5);
    });

    it('and the CURRENT producers do not — which is the delta slice 6 bought', () => {
      for (const producer of PRODUCERS) {
        const entry = TRANSCRIPT.egress[producer.name]!;
        if (entry.parses !== true) continue;
        const fixture = FIXTURES.get(producer.name)!;
        expect(rejectedPaths(fixture.body, entry)).not.toContain('parameter_uncertainties[].mean');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // ROADMAP 2.762 — the goal-threshold class, proved against a pin that predates it
  // ---------------------------------------------------------------------------
  describe('PRESENCE PROOF, goal-threshold class — pinned to the PRE-2.749 artefact, never to "current"', () => {
    beforeEach(() => installEgressCapture());
    afterEach(() => uninstallEgressCapture());

    /**
     * ISL's committed openapi.json at `35149dd1` — the pin this repo carried from
     * 1 Aug until the 2.749 re-pin on 6 Aug 2026. FROZEN, and regenerated NEVER:
     * it is a historical artefact, so a hash literal here is a hash of an
     * immutable file, not a mirror of anything that can move.
     *
     * WHY IT IS IN THE TREE AT ALL. Between those dates PLoT emitted
     * `goal_threshold_frame` (translator-v3.ts:767, ROADMAP 2.258) while this pin
     * did not DECLARE it, so ISL's `extra="ignore"` would have discarded it
     * silently. The gate stayed green — not through an exemption, but because no
     * fixture in the pairing emitted `goal_threshold` at all, so no body carrying
     * a frame was ever walked. Adding the goal-stamped producers proves today's
     * pin is clean; it does NOT, on its own, prove the gate can SEE the class of
     * defect it missed. Replaying the SAME producers against the SAME instrument
     * at the pin that had the hole is what proves that, and it is the reason this
     * block is a standing test rather than a paragraph in a PR body.
     *
     * Trap 12b: the reference is the historical document, not "whatever is
     * deployed now", so this control cannot decay into a tautology the next time
     * ISL moves.
     */
    const PREPIN_ISL_SHA = '35149dd148e0192ee1c44ec05336818371e30f81';
    const PREPIN_FILE = 'tests/fixtures/isl-pinned/isl-openapi-PREPIN-35149dd1.json';
    const PREPIN_SHA256 = '96bd9627aa76c76e4e280657a7972ae8ea221833f520788cd22938ab571d86ac';
    const PREPIN: OpenApiDoc = JSON.parse(readFileSync(resolve(REPO_ROOT, PREPIN_FILE), 'utf8'));

    /** The producers this row added, by name. */
    const GOAL_STAMPED = ['v2-run-goal-threshold-level', 'v2-run-goal-threshold-delta'];

    const undeclaredIn = (body: unknown, doc: OpenApiDoc): string[] =>
      [...new Set(undeclaredPaths(body, 'RobustnessRequestV2', doc).map((h) => h.normalised))].sort();

    /** Drive one producer by NAME and return the body it put on the wire. */
    async function wireBodyOf(name: string): Promise<Record<string, unknown>> {
      const producer = PRODUCERS.find((p) => p.name === name);
      expect(producer, `producer ${name} has been renamed or deleted`).toBeDefined();
      const captures = await producer!.run();
      expect(captures).toHaveLength(1);
      return captures[0]!.body as Record<string, unknown>;
    }

    it('the frozen pre-pin artefact is the exact historical bytes it claims to be', () => {
      expect(sha256File(PREPIN_FILE)).toBe(PREPIN_SHA256);
      // And it is genuinely the PREVIOUS pin, not the current one wearing a name.
      expect(PREPIN_ISL_SHA).not.toBe(PIN.isl.sha);
    });

    it('POSITIVE CONTROL: the pre-pin artefact is a working document, and its ONLY goal-side gap is the frame', () => {
      // Trap 13: an absence reading is worthless unless the instrument can show a
      // presence on the same input. Three independent presences here.
      expect(Object.keys(PREPIN.components.schemas).length).toBeGreaterThan(50);
      const props = Object.keys(
        PREPIN.components.schemas.RobustnessRequestV2!.properties as object,
      );
      // It DOES declare goal_threshold — so a `goal_threshold` reading of
      // "declared" below is the document speaking, not the walker giving up.
      expect(props).toContain('goal_threshold');
      expect(props).toContain('goal_constraints');
      // …and it does NOT declare the frame. That single difference is the defect.
      expect(props).not.toContain('goal_threshold_frame');
      expect(
        Object.keys(OPENAPI.components.schemas.RobustnessRequestV2!.properties as object),
      ).toContain('goal_threshold_frame');
    });

    it('POSITIVE CONTROL: the walker still REPORTS against the pre-pin artefact (it is not silently inert)', async () => {
      // A stale-document control that reported nothing for every input would make
      // every reading below vacuous. It does not: the caller-supplied constraint
      // weight is undeclared at BOTH pins, and is reported at both.
      const body = await wireBodyOf('v2-run-base-constraint-weight');
      expect(undeclaredIn(body, PREPIN)).toEqual(['goal_constraints[].weight']);
      expect(undeclaredIn(body, OPENAPI)).toEqual(['goal_constraints[].weight']);
    });

    for (const name of GOAL_STAMPED) {
      it(`${name}: the pairing REPORTS goal_threshold_frame undeclared at the pre-pin, and is CLEAN at the current pin`, async () => {
        const body = await wireBodyOf(name);

        // PIN THE PRECONDITION IN-TEST (trap 13b, third face). Without this the
        // "clean at the current pin" half passes just as happily when the
        // producer has stopped emitting the fields altogether — a guard whose
        // discrimination depends on a fixture that nothing pins.
        expect(body.goal_threshold, `${name} no longer emits goal_threshold`).toBe(0.72);
        expect(
          body.goal_threshold_frame,
          `${name} no longer emits goal_threshold_frame — the whole proof below would be vacuous`,
        ).toBe(name.endsWith('level') ? 'level' : 'delta');

        // THE PROOF. Same producer, same walker, two pins.
        expect(
          undeclaredIn(body, PREPIN),
          `${name} should show goal_threshold_frame UNDECLARED against ISL @${PREPIN_ISL_SHA} — ` +
            'the state in which ISL silently discarded it under extra:"ignore".',
        ).toEqual(['goal_threshold_frame']);
        expect(
          undeclaredIn(body, OPENAPI),
          `${name} should be clean against the current pin (ISL @${PIN.isl.sha}), which declares the frame.`,
        ).toEqual([]);
      });
    }

    it('THE HOLE, MEASURED: every pre-2.762 producer is goal-free, so NONE of them could report the frame at either pin', async () => {
      // This is the finding itself, stated as an executable claim rather than as
      // prose in a commit message: the gate did not stay green because it
      // forgave the frame — it stayed green because nothing it walked contained
      // one. Note the assertion is over what the producers put ON THE WIRE, not
      // over a grep of the fixture files.
      const emittingFrame: string[] = [];
      const reportingFrameAtPrePin: string[] = [];
      for (const producer of PRODUCERS) {
        if (producer.endpoint !== '/api/v1/robustness/analyze/v2') continue;
        const body = await wireBodyOf(producer.name);
        if ('goal_threshold_frame' in body) emittingFrame.push(producer.name);
        if (undeclaredIn(body, PREPIN).includes('goal_threshold_frame')) {
          reportingFrameAtPrePin.push(producer.name);
        }
      }
      // Exactly the producers this row added — no more, no fewer. A third
      // goal-stamped producer, or the loss of one of these, lands here.
      expect(emittingFrame.sort()).toEqual([...GOAL_STAMPED].sort());
      expect(reportingFrameAtPrePin.sort()).toEqual([...GOAL_STAMPED].sort());
    });
  });

  // ---------------------------------------------------------------------------
  // (b) Stale-exemption detection
  // ---------------------------------------------------------------------------
  describe('knownUndeclared is an exemption list with an expiry, not a licence', () => {
    const exemptions = PLOT_TO_ISL_CONTRACT.knownUndeclared ?? [];

    it('POSITIVE CONTROL: there are exemptions to check', () => {
      expect(exemptions.length).toBeGreaterThan(0);
    });

    it('none has been ADOPTED by ISL — an adopted key must leave the list', () => {
      for (const path of exemptions) {
        expect(
          schemaPathStatus(path, 'RobustnessRequestV2', OPENAPI),
          `${path} is now DECLARED by ISL's pinned model. The exemption is stale: delete it from ` +
            'knownUndeclared (and, for constraint_id, take the reader-first step that OQ-5 sequenced).',
        ).not.toBe('declared');
      }
    });

    it('none names a path ISL’s model tree cannot contain — a typo exempts nothing', () => {
      for (const path of exemptions) {
        expect(
          schemaPathStatus(path, 'RobustnessRequestV2', OPENAPI),
          `${path} does not resolve to a member position under a declaring parent in ` +
            "ISL's RobustnessRequestV2 tree. A typo here silently exempts nothing.",
        ).toBe('undeclared-under-declaring-parent');
      }
    });

    it('each is still ACTUALLY EMITTED by at least one producer — an unemitted exemption is dead', () => {
      const emitted = new Set<string>();
      for (const producer of PRODUCERS) {
        const entry = TRANSCRIPT.egress[producer.name];
        if (!entry || entry.parses !== true) continue;
        for (const p of rejectedPaths(FIXTURES.get(producer.name)!.body, entry)) emitted.add(p);
      }
      for (const path of exemptions) {
        expect(
          emitted,
          `${path} is exempted but no producer emits it. Either the exemption is dead (delete it) or the ` +
            'producer coverage in tests/helpers/isl-egress-producers.ts no longer reaches the branch that sends it.',
        ).toContain(path);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // NEGATIVE FIXTURES — prove the instrument goes red (S0 convention)
  // ---------------------------------------------------------------------------
  describe('NEGATIVE FIXTURES: the instrument discriminates', () => {
    const baseBody = () => JSON.parse(JSON.stringify(FIXTURES.get('v2-run-base')!.body));

    it('a planted undeclared key is reported, at its exact path, by the schema derivation', () => {
      const body = baseBody();
      body.graph.nodes[0].observed_state.metadata = { operator: '<=' };
      body.parameter_uncertainties[0].mean = 0.4;
      body.graph.edges[1].weight = 0.3;
      body.a_key_nobody_declares = true;

      const hits = undeclaredPaths(body, 'RobustnessRequestV2', OPENAPI);
      // `goal_constraints[0].constraint_id` used to appear in this list. It is
      // gone because ISL now DECLARES the field (slice 6b, ISL PR #115 —
      // re-pinned here to @0316098b), not because the instrument stopped
      // seeing it: the four remaining planted paths still land, which is what
      // keeps this fixture a discriminating control rather than a vacuous one.
      expect(hits.map((h) => h.path).sort()).toEqual(
        [
          'a_key_nobody_declares',
          'graph.edges[1].weight',
          'graph.nodes[0].observed_state.metadata',
          'parameter_uncertainties[0].mean',
        ].sort(),
      );
    });

    it('…and the unexplained-key assertion that guards every producer FAILS on that body', () => {
      const body = baseBody();
      body.graph.nodes[0].observed_state.metadata = { operator: '<=' };
      const unexplained = [
        ...new Set(undeclaredPaths(body, 'RobustnessRequestV2', OPENAPI).map((h) => h.normalised)),
      ].filter((p) => !(PLOT_TO_ISL_CONTRACT.knownUndeclared ?? []).includes(p));
      // The live assertion is `expect(unexplained).toEqual([])`. Here it would not.
      expect(unexplained).toEqual(['graph.nodes[].observed_state.metadata']);
    });

    it('a planted STALE exemption (a path ISL declares) is caught by the adoption check', () => {
      const planted = [...(PLOT_TO_ISL_CONTRACT.knownUndeclared ?? []), 'graph.nodes[].id'];
      const stale = planted.filter(
        (p) => schemaPathStatus(p, 'RobustnessRequestV2', OPENAPI) === 'declared',
      );
      expect(stale).toEqual(['graph.nodes[].id']);
    });

    it('a planted TYPO exemption is caught by the resolvability check', () => {
      const planted = ['goal_constriants[].constraint_id', 'graph.nodes[].observed_stat.value'];
      for (const p of planted) {
        expect(schemaPathStatus(p, 'RobustnessRequestV2', OPENAPI)).toBe('parent-not-in-tree');
      }
    });

    it('REMOVING a real exemption turns the producer pairing RED, naming the path', () => {
      // The mutation the brief asks for, run in-suite so it is standing evidence
      // rather than a one-off transcript: with the exemption taken out of the
      // list, the producer's body is no longer clean.
      //
      // ⚠ REPOINTED (slice 6b). This control used to remove
      // `goal_constraints[].constraint_id` against the `v2-run-base` producer.
      // ISL now DECLARES that field, so the removal stopped producing a hit and
      // the control began passing by testing nothing — trap 12b exactly: a
      // control pinned to "whatever is currently exempt" decays the moment the
      // exemption list changes. It is now pointed at `goal_constraints[].weight`
      // — still genuinely undeclared upstream — and at the producer that
      // actually emits it (`weight` is caller-supplied and latent on the golden
      // `v2-run-base` path, which is why that fixture exists).
      const EXEMPTION = 'goal_constraints[].weight';
      const PRODUCER = 'v2-run-base-constraint-weight';

      // Guard the guard: if this exemption is ever adopted upstream too, fail
      // loudly here rather than silently asserting an empty diff again.
      expect(PLOT_TO_ISL_CONTRACT.knownUndeclared ?? []).toContain(EXEMPTION);

      const shortened = (PLOT_TO_ISL_CONTRACT.knownUndeclared ?? []).filter(
        (p) => p !== EXEMPTION,
      );
      const entry = TRANSCRIPT.egress[PRODUCER]!;
      const unexplained = rejectedPaths(FIXTURES.get(PRODUCER)!.body, entry).filter(
        (p) => !shortened.includes(p),
      );
      expect(unexplained).toEqual([EXEMPTION]);
    });
  });

  // ---------------------------------------------------------------------------
  // FINDINGS the pairing surfaced, pinned so they cannot regress silently
  // ---------------------------------------------------------------------------
  describe('FINDINGS pinned by this suite (reported, not fixed — slice 2 is test-only)', () => {
    it('computeCounterfactual sends a body ISL’s mounted CounterfactualRequest REJECTS', () => {
      const entry = TRANSCRIPT.egress['causal-counterfactual-dead']!;
      expect(entry.parses).toBe(false);
      // Missing REQUIRED members — a stronger failure than an undeclared key.
      expect(entry.validation_errors.map((e) => `${e.loc.join('.')}:${e.type}`).sort()).toEqual([
        'model:missing',
        'outcome:missing',
      ]);
      // …and what it DOES send is undeclared: PLoT says {dag, target}; ISL
      // declares {model, outcome}. Producer is dead, so no live impact today.
      const hits = undeclaredPaths(
        FIXTURES.get('causal-counterfactual-dead')!.body,
        'CounterfactualRequest',
        OPENAPI,
      ).map((h) => h.normalised);
      expect(hits.sort()).toEqual(['dag', 'target']);
    });

    it('analyseFactorSensitivity omits ISL’s REQUIRED edge `strength` (slice-6 finding 3, now proven at the model)', () => {
      const entry = TRANSCRIPT.egress['factor-sensitivity-dead']!;
      expect(entry.parses).toBe(false);
      expect(entry.validation_errors.map((e) => `${e.loc.join('.')}:${e.type}`)).toEqual([
        'graph.edges.0.strength:missing',
        'graph.edges.1.strength:missing',
      ]);
      // Slice 6 flagged this by reading the code. The pinned model now says it.
    });

    it('two LIVE producers target endpoints ISL does not mount at the pin', () => {
      const liveUnmounted = ENDPOINT_MANIFEST.filter((r) => r.plotLiveness === 'live' && !r.islMounted)
        .map((r) => r.endpoint)
        .sort();
      expect(liveUnmounted).toEqual(['/api/v1/analysis/thresholds', '/api/v1/causal/validate']);
      // Both are absorbed by their callers (fallback / degrade-and-disclose), so
      // this is capability loss, not an outage. It is pinned here so that ISL
      // re-mounting either one — or PLoT adding a THIRD — is a visible change.
    });

    it('the endpoints PLoT can reach and ISL mounts are exactly two', () => {
      const pairable = ENDPOINT_MANIFEST.filter((r) => r.islMounted).map((r) => r.endpoint).sort();
      expect(pairable).toEqual(['/api/v1/causal/counterfactual', '/api/v1/robustness/analyze/v2']);
    });
  });
});

/**
 * METHOD 1. Rejected = every path in the body that ISL's own parse did not keep.
 *
 * `parsed_dump` is `model_dump(by_alias=True, exclude_unset=True)` from the
 * pinned model, so a key dropped by `extra: "ignore"` is simply absent from it.
 * Nothing here re-states ISL's field list.
 */
function rejectedPaths(body: unknown, entry: ReplayEntry): string[] {
  const accepted = jsonPaths(entry.parsed_dump);
  return [...jsonPaths(body)].filter((p) => !accepted.has(p)).sort();
}

// Keeps the OpenApiDoc import honest for consumers reading this file.
export type { OpenApiDoc };
