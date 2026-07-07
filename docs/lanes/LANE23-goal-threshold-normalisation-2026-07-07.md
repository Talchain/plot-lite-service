# Lane P0-C1 — goal-threshold normalisation (silent nullification of the user's success target)

- **Branch:** `claude-lane23/goal-threshold-normalisation` (fresh worktree from `origin/staging` @ `38d589cd`)
- **Date:** 2026-07-07
- **Live evidence source:** 2026-07-07 live run — the user's "at least 20%" goal
  constraint was clamped to 1.0 on a default [0,1] range; every option's goal
  probability came back ~0 and was suppressed as unreliable. The displayed
  results silently ignored his registered target.
- **Scope discipline:** additive only. No ISL request-shape change, no schema
  change, no change to the `target_base_defaulted` suppression leg (that is
  the pending doctrine decision **P0-C2**, not this lane).

---

## The verified live mechanism (code @ 38d589cd + live logs)

The correct value was on the wire the whole time and was never used:

1. CEE sends the explicit goal constraint `{ value: 20, unit: '%' }` on node
   `goal_productivity` — **and** stamps the goal node itself with the
   correctly-normalised `goal_threshold: 0.2` plus `goal_threshold_cap: 100`
   for exactly this normalisation.
2. PLoT's constraint normaliser ignores BOTH signals:
   - `normaliseGoalConstraints()` (`src/lib/intervention-normaliser.ts`,
     pre-fix ~876–946) calls `deriveRange(node)` which reads only
     `observed_state.cap` / `state_space.range` / hints / baselines. The goal
     node has none of these → **default [0,1] range**.
   - The constraint's `'%'` unit never reaches the normaliser at all: the
     temporal filter (`src/normalisation/constraint-filter.ts`) strips `unit`
     at the ISL boundary *before* Phase 4b normalisation runs.
   - The node's `goal_threshold`/`goal_threshold_cap` never reach it either:
     the graph normaliser (`src/normalisation/graph-normaliser.ts`,
     `normaliseNode`) rebuilds nodes into canonical `EngineNodeV3`, which does
     not carry those fields.
3. Threshold 20 normalised against [0,1] → **clamped to 1.0** ("≥ domain
   max"); PLoT logged `plot.constraint_out_of_domain` (warn) and the repair
   `normalised range=[0,1] source=default (clamped)`.
4. The lane-6 producer-honesty layer then (correctly, given its inputs)
   flagged `threshold_normalisation_defaulted` and suppressed
   `probability_of_joint_goal` / `constraint_probabilities` —
   so the emitted results silently ignored the target.
5. The one path that WOULD have used the node's already-normalised
   `goal_threshold` (`auto_constraint_from_threshold`, `src/routes/v2/run.ts`
   Phase 1c+) is skipped whenever an explicit constraint travels
   (`action: 'skipped', reason: 'constraints_present'`).

---

## Fix (additive, three touch points)

### 1. `src/lib/intervention-normaliser.ts` — producer-declared constraint scales

`normaliseGoalConstraints(constraints, nodes, extras?)` gains an optional
`ConstraintNormalisationExtras`:

- `unitsByConstraintId` — the constraint units captured before the
  ISL-boundary strip;
- `goalThresholdMetaByNodeId` — `{ goal_threshold?, goal_threshold_cap? }`
  captured from the RAW upstream nodes.

Range derivation for a constraint, in priority order:

| Priority | Source               | Rule                                                            |
|----------|----------------------|-----------------------------------------------------------------|
| 0        | `goal_threshold_cap` | node's CEE-stamped cap (> 0, finite) → range [0, cap]           |
| 1        | `unit_percent`       | constraint unit is '%' (or percent/pct/percentage) → [0, 100] — house doctrine: '%' always normalises against 100 |
| 2+       | existing chain       | `deriveRange(node)`: explicit_cap → explicit → … → default      |

**Documented design choice (deliverable 2c):** when the node also carries a
CEE-stamped, already-normalised finite `goal_threshold` in [0,1] that
*corresponds to the same target* (|value/cap − goal_threshold| ≤ 1e-3 on the
normalised scale, under a producer-declared cap), the stamp is **preferred**
over re-normalising the raw client value. Rationale: CEE produced both
numbers from the same user input, so its normalisation is authoritative and
free of re-derivation drift; the correspondence check means a **stale** stamp
(user changed the target to 25%, node still says 0.2) is ignored rather than
silently overriding the newer constraint. The tolerance (1e-3) absorbs
producer rounding to 4 dp but cannot bridge two genuinely different targets.

New `RangeSource` members `'goal_threshold_cap'` and `'unit_percent'` are
counted as **non-heuristic** (producer-declared) in `used_heuristic`, and the
repair record / diagnostics carry the provenance
(`source=goal_threshold_cap`, `used_node_goal_threshold: true`,
`(node goal_threshold preferred)`).

### 2. `src/normalisation/constraint-filter.ts` — out-of-domain gate honours declared scales

A threshold outside [0,1] that normalises INTO [0,1] under a declared scale
(node `goal_threshold_cap`, else 100 for a '%' unit) is **in-domain**: the
gate now logs `plot.constraint_scale_resolved` (info) instead of
`plot.constraint_out_of_domain` (warn) and emits no warning record (so no
`CONSTRAINT_OUT_OF_DOMAIN` critique). Values **beyond** the declared cap
(e.g. 150 '%') and negative values still warn exactly as before. Constraints
with no declared scale are untouched.

### 3. `src/routes/v2/run.ts` — capture the signals before they disappear

Immediately after constraint compilation (before the temporal filter strips
`unit` and after the graph normaliser has already dropped the raw node
fields), the route builds:

- `goalThresholdMetaByNodeId` via new `collectGoalThresholdNodeMeta(body.graph?.nodes)`
  (direct or `data.`-nested fields, finite numbers only — same raw-node-read
  pattern as the existing Phase 1c+ auto-constraint fallback);
- `constraintUnitsByConstraintId` from the compiled `RawGoalConstraint[]`.

Both are passed to `filterTemporalConstraints(...)` (new optional 4th param)
and to `normaliseGoalConstraints(...)` (new optional 3rd param).

---

## Suppression boundary kept honest (deliverable 3 — P0-C2 unaffected)

`detectUnreliableConstraintTargets` (`src/lib/constraint-reliability.ts`) is
**unchanged**. After this fix, for a '%'-or-capped goal target the
`threshold_normalisation_defaulted` reason can no longer fire (the range
source is a declared scale, not `'default'`), so goal-fit suppression on this
path depends ONLY on the remaining `target_base_defaulted` leg — ISL's
`CONSTRAINT_NODE_DEFAULT_BASE` for the goal node's missing value channel.
That leg is the pending doctrine decision **P0-C2** and fires exactly as
before (pinned by the fixture test "PIN: suppression still fires on
target_base_defaulted ALONE").

---

## RED → GREEN evidence

New fixture `tests/goal-threshold-normalisation.fixture.test.ts` reproduces
the live chain against a mocked ISL that captures the forwarded request
(goal node stamped `goal_threshold 0.2` / `goal_threshold_cap 100`,
constraint `{value: 20, unit: '%'}`, plus a no-stamps '%-only' variant):

- **RED on origin/staging @ 38d589cd** (commit `3c6f6aa`, run before the fix):
  **5 failed / 2 passed** —
  - ISL received `value: 1` (clamped), expected 0.2;
  - `CONSTRAINT_OUT_OF_DOMAIN` critique present, expected none;
  - `probability_of_joint_goal` suppressed (undefined), expected 0.55;
  - the 2 passes are the regression controls (non-'%' unit still defaults +
    explicit-range node still normalises as before — pinning that the legacy
    paths were already correct and must not change).
- **GREEN on this branch:** 7/7, plus
  `tests/goal-threshold-normalisation.unit.test.ts` 16/16 (unit pins for the
  scale precedence, the stamp preference + stale-stamp rejection, cap-validity
  guards, and the filter gate), and the surrounding constraint suite set:
  **19 test files / 326 tests passed** (auto-constraint-fallback,
  cil-constraint-*, constraint-*-*, constraints*, multi-constraint,
  normaliser-constraint-passthrough, temporal-constraint-filter,
  internal-field-preservation, gates/constraint-scale-correctness,
  intervention-normaliser, constraint-target-unreliable).

### Deliberately-changed test expectations (both are '%'-semantics, i.e. inside this fix's intended blast radius)

1. `tests/temporal-constraint-filter.test.ts` **T5** pinned the old behaviour
   that `1.1` with unit `'%'` warns out-of-domain. Under the house doctrine
   `1.1%` is in-domain (= 0.011). Split into **T5a** (within the declared
   scale → no warning, `plot.constraint_scale_resolved` logged) and **T5b**
   (150 '%' → still warns), preserving the gate's original intent.
2. `tests/constraint-target-unreliable.fixture.test.ts` — the lane-6 case
   "suppresses on the normalisation-default leg ALONE" used the 20/'%'
   constraint, which no longer hits the default range (it is now FIXED, not
   suppressed). The case now uses a scale-less unit (`'points'`) on the same
   valueless node so the default-range suppression leg itself stays pinned.
   All other lane-6 cases (target_base_defaulted suppression, warning wording,
   coaching gate, control) pass unchanged.

---

## Regression surface (deliverable 4)

Pinned unchanged (unit + fixture tests):

- constraints with **units other than '%'** (`USD`, `months`, `points`) — the
  node-derived chain, out-of-domain warning, and default-range suppression
  behave byte-identically;
- constraints on nodes with **explicit `state_space.range`** — still
  normalised against the explicit range (`source: 'explicit'`);
- temporal drop rules (deadline_metadata, temporal units) — untouched;
- no-extras calls to `normaliseGoalConstraints` — identical output including
  repair strings (`source=default (clamped)`).

Intentional behaviour change beyond the headline fix (documented, doctrine-
consistent): a '%'-united constraint now ALWAYS normalises against 100, even
on a node with an explicit range — a percent target reads as a fraction of
the node's normalised domain (50% → 0.5), not as 50 raw range-units. Pinned
in the unit tests.

---

## What remains (not this lane)

- **`target_base_defaulted` leg = P0-C2 (doctrine decision, Paul-gated).**
  With the mechanical bug fixed, the live scenario still suppresses goal-fit
  whenever ISL defaults the goal node's base to 0.0 (no observed value /
  parameter uncertainty on the goal node — the missing value channel). That
  suppression is correct producer-honesty today; whether/how to give
  objectives a value channel is the pending doctrine decision.
- `constraintsNeedNormalisation` gate is value-based (any value outside
  [0,1] triggers normalisation of ALL constraints). A '%'-united constraint
  with value ≤ 1 (e.g. "0.5%") is NOT normalised — pre-existing semantics,
  out of scope here; would need CEE input-shape doctrine first.
- The auto_constraint_from_threshold path (no explicit constraint) already
  used the node's goal_threshold and is unchanged; if CEE ever stamps a RAW
  (unnormalised) goal_threshold there, the new cap tier now also covers that
  case at normalisation time.
- CEE-side: nothing in this lane changes what CEE sends. The stamp-preference
  logic tolerates but does not fix stale `goal_threshold` stamps — staleness
  is a CEE persistence concern.

## Known pre-existing CI reds (not chased, per repo doctrine)

`audit` (fast-uri/fastify advisories) and `gates (windows-latest)` (invalid
path `tools/sdk-smoke:python.mjs`) fail on every PR, unrelated to this change.
