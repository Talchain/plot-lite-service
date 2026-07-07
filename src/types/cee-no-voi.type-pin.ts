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

// The complete set of forbidden VOI / EVPI key aliases, checked IDENTICALLY at
// both the top level (CeeReviewRequest) and the nested sensitive_parameters
// level. Keeping one shared union prevents the two checks from drifting apart
// (e.g. one covering 'evpi' but not 'evpi_percentage_points', or vice versa).
type ForbiddenVoiKey = 'value_of_information' | 'voi' | 'evpi' | 'evpi_percentage_points' | 'evpi_status';

type NoVoiOnCeeRequest = Extract<keyof CeeReviewRequest, ForbiddenVoiKey>;
type NoVoiOnSensitiveParam = Extract<keyof SensitiveParam, ForbiddenVoiKey>;

const _ceeNoVoi: NoVoiOnCeeRequest extends never ? true : never = true;
const _spNoVoi: NoVoiOnSensitiveParam extends never ? true : never = true;
void _ceeNoVoi;
void _spNoVoi;
