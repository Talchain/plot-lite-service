# ISL `conditional_winners` wire bytes — provenance

`isl-conditional-winners.json` is **ISL's own serialisation**, not a hand-written
reading of ISL's schema.

## How it was produced (reproducible)

```
python3 -m venv <venv> && <venv>/bin/pip install 'pydantic==2.6.1' 'pydantic-settings==2.2.1' 'numpy>=1.26'
git clone --filter=blob:none Talchain/Inference-Service-Layer <clone> && git -C <clone> checkout 28fe0c95
<venv>/bin/python tools/isl-contract/gen-conditional-winners-fixture.py \
  --isl-repo <clone> --out tests/fixtures/isl-conditional-winners-20260817/isl-conditional-winners.json
```

The generator imports ISL's **own** `ConditionalWinnerV2` / `BucketResultV2`
Pydantic models from that clone and records `model_dump(mode="json",
exclude_none=True)`. It aborts unless the clone's `HEAD` is exactly
`28fe0c950f6ca5737f4555c863353d37b734dddf`. No key name in this file was typed
by the lane; every one came out of ISL's runtime. (Same principle as
`tools/isl-contract/replay-through-pinned-model.py`: the "what does ISL declare"
judgement happens inside ISL's own runtime exactly once.)

## What this fixture IS, and what it is NOT — stated because the difference is the defect

**IS:** the producer's declared wire shape, executed.

**IS NOT:** a captured live HTTP response body. A live populated capture *does*
exist — the 17 Aug frequency census
(`acceptance-evidence/conditional-winners-frequency-census-2026-08-17.md`, seeded
`/v2/run`, seed 424245) shows ISL emitting a populated row inside
`_meta.payloads.isl_response` — but PLoT's own structural-key redactor **digests
the two probability keys** (`sha8:65d458d8`, `sha8:34904571`) because they are not
contract-declared. The salt is a per-process HMAC, so **the live capture cannot
supply the names it proves are there.** That is precisely why the producer's
runtime is the oracle here.

## Two independent corroborations of the names

1. **ISL's pinned OpenAPI in this repo** — `tests/fixtures/isl-pinned/isl-openapi.json`
   (ISL sha `686fcb7f`, a *different* ref from the generator's `28fe0c95`) declares
   `BucketResultV2` = `{n_samples, runner_up_id, runner_up_probability, winner_id,
   winner_label, winner_probability}`, required `[n_samples, winner_id, winner_label,
   winner_probability]`. No `win_probability`. No `mean_outcome`.
2. **The live capture's clear/digested split is arithmetic, and it matches.** The
   redactor keeps manifest keys in clear and digests the rest. Of this fixture's six
   bucket keys, exactly four (`n_samples`, `winner_id`, `winner_label`,
   `runner_up_id`) are in `src/util/structural-keys.generated.ts` and exactly two
   (`winner_probability`, `runner_up_probability`) are not — which is exactly the
   4-clear / 2-digested pattern the live capture showed. A contrast control in the
   same check: `win_probability` and `mean_outcome` ARE in the manifest, so had ISL
   sent those names they would have appeared in clear text. They did not appear at all.

## Why these three rows

- **A** — the full shape (flip, both runner-ups, a split unit).
- **B** — Optional members ABSENT (ISL serialises with `exclude_none=True`, so an
  absent Optional is an absent KEY, never a JSON null) and a **negative
  `split_value`**: the census found a real persisted row at `-0.017`, so a
  sign-asymmetric guard would silently eat it.
- **C** — probabilities at the **`[0,1]` boundaries** (`1.0`, `0.0`), which must
  survive: `prob01` is inclusive, and `0.0` is a measured probability, not a
  missing one.

## Append-only

This file and its JSON are a record of what the producer emits at a named sha.
Add rows; do not rewrite existing ones. If ISL's shape changes, add a new dated
fixture directory and a new pin — do not edit this one (a rewritten record makes
every test that reads it agree with a history that never happened).
