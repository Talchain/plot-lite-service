# Track S — PLoT Capability, Contract, Scientific Integrity, Performance & Reliability Audit

**Date:** 2026-07-05
**Auditor:** Claude Code (read-only audit mode)
**Repo:** `plot-lite-service` (Talchain/plot-lite-service)
**Baseline SHA:** `a14f79a` — identical to `origin/staging` (0 ahead / 0 behind)
**Mode:** Static source audit. Dependencies could NOT be installed (private registry `@talchain/schemas` returned 401), so **no typecheck, tests, or benchmarks were run locally.** All test/CI claims are inferred from source + CI config and are labelled accordingly.

> **Provenance discipline:** Where a finding rests on PR names, branch absence, or inference it is labelled **provisional**. Live-code evidence is labelled with file:line. Cross-repo (ISL/CEE/UI) behaviour cannot be observed from this repo and is labelled **upstream — unverified**.

---

## A. Executive verdict

**Usable for the current PoC path with specific Tier‑0 blockers.**

The live `/v2/run` path is real, coherent, and unusually disciplined about numeric egress honesty (a dedicated guard module drops non-finite ISL values instead of serialising fabricated `null`s). Determinism, seed authority, option-node filtering, constraint precedence, and identifiability all trace cleanly through committed source. The scientific posture is mostly honest: EVPI is explicitly labelled `heuristic`, VOI is non-negativity-clamped, and organisational nodes are filtered before ISL.

Three things hold back an unqualified "trusted":

1. **`POST /v2/run` has no authentication guard** (Tier‑0, security). Every other write surface (`/v1/*`, legacy `/critique`, `/draft-flows`, `/stream`) enforces `authGuard`; `/v2/run` does not, and `render.yaml` ships staging with `AUTH_ENABLED=1`. Code evidence is high-confidence; deployed exploitability depends on an upstream gateway we cannot observe.
2. **EVPI is a heuristic proxy, not counterfactual EVPI, and has no below-resolution handling** — noisy near-zero values are clamped to a confident number rather than marked "indistinguishable from zero" (Tier‑1, scientific honesty).
3. **The audit could not be validated by execution.** The private-registry 401 means the whole `node_modules` tree is absent; a reviewer must trust CI, and CI's own gate (`RATE_LIMIT_ENABLED=0 npm test`) is the only authoritative signal. Local reproducibility is currently gated on registry credentials.

Everything else is Tier‑1/Tier‑2 polish or upstream/handoff. No evidence of scientific dishonesty in the emitted contract was found; the codebase is visibly the product of prior careful Track S hardening.

---

## B. Ground-truth preflight

| Item | Value | Evidence |
|---|---|---|
| Working dir / toplevel | `/home/user/plot-lite-service` | `git rev-parse` |
| Branch @ HEAD | `claude/plot-capability-audit-9xgfwz` @ `a14f79a` | `git rev-parse HEAD` |
| vs `origin/staging` | **identical (0/0)** | `git rev-list --count` |
| `main` (production) | `f19ed87` != staging | `git ls-remote` |
| `claude/great-lewin-9bfcab` | **does not exist** on remote | `git ls-remote` — *provisional* re: whether Track S amendments all landed |
| Working tree | clean, no stash, no stale `src/**/*.js` | `git status`, stale-js scan (0 hits) |
| App entrypoint | `src/main.ts` -> `src/createServer.ts` (single factory, 1522 lines) | direct read |
| `/v2/run` handler | `src/routes/v2/run.ts` (5055 lines), registered via `registerV2Routes` -> `registerRunV2Route` (createServer.ts:1505) | direct read |
| Health check path | `/v1/health` (render.yaml) | render.yaml:14 |
| Runtime | `npm ci && npm run build` -> `node dist/main.js` (compiled `dist/`, **not** tracked in git) | package.json, render.yaml, Dockerfile |
| `dist/` / compiled `src/*.js` | absent & untracked; guarded by `scripts/check-no-stale-js.sh` (CI + build + pre-push) | `git ls-files`, .gitignore |
| Package manager / Node | npm; engines `>=20 <21`; **container Node = v22.22.2** (mismatch — noted for any local run) | package.json |
| Schema package | `@talchain/schemas@0.2.1` (exact pin). **No `@olumi/contracts`.** | package.json, lockfile |
| Tests typechecked? | **No** — `tsconfig.json` `include: ["src/**"]`; tests are ESLint-parsed only | tsconfig.json:18 |
| CI gate | `.github/workflows/ci.yml`: stale-js -> `npm ci` -> ESLint `--max-warnings 97` -> `validate:contracts` -> `build` -> `RATE_LIMIT_ENABLED=0 npm test` | ci.yml |
| Recent staging CI | PRs #191-#193 (A1b/A1c lever suppression, P0a VOI/EVPI) all green | GitHub Actions API |
| Dependency install | **FAILED** — `npm ci` aborted at `@talchain/schemas` (registry 401); `node_modules` empty | npm debug log |
| `git status` after `npm ci` | clean (no repo files modified) | verified per brief §17 |

**Deploy/runtime path is established. Live `/v2/run` path is established.** No stop-condition triggered except the dependency-install failure, which degrades the audit to static-only (test claims marked "not run").

---

## C. Capability inventory

Single Fastify factory; no unmounted routers were found (every file under `src/routes/**` is imported and registered). Classification legend: **L**=live, **Lg**=legacy/direct-UI, **T**=test-gated, **F**=flag-gated, **D**=dormant-in-prod.

| Capability | Location | Route / entrypoint | Live status | Auth | Sci. status | Recommendation |
|---|---|---|---|---|---|---|
| Option-comparison run | `routes/v2/run.ts` | `POST /v2/run` | **L** (primary CEE path) | **none** | core | **Tier 0: add auth** |
| Legacy engine run | `routes/v1/run.ts` | `POST /v1/run` | L / Lg | /v1 hook | core | keep; B3 drift watch |
| ~50 `/v1/*` analysis endpoints | `routes/v1/*` | `/v1/{counterfactual,critique,draft,validate,compare,intervene,sensitivity,optimise,evoi,pre-analysis-sensitivity,...}` | L (mixed usage) | /v1 hook | mixed | inventory & prune (Tier 2) |
| CEE proxy | `routes/v1/cee-proxy.ts`, `cee-draft-graph.ts` | `POST /v1/cee/{graph-readiness,bias-check,sensitivity-coach,prompts/warm}` | L | /v1 hook | n/a | keep |
| Legacy critique/improve | `createServer.ts:1146/1217` | `POST /critique`, `/improve` | Lg | inline | n/a | dedupe vs `/v1/critique` (Tier 2) |
| Draft flows (fixtures) | `createServer.ts:985/1066` | `GET/POST /draft-flows` | Lg | inline | n/a | keep (fixture replay) |
| SSE stream | `createServer.ts` / `routes/v1/stream*.ts` | `GET /stream`, `/v1/stream` | F (`FEATURE_STREAM`, `STREAM_PARITY_ENABLE`) | yes | n/a | keep |
| Health/version/ready/live | `routes/health.ts`, `v1/index.ts` | `/`, `/health`, `/v1/health`, `/version`, `/ready`, `/live` | L | public | n/a | keep; add build SHA to `/health` |
| OpenAPI serve | `createServer.ts:255/1445` | `/v1/openapi.json` (always), `/openapi.json` (`OPENAPI_DEV`) | L / F | public | n/a | reconcile 2 specs (Tier 2) |
| Prometheus / ops | `plugins/metrics.ts`, `routes/ops/snapshot.ts` | `/metrics` (F), `/ops/snapshot` (F) | F | key/bearer | n/a | keep |
| Test routes | `createServer.ts`, `routes/test/*` | `/test/*`, `/__test/*`, `/internal/replay-*`, `/demo/stream`, `/__env`, `/__audit__/recent`, `/__governance__/versions` | T (`TEST_ROUTES=1`) | mixed/test-auth | n/a | **prod-abort verified** (main.ts:31, createServer.ts:228) |
| SCM-lite kernel | `src/scm-lite/*`, `inference/model_based.ts` | via `/v1/simulate*`,`/optimise`,`/intervene` | **D in prod** (`SCM_LITE_ENABLE=0`) | yes | proxy compute | quarantine/label dormant (Tier 2) |
| Causal DSCM helpers | `src/causal/dscm/*` | not on `/v2/run` | D/experimental | — | experimental | label; V5 handoff |
| Identifiability (backdoor) | `trust/identifiability-v2.ts`, `causal/d-separation.ts` | on `/v2/run` (Phase 2b) | **L** | — | **structural, real** | keep; see F.7 |
| SDK / packages | `sdk/`, `packages/olumi-plot-sdk/` | not server-mounted | D | — | n/a | out of runtime scope |

Root-level dirs `out/`, `tmp_release/`, `artifact/` (except `artifact/runtime-config.json`, live via SIGHUP reload), `evidence/`, `handoff/`, `reports/` are build/evidence cruft — **not** part of the runtime graph.

---

## D. Live `/v2/run` path trace (request -> ISL -> response)

Full ordered trace of `src/routes/v2/run.ts` (handler starts line 2824). Every step is committed source at `a14f79a`.

1. **Ingress** (2824): `runV3Schema` + `preValidation` unknown-**top-level**-key reject (2809); nested unknown keys pass (forward-compat, dropped later).
2. **Request ID** (2830): `x-request-id` hdr -> `body.request_id` -> `req.id`; mismatch warn.
3. **Categorical integrity** (`validation/categorical-detector.ts`, 2900): raw options pre-strip; 422 blocked (NOMINAL_INTERVENTION_NOT_SUPPORTED / ONE_HOT_MUTEX / GROUPING_INCONSISTENT) or info/warn critiques. **Fail-closed** (default enabled; kill-switch `CATEGORICAL_INTEGRITY_ENFORCEMENT`).
4. **Normalise graph** (`normalise-and-repair.ts`): `repairs[]`, warnings; 422 on `NormalisationError`.
5. **Filter org nodes** (`option-filter.ts:filterOptionNodes`, 3105): option/decision nodes removed **before ISL**.
6. **Seed resolve** (884 `resolveSeed` + `sampling/graph-hash.ts`): provided OR graph topology+mean-weights hash; **PLoT is seed authority**; excludes `exists_probability`, `strength.std`.
7. **Goal validation** (3132-3190): 422 MISSING / NOT_IN_GRAPH / NOT_CAUSAL.
8. **Constraint compile** (`constraint-compiler.ts`; MAX_CONSTRAINTS=20 guard 3198): strips client `_internal` (3236); F.5 repair logs.
9. **Auto-constraint** (3289): synth `auto_goal_threshold` `>=` from goal_threshold; `_meta.constraint_sources`.
10. **Temporal filter** (`constraint-filter.ts`): drops temporal -> `_meta.filtered_constraints`; not sent to ISL; CONSTRAINT_FILTERED_TEMPORAL critique.
11. **Constraint validate** + **Precedence** (3442): constraints **supersede** goal_threshold -> repair "ignored"; `effectiveGoalThreshold=undefined`.
12. **Preflight** (`preflight-v2.ts`): 422 on fail; **MAX_NODES/EDGES/OPTIONS enforced here** (post-normalisation); dedup options.
13. **Identifiability** (`trust/identifiability-v2.ts`, Phase 2b): backdoor + Bayes-ball d-sep; IDENTIFIABILITY_WARNING + UNMEASURED_CONFOUNDING_WARNING critiques; WARNING-only; deterministic.
14. **Base hash** (`canonicalise.ts:hashRequest`, HASH_VERSION=7): request-derived only (ISL fields excluded v6).
15. **ISL gate** (`isEnabled`, `ISL_ENABLE=1`): if disabled -> 200 `failed` + ISL_NOT_ENABLED.
16. **Intervention norm** (`intervention-normaliser.ts`, 7-tier `deriveRange`): options -> [0,1]; MIXED_RANGE_DERIVATION info; clamp flagged.
17. **Constraint norm** + **PU injection** (`constraint-pu-injection.ts`): constraints -> [0,1]; pinned parameter_uncertainties.
18. **ISL request build** (`translator-v3.ts:toISLRobustnessRequest`): edges emitted as **`from`/`to` (NOT `from_`)**; seed always forwarded; invariant-log if seed missing.
19. **ISL call** (`client.ts` -> `POST /api/v1/robustness/analyze/v2?response_version=2`): `X-API-Key`, `X-ISL-Response-Version:2`; timeout + up to `ISL_MAX_RETRIES`(3) retries w/ exp backoff; circuit breaker.
20. **ISL error mapping** (4125-4197): ISL 422 -> 422 `buildBlockedResponse`; network/5xx/analysis_status=failed -> **200 `failed`** `buildV2RunError`; retryable computed (401->false, 429/5xx->true).
21. **Denormalise** (`denormaliseISLResult`): outcomes -> user units.
22. **Sensitivity assembly** (4219+; `transformEdgeSensitivity/EValues/ConditionalWinners`, `mapIslFactorEntry`): non-finite rows **dropped** + warn logs; guards via `numeric-egress-guards.ts`.
23. **Factor sensitivity** (`factor-influence.ts`, graph PRIMARY) + `mergeIslConfidenceIntoGraphFactors`: unified confidence (0.5*band + 0.5*edge); direction/sign preserved.
24. **EVPI enrichment** (4293; `evpi-emission.ts`): VOI * winProbSpread * 100 (>=0, `evpi_method:'heuristic'`); **skips option-pinned levers**.
25. **Flip thresholds** (`coaching/flip-thresholds.ts` + `analysis/flip-thresholds.ts` ISL binary search): excludes factors overridden by all options; decoupled probe depth.
26. **Constraints assembly** (1370 `buildConstraintFields`): empty/malformed -> `unavailable`/`error`, not `computed`; prob01 + exact one-to-one cardinality check; index-positional id mapping.
27. **Robustness assembly** (`robustness-analysis.ts`): fragile/robust edges + labels + severity; scalars omitted when non-finite.
28. **Thresholds (opt)** (4679; `POST /api/v1/analysis/thresholds`): budget-gated; non-finite dropped.
29. **CEE review (opt)** (`cee/orchestrator.ts`, `decision-review-orchestrator.ts`): **graceful degrade, never throws**; LLM-excluded from hash.
30. **M1 coaching** (`coaching/m1-coaching.ts`): consumes published factor array (provenance-aligned).
31. **Response hash recompute** (4374): request inputs only.
32. **Build response** (1607 `buildResponse`): `_meta`, `meta`, `downstream_calls`, decision_brief, fact_objects, review_cards; egress guards throughout.
33. **Safety net** (5029 catch): any throw -> **200 `failed` `V2RunError`** — `error.v1` never leaks.

**Key path properties:** fail-closed on categorical/normalisation/preflight/ISL-invalid; org nodes filtered before ISL; seed always forwarded and PLoT-authoritative; non-finite ISL numbers omitted (not `null`-fabricated); status vocabulary honest (data-presence authoritative over ISL's claim).

---

## E. Data model & contract alignment

| Contract expectation | PLoT implementation | Evidence | Aligned? | Owner |
|---|---|---|---|---|
| Bind to `@talchain/schemas` (not `@olumi/contracts`) | `@talchain/schemas@0.2.1` only | package.json | yes | — |
| Limits from shared schema | `constants/limits.ts` re-exports `LIMITS` | limits.ts:11 | yes | — |
| `edge.from`/`to` external; translate at ISL boundary | ISL request keeps `from`/`to` (**no `from_`**) for `/robustness/analyze/v2` | translator-v3.ts:164 | yes (endpoint accepts `from`) | PLoT/ISL |
| Org nodes filtered before inference | `filterOptionNodes` before ISL | run.ts:3105 | yes | PLoT |
| `goal_constraints` supersede `goal_threshold` | precedence routing + repair | run.ts:3442 | yes | PLoT |
| Temporal constraints filtered, not sent to ISL | `filterTemporalConstraints` -> `_meta.filtered_constraints` | run.ts:3377 | yes | PLoT |
| `constraints_status:'computed'` only when real | empty/malformed -> `unavailable`/`error` | run.ts:1385-1499 | yes | PLoT |
| Unknown top-level fields rejected | `preValidation` allowlist | run.ts:2809 | yes | PLoT |
| Hash excludes `_meta` & ISL-derived | HASH_VERSION 7 | canonicalise.ts:75 | yes | PLoT |
| `graphIdentityHash` present | **absent** — only request-derived `hashRequest` | canonicalise.ts | info (hyp #17 confirmed) | PLoT |
| Two OpenAPI trees | `contracts/openapi.yaml` (CI-linted, has `/v2/run`) vs `openapi/openapi-plot-lite-v1.yaml` | grep | drift risk | PLoT |
| `evpi_percentage_points` `minimum:0`, OMITTED when absent | enforced; `evpi_method` documented | openapi.yaml:6142 | yes | PLoT |
| Tests assert parity with shared types | tests excluded from `tsc`; runtime asserts only | tsconfig.json:18 | medium gap | PLoT |

---

## F. Scientific validity & honesty

**F.1 Normalisation & scale.** 7-tier `deriveRange`: explicit_cap -> explicit state_space -> CE `extracted_range` -> inferred -> default [0,1]. Clamping flagged; `MIXED_RANGE_DERIVATION` info when tiers differ. Outcomes/sensitivity denormalised; `_normalised:true` when ranges unavailable. **Honest.** Risk: `default` [0,1] tier silently assumes already-normalised input (the #284 gap).

**F.1a #284 value-scale egress net — ABSENT on staging (hyp #5 falsified).** No `cap_denormalised`/`ambiguous_no_evidence` markers anywhere in `src/` (grep 0 hits). A raw value arriving with no range evidence falls to `default` [0,1] and is treated as already-normalised. **PR B still needed.** Confidence: high (grep-verifiable).

**F.2 Constraints.** Compile -> temporal-filter -> validate -> normalise -> forward. `buildConstraintFields` requires **exact one-to-one** forwarded<->returned correspondence and rejects to `unavailable` on malformed probability (run.ts:1461-1499). Positional index->constraint_id mapping (ISL doesn't echo constraint_id). **Honest.** ISL goal/constraint probability inconsistency is upstream — unverified.

**F.3 Sensitivity.** Factor sensitivity **graph-based PRIMARY**, ISL fallback. Sign/direction preserved (not `abs`). Option-pinned factors filtered from published array but kept (unfiltered) for confidence merge only. Confidence **recomputed by PLoT** with provenance tags, never ISL's raw value. **Honest.** Largely neutralises the ISL "sensitivity vs options[0]" concern for factor sensitivity; edge_sensitivity is ISL passthrough.

**F.4 Robustness & fragile edges.** From ISL `/robustness/analyze/v2`; normalised, label-enriched, severity-classified. Scalars omitted when non-finite. Deterministic. **Honest.** `switch_probability` fabrication guard explicitly **deferred** (type-required cross-consumer) — open item S-09.

**F.5 VOI / EVPI — Tier‑1 honesty gap.** VOI: `sanitiseIslVoi` clamps neg/non-finite -> `undefined`. EVPI: `VOI * winProbSpread * 100`, clamped >=0, tagged `evpi_method:'heuristic'`, skips option-pinned levers. **Gap:** no below-resolution handling — noisy VOI ~= 0 yields a confident small EVPI, not "unavailable/below-resolution". `/v2/run` VOI path is distinct from #189's internal builder. Hyps #8/#9/#10/#11 confirmed.

**F.6 Intercept / root.** `toISLNode` forwards `intercept`(0.0) + `epsilon_std`(0.0) verbatim; no root repair, no intercept strip. `populateNodeIntercepts` is CEE/V5-owned (upstream). Hyp #14 confirmed.

**F.7 Identifiability & claim firewall — stronger than hypothesised.** `trust/identifiability-v2.ts` is a **real** backdoor-criterion impl (Bayes-ball d-sep, bidirected->latent expansion), runs on `/v2/run`, emits IDENTIFIABILITY_WARNING + UNMEASURED_CONFOUNDING_WARNING (WARNING-only), deterministic. **Falsifies** hyp #15 (dormant/partial): structural identifiability is live and wired to user-facing critiques — independent of ISL's (upstream) data-driven identifiability status.

**F.8 Categorical / boolean.** `categorical-detector.ts` runs before normalisation, **fail-closed**. Nominal -> 422 blocker; one-hot validated/blocked; stripped-field warnings deduped. Hyp #16 confirmed.

**F.9 Determinism & reproducibility.** Seed = provided OR graph topology+mean-weights (excludes `exists_probability`, `strength.std`); always forwarded; invariant-logged if missing. `responseHash` v7 request-derived only. Only `analysisAffectingHash`-equivalent; **no `graphIdentityHash`** (hyp #17 confirmed). Reproducibility tests exist — not run locally.

---

## G. Reliability & numeric safety

**Strong.** `routes/v2/numeric-egress-guards.ts` is the single source of truth (`finiteNum`/`prob01`/`nonNeg`/`nonNegInt`/`hasAllRequiredOutcomeStats`). Non-finite ISL numbers **omitted** (honest absence), never `null`-fabricated, never boundary-snapped. `option_comparison_status:'computed'` uses the SAME `hasAllRequiredOutcomeStats` predicate as the outcome serialiser — so status can't claim computed while the outcome was dropped.

- Fail-closed (422) for categorical/normalisation/preflight/ISL-invalid; graceful degrade (status flags) for CEE/coaching/flip/thresholds; outer catch guarantees `V2RunError`.
- blocked(422)=client-fixable pre-ISL; failed(200)=ISL/compute failure. Retryability computed from ISL status.
- Edge cases handled: empty/missing goal, non-causal goal, cycles/dup IDs, too-many-constraints (20), too-many-nodes/edges/options, non-finite ISL outputs.
- Silent-loss observability: `*_dropped_nonfinite` warn logs.

**Gaps:** (1) MAX_NODES/EDGES/OPTIONS enforced in preflight (Phase 2) **after** full normalisation (Phase 1) — minor DoS amplification (S-07). (2) ISL POST retried 3x on timeout/5xx — safe (deterministic inference) but worth an explicit idempotency note.

---

## H. Boundary & dataflow

**B2 (CEE -> PLoT):** CEE calls `/v2/run`. **No auth guard** (S-01). Request validated by schema + unknown-key allowlist; egress numeric finiteness enforced. Seed chain PLoT-authoritative.

**B3 (UI -> PLoT legacy direct):** `/v1/run` + legacy top-level `/critique`, `/improve`, `/draft-flows`, `/stream` remain registered and auth-guarded. Drift risk (two run surfaces), currently controlled. No flag gates `/v1/run` off.

**B4 (PLoT -> ISL):** `integrations/isl/client.ts`. Auth `X-API-Key`; timeout + 3x retry + circuit breaker; `response_version=2` pinned (header+query). Edges as `from`/`to`. Org nodes pre-filtered. Seed forwarded. Response cast without ingress schema validation — mitigated by egress guards (an ISL-ingress zod parse would be more defensive).

**PLoT -> CEE review path:** `buildCeeReviewRequest` (2471) sends graph snapshot, per-option outcomes, top edge drivers, ranked actions, ISL robustness summary. Consumes `factor_sensitivity`/`robustness`/`fragile_edges` — field-level traced; no obvious internal-only leakage; graceful degradation.

---

## I. Performance

**No benchmark evidence collected** (dependencies absent; brief forbids heavy load tests without approval). Static: `/v2/run` = normalise -> preflight -> identifiability (d-sep) -> 1 main ISL call -> optional flip-probe ISL calls (binary search, decoupled depth) -> optional thresholds ISL call -> optional CEE calls (parallelised). Dominant cost is ISL Monte Carlo (`n_samples` default 4000, env `STANDARD_N_SAMPLES`) + flip-probe round-trips. Tooling: `tools/bench-fanout.cjs`, `tools/loadcheck.js`, `tools/slo-budget-gate.mjs`, `perf-gate.yml`, `perf-probe.yml`, `load-probe-nightly.yml`. `/v1/health` exposes `engine_p95_ms_rolling` (budget `ENGINE_P95_BUDGET_MS` default 600). Proposed matrix (not created): 3-node; 12-node/20-edge PoC; max-limit; multi-option; multi-constraint; include_voi/thresholds on/off; ISL-unavailable; same-seed repeat.

---

## J. Security & operational safety

| Area | State | Evidence | Severity |
|---|---|---|---|
| **`/v2/run` auth** | **NO guard** while `AUTH_ENABLED=1` ships | run.ts route opts; grep `src/routes/v2` | **Tier 0 / high** (code: high; deployed: medium) |
| `/v1/*` auth | preHandler hook | v1/index.ts:29 | ok |
| Legacy routes auth | inline `authGuard` | createServer.ts:986/1067/1254 | ok |
| Auth impl | Bearer, `timingSafeEqual`, length pre-check | auth-guard.ts:96-107 | ok |
| Env validation | fail-fast `validateEnv` + `secret-validation` (HMAC, demo-off, external URLs) | config-validator.ts | **does not require `ISL_API_KEY`/`CEE_API_KEY`** | low (S-10) |
| Test routes in prod | **aborts** `NODE_ENV=production` + `TEST_ROUTES=1` | main.ts:31, createServer.ts:228 | ok |
| CORS | allowlist `parseCorsCsv`, strict preflight, wildcard only `CORS_DEV=1`, localhost-in-prod warn | createServer.ts:322 | ok |
| Rate limit | per-IP token bucket 60rpm; 413 beats 429; `trustProxy` gated | rate-limit.ts:93 | ok (per-IP => shared-NAT collide, S-13) |
| Body limits | global 128KB; `/v2/run` 10MB; per-route overrides | createServer.ts:186, run.ts:834 | ok |
| Secrets in logs | pino redact `parse_text`; optional `NO_USER_TEXT_LOGGING`; `sanitizePayloadForDebug` | createServer.ts:184 | ok |
| Helmet / HSTS | enabled; HSTS prod-over-TLS | createServer.ts:313 | ok |
| Stack traces in responses | outer catch returns typed `V2RunError`, no stack | run.ts:5029 | ok |
| Dockerfile | `node:20-slim`, non-root `appuser` | Dockerfile | ok |
| `dist`/generated drift | untracked, built at deploy; stale-js guard | check-no-stale-js.sh | ok |
| Dependency audit | not run (no node_modules); `dependency-audit.yml` exists | — | not run |

No secrets in committed files. `.npmrc` uses `${GITHUB_TOKEN}` interpolation (no literal token).

---

## K. Maintainability

- `/v2/run` is a **5055-line file** with a ~2200-line handler; `buildResponse` alone ~800 lines. Correct + well-commented but a change-risk hotspot. Extraction opportunities: constraint/sensitivity/CEE/`_meta` assemblers.
- Duplication: two rate limiters (`middleware/rate-limit.ts` + legacy `rateLimit.ts`); two OpenAPI trees; legacy `/critique`+`/improve` vs `/v1/critique`; `/health` vs `/v1/health`.
- Egress guards, EVPI contract, feature-status mapping already centralised — good.
- `as any` frequent on ISL wire data — mitigated by egress guards, weakens compile safety.
- Tests not typechecked (tsconfig excludes tests); `.type-pin.ts` compiled only via ESLint parser (hyp #20).
- Dormant `src/scm-lite/*` imported but off in prod.
- Docs/code drift: two OpenAPI specs; `CLAUDE.md` references prod `./monitor-deployment.sh` (process risk).

Simplification (recommend, don't implement): capability registry; quarantine SCM-lite; extract `/v2/run` sub-assemblers; single OpenAPI source; typecheck tests; consolidate rate limiters.

---

## L. Risk register

| ID | Finding | Evidence | Conf. | Severity | Owner | Category | Recommended action | Blocks PoC? | Blocks sci.? | Lane |
|---|---|---|---|---|---|---|---|---|---|---|
| S-01 | `/v2/run` has no auth guard while `AUTH_ENABLED=1` ships | run.ts route opts; grep `src/routes/v2` | High/Med | Critical | PLoT | security | Add `authGuard` + registration test asserting 401 | Yes (if internet-reachable) | No | Tier 0 |
| S-02 | EVPI heuristic has no below-resolution handling | evpi-emission.ts; run.ts:4293 | High | High | PLoT | scientific validity | Add below-resolution/`unavailable` class distinct from true 0 | No | Yes | Tier 1 |
| S-03 | #284 value-scale egress net absent; raw-unit intervention silently [0,1] | grep 0 hits; deriveRange default tier | High | High | PLoT/CEE | scientific validity | Land PR B OR confirm CEE guarantees range evidence | No | Yes | Tier 0/1 |
| S-04 | Audit not executable locally; registry 401 blocks `npm ci` | npm debug log | High | Med | Paul/PLoT | reliability | Provision read token for `@talchain/schemas` in audit/dev | No | No | Security/ops |
| S-05 | Tests excluded from `tsc` typecheck | tsconfig.json:18 | High | Med | PLoT | maintainability | Add `tsconfig.tests.json` typecheck to CI | No | No | Tier 1 |
| S-06 | Two OpenAPI trees can drift | grep; contracts/ + openapi/ | High | Med | PLoT | contract | Pick one canonical; contract test vs live route | No | No | Tier 2 |
| S-07 | Graph size limits enforced post-normalisation | preflight-v2.ts:329 | High | Low | PLoT | performance | Cheap pre-normalisation count guard | No | No | Tier 2 |
| S-08 | ISL response cast without ingress validation | client.ts:180 `as T` | High | Low | PLoT | reliability | Optional zod parse at ISL ingress | No | No | Tier 2 |
| S-09 | `switch_probability` non-finite fabrication guard deferred | run.ts:1877 note | High | Med | PLoT/ISL | scientific validity | Make optional or guard cross-consumer | No | Partial | Tier 1 / ISL |
| S-10 | `ISL_API_KEY`/`CEE_API_KEY` not required at startup | config-validator.ts | High | Low | PLoT | ops | Presence checks gated on feature flags | No | No | Tier 2 |
| S-11 | Dormant `src/scm-lite/*` imported but off in prod | render.yaml; imports | High | Low | PLoT | maintainability | Label/quarantine; document dormancy | No | No | Tier 2 |
| S-12 | `/v2/run` 5055-line file, ~2200-line handler | file size | High | Low | PLoT | maintainability | Extract sub-assemblers (no behaviour change) | No | No | Tier 2 |
| S-13 | Rate limit per-IP only | rate-limit.ts:93 | High | Low | PLoT | security | Principal-based keying when authed | No | No | Tier 2 |
| S-14 | Two run surfaces (`/v1/run` + `/v2/run`) — B3 drift | v1/index.ts; run.ts | High | Low | PLoT/UI | product | Define deprecation/removal condition | No | No | Tier 2 |
| S-15 | Legacy route dup (`/critique`, `/health`) | createServer.ts | High | Low | PLoT | maintainability | Dedupe post-migration | No | No | Tier 2 |

---

## M. Recommended roadmap

**Tier 0:** 1. S-01 auth `/v2/run` (+ registration test; confirm gateway with Paul). 2. S-03 value-scale ownership (land PR B or get CEE range-evidence guarantee).
**Tier 1:** 3. S-02 EVPI below-resolution. 4. S-09 `switch_probability` guard. 5. S-05 typecheck tests in CI.
**Tier 2:** S-06 OpenAPI single-source; S-07 pre-normalisation size guard; S-08 ISL-ingress validation; S-11 quarantine SCM-lite; S-12 extract `/v2/run` sub-assemblers; S-13/S-14/S-15 dedupe & deprecation.
**Security/ops:** S-04 registry token; S-10 startup key checks; build SHA on `/health`.
**V5 handoffs:** intercept/root doctrine; EVPI display doctrine (counterfactual vs heuristic UX); association-vs-causal claim labelling.
**ISL handoffs:** options[0]-relative sensitivity; goal/constraint probability consistency; identifiability status; `switch_probability` finiteness; path_decomposition/edge-level field drop.
**Questions for Neil:** Is ISL VOI true EVPI or a proxy? Does ISL emit below-resolution EVPI expecting PLoT suppression? Should ISL return `constraint_id`?
**Questions for Paul:** Is `/v2/run` fronted by an authenticating gateway (determines S-01 exploitability)? Does CEE guarantee range evidence per intervention (determines S-03 tier)? Is direct `/v1/run` (B3) still a supported UI path?

---

## N. Suggested next briefs (not written)

1. Tier‑0 auth brief — add `authGuard` to `/v2/run`; registration + negative tests; gateway confirmation. Owner: PLoT.
2. Value-scale egress brief (PR B) — `cap_denormalised`/`ambiguous_no_evidence` + CEE evidence contract. Owner: PLoT + CEE.
3. EVPI honesty brief — below-resolution handling + display doctrine. Owner: PLoT + V5.
4. Test-typecheck + OpenAPI single-source brief — CI hardening. Owner: PLoT.
5. `/v2/run` decomposition brief — extract sub-assemblers, golden-fixture pinned. Owner: PLoT.

---

## Hypothesis verdicts (§15)

| # | Verdict | Note |
|---|---|---|
| 1 | Confirmed | `/v2/run` main live path |
| 2 | Partially | `dist` untracked+built at deploy; stale-js guarded |
| 3 | Confirmed | tests target `src`; runtime `dist` |
| 4 | Falsified (this clone) | 0 stale files; guarded |
| 5 | Falsified | #284 markers absent; PR B still needed |
| 6 | Confirmed | constraint/intervention norm symmetric |
| 7 | Falsified (fixed) | empty constraint -> `unavailable`/`error` |
| 8 | Confirmed (path split) | `/v2/run` own enrichment |
| 9 | Confirmed | run.ts:4293 + `sanitiseIslVoi` |
| 10 | Confirmed | `evpi_method:'heuristic'` |
| 11 | Confirmed | below-resolution absent (S-02) |
| 12 | Confirmed | sign preserved; UI re-derivation downstream |
| 13 | Mostly falsified | filtered from sensitivity; kept only for confidence merge; EVPI skips levers |
| 14 | Confirmed | intercept pass-through, no repair |
| 15 | Falsified | identifiability live backdoor impl |
| 16 | Confirmed | categorical fail-closed 422 |
| 17 | Confirmed | request-derived hash only, no graphIdentityHash |
| 18 | Confirmed | `@talchain/schemas@0.2.1`; skew unverifiable here |
| 19 | Confirmed | `/v1/run` + legacy routes |
| 20 | Confirmed | tsconfig include=src only |
| 21 | Partially | two specs; `/v2/run` in contracts/openapi.yaml |
| 22 | Confirmed | decision_brief/m1_coaching/critiques deterministic; LLM narrative is CEE |
| 23 | Falsified | egress guards + outer catch fail closed |
| 24 | Confirmed (some) | SCM-lite dormant; DSCM experimental |
| 25 | Partially | perf tooling exists; `/v2/run` p95 not asserted in same gate |

---

## ISL audit reconciliation (PLoT-side, current staging)

| # | ISL item | PLoT-side finding | Exposure class |
|---|---|---|---|
| 1 | Endpoint/version | `POST /api/v1/robustness/analyze/v2`, `response_version=2` (header+query) | — |
| 2 | Relies on ISL V1/default? | No — V2 pinned; reads `options ?? results` for back-compat only | neutralised |
| 3 | Removes org nodes before ISL | Yes — `filterOptionNodes` pre-ISL | neutralised |
| 4 | Always sends explicit seed | Yes — always forwarded; invariant-logged if missing | neutralised |
| 5 | Rejects cycles before ISL | Yes — normaliser/preflight | neutralised |
| 6 | Rejects/dedupes duplicate edges | Yes — normaliser; dup IDs rejected | neutralised |
| 7 | Can trigger ISL goal/constraint prob inconsistency | Precedence makes threshold+constraints mutually exclusive; inconsistency upstream | unknown — upstream unverified |
| 8 | Surfaces goal & constraint probs comparably | Yes — `probability_of_goal`, `probability_of_joint_goal`, per-constraint `prob_satisfied` all [0,1]-guarded | exposed (honestly) |
| 9 | Consumes/sanitises/recomputes ISL VOI | Sanitises (>=0) + PLoT heuristic EVPI enrichment | PLoT partially owns |
| 10 | Neg/below-res EVPI & still emits claims | Negative suppressed; **below-resolution not handled** (S-02) | PLoT worsens |
| 11 | Presents ISL sensitivity as global despite options[0] | Factor sensitivity graph-based PRIMARY (neutralises); edge_sensitivity is passthrough | mostly neutralised |
| 12 | Requests path_decomposition / edge fields ISL drops | Requests `include_e_values`; `edge_e_values` consumed; path_decomposition not requested | unknown — upstream |
| 13 | Emits identifiability despite ISL "unknown" | PLoT computes OWN structural backdoor identifiability (not ISL's) — legitimate, deterministic | PLoT owns (separate, valid) |
| 14 | Validates unknown fields itself (ISL ignores) | Yes — top-level allowlist rejects unknown keys | neutralised |
| 15 | Regression tests prove the above | Tests exist (determinism, error-shapes, multi-constraint, normalisation-parity, egress lanes) — not run locally; no test proves `/v2/run` auth | partial |

---

*End of audit. No code, config, schema, or dependency files were modified by this audit.*
