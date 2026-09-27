# Sampling measurements: ISL to PLoT

This additive carrier makes two existing ISL measurements available on PLoT's
`/v2/run` response without changing computation, ranking or recommendation policy:

| Field | Meaning | Public location |
|---|---|---|
| `tie_rate` | Fraction of requested Monte Carlo draws with exactly tied maximum outcomes, before auto-noise; not a near-tie/confidence score | Top level in enhanced ISL and PLoT responses |
| `edge_existence_rates` | Realised edge inclusion frequencies, retaining the producer's exact `from->to` identity keys | Top level in enhanced ISL and PLoT responses |

PLoT's client already preserves the JSON fields. The first PLoT loss was the
field-by-field `buildResponse` projection. `getIslSamplingDiagnostics` now reads
only the enhanced top-level contract and the public response adopts the result.
It does not reinterpret internal/legacy `_metadata` as the enhanced contract.

Both fields are optional. Valid finite rates in [0,1] survive unchanged, including
zero. A computed empty map stays `{}`. Missing measurements stay absent, never
zero or a stable-result verdict. Malformed values are withheld and disclosed by
`ISL_SAMPLING_DIAGNOSTICS_INVALID`; any malformed map entry withholds the whole
map rather than presenting a partial edge population as complete. The other
independently valid field can still survive.

## Compatibility and deployment

No package, lockfile or version alignment is needed for this PLoT slice. The
actual vendored `@talchain/schemas` 0.40 enrichment parser preserves unknown
top-level fields. It also accepts malformed unknown fields, which is why this
carrier validates its values before adoption rather than claiming the old
enrichment guard validated them. The exact installed-old-consumer behavior is
exercised in `tests/isl-sampling-diagnostics.unit.test.ts`.

| ISL producer | PLoT consumer | Behavior |
|---|---|---|
| Older enhanced response | New PLoT | Both fields remain absent |
| New enhanced response | Older PLoT | Client receives them; old response projection drops them |
| New enhanced response | New PLoT | Valid fields survive at the same top-level paths |

Deploying an optional-field consumer before the producer is compatible. A new
producer with old PLoT is also service-compatible but loses these measurements;
that combination is not carriage completion. CEE/UI keep-lists and consumers
belong to the separate onward owner and must adopt the exact fields before
product availability is claimed. This lane does not implement UI presentation,
new confidence scores, or interpretation/recommendation policy.

## Evidence and limits

`tests/fixtures/isl-sampling-transport-20260831/manifest.json` identifies the exact
ISL producer commit and hashes its actual enhanced API request/response fixtures.
The route test reads complete producer responses, without constructing a
synthetic success payload, through the real PLoT Fastify route; only the service
transport is stubbed. The fixture controls distinguish tie rates .91/.07/0 and
edge rates .09/.93/1, an old producer with absent fields, malformed values and an
unrelated timestamp change. Request scientific inputs, existing outcomes and
request hashes stay unchanged when only these carried fields change. The
response-content hash includes the new fields naturally.

Focused checks:

```sh
npm run typecheck
npx vitest run tests/isl-sampling-diagnostics.unit.test.ts tests/isl-sampling-diagnostics.route.test.ts
npm run validate:contracts
npm run gate:numeric-egress
```

Existing envelope, enrichment, auto-noise numeric invariance, OpenAPI drift and
structural-key drift tests are companion controls. The complete local staging
gate is not the isolated-branch smoke gate; full required CI, independent review,
real cross-service HTTP evidence and onward CEE/UI adoption remain separate
claims. Nothing here certifies a deployed or mounted capability.
