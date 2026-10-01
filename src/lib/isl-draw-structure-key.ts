/**
 * ⭐ THE DRAW STRUCTURE OF ONE ISL REQUEST, AS AN OPAQUE DIGEST (M2 cause; DL 5934513210 option (b); CEE #2410).
 *
 * WHY PLoT. CEE's run delta may say a rerun's movement was CAUSED by the user's edit (`C1_attributable`) only when both
 * Runs drew their samples the same way. ISL draws per sample in LIST ORDER from ONE stream (`robustness_analyzer_v2`:
 * per edge a Bernoulli on `exists_probability`, then a normal only if the edge exists), so the same seed pairs two Runs
 * only when the draw structure is unchanged (SCIENCE/DSK 5934059958). PLoT built and sent that request, so PLoT is the
 * ONE authority on its structure. CEE only compares two of these strings for equality and never recomputes them.
 *
 * WHY HERE AND NOT `_meta.payloads`. The recorded request rides `_meta.payloads` only under `UI_CANONICAL_META`, off on
 * staging, and the always-on downstream record keeps a size-capped debug copy (`sanitizePayloadForDebug` truncates long
 * arrays). The key is computed from the EXACT body the ISL client sends, before any of that.
 *
 * IN THE KEY, in list order: nodes (epsilon noise on or off; a nonlinear identity's operands), edges (`exists_probability`;
 * a strength mean at exactly 0), the parameter uncertainties with their distribution type, each option's intervention set
 * and stated ranges, factor correlations, and the analysis switches. NOT in the key: values that do not change what is
 * drawn (a strength mean or std off 0, a prior's bounds, an intervention level, the seed). Same definition as CEE #2410's
 * `islDrawStructureKey`, now owned here. `null` when the body is not an analysis request (no graph).
 *
 * ⛔ DEPENDS ON ISL (SCIENCE/DSK 5935983506; overflow P1 5935944093): "a mean or std does not change what is drawn" holds
 * only once ISL samples synchronously (inverse-CDF truncated normal, the strength uniform drawn every iteration). With
 * rejection sampling it does NOT, so this key must not license C1 until that ISL change is deployed (merge order: ISL →
 * this PR → CEE #2410).
 */
import { createHash } from 'node:crypto';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const isZero = (v: unknown): boolean => typeof v === 'number' && v === 0;

export function islDrawStructureKey(islRequest: unknown): string | null {
  if (!isRec(islRequest) || !isRec(islRequest.graph)) return null;
  const g = islRequest.graph;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;
  const nodes = g.nodes.filter(isRec).map((n) => {
    const nli = isRec(n.nonlinear_identity)
      ? JSON.stringify([n.nonlinear_identity.operation ?? null, n.nonlinear_identity.factor_ids ?? null, n.nonlinear_identity.addends ?? null])
      : '';
    const eps = typeof n.epsilon_std === 'number' && n.epsilon_std > 0 ? 'eps' : '';
    return `${String(n.id)}|${String(n.kind)}|${eps}|${nli}`;
  });
  const edges = g.edges.filter(isRec).map((e) => {
    const mean = isRec(e.strength) ? e.strength.mean : undefined;
    return `${String(e.from)}->${String(e.to)}@${String(e.exists_probability ?? 'default')}${isZero(mean) ? '|mean0' : ''}`;
  });
  const uncertainties = (Array.isArray(islRequest.parameter_uncertainties) ? islRequest.parameter_uncertainties.filter(isRec) : [])
    .map((u) => `${String(u.node_id)}:${String(u.distribution)}`);
  const options = (Array.isArray(islRequest.options) ? islRequest.options.filter(isRec) : []).map((o) => {
    const levers = isRec(o.interventions) ? Object.keys(o.interventions).sort().join(',') : '';
    const ranges = isRec(o.intervention_ranges)
      ? Object.keys(o.intervention_ranges).sort().map((k) => {
        const r = (o.intervention_ranges as Rec)[k];
        return isRec(r) ? `${k}~${String(r.meaning)}:${String(r.low)}:${String(r.high)}` : k;
      }).join(',')
      : '';
    return `${String(o.id)}|${levers}|${ranges}`;
  });
  const canonical = JSON.stringify({
    nodes,
    edges,
    uncertainties,
    options,
    correlations: islRequest.factor_correlations ?? null,
    switches: [islRequest.analysis_types ?? null, islRequest.include_voi ?? null, islRequest.include_e_values ?? null, islRequest.include_factor_flips ?? null],
  });
  return createHash('sha256').update(canonical).digest('hex');
}
