/**
 * Lane A1b — elasticity / tunability re-leak suppression (unit).
 *
 * A1 made intervention-controlled levers egress `sensitivity_score: 0` +
 * `zero_reason: 'intervention_override'`, but graph-derived `elasticity` still
 * drove the tunability / evidence / VoI / "what would change" surfaces. A1b
 * excludes levers at those surfaces (predicate keyed on `zero_reason`) and the
 * producer defensively zeroes `elasticity`. `influence_score` / `importance_rank`
 * are NOT touched (structural — key_drivers / assumptions_ledger keep the lever).
 *
 * Each block is RED-before (the lever leaks on pre-A1b code) / GREEN-after.
 * Levers here carry a NON-ZERO `elasticity` so the tests prove the explicit
 * predicate (not merely the producer `elasticity: 0`) excludes them.
 */
import { describe, it, expect } from 'vitest';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';
import { generateHeadlines, detectHeadlineType } from '../src/coaching/headlines.js';
import { generateCritiques } from '../src/coaching/critiques.js';
import { computeKeyDrivers } from '../src/coaching/key-drivers.js';
import { buildEvidencePriorityCard, toEvidencePriorityFactorInputs, type FactorInput } from '../src/review-pass/evidence-priority.js';
import { filterInterventionOverrides } from '../src/lib/intervention-override.js';
import type { CoachingInputs, NormalisedFactorSensitivity } from '../src/coaching/types.js';

const LEVER = 'Technical Leadership Capacity';
const NONLEVER = 'Launch Deadline Pressure';

// ---------------------------------------------------------------------------
// decision_brief.top_drivers + what_would_change (public, abs(elasticity)-ranked)
// ---------------------------------------------------------------------------
function briefInput(factor_sensitivity: any[]): BriefAssemblyInput {
  return {
    analysis_status: 'computed',
    critiques: [],
    option_comparison: [
      { option_id: 'opt1', label: 'A', win_probability: 0.6 },
      { option_id: 'opt2', label: 'B', win_probability: 0.4 },
    ],
    // fragile_edges empty → what_would_change uses the factor_sensitivity fallback
    robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
    meta: { seed_used: '1' },
    factor_sensitivity,
  } as BriefAssemblyInput;
}

describe('A1b — decision_brief excludes intervention_override levers', () => {
  // Lever has the HIGHEST abs(elasticity); pre-A1b it would be the #1 top driver.
  const factors = [
    { factor_id: 'fac_leadership_capacity', factor_label: LEVER, elasticity: 1, influence_score: 1, direction: 'positive', zero_reason: 'intervention_override' },
    { factor_id: 'fac_time_pressure', factor_label: NONLEVER, elasticity: 0.51, influence_score: 0.51, direction: 'negative', zero_reason: null },
  ];

  it('top_drivers: lever excluded, non-lever present (RED pre-A1b: lever ranks #1)', () => {
    const brief = assembleBrief(briefInput(factors))!;
    const labels = brief.top_drivers.map(d => d.factor_label);
    expect(labels).not.toContain(LEVER);
    expect(labels).toContain(NONLEVER);
  });

  it('what_would_change fallback: lever excluded, non-lever present', () => {
    const brief = assembleBrief(briefInput(factors))!;
    expect(brief.what_would_change).not.toContain(LEVER);
    expect(brief.what_would_change).toContain(NONLEVER);
  });
});

// ---------------------------------------------------------------------------
// evidence-priority (review_cards) — mirrors run.ts epFactors construction
// ---------------------------------------------------------------------------
describe('A1b — evidence-priority excludes intervention_override levers', () => {
  it('lever absent from evidence-priority items (RED pre-A1b: lever ranks by |elasticity|)', () => {
    const merged = [
      { factor_id: 'fac_leadership_capacity', factor_label: LEVER, elasticity: 1, confidence: 0.1, zero_reason: 'intervention_override' },
      { factor_id: 'fac_time_pressure', factor_label: NONLEVER, elasticity: 0.51, confidence: 0.1, zero_reason: null },
    ];
    // Exactly as run.ts builds epFactors: filter THEN map, through the SAME
    // exported mapper the route calls. This block used to open-code the map,
    // and had already drifted from the route by a `?? fs.sensitivity_score`
    // limb — the hand-maintained mirror CLAUDE.md trap 12 warns about. Derive,
    // never mirror: if the mapping rule changes, this test moves with it.
    const epFactors: FactorInput[] = toEvidencePriorityFactorInputs(
      filterInterventionOverrides(merged),
    );
    const card = buildEvidencePriorityCard(epFactors);
    const ids = (card?.items ?? []).map(i => i.factor_id);
    expect(ids).not.toContain('fac_leadership_capacity');
    expect(ids).toContain('fac_time_pressure');
  });
});

// ---------------------------------------------------------------------------
// headlines — VoI/evidence naming (needs_evidence topGap), scoped to VoI only
// ---------------------------------------------------------------------------
function normFactor(over: Partial<NormalisedFactorSensitivity>): NormalisedFactorSensitivity {
  return { node_id: 'n', label: 'L', elasticity: 0, importance_rank: 1, confidence: 0.5, direction: 'positive', influence_score: 0, zero_reason: undefined, ...over };
}
function coachingInputs(factorSensitivity: NormalisedFactorSensitivity[], over: Partial<CoachingInputs> = {}): CoachingInputs {
  return {
    graph: { nodes: [{ id: 'goal', kind: 'goal', label: 'Goal' }, { id: 'fac', kind: 'factor', label: 'Fac' }], edges: [] } as any,
    options: [
      { id: 'opt1', label: 'A', winProbability: 0.6, outcomeMean: 0.7, outcomeP10: undefined, outcomeP90: undefined },
      { id: 'opt2', label: 'B', winProbability: 0.4, outcomeMean: 0.5, outcomeP10: undefined, outcomeP90: undefined },
    ],
    factorSensitivity,
    fragileEdges: [],
    robustness: { level: undefined, recommendationStability: undefined, isRobust: undefined }, // stability undefined → needs_evidence
    interventionTargetIds: new Set<string>(),
    ...over,
  } as CoachingInputs;
}

describe('A1b — headlines do not name levers as VoI/evidence gaps (existence check untouched)', () => {
  it('needs_evidence topGap names a non-lever, not the lever (RED pre-A1b: lever named)', () => {
    // Lever has the highest VoI (|elasticity|*(1-confidence)); pre-A1b it is named.
    const factors = [
      normFactor({ node_id: 'fac_leadership_capacity', label: LEVER, elasticity: 1, confidence: 0.1, influence_score: 1, zero_reason: 'intervention_override' }),
      normFactor({ node_id: 'fac_time_pressure', label: NONLEVER, elasticity: 0.4, confidence: 0.2, influence_score: 0.4, direction: 'negative' }),
    ];
    const headlines = generateHeadlines(coachingInputs(factors));
    const allText = Object.values(headlines).join(' || ');
    expect(allText).not.toContain(LEVER);
    expect(allText).toContain(NONLEVER);
  });

  it('existence check unaffected: headlines still produced when only a lever is present', () => {
    // hasFactorSensitivity must remain true (we do not erase lever existence).
    const factors = [normFactor({ node_id: 'fac_leadership_capacity', label: LEVER, elasticity: 1, confidence: 0.1, influence_score: 1, zero_reason: 'intervention_override' })];
    const headlines = generateHeadlines(coachingInputs(factors));
    expect(Object.keys(headlines).length).toBeGreaterThan(0); // winner headline still emitted
  });

  // Codex finding: detectHeadlineType (used by orchestrator) is the SAME headline
  // VoI classification surface and must apply the predicate too — otherwise a
  // high-elasticity lever drives high_uncertainty there while generateHeadlines
  // (filtered) disagrees. RED pre-fix: detectHeadlineType returned high_uncertainty.
  it('detectHeadlineType: high-elasticity intervention_override lever does NOT classify as high_uncertainty (no fragile edge)', () => {
    const factors = [
      normFactor({ node_id: 'fac_leadership_capacity', label: LEVER, elasticity: 1, confidence: 0.05, influence_score: 1, zero_reason: 'intervention_override' }),
      normFactor({ node_id: 'fac_team_size', label: 'Existing Team Size', elasticity: 0.05, confidence: 0.9, influence_score: 0.05, direction: 'positive' }),
    ];
    // stability defined + clear winner delta + NO fragile edges → without the
    // lever's stale VoI, the type is not high_uncertainty.
    const inputs = coachingInputs(factors, { robustness: { level: 'high', recommendationStability: 0.85, isRobust: true } as any });
    expect(detectHeadlineType(inputs)).not.toBe('high_uncertainty');
    // Consistency: generateHeadlines on the same input must not name the lever.
    expect(Object.values(generateHeadlines(inputs)).join(' || ')).not.toContain(LEVER);
  });
});

// ---------------------------------------------------------------------------
// structural surfaces (S1) — key_drivers keeps the lever (must NOT change)
// ---------------------------------------------------------------------------
describe('A1b — key_drivers (structural) still includes the lever (out of scope)', () => {
  it('lever appears in key_drivers via influence_score (unchanged)', () => {
    const factors = [
      normFactor({ node_id: 'fac_leadership_capacity', label: LEVER, elasticity: 0, importance_rank: 1, influence_score: 1, zero_reason: 'intervention_override' }),
      normFactor({ node_id: 'fac_time_pressure', label: NONLEVER, elasticity: 0.51, importance_rank: 2, influence_score: 0.51, direction: 'negative' }),
    ];
    const drivers = computeKeyDrivers(coachingInputs(factors));
    const ids = drivers.map(d => d.factor_id);
    expect(ids).toContain('fac_leadership_capacity'); // structural importance preserved
  });
});

// ---------------------------------------------------------------------------
// checkMissingRiskPathway guard — material lever via influence_score, both
// elasticity:0 and elasticity:undefined (lever branch ignores elasticity)
// ---------------------------------------------------------------------------
const MISSING = 'MISSING_RISK_PATHWAY';
function hasMissingRiskCritique(inputs: CoachingInputs): boolean {
  return generateCritiques(inputs).some(c => c.type === MISSING);
}
// graph with NO risk→goal edge so the structural fallback cannot suppress.
const NO_RISK_GRAPH = { nodes: [{ id: 'goal', kind: 'goal', label: 'Goal' }, { id: 'fac', kind: 'factor', label: 'Fac' }], edges: [] } as any;

describe('A1b — checkMissingRiskPathway materiality guard', () => {
  for (const elastic of [0, undefined] as const) {
    it(`material negative lever (influence_score>0.01) STILL suppresses the critique [elasticity:${String(elastic)}]`, () => {
      // RED pre-A1b: base uses abs(elasticity)>0.01 → lever (elasticity 0/undef) not
      // material → critique falsely FIRES. GREEN: guard uses influence_score → material.
      const factors = [normFactor({ node_id: 'fac_leadership_capacity', label: LEVER, elasticity: elastic, influence_score: 0.5, direction: 'negative', zero_reason: 'intervention_override' })];
      expect(hasMissingRiskCritique(coachingInputs(factors, { graph: NO_RISK_GRAPH }))).toBe(false);
    });

    it(`negligible negative lever (influence_score<=0.01) does NOT over-suppress → critique fires [elasticity:${String(elastic)}]`, () => {
      const factors = [normFactor({ node_id: 'fac_leadership_capacity', label: LEVER, elasticity: elastic, influence_score: 0.005, direction: 'negative', zero_reason: 'intervention_override' })];
      expect(hasMissingRiskCritique(coachingInputs(factors, { graph: NO_RISK_GRAPH }))).toBe(true);
    });
  }

  it('non-lever negative behaviour unchanged: material suppresses, negligible fires', () => {
    const material = [normFactor({ node_id: 'fac_time_pressure', label: NONLEVER, elasticity: 0.5, influence_score: 0.5, direction: 'negative' })];
    expect(hasMissingRiskCritique(coachingInputs(material, { graph: NO_RISK_GRAPH }))).toBe(false);
    const negligible = [normFactor({ node_id: 'fac_time_pressure', label: NONLEVER, elasticity: 0.005, influence_score: 0.005, direction: 'negative' })];
    expect(hasMissingRiskCritique(coachingInputs(negligible, { graph: NO_RISK_GRAPH }))).toBe(true);
  });

  it('genuinely missing negative/risk pathway still fires (no negatives at all)', () => {
    const factors = [normFactor({ node_id: 'fac_team', label: 'Team', elasticity: 0.5, influence_score: 0.5, direction: 'positive' })];
    expect(hasMissingRiskCritique(coachingInputs(factors, { graph: NO_RISK_GRAPH }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkDominantFactor — DOMINANT_FACTOR is a tunability critique ("what would
// change if {x} had less influence?"); option-pinned levers must never be named
// as the dominant tunable factor. Excluded via the explicit predicate (durable
// guarantee), not producer elasticity:0. Levers here carry a NON-ZERO elasticity
// so the test proves the predicate, not the producer value.
// ---------------------------------------------------------------------------
describe('A1b — checkDominantFactor excludes intervention_override levers', () => {
  function dominantCritique(inputs: CoachingInputs) {
    return generateCritiques(inputs).find(c => c.type === 'DOMINANT_FACTOR');
  }

  it('a high-elasticity lever is NOT named as the dominant factor (RED pre-A1b: lever named)', () => {
    const factors = [
      normFactor({ node_id: 'fac_leadership_capacity', label: LEVER, elasticity: 10, importance_rank: 1, influence_score: 1, zero_reason: 'intervention_override' }),
      normFactor({ node_id: 'fac_time_pressure', label: NONLEVER, elasticity: 0.1, importance_rank: 2, influence_score: 0.1, direction: 'negative' }),
    ];
    const dom = dominantCritique(coachingInputs(factors));
    expect(dom?.targets ?? []).not.toContain('fac_leadership_capacity');
    expect(dom?.challenge_question ?? '').not.toContain(LEVER);
    expect(dom?.suggested_action ?? '').not.toContain(LEVER);
  });

  it('a non-lever factor can still be named as dominant (predicate does not break detection)', () => {
    const factors = [
      normFactor({ node_id: 'fac_time_pressure', label: NONLEVER, elasticity: 10, importance_rank: 1, influence_score: 1, direction: 'negative' }),
      normFactor({ node_id: 'fac_team_size', label: 'Existing Team Size', elasticity: 0.1, importance_rank: 2, influence_score: 0.1, direction: 'positive' }),
    ];
    const dom = dominantCritique(coachingInputs(factors));
    expect(dom, 'DOMINANT_FACTOR fires for a real non-lever dominance').toBeDefined();
    expect(dom!.targets).toContain('fac_time_pressure');
  });

  it('unrelated critique behaviour unchanged: NARROW_FRAMING still fires with a lever present', () => {
    // Filter is LOCAL to checkDominantFactor — other critiques are unaffected.
    const factors = [normFactor({ node_id: 'fac_leadership_capacity', label: LEVER, elasticity: 10, importance_rank: 1, influence_score: 1, zero_reason: 'intervention_override' })];
    const types = generateCritiques(coachingInputs(factors)).map(c => c.type);
    expect(types).toContain('NARROW_FRAMING'); // 2 options, no status-quo → fires regardless of factors
  });
});
