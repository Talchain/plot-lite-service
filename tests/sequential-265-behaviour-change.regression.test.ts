/**
 * C6: the 200 -> 400 behaviour changes #265 shipped without test cover.
 *
 * #265's gate is "any issue with `severity === 'error'`", which reaches the
 * PRE-EXISTING error codes (NON_CONTIGUOUS_STAGES, MISSING_DECISION_NODE,
 * MISSING_UNCERTAINTY_NODE, INVALID_NODE_STAGE, INVALID_DISCOUNT_FACTOR), not
 * only the four new malformation codes. Its own two new 400 tests exercise
 * exactly one input — `stages = 'not-an-array'`. Everything else below was
 * uncovered.
 *
 * Measured pre-#265 (04f6dbac) vs post-#265 (eceb6bb), same probe, both routes,
 * in a worktree per revision:
 *
 *   sequential_metadata.default_discount_factor    PRE                POST
 *   "0.95"                        200  ev=6066     400 INVALID_DISCOUNT_FACTOR
 *   "abc"                         200  ev=null     400 INVALID_DISCOUNT_FACTOR
 *   true                          200  ev=6221.5   400 INVALID_DISCOUNT_FACTOR
 *   {}                            200  ev=null     400 INVALID_DISCOUNT_FACTOR
 *   null                          200  ev=6221.5   200                (unchanged)
 *   0.95  (control)               200  ev=6066     200  ev=6066       (unchanged)
 *
 * The decisive row is the first: `"0.95"` produced ev=6066 pre-#265, BYTE-EQUAL
 * to the numeric 0.95 control. JS coerced the string in the `< 0 / > 1`
 * comparisons and again in the arithmetic, so the client got the RIGHT answer.
 * #265 turned that into a 400. A numeric string is a client-serialisation
 * artefact, not a semantic error, so this test pins it back to 200 — but now
 * with the coercion DISCLOSED as a warning instead of happening silently.
 *
 * `"abc"`, `true` and `{}` are deliberately NOT restored. Pre-#265 they returned
 * 200 carrying `overall_expected_value: null` or an accidental
 * boolean-to-1 coercion — silent garbage. #265's 400 is strictly better there,
 * so it stays, and this file is where that choice is written down.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerSequentialAnalysisRoute } from '../src/routes/v1/analysis-sequential.js';
import { registerPolicyTreeRoute } from '../src/routes/v1/analysis-policy-tree.js';
import { validateSequentialGraph } from '../src/util/sequential-validation.js';

const NODES = [
  { id: 'd1', label: 'D1', kind: 'decision', stage: 0 },
  { id: 'o1a', label: 'O1a', kind: 'option', stage: 0, value: 60 },
  { id: 'o1b', label: 'O1b', kind: 'option', stage: 0, value: 40 },
  { id: 'd2', label: 'D2', kind: 'decision', stage: 1 },
  { id: 'o2a', label: 'O2a', kind: 'option', stage: 1, value: 70 },
  { id: 'out', label: 'Out', kind: 'outcome', stage: 1, value: 100 },
];
const EDGES = [
  { from: 'o1a', to: 'out', weight: 0.6 },
  { from: 'o2a', to: 'out', weight: 0.7 },
];
const GOOD_STAGES = [
  { index: 0, label: 's0', decisions: ['d1'], resolved_uncertainties: [] },
  { index: 1, label: 's1', decisions: ['d2'], resolved_uncertainties: [] },
];

function payloadWithDiscount(default_discount_factor: unknown) {
  return {
    graph: {
      nodes: NODES,
      edges: EDGES,
      sequential_metadata: { is_sequential: true, stages: GOOD_STAGES, default_discount_factor },
    },
    outcome_node: 'out',
  };
}

const BOTH_FULL_VALIDATION_ROUTES = ['/v1/analysis/sequential', '/v1/analysis/policy-tree'];

describe('C6: #265 behaviour changes on previously-200 inputs', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerSequentialAnalysisRoute(app);
    await registerPolicyTreeRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    process.env.ENABLE_SEQUENTIAL_ANALYSIS = '1';
    delete process.env.ISL_SEQUENTIAL_ENABLE;
    delete process.env.ISL_POLICY_TREE_ENABLE;
    delete process.env.ISL_ENABLE;
  });

  // ===========================================================================
  // (a) a numeric-string discount factor must not block
  // ===========================================================================
  describe('(a) a coercible numeric-string default_discount_factor', () => {
    it('RED-first: does not block either route', async () => {
      for (const url of BOTH_FULL_VALIDATION_ROUTES) {
        const res = await app.inject({ method: 'POST', url, payload: payloadWithDiscount('0.95') });
        // Before this fix: 400 INVALID_DISCOUNT_FACTOR on both.
        expect(res.statusCode, `${url} must not block on "0.95"`).toBe(200);
      }
    });

    it('RED-first: yields the SAME analysis as the equivalent number', async () => {
      // Restoring the status code is not enough — the answer has to be the one
      // the client used to get. Pre-#265 this was ev=6066 either way.
      const asString = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: payloadWithDiscount('0.95'),
      });
      const asNumber = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: payloadWithDiscount(0.95),
      });

      expect(asString.statusCode).toBe(200);
      expect(asNumber.statusCode).toBe(200);

      const s = JSON.parse(asString.payload);
      const n = JSON.parse(asNumber.payload);
      expect(s.analysis.overall_expected_value).toBe(n.analysis.overall_expected_value);
      expect(typeof n.analysis.overall_expected_value).toBe('number');
      expect(Number.isFinite(n.analysis.overall_expected_value)).toBe(true);

      // RED-first: the response must not say two different things about one
      // value. `model_card.discount_factor` is declared `number`, but the raw
      // string used to be echoed straight through — so the card read "0.95"
      // while the COERCED_DISCOUNT_FACTOR warning said it was read as 0.95.
      expect(s.model_card.discount_factor).toBe(0.95);
      expect(typeof s.model_card.discount_factor).toBe('number');
    });

    it('POSITIVE CONTROL: the discount factor actually affects the result', async () => {
      // Without this, the equality above could hold because the discount factor
      // is ignored entirely — the assertion would pass while proving nothing.
      const discounted = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: payloadWithDiscount(0.5),
      });
      const undiscounted = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: payloadWithDiscount(1),
      });

      const a = JSON.parse(discounted.payload).analysis.overall_expected_value;
      const b = JSON.parse(undiscounted.payload).analysis.overall_expected_value;
      expect(a).not.toBe(b);
    });

    it('RED-first: the coercion is DISCLOSED, not silent', async () => {
      // Pre-#265 the string was coerced by accident with no signal at all. The
      // 200 comes back, but the client is told the field was not a number.
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: payloadWithDiscount('0.95'),
      });
      const issues = JSON.parse(res.payload).validation.issues;
      const coerced = issues.find((i: any) => i.code === 'COERCED_DISCOUNT_FACTOR');
      expect(coerced).toBeDefined();
      expect(coerced.severity).toBe('warning');
      expect(coerced.message).toContain('string');
    });

    it('POSITIVE CONTROL: a plain number is not reported as coerced', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/sequential',
        payload: payloadWithDiscount(0.95),
      });
      const issues = JSON.parse(res.payload).validation.issues;
      expect(issues.map((i: any) => i.code)).not.toContain('COERCED_DISCOUNT_FACTOR');
      expect(issues).toEqual([]);
    });

    it('a numeric string OUT of range still blocks, like the number would', () => {
      // Coercion is not permission: "1.5" must fail exactly as 1.5 does.
      for (const v of ['1.5', '-0.1']) {
        const r = validateSequentialGraph({
          nodes: NODES,
          edges: EDGES,
          sequential_metadata: {
            is_sequential: true,
            stages: GOOD_STAGES,
            default_discount_factor: v,
          },
        } as any);
        const err = r.issues.find((i) => i.code === 'INVALID_DISCOUNT_FACTOR');
        expect(err, `"${v}" must still be rejected`).toBeDefined();
        expect(err!.severity).toBe('error');
      }
    });

    it('non-coercible values are DELIBERATELY still blocked (documented choice)', async () => {
      // Pre-#265 these returned 200 with overall_expected_value: null (or a
      // boolean silently coerced to 1). That silence is worse than a 400, so
      // #265's block is kept here on purpose rather than restored.
      for (const bad of ['abc', true, {}, [], '', '  ']) {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/analysis/sequential',
          payload: payloadWithDiscount(bad),
        });
        expect(res.statusCode, `${JSON.stringify(bad)} must block`).toBe(400);
        expect(JSON.parse(res.payload).code).toBe('INVALID_DISCOUNT_FACTOR');
      }
    });

    it('null and undefined remain accepted, as before and after #265', async () => {
      for (const v of [null, undefined]) {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/analysis/sequential',
          payload: payloadWithDiscount(v),
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.payload).validation.issues).toEqual([]);
      }
    });
  });

  // ===========================================================================
  // (b) a rejected stage entry must not cascade into N misattributed errors
  // ===========================================================================
  describe('(b) a rejected stage definition must not cascade INVALID_NODE_STAGE', () => {
    /** `index: '1'` is dropped by readStageDefinitions; 3 nodes still point at stage 1. */
    const graphWithDroppedStage = () =>
      ({
        nodes: NODES,
        edges: EDGES,
        sequential_metadata: {
          is_sequential: true,
          stages: [
            GOOD_STAGES[0],
            { index: '1', label: 's1', decisions: ['d2'], resolved_uncertainties: [] },
          ],
        },
      }) as any;

    it('RED-first: reports the rejected definition, not one error per orphaned node', () => {
      const r = validateSequentialGraph(graphWithDroppedStage());
      const codes = r.issues.map((i) => i.code);

      expect(codes).toContain('INVALID_STAGE_DEFINITION');
      // Before the fix: three INVALID_NODE_STAGE errors (d2, o2a, out), all of
      // them restating a consequence of the one real fault.
      expect(codes).not.toContain('INVALID_NODE_STAGE');
    });

    it('POSITIVE CONTROL: INVALID_NODE_STAGE still fires when the stage list is intact', () => {
      // Suppression must be conditional on the list being known-incomplete. With
      // every entry well-formed, a node pointing at an undefined stage is a real
      // and correctly-attributed error.
      const r = validateSequentialGraph({
        nodes: [...NODES, { id: 'orphan', label: 'Orphan', kind: 'factor', stage: 9 }],
        edges: EDGES,
        sequential_metadata: { is_sequential: true, stages: GOOD_STAGES },
      } as any);

      const issue = r.issues.find((i) => i.code === 'INVALID_NODE_STAGE');
      expect(issue).toBeDefined();
      expect(issue!.affected_ids).toEqual(['orphan']);
      expect(r.valid).toBe(false);
    });

    it('still blocks — suppressing the cascade must not unblock the request', async () => {
      // The rejected definition is itself error-severity, so the 400 stands.
      for (const url of BOTH_FULL_VALIDATION_ROUTES) {
        const res = await app.inject({
          method: 'POST',
          url,
          payload: { graph: graphWithDroppedStage(), outcome_node: 'out' },
        });
        expect(res.statusCode, url).toBe(400);
        expect(JSON.parse(res.payload).code, url).toBe('INVALID_STAGE_DEFINITION');
      }
    });
  });

  // ===========================================================================
  // the policy-tree gate widening #265 shipped uncovered
  // ===========================================================================
  describe('policy-tree now blocks on PRE-EXISTING error codes too (intended, was uncovered)', () => {
    /**
     * #265 added the gate at analysis-policy-tree.ts:263. Before it, the route
     * discarded `validation` entirely and returned 200 on EVERY validation
     * error. So this is a wide status change for that route — intended, matching
     * the contract table this module has always published, but #265's only 400
     * tests used `stages = 'not-an-array'`. These pin the rest of the surface so
     * the next person can see what the gate actually covers.
     */
    const cases: Array<[string, unknown]> = [
      [
        'NON_CONTIGUOUS_STAGES',
        [
          { index: 0, label: 's0', decisions: [], resolved_uncertainties: [] },
          { index: 5, label: 's5', decisions: [], resolved_uncertainties: [] },
        ],
      ],
      [
        'MISSING_DECISION_NODE',
        [{ index: 0, label: 's0', decisions: ['nope'], resolved_uncertainties: [] }],
      ],
      [
        'MISSING_UNCERTAINTY_NODE',
        [{ index: 0, label: 's0', decisions: [], resolved_uncertainties: ['nope'] }],
      ],
    ];

    it.each(cases)('policy-tree blocks with %s', async (code, stages) => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/policy-tree',
        payload: {
          graph: { nodes: NODES, edges: EDGES, sequential_metadata: { is_sequential: true, stages } },
          outcome_node: 'out',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe(code);
    });

    it('POSITIVE CONTROL: a well-formed graph is not blocked by that gate', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/analysis/policy-tree',
        payload: {
          graph: {
            nodes: NODES,
            edges: EDGES,
            sequential_metadata: { is_sequential: true, stages: GOOD_STAGES },
          },
          outcome_node: 'out',
        },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
