# Track S — PLoT Capability, Contract, Scientific Integrity, Performance & Reliability Audit

**Date:** 2026-07-05
**Auditor:** Claude Code (read-only audit mode)
**Repo:** `plot-lite-service` (Talchain/plot-lite-service)
**Baseline SHA:** `a14f79a` — identical to `origin/staging` (0 ahead / 0 behind)
**Mode:** Static source audit. Dependencies could NOT be installed (private registry `@talchain/schemas` returned 401), so **no typecheck, tests, or benchmarks were run locally.** All test/CI claims are inferred from source + CI config and are labelled accordingly.

> **Provenance discipline:** Where a finding rests on PR names, branch absence, or inference it is labelled **provisional**. Live-code evidence is labelled with file:line. Cross-repo (ISL/CEE/UI) behaviour cannot be observed from this repo and is labelled **upstream — unverified**.

The full report body (sections A–N, the 25 hypothesis verdicts, and the 15-item ISL reconciliation table) is delivered to Paul in chat and mirrored in the working-tree file of the same name. This API-pushed copy carries the executive summary and risk register so the branch has a durable record; consult the chat copy or the working-tree file for the complete per-section trace.

## A. Executive verdict

**Usable for the current PoC path with specific Tier‑0 blockers.**

The live `/v2/run` path is real, coherent, and unusually disciplined about numeric egress honesty (a dedicated guard module drops non-finite ISL values instead of serialising fabricated `null`s). Determinism, seed authority, option-node filtering, constraint precedence, and identifiability all trace cleanly through committed source. EVPI is explicitly labelled `heuristic`, VOI is non-negativity-clamped, and organisational nodes are filtered before ISL.

Three things hold back an unqualified "trusted":

1. **`POST /v2/run` has no authentication guard** (Tier‑0, security). Every other write surface (`/v1/*`, legacy `/critique`, `/draft-flows`, `/stream`) enforces `authGuard`; `/v2/run` does not, and `render.yaml` ships staging with `AUTH_ENABLED=1`. Code evidence is high-confidence; deployed exploitability depends on an upstream gateway we cannot observe.
2. **EVPI is a heuristic proxy, not counterfactual EVPI, and has no below-resolution handling** — noisy near-zero values are clamped to a confident number rather than marked "indistinguishable from zero" (Tier‑1, scientific honesty).
3. **The audit could not be validated by execution.** The private-registry 401 means `node_modules` is absent; a reviewer must trust CI, and CI's own gate (`RATE_LIMIT_ENABLED=0 npm test`) is the only authoritative signal.

No evidence of scientific dishonesty in the emitted contract was found; the codebase is visibly the product of prior careful Track S hardening.

## B. Ground-truth preflight (summary)

- Branch `claude/plot-capability-audit-9xgfwz` @ `a14f79a` == `origin/staging` (0/0). Clean tree; no stale `src/**/*.js`.
- `claude/great-lewin-9bfcab` does not exist on remote (provisional re: whether all Track S amendments landed).
- Entrypoint `src/main.ts` -> `src/createServer.ts`; `/v2/run` at `src/routes/v2/run.ts` (5055 lines).
- Runtime: `npm ci && npm run build` -> `node dist/main.js` (dist untracked, built at deploy). Health `/v1/health`.
- Schema pkg `@talchain/schemas@0.2.1` (no `@olumi/contracts`). Node engines >=20<21; container Node v22.
- Tests NOT typechecked (`tsconfig` include = `src/**` only).
- `npm ci` FAILED (registry 401) -> node_modules empty -> typecheck/tests NOT run locally. `git status` clean after (no repo files modified).

## L. Risk register

| ID | Finding | Conf. | Severity | Owner | Category | Lane |
|---|---|---|---|---|---|---|
| S-01 | `/v2/run` has no auth guard while `AUTH_ENABLED=1` ships | High (code) / Med (deployed) | Critical | PLoT | security | Tier 0 |
| S-02 | EVPI heuristic has no below-resolution handling; noisy~=0 -> confident number | High | High | PLoT | scientific validity | Tier 1 |
| S-03 | #284 value-scale egress net absent; raw-unit intervention w/ no range evidence silently treated as [0,1] | High | High | PLoT/CEE | scientific validity | Tier 0/1 |
| S-04 | Audit not executable locally; private registry 401 blocks `npm ci` | High | Med | Paul/PLoT | reliability | Security/ops |
| S-05 | Tests excluded from `tsc` typecheck; type-level asserts not enforced | High | Med | PLoT | maintainability | Tier 1 |
| S-06 | Two OpenAPI trees can drift from `/v2/run` reality | High | Med | PLoT | contract | Tier 2 |
| S-07 | Graph size limits enforced post-normalisation | High | Low | PLoT | performance | Tier 2 |
| S-08 | ISL response cast without ingress validation | High | Low | PLoT | reliability | Tier 2 |
| S-09 | `switch_probability` non-finite fabrication guard deferred | High | Med | PLoT/ISL | scientific validity | Tier 1 / ISL |
| S-10 | `ISL_API_KEY`/`CEE_API_KEY` not required at startup when features enabled | High | Low | PLoT | ops | Tier 2 |
| S-11 | Dormant `src/scm-lite/*` imported but off in prod (`SCM_LITE_ENABLE=0`) | High | Low | PLoT | maintainability | Tier 2 |
| S-12 | `/v2/run` 5055-line file, ~2200-line handler | High | Low | PLoT | maintainability | Tier 2 |
| S-13 | Rate limit per-IP only (shared-NAT clients collide) | High | Low | PLoT | security | Tier 2 |
| S-14 | Two run surfaces (`/v1/run` + `/v2/run`) — B3 drift | High | Low | PLoT/UI | product | Tier 2 |
| S-15 | Legacy route dup (`/critique` vs `/v1/critique`, `/health` vs `/v1/health`) | High | Low | PLoT | maintainability | Tier 2 |

## M. Roadmap (summary)

- **Tier 0:** S-01 (auth `/v2/run` + registration test); S-03 (value-scale ownership: land PR B or confirm CEE guarantees range evidence).
- **Tier 1:** S-02 (EVPI below-resolution); S-09 (`switch_probability` guard); S-05 (typecheck tests in CI).
- **Tier 2:** S-06 OpenAPI single-source; S-07 pre-normalisation size guard; S-08 ISL-ingress validation; S-11 quarantine SCM-lite; S-12 extract `/v2/run` sub-assemblers; S-13/S-14/S-15 dedupe & deprecation.
- **Security/ops:** S-04 registry token; S-10 startup key checks; build SHA on `/health`.
- **V5 handoffs:** intercept/root doctrine; EVPI display doctrine; association-vs-causal claim labelling.
- **ISL handoffs:** options[0]-relative sensitivity; goal/constraint prob consistency; identifiability status; `switch_probability` finiteness.
- **Questions for Paul:** Is `/v2/run` fronted by an authenticating gateway? Does CEE guarantee range evidence per intervention? Is direct `/v1/run` (B3) still supported?
- **Questions for Neil:** Is ISL VOI true EVPI or a proxy? Should ISL return `constraint_id` (positional mapping is PLoT's only identity handle)?

## Hypothesis verdicts (headline)

Confirmed: #1,#3,#6,#8,#9,#10,#11,#12,#14,#16,#17,#18,#19,#20,#22. Falsified: #4 (no stale js this clone), #5 (#284 net absent), #7 (empty-constraint fixed -> unavailable/error), #15 (identifiability live, not dormant), #13 (levers filtered from sensitivity; kept only for confidence merge), #23 (fails closed). Partial: #2, #21, #24, #25.

## ISL reconciliation (headline)

PLoT calls ISL `POST /api/v1/robustness/analyze/v2` (response_version=2). Neutralised on PLoT side: org-node filtering, explicit seed always forwarded, cycle/dup rejection, unknown-field rejection, graph-based (not options[0]-relative) factor sensitivity. PLoT-owned: structural backdoor identifiability (independent of ISL's unknown status), VOI sanitisation + heuristic EVPI. PLoT worsens: below-resolution EVPI (S-02). Upstream-unverified: ISL goal/constraint probability consistency, path_decomposition drop.

---

*End of audit summary. No code, config, schema, or dependency files were modified by this audit. Full per-section trace is in the chat-delivered copy of this file.*
