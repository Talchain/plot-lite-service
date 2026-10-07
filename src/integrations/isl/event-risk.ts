/**
 * event_risk.v1: PLoT's ONE owner of the opt-in event-risk block (Science 393023, pilot §4).
 *
 * A risk node may carry `event_risk` (a risk is an EVENT that may happen within a horizon). PLoT
 * neither mints nor changes it. It reads the block, refuses a malformed one (400, never dropped:
 * a dropped event is an inert risk presented as modelled) and forwards it VERBATIM to ISL. ISL
 * owns the deep semantics and refuses with a typed 422 what v1 cannot evaluate.
 *
 * The reader (`readEventRisk`) lives beside `readNonlinearIdentity` in
 * src/normalisation/graph-normaliser.ts; this module owns the forward and the echo.
 *
 * Fail-closed echo (hazard 1, version skew). An ISL that does not know `event_risk` silently
 * drops it (`extra: "ignore"`) and runs the risk as an ordinary node. So after the call PLoT
 * requires ISL's `event_risks_applied` echo to name exactly the risks it sent. Precedent: the
 * TEMPORAL `intervention_ranges` echo.
 *
 * Inert when absent: a request with no `event_risk` gains no key at any hop and is never
 * checked, so it is byte-identical.
 */

/** The v1 block as PLoT forwards it (verbatim; ISL validates the inside). */
export interface EventRiskV1 {
  version: 1;
  occurrence: Record<string, unknown>;
  horizon: Record<string, unknown>;
  mitigations?: Array<Record<string, unknown>>;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The ids of the nodes that carry `event_risk` on an ISL request, sorted. Empty for legacy. */
export function eventRiskIdsSent(nodes: ReadonlyArray<{ id: string; event_risk?: unknown }>): string[] {
  return nodes
    .filter((n) => n.event_risk !== undefined)
    .map((n) => n.id)
    .sort();
}

/**
 * Did ISL apply exactly the event risks PLoT sent? Reads the V2 envelope's top-level
 * `event_risks_applied` (the V1 `_metadata` copy as a fallback). Vacuously true when nothing
 * was sent, so a legacy request is never checked.
 */
export function eventRiskEchoMatches(sentIds: readonly string[], islResult: unknown): boolean {
  if (sentIds.length === 0) return true;
  if (!isPlainObject(islResult)) return false;
  const meta = isPlainObject(islResult._metadata) ? islResult._metadata : undefined;
  const echo = islResult.event_risks_applied ?? meta?.event_risks_applied;
  if (!Array.isArray(echo)) return false;
  const echoed = echo
    .map((entry) => (isPlainObject(entry) ? entry.node_id : undefined))
    .filter((id): id is string => typeof id === 'string')
    .sort();
  return echoed.length === sentIds.length && echoed.every((id, i) => id === sentIds[i]);
}
