# starter-pricing.request.json

This is the `request` half of AI Quality's served capture `starter-pricing-20260929T054540Z.json`, stored verbatim, from `olumi-programme-docs:evidence/aiq-p2-science-columns-20260927:served-post-merge-20260929/starter-pricing/`. The capture is UI staging `6eea3254`'s `src/canvas/starters/data/pricing-model.draft.json`, posted as-is to served PLoT `2e9de99` / ISL `f7f19e3` on 29 Sep 2026 05:45Z (AIQ #72 5884454738). It carries the NRR limit exactly as the starter states it: `constraint_out_nrr_min`, `out_nrr >= 1.1`, unit `fraction`, from 110%.

It is read by `tests/nrr-ratio-limit-clamp.route.test.ts`, which varies only `out_nrr` and the limit's `value_frame` (R3-B measurement #72 5884593270; AIQ ACK 5884802000).
