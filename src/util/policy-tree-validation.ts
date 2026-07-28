/**
 * Total validation of an untrusted `policy_tree`, down to the fields a reader
 * actually consumes.
 *
 * ## Why this exists
 *
 * `/v1/explain/policy` casts `req.body as ExplainPolicyRequest` and previously
 * validated only that `policy_tree`, `policy_tree.nodes` and
 * `policy_tree.root_id` were *truthy*. Everything below that was read as if the
 * TypeScript types were enforced at the wire, and they are not: a node without
 * `children` reached `n.children.length` and the resulting TypeError surfaced to
 * callers as an opaque 500 "Something went wrong". Reproduced live on staging
 * build `220739b` with
 * `{"policy_tree":{"root_id":"r","depth":2,"nodes":[{"id":"r"}]}}`.
 *
 * This is the same defect class PR #265 fixed for `sequential_metadata`. That
 * fix made `validateSequentialGraph` total and gave it a home in
 * `src/util/sequential-validation.ts`; this is its sibling, and it lives beside
 * it for the same reason: a policy tree arrives as untrusted wire input whose
 * declared TypeScript type is not enforced at the wire, so the check belongs
 * somewhere a consumer can call rather than re-validate by hand and re-derive
 * the `{code, field, message}` envelope.
 *
 * ## Why this module exists — and it is NOT the route named below
 *
 * This module validates the policy-tree SHAPE for **`/v1/explain/policy`**.
 * That is its entire reason to exist, and that route is the SOLE consumer:
 * `src/routes/v1/explain-policy.ts` is the only importer of
 * `validatePolicyTreeShape` in the repo (complete manifest, derived at
 * `05529e42`: one `import`, one call site, two `Precondition:` references).
 * `/v1/explain/policy` is registered and auth-gated and is NOT affected by the
 * deletion recorded below — do not conflate the two routes.
 *
 * ## ⚠ CORRECTED 28 Jul 2026 — this header used to justify itself with a route
 * ## that no longer exists
 *
 * The paragraph above previously read *"`/v1/analysis/policy-tree` is
 * registered and live, so a second consumer of a policy tree is foreseeable"*.
 * **That claim was false.** `/v1/analysis/policy-tree` was deleted as vacuous
 * on 26 Jul 2026 — it produced no option-discriminating output, and ISL owns
 * the real sequential capability. `src/routes/v1/types/proxy.types.ts`,
 * `src/util/sequential-validation.ts`, `src/trust/types.ts` and the Phase-4
 * tests all recorded that deletion; this file alone kept the pre-deletion
 * sentence, so the module's stated justification outlived the thing it named.
 *
 * Live-probed 28 Jul 2026 against staging tip `05529e42`: `GET` and `POST`
 * `/v1/analysis/policy-tree` → **404**, and `/v1/analysis/sequential` → **404**,
 * against positive control `POST /v1/run` → 401 (the gate is real, so 404 is
 * absence and not an auth artefact) and negative control
 * `POST /v1/does-not-exist-xyz` → 404.
 *
 * **Do not "restore" `/v1/analysis/policy-tree` on the strength of finding its
 * name here.** It was removed deliberately, nothing in this module depends on
 * it, and this module is not orphaned by its removal: the foreseen "second
 * consumer" is not what keeps this code alive — `/v1/explain/policy` is.
 *
 * ## Layering
 *
 * The parameter is typed STRUCTURALLY (`{ nodes?: unknown }`), not as the route's
 * `IslPolicyTreeResponse`. Two reasons, and the first is the point of the whole
 * module: the declared type is exactly what is NOT enforced at the wire, so
 * accepting it here would re-assert the guarantee this function exists to
 * doubt. Second, `src/util` is a leaf — importing a `src/routes/v1` type would
 * invert the layering, the inversion `src/util/numeric.ts` documents avoiding.
 *
 * ## The rule for anyone editing a consumer
 *
 * Every field of `policy_tree` that a handler reads must either be validated
 * here (typed 400) or be read totally (no throw, no fabricated output) at the
 * point of use. Malformed input must produce an honest envelope, never a 500.
 *
 * Load-bearing fields are validated because the analysis is genuinely
 * uncomputable without them:
 * - `nodes[].stage`          — the grouping key, and a required response field
 * - `nodes[].expected_value` — arithmetic input; also `.toFixed()` in the output
 * - `nodes[].children`       — the sole terminal-node discriminator
 * Cosmetic fields (`type`, `label`, `action`, `policy_summary`) are read totally
 * instead, so a request that succeeds today keeps succeeding.
 *
 * ## ⚠ Ordering, for callers
 *
 * At `/v1/explain/policy` this runs as the LAST validator, deliberately: a body
 * malformed in both its graph and its policy_tree keeps reporting the graph code
 * it reported before the check existed (e.g. `INVALID_STAGE_DEFINITION`, pinned
 * by #265's live evidence and by the PRESERVATION CONTROL in
 * `tests/explain-policy-malformed-tree.regression.test.ts`). Ordered last, it
 * never renames a 400 that callers already receive. A new consumer that runs it
 * FIRST does not inherit that property and must establish its own.
 *
 * ## ⚠ CORRECTED SCOPE — it is NOT only 500→400
 *
 * #273 stated the invariant as *"this change only ever converts a 500 into a
 * 400"*. That is **not exactly true**, and the imprecision is recorded here
 * rather than quietly kept: the disclosure named three flips, but its own
 * "load-bearing" definition excluded `id`, and there is a fourth.
 *
 * A tree that is well-formed in `stage`, `expected_value` and `children` but
 * carries a missing / non-string / empty `id` returned **200 before, 400 now**.
 * A present-but-wrongly-typed `stage` (e.g. the string `"2"`) is the same shape
 * of flip: it grouped and rendered before, and is refused now.
 *
 * The `id` check is nevertheless KEPT, not relaxed to absence-only, because
 * `id` IS read on the success path: `decisionText`'s last resort returns
 * `node.id` straight into user-facing prose (`"the optimal action is …"`) and
 * into `key_decision`. A non-string `id` therefore renders as `"[object
 * Object]"` or `"undefined"` — the same fabrication-into-prose class the
 * `policy_summary` fix in that route eliminated. Refusing honestly is correct;
 * the overclaiming sentence was the defect, so the sentence is what changed.
 */

import { isFiniteNumber } from './numeric.js';

/** The typed refusal a caller turns into its own 400 envelope. */
export interface PolicyTreeShapeIssue {
  code: string;
  field: string;
  message: string;
}

/**
 * Returns the first shape violation found, or `null` when the tree is safe to
 * read. Total: never throws, whatever the input contains.
 */
export function validatePolicyTreeShape(policyTree: {
  nodes?: unknown;
}): PolicyTreeShapeIssue | null {
  if (!Array.isArray(policyTree.nodes)) {
    return {
      code: 'INVALID_POLICY_TREE',
      field: 'policy_tree.nodes',
      message: `policy_tree.nodes must be an array of policy tree nodes, received ${policyTree.nodes === null ? 'null' : typeof policyTree.nodes}.`,
    };
  }

  for (let i = 0; i < policyTree.nodes.length; i++) {
    const node = policyTree.nodes[i] as unknown;

    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return {
        code: 'INVALID_POLICY_TREE_NODE',
        field: `policy_tree.nodes[${i}]`,
        message: `policy_tree.nodes[${i}] is not a policy tree node — expected an object, received ${node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node}.`,
      };
    }

    const n = node as Record<string, unknown>;

    if (typeof n.id !== 'string' || n.id.length === 0) {
      return {
        code: 'INVALID_POLICY_TREE_NODE',
        field: `policy_tree.nodes[${i}].id`,
        message: `policy_tree.nodes[${i}] is missing a non-empty string "id".`,
      };
    }

    if (!isFiniteNumber(n.stage)) {
      return {
        code: 'INVALID_POLICY_TREE_NODE',
        field: `policy_tree.nodes[${i}].stage`,
        message: `policy_tree.nodes[${i}] ("${n.id}") has "stage" of type ${n.stage === null ? 'null' : typeof n.stage}, expected a finite number. Stage explanations are grouped by this value.`,
      };
    }

    if (!isFiniteNumber(n.expected_value)) {
      return {
        code: 'INVALID_POLICY_TREE_NODE',
        field: `policy_tree.nodes[${i}].expected_value`,
        message: `policy_tree.nodes[${i}] ("${n.id}") has "expected_value" of type ${n.expected_value === null ? 'null' : typeof n.expected_value}, expected a finite number. Risk and rationale figures are computed from it.`,
      };
    }

    if (!Array.isArray(n.children)) {
      return {
        code: 'INVALID_POLICY_TREE_NODE',
        field: `policy_tree.nodes[${i}].children`,
        message: `policy_tree.nodes[${i}] ("${n.id}") has "children" of type ${n.children === null ? 'null' : typeof n.children}, expected an array of child node IDs. Terminal nodes are identified by an empty "children" array.`,
      };
    }
  }

  return null;
}
