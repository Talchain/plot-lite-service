/**
 * Paul's churn limit and its measured variants, derived IN-REPO from MG's
 * byte-for-byte capture `tests/fixtures/paul-own-a295e4a1-20260927/cee-to-plot.request.json`.
 *
 * `shape` and `spell` are a line-for-line port of Canonical State's
 * `measure.py` (`output/olumi-handover-2026-09-25/canonical-state/rule1-limit-period/`,
 * 28 Sep 2026). Checked in MG 71229dfd's session: applying `measure.py`'s own
 * `shape`/`spell` to this fixture reproduces every one of Canonical's raw
 * requests it names (J-a-4, J-b-4, J-bn-4, P-a-4, P-b-4, P-bn-4, J-y-10,
 * J-yn-10, P-yn-10, J-a-10) exactly, `request_id`/`seed` aside — so the rows
 * that use these shapes run on Canonical's measured inputs, not on a
 * re-authored copy of them.
 *
 * Shapes:  P = as captured (churn NON-ROOT, one option `ca47b368` sets it to 2.5)
 *          J = journey A: `ca47b368` removed (churn NON-ROOT, NOT intervened)
 *          R = churn's two non-option parents removed (ROOT, intervened)
 * Spellings (limit unit / node unit / node baseline):
 *   a  '%'           / '% per month' / 0.03, CEE's same-period relabel stamp (TODAY'S WIRE)
 *   an as a, no baseline
 *   b  '% per month' / '% per month' / 0.03   (no stamp)
 *   bn as b, no baseline
 *   c  '%'           / '%'           / 0.03   (no stamp)
 *   cn as c, no baseline
 *   y  '% per year'  / '% per month' / 0.03   (a DIFFERENT period, verbatim, no stamp)
 *   yn as y, no baseline
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const CHURN = 'monthly_churn';
export const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';
export const RETENTION_OPTION = 'ca47b368';

const FIXTURE = resolve(__dirname, '../fixtures/paul-own-a295e4a1-20260927/cee-to-plot.request.json');

export function paulRequest(): any {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

/** `measure.py` `shape`. */
export function shape(req: any, s: 'P' | 'J' | 'R'): any {
  const r = structuredClone(req);
  if (s === 'R') {
    r.graph.edges = r.graph.edges.filter(
      (e: any) => !(e.to === CHURN && (e.from === 'price_sensitivity' || e.from === 'fac_existing_customers_grandfathered')),
    );
  }
  if (s === 'J') {
    const drop = RETENTION_OPTION;
    r.options = r.options.filter((o: any) => o.id !== drop);
    r.graph.nodes = r.graph.nodes.filter((n: any) => n.id !== drop);
    r.graph.edges = r.graph.edges.filter((e: any) => e.from !== drop && e.to !== drop);
  }
  return r;
}

export type Spelling = 'a' | 'an' | 'b' | 'bn' | 'c' | 'cn' | 'y' | 'yn';

const LIMIT_UNIT: Record<Spelling, string> = {
  a: '%', an: '%', b: '% per month', bn: '% per month', c: '%', cn: '%', y: '% per year', yn: '% per year',
};
const NODE_UNIT: Record<Spelling, string> = {
  a: '% per month', an: '% per month', b: '% per month', bn: '% per month', c: '%', cn: '%', y: '% per month', yn: '% per month',
};

/** `measure.py` `spell` (mutates and returns `r`). */
export function spell(r: any, sp: Spelling, value: number): any {
  const node = r.graph.nodes.find((n: any) => n.id === CHURN);
  const os = node.observed_state;
  os.unit = NODE_UNIT[sp];
  if (sp === 'bn' || sp === 'an' || sp === 'cn' || sp === 'yn') delete os.baseline;
  else os.baseline = os.value;
  for (const gcs of [r.goal_constraints, r.graph.goal_constraints ?? []]) {
    for (const c of gcs) {
      if (c.constraint_id !== CHURN_LIMIT) continue;
      c.unit = LIMIT_UNIT[sp];
      c.value = value;
      delete c.provenance_unit_relabelled;
      if (sp === 'a' || sp === 'an') {
        c.provenance_unit_relabelled = {
          rule: 'agent_lane_limit_unit_v1',
          pre_normalisation_value: value,
          pre_normalisation_unit: '% per month',
        };
      }
    }
  }
  return r;
}

/** Canonical's tag, e.g. `variant('P', 'a', 4)` is `P-a-4`. */
export function variant(s: 'P' | 'J' | 'R', sp: Spelling, value: number): any {
  return spell(shape(paulRequest(), s), sp, value);
}

/** Every copy of the churn limit (top level and graph), so an edit reaches both carriers. */
export function churnLimits(r: any): any[] {
  return [...(r.goal_constraints ?? []), ...(r.graph?.goal_constraints ?? [])].filter(
    (c: any) => c.constraint_id === CHURN_LIMIT,
  );
}

/**
 * CEE's DEMOTED form of a request: every option setting re-expressed in its
 * node's UNIT form (value ÷ the node's own frame: `observed_state.cap`, else
 * the raw `scale_frame`), so PLoT's Phase-4a gate skips the request
 * (`needsNormalisation`). The frame is read off the request's own node, never
 * assumed; a setting on a node with no frame fails the helper loudly.
 */
export function demote(req: any): any {
  const r = structuredClone(req);
  const byId = new Map<string, any>(r.graph.nodes.map((n: any) => [n.id, n]));
  for (const o of r.options) {
    for (const [nodeId, raw] of Object.entries<any>(o.interventions ?? {})) {
      const node = byId.get(nodeId);
      const frame = node?.observed_state?.cap ?? node?.scale_frame;
      if (typeof frame !== 'number' || !(frame > 0)) throw new Error(`demote: no frame for ${nodeId}`);
      const value = typeof raw === 'number' ? raw : raw?.value;
      o.interventions[nodeId] = value / frame;
    }
  }
  return r;
}

/**
 * The churn limit's DELIVERED block: everything the response says about it,
 * plus what PLoT asked ISL. Bound by constraint_id; option rows by option_id.
 */
export function deliveredChurnBlock(body: any, islBody: any): any {
  return {
    constraints_status: body.constraints_status ?? null,
    joint_withheld: body.joint_withheld ?? null,
    constraint_results: (body.constraint_results ?? []).filter((c: any) => c.constraint_id === CHURN_LIMIT),
    option_comparison: (body.option_comparison ?? []).map((o: any) => ({
      option_id: o.option_id,
      constraint_probabilities: o.constraint_probabilities ?? null,
      probability_of_joint_goal: o.probability_of_joint_goal ?? null,
      constraints_decision_grade: o.constraints_decision_grade ?? null,
      constraint_margins: (o.constraint_margins ?? []).filter((m: any) => m.constraint_id === CHURN_LIMIT),
      goal_fit_basis: o.goal_fit_basis ?? null,
    })),
    unreliable: (body.inference_warnings ?? []).filter((w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE'),
    constraint_repairs: (body._meta?.repairs_applied ?? []).filter((r: any) => r.field === `constraint.value.${CHURN_LIMIT}`),
    isl_constraint: (islBody?.goal_constraints ?? []).find((c: any) => c.constraint_id === CHURN_LIMIT) ?? null,
  };
}
