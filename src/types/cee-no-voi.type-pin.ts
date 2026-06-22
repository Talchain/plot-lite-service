//
// COMPILE-TIME TYPE PIN: #189 enrichment VOI is inert with respect to CEE.
// ---------------------------------------------------------------------------
// The outbound CEE review request (CeeReviewRequest), and its nested
// sensitive_parameters, must carry NO value-of-information / EVPI field.
// #189's robustness-enrichment VOI is internal-only; the CEE review path reads
// fragile_edges and must never receive VOI.
//
// WHY THIS LIVES IN src/ (not in the gate test): this is the authoritative
// compile-time guard, ENFORCED by "tsc -p tsconfig.json --noEmit"
// (npm run typecheck) and CI ("npx tsc --noEmit", engine-ci.yml) because
// src/**/*.ts is in the tsconfig include. The same assertion previously lived
// inline in tests/gates/voi-enrichment-pin.test.ts, where it was NOT enforced:
// tests/ is excluded from tsconfig.json and Vitest transpiles via esbuild,
// which strips types without type-checking. The runtime VOI/EVPI honesty pins
// on the public /v2/run surface remain in that gate test.
//
// HOW IT FAILS: if a VOI / EVPI key is ever added to CeeReviewRequest (or its
// nested sensitive_parameters), the corresponding Extract<...> stops resolving
// to never, the "extends never ? true : never" annotation resolves to never,
// and the "= true" initialiser fails to compile, surfacing the regression at
// typecheck time. This module is never imported at runtime; it exists solely so
// tsc evaluates the assertions.
//
import type { CeeReviewRequest } from '../cee/types.js';

type SensitiveParam = NonNullable<
  NonNullable<CeeReviewRequest['isl_robustness']>['sensitive_parameters']
>[number];

type NoVoiOnCeeRequest = Extract<
  keyof CeeReviewRequest,
  'value_of_information' | 'voi' | 'evpi_percentage_points'
>;
type NoVoiOnSensitiveParam = Extract<
  keyof SensitiveParam,
  'value_of_information' | 'voi' | 'evpi'
>;

const _ceeNoVoi: NoVoiOnCeeRequest extends never ? true : never = true;
const _spNoVoi: NoVoiOnSensitiveParam extends never ? true : never = true;
void _ceeNoVoi;
void _spNoVoi;
