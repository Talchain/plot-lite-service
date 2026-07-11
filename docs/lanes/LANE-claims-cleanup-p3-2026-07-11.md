# Lane: external-claims clean-up sweep (Track S P.3 + Sci-Roadmap 1C/B5.29) — 2026-07-11

Sources of record: `parallel-briefs/CORPUS-FIDELITY-CHECK-2026-07-11.md` (Q1/Q3),
`Olumi_Scientific_Enhancement_Roadmap_v2.md` (§1C, §Phase 0 B5.29),
`olumi-track-s-development-plan-v6.md` (§P.3). Full cross-repo manifest:
`GitHub/parallel-briefs/CLAIMS-CLEANUP-MANIFEST-2026-07-11.md`.

## Scope searched (complete)

All five repos at pinned refs — DecisionGuideAI `d085995c`, olumi-assistants-service
`f00a209a`, plot-lite-service `4653d447`, Inference-Service-Layer `569a2312` (all
`origin/staging`), olumi-schemas `b02ba489` (`origin/main`). Patterns (case-insensitive
`git grep -E`, excluding node_modules/lockfiles/dist/.tooling):
`causality|structural_proxy|bayesian|adjustment[ _-]set|do.calculus|causal inference|identifiab|well[- _]calibrated|validated causal|95% valid`
plus targeted passes for `95%`-validity claims, `guarantee/scientifically
proven/validated`, `calibrat*` (non-archive), and user-visible `EVPI` strings in UI src.

## Fixed in this PR (PLoT copy/docs class — no contract fields touched)

| File:line (pre-fix) | Was | Now |
|---|---|---|
| `README.md:5` | "Deterministic causal inference engine… Science-powered, production-ready" | probabilistic simulation over user-specified causal structure |
| `README.md:22` | "Do-calculus with identifiability checks" (full do-calculus is NOT implemented — backdoor criterion only, see `docs/archive/root/UTILITY_FIX_COMPLETE.md:184`) | do-operator interventions + backdoor identifiability checks |
| `README.md:31,33` | "Run causal inference" / "Causal interventions" | simulation / do-operator wording |
| `docs/api-reference.md:71` | "Execute causal inference on a decision graph." | probabilistic simulation wording |
| `sdk/package.json:34-35` | npm keywords `causal`, `bayesian` (no Bayesian inference on the live path; SCM-Lite BMA is a dormant lib) | keyword `causal-structure` |

## Filed for follow-up lanes (NOT fixed here)

### CEE lane (active fixup lane owns the repo)
- **§1C rename: ALREADY DONE — record it.** No `causality` field exists anywhere at the
  pinned refs; `structural_proxy` is live in `src/cee/quality/index.ts:102`, openapi.yaml:3159,
  schemas, tests, and UI fixtures. Sci-Roadmap 1C + corpus-check "unverified" row can be
  closed with this evidence.
- `src/cee/key-insight/index.ts:380` — `identifiability?.identifiable ?? true`: identifiability
  **defaults to true** when ISL provides none (ISL identifiability router is disabled), and
  line 429-430 then selects "confident causal language". Claim-integrity defect: confidence
  from absence of evidence. Route is registered (`src/server.ts:28`).
- `src/cee/decision-review/templates.ts:123-124` — user-facing "This interval is
  well-calibrated based on historical data." No historical calibration loop exists (Track S
  P.1/2.1 not closed). Currently dormant (ISL conformal disabled) but the template is live code.
- `src/services/review/blockBuilders.ts:524` — user message "Graph contains cycles. This may
  affect causal inference." — soften "causal inference" to "the analysis" (P.3 vocabulary).
- `openapi.yaml:4332`, `src/cee/key-insight/index.ts:80`, `src/schemas/cee.ts:178` —
  `adjustment_set` field + descriptions: contract-adjacent; descriptions are fixable, field
  rename would be Paul-gated (leave the field).

### UI lane (A2 owns the repo)
- `src/canvas/components/IdentifiabilityBadge.tsx:57-61` — badge copy "Model has a unique
  solution. Analysis results are reliable." — "results are reliable" is an over-claim
  (identifiability ≠ reliability); also P.3 wants identifiability jargon softened in user copy.
- `src/adapters/plot/enrichment.ts:597` — user-facing suggestion "Causal effect is not
  identifiable… Consider adding instrumental variables…" (jargon + instrumental variables
  are not a product capability).
- User-visible **EVPI jargon** (Track S standing rule 6: "No EVPI jargon in user-facing
  copy"): `src/canvas/components/RecommendationCard/RobustnessBlock.tsx:273` ("EVPI: …"),
  `src/canvas/components/model-tab/FactorsSection.tsx:496`, `src/canvas/components/model-tab/StatusBar.tsx:83`
  ("pp via EVPI"), `src/canvas/components/ModelTabBody.tsx:589` ("ranked by EVPI"). Note the
  repo already has `src/test/glossaryBannedTerms.ts:68` banning `/^EVPI$/` — enforcement gap.

### Paul / external-materials (not in any repo)
- **B5.29 "95% validity" rename: NOT FOUND in any repo** at the pinned refs (patterns above,
  plus `structural validity|95%` pass). The claim lives in external materials (pitch/website)
  per Sci-Roadmap Phase 0 ("Docs — Paul's task"). Remains open, outside repo scope.
- P.3's per-surface checklist (investor materials, website, decks, demo script, one-pagers,
  outbound templates) — no such copy is tracked in these repos; the checklist remains to be
  produced against the external surfaces.

### No action (reviewed, honest or historical)
- Implemented-capability naming: identifiability/adjustment-set code + tests in PLoT
  (`src/trust/identifiability*.ts` — backdoor identifiability IS deployed, Sci-Roadmap Phase 0 ✅)
  and ISL (`src/services/identifiability_analyzer.py` etc. — built, dormant). Describing
  implemented code by its correct name is not an over-claim.
- PLoT `docs/SCM_LITE_NOTES.md` (BMA is a real dormant lib), `contracts/openapi.yaml:2039`
  ("full Bayesian update in future versions" — explicitly honest), `docs/archive/**` +
  ISL `docs/_archive/**` (historical session records; left as record).
- olumi-schemas: 140 hits reviewed — all honest discipline (`evpi_status: below_resolution`
  never fabricates 0; calibration refs = future Brier loop). Clean.
- ISL `docs/science-validation/REPORT.md` + benchmarks: precise statistical language
  ("95% claim", "within-model") — exemplary, no action. (Path barred to local lanes anyway.)
