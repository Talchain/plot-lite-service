//
// COMPILE-TIME TYPE PIN (F3, ruling D-23.15): the removed ISL wire field
// `factor_evpi` must NOT be re-declared on the ISL response type.
// ---------------------------------------------------------------------------
// ISL #103 removed the top-level `factor_evpi` field (win-probability EVPI),
// renaming its win-probability successor to `p_win_sensitivity` and adding the
// outcome-unit `factor_evppi`. PLoT's old evidence-ranking consumer read
// `factor_evpi` and silently fell back to the VOI×spread heuristic when it was
// absent — a producer rename stranding a consumer with zero signal. The
// consumer has been removed; this pin stops the FIELD from creeping back onto
// the response type (which would let a typed read of the dead name compile
// again, re-arming the silent-fallback trap).
//
// WHY A TYPE PIN AS WELL AS THE GREP GUARD: run.ts types `islResult` as `any`,
// so a runtime grep (tests/contract/isl-factor-evpi-removed.guard.test.ts) is
// what catches an untyped read; this pin is what catches the field being
// re-added to ISLRobustnessAnalyzeV2Response, which would silently re-permit a
// TYPED read. Same derive-don't-mirror intent, enforced at `tsc` time.
//
// HOW IT FAILS: if `factor_evpi` is re-added as a key on
// ISLRobustnessAnalyzeV2Response, Extract<...> stops resolving to `never`, the
// `extends never ? true : never` annotation resolves to `never`, and the
// `= true` initialiser fails to compile — surfacing the regression under
// `npm run typecheck` (tsc -p tsconfig.json --noEmit). Never imported at
// runtime; it exists solely so tsc evaluates the assertion.
//
import type { ISLRobustnessAnalyzeV2Response } from '../integrations/isl/types/isl-types.js';

type NoFactorEvpiOnIslResponse = Extract<keyof ISLRobustnessAnalyzeV2Response, 'factor_evpi'>;

const _noFactorEvpi: NoFactorEvpiOnIslResponse extends never ? true : never = true;
void _noFactorEvpi;
