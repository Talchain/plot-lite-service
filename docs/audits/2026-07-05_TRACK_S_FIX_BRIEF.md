# Track S — PLoT Fix Workstream Brief (DRAFT RECOMMENDATION)

> **Status: DRAFT — not authorisation to implement.** This is the optimal prompt to hand a follow-up Claude Code workstream *if and when Paul approves the scope*. It derives entirely from the 2026-07-05 Track S audit (`docs/audits/2026-07-05_TRACK_S_PLOT_AUDIT.md`). Do not start implementation on the strength of this file alone. Paul must confirm the two gating questions (S-01 gateway, S-03 CEE range contract) before the auth and value-scale items are actioned.

---

## The prompt to hand the implementation agent

You are working in `plot-lite-service` (PLoT — the Fastify/TypeScript orchestration engine between CEE/UI and ISL). Develop on branch `staging` conventions but on your own feature branch; **never push to `main`**. Default deploy target is `staging`. Read `CLAUDE.md` first and obey its deployment, testing-tier, and git rules exactly.

### Context you need before touching code
- Live analysis path is `POST /v2/run` → `src/routes/v2/run.ts` (5055 lines; ~2200-line handler). It normalises → validates → filters org nodes → calls ISL `POST /api/v1/robustness/analyze/v2` → assembles a `RunResponseV3`.
- Auth is `src/middleware/auth-guard.ts` (`authGuard(req, reply)` returns `false` and sends the error when unauthorised). `/v1/*` is guarded by a `preHandler` hook (`src/routes/v1/index.ts:29`); legacy routes call `authGuard` inline (`src/createServer.ts:986/1067/1254`).
- Numeric egress safety is centralised in `src/routes/v2/numeric-egress-guards.ts` (`finiteNum`/`prob01`/`nonNeg`/`nonNegInt`/`hasAllRequiredOutcomeStats`). Reuse these — do not write new ad-hoc finite checks.
- EVPI/VOI contract lives in `src/lib/evpi-emission.ts` (`sanitiseIslVoi`, `computeEvpiPercentagePoints`). The non-negativity contract (Howard 1966) and the OpenAPI `evpi_percentage_points.minimum: 0` must be preserved.
- Scale/normalisation is `src/lib/intervention-normaliser.ts` (`deriveRange` 7-tier chain). The OpenAPI spec is `contracts/openapi.yaml` (CI-linted; hand-authored — update it manually when you change response shapes).
- Dependencies require a read token for the private `@talchain/schemas` package (GitHub Packages registry). If `npm ci` fails with 401, stop and report — do not work around it by editing `package.json`/lockfile/`.npmrc`.

### Scope (do these; nothing else without asking)
Make **surgical, minimal-diff** changes. Preserve response byte-shape on the normal path (golden fixtures and `response_hash` must not drift except where a field is intentionally added). Work the items in this order:

**1. Tier 0 — Authenticate `/v2/run` (audit S-01).**
Add `authGuard` to the `POST /v2/run` route (and its `HEAD`) so it matches the `/v1/*` posture. Prefer the existing pattern (inline `if (!(await authGuard(req, reply))) return;` at the top of the handler, or a scoped `preHandler`). It must:
- return 401 with `WWW-Authenticate: Bearer` when `AUTH_ENABLED=1` and no/invalid token;
- remain a no-op when `AUTH_ENABLED` is unset (so tests and local dev are unchanged);
- not break the unknown-key `preValidation` or `bodyLimit` already on the route.
Add a route-registration test proving: (a) 401 unauthenticated when auth on; (b) 200/normal when authenticated; (c) unchanged behaviour when auth off. **Do not** change any other route's auth.

**2. Tier 0/1 — Value-scale egress (audit S-03) — ONLY if Paul confirmed PLoT owns this.**
If confirmed, implement the #284 egress net in `intervention-normaliser.ts` + the `/v2/run` denormalisation path: classify each denormalised intervention/outcome as `cap_denormalised` or `ambiguous_no_evidence` when the range came from the `default` [0,1] tier with no range evidence, surface it in `_meta` (new field — update OpenAPI), and emit a critique. Do **not** silently mis-scale. If Paul said CEE guarantees range evidence, skip this and leave a `// AUDIT S-03: value-scale owned by CEE — see 2026-07-05 brief` note only.

**3. Tier 1 — EVPI below-resolution honesty (audit S-02).**
In `evpi-emission.ts` + the `/v2/run` enrichment loop (`run.ts` ~4293) and `coaching/evidence-gaps.ts`, distinguish "VOI indistinguishable from zero" (below-resolution → omit the field or mark `evpi_method:'below_resolution'`/unavailable) from a true confident zero. Keep the `≥0` clamp and the existing `evpi_method:'heuristic'` label for genuine values. Update OpenAPI `evpi_method` enum + description. Preserve the missing-vs-zero distinction the rest of the contract relies on.

**4. Tier 1 — `switch_probability` finiteness guard (audit S-09).**
Apply the same egress-guard discipline to `switch_probability` on fragile edges (`run.ts` ~1877 has the deferred note). Because it is type-required across consumers, coordinate: either make it optional in the type + OpenAPI, or drop the whole fragile-edge entry when it is non-finite (mirroring the existing row-drop pattern). Add a test with a non-finite ISL `switch_probability`.

**5. Tier 1 — Typecheck tests in CI (audit S-05).**
Add a `tsconfig.tests.json` that includes `tests/**` and a CI step (`tsc -p tsconfig.tests.json --noEmit`). Fix any type errors this surfaces in test files. Do not change `tsconfig.json`'s runtime `include`.

### Hard constraints
- **Surgical only.** No refactors of `/v2/run` structure in this workstream (that is a separate Tier‑2 brief). No dependency changes, no lockfile edits, no schema-package bumps.
- **Reuse, don't reinvent:** `numeric-egress-guards.ts`, `evpi-emission.ts`, `authGuard`, `deriveRange`, existing repair/critique helpers.
- **Cross-service alignment:** any field you add/rename to the `/v2/run` response must be reflected in `contracts/openapi.yaml` (hand-authored) in the same change, and you must check that CEE/UI consumers won't break (search the response type `RunResponseV3` in `src/types/engine-v3.ts` and note additive-only changes). Field-trace every change (per `CLAUDE.md` "Data flow tracing").
- **Determinism:** do not alter seed derivation, hashing, or normalisation math. Any new field must be excluded from `response_hash` unless it is request-derived (follow the existing `_meta`/`meta` exclusion convention).
- **Fail-closed:** new validation must default to the safe/enabled state (mirror the categorical kill-switch pattern).

### Testing protocol (follow CLAUDE.md three tiers)
- After each change: `npx tsc --noEmit` then `npx vitest run --changed --bail=1` (Tier 1 smoke).
- Add/extend tests that assert **behaviour**, not HTTP 200: auth 401/403 negatives; EVPI below-resolution vs zero; non-finite `switch_probability` row-drop; value-scale classification (if in scope). Prove field-level consumption, not just presence.
- Before declaring done: run the full local gate the pre-push hook runs (`bash scripts/pre-push-validate.sh`) — typecheck, tests, stale-js, OpenAPI lint. CI is authoritative.
- If `npm ci` cannot install (`@talchain/schemas` 401), **stop and report** — do not fabricate green.

### Definition of done (do not stop until all are true)
1. All in-scope items implemented with surgical diffs; each has behaviour-asserting tests.
2. `contracts/openapi.yaml` updated for every response-shape change; `spectral lint` passes.
3. Full local gate green (or explicitly reported as blocked on the registry token).
4. **Final self-review pass:** re-read your own diff end-to-end and hunt for silent bugs and regressions — golden-fixture / `response_hash` drift on the normal path, a status that can now report `computed` while a guard dropped the data, a new field that CEE/UI don't expect, an auth change that accidentally guards a public/health route, a below-resolution branch that swallows genuine values. Fix anything you find, then re-run the gate.
5. Confirm data & cross-service alignment: response type ↔ OpenAPI ↔ CEE/UI expectations all agree; every semantic transform is logged (repair/critique) as the existing code does.
6. Report: what changed, per-file; what you tested and the result; any silent-bug/regression you caught and mitigated in the self-review; anything you deliberately left out and why.

### Explicitly out of scope (do NOT do)
- `/v2/run` decomposition / file-splitting (separate Tier‑2 brief).
- OpenAPI single-source consolidation, rate-limiter dedupe, SCM-lite quarantine, `/v1` route pruning (Tier‑2).
- Anything touching ISL/CEE/UI/ISL-schema repos, prompts, PMS, or the schema package.
- Pushing to `main`; creating a PR unless asked; running staging/prod smoke tests without approval.

---

## Why this scope (traceability to the audit)

| Brief item | Audit risk | Tier | Gating question |
|---|---|---|---|
| 1. Auth `/v2/run` | S-01 | Tier 0 | Paul: is there an authenticating gateway? |
| 2. Value-scale egress | S-03 | Tier 0/1 | Paul: does CEE guarantee range evidence? |
| 3. EVPI below-resolution | S-02 | Tier 1 | — |
| 4. `switch_probability` guard | S-09 | Tier 1 | ISL: field required-ness |
| 5. Typecheck tests | S-05 | Tier 1 | — |

Everything else in the audit risk register (S-06 through S-15) is deliberately deferred to later Tier‑2 briefs to keep this workstream small, low-risk, and reviewable.
