/**
 * Enrichment egress guard — PRESENCE-SHAPED FAIL-CLOSED (ROADMAP 2.726).
 *
 * WHY THIS SPLIT EXISTS, derived from the guard's own incident record rather
 * than from a preference for strictness:
 *
 * The guard shipped FAIL-OPEN — it detected, disclosed three ways, and shipped
 * the body regardless. Every real-world firing it has ever had was the SCHEMA
 * being wrong about HONEST producer data, never the producer corrupting a
 * value:
 *
 *   1. 0.30.0 era — `flip_thresholds[].direction` was a REQUIRED `z.string()`.
 *      PLoT honestly OMITS it on a no-flip row ("a direction for a flip that
 *      does not exist would be a fabricated claim"), so the guard raised
 *      ENRICHMENT_CONTRACT_MISMATCH on every run carrying an honest no-flip.
 *      Fixed by RELAXING the schema in 0.31.0 (`direction` → `.optional()`).
 *      Tombstone: src/integrations/isl/adapters/factor-flip-values.ts.
 *   2. 0.37.0 era — `EnrichmentOutcomeStatsSchema` required `mean`/`p10`/`p50`/
 *      `p90`. ISL omits them on a degenerate Monte-Carlo run and PLoT refuses
 *      to fabricate them, so the guard fired on every degenerate option. Fixed
 *      by RELAXING the schema in 0.38.0. Record: vendor/README.md.
 *
 * Both incidents are ABSENCE-shaped: a required key MISSING because the
 * producer had nothing honest to say. A blanket fail-closed guard would have
 * refused that traffic — a live capability outage lasting a schema release
 * cycle, twice, caused by the guard rather than by a defect.
 *
 * The hazard the guard actually exists to stop is the opposite shape: a key
 * PRESENT carrying a corrupt value, which a consumer can read as a real
 * measurement. That class has never once been observed firing (Render logs,
 * both environments, full 29-day retention, positive-controlled: zero
 * `enrichment_contract_mismatch` events).
 *
 * So the line this suite pins is ABSENCE-vs-PRESENCE, not strict-vs-lenient:
 *   - ABSENCE-shaped  → unchanged, fail-open, disclose only. The two historical
 *                       incidents keep shipping exactly as they did.
 *   - PRESENCE-shaped → the corrupt UNIT is WITHHELD from the wire, and the
 *                       withholding is disclosed explicitly so the resulting
 *                       absence can never be misread as the semantic "not
 *                       computed" / "suppressed" that this envelope's own
 *                       doctrine attaches to a missing key.
 *
 * Withholding granularity mirrors the house precedent
 * (EDGE_E_VALUE_NON_FINITE_DROPPED drops the bad ROW, keeps the family):
 * a top-level ARRAY family loses only the offending ROW; anything else loses
 * the TOP-LEVEL KEY, because a nested object block whose interior is corrupt
 * cannot be vouched for piecewise.
 *
 * PII discipline is unchanged and load-bearing: classification reads zod's
 * `received` discriminator but NEVER stores it — for `invalid_enum_value`,
 * `received` IS the corrupted value.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessEnrichmentContract,
  withheldUnitsFor,
  applyEnrichmentWithholding,
  buildEnrichmentContractWarning,
} from '../src/routes/v2/enrichment-egress-guard.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const realFixture = () =>
  JSON.parse(
    readFileSync(join(REPO_ROOT, 'tests', 'golden', 'pricing-canary', 'plot-response.json'), 'utf8'),
  );

// Distinctive, greppable corrupt values so leak assertions are unambiguous.
const CORRUPT_ENUM = 'banana_leak_canary';
const CORRUPT_NUMBER_AS_STRING = 'NOT-A-NUMBER-leak-canary';

describe('issue classification — absence-shaped vs presence-shaped', () => {
  it('a MISSING required key is classified absent:true (the historical false-alarm shape)', () => {
    // flip_thresholds rows require factor_id/factor_label/current_value/... —
    // an empty row is exactly "producer had nothing honest to say".
    const a = assessEnrichmentContract({ flip_thresholds: [{}] });
    expect(a.ok).toBe(false);
    expect(a.issues.length).toBeGreaterThan(0);
    // Bind by identity: the specific path, not "some issue somewhere".
    const factorId = a.issues.find((i) => i.path === 'flip_thresholds.0.factor_id');
    expect(factorId, 'flip_thresholds.0.factor_id must be reported').toBeDefined();
    expect(factorId!.absent).toBe(true);
    // EVERY issue on an empty-row body is absence-shaped.
    expect(a.issues.every((i) => i.absent)).toBe(true);
  });

  it('a PRESENT wrong-typed value is classified absent:false', () => {
    const a = assessEnrichmentContract({ decision_evpi: CORRUPT_NUMBER_AS_STRING });
    expect(a.ok).toBe(false);
    const issue = a.issues.find((i) => i.path === 'decision_evpi');
    expect(issue, 'decision_evpi must be reported').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.absent).toBe(false);
  });

  it('a PRESENT bad enum is presence-shaped AND the corrupted value never enters the issue (PII)', () => {
    const a = assessEnrichmentContract({ confidence_tier: CORRUPT_ENUM });
    expect(a.ok).toBe(false);
    const issue = a.issues.find((i) => i.path === 'confidence_tier');
    expect(issue, 'confidence_tier must be reported').toBeDefined();
    expect(issue!.absent).toBe(false);
    // Positive control for the PII assertion: the PATH is present (so the
    // assertion is looking at real content) while the VALUE is absent.
    expect(JSON.stringify(a)).toContain('confidence_tier');
    expect(JSON.stringify(a)).not.toContain(CORRUPT_ENUM);
  });
});

describe('withheldUnitsFor — what a presence-shaped issue costs', () => {
  it('a corrupt ROOT SCALAR withholds exactly that top-level key', () => {
    const a = assessEnrichmentContract({ decision_evpi: CORRUPT_NUMBER_AS_STRING });
    expect(withheldUnitsFor(a)).toEqual(['decision_evpi']);
  });

  it('a corrupt TOP-LEVEL ARRAY ROW withholds only that row, never the family', () => {
    const body = realFixture();
    expect(Array.isArray(body.factor_sensitivity), 'fixture must carry factor_sensitivity').toBe(true);
    expect(body.factor_sensitivity.length).toBeGreaterThan(1);
    body.factor_sensitivity[1].influence_score = CORRUPT_NUMBER_AS_STRING;
    const a = assessEnrichmentContract(body);
    expect(a.ok).toBe(false);
    // The ROW, not the key: dropping the whole family over one bad row would
    // destroy healthy science (house precedent EDGE_E_VALUE_NON_FINITE_DROPPED).
    expect(withheldUnitsFor(a)).toEqual(['factor_sensitivity[1]']);
  });

  it('a corrupt value NESTED UNDER AN OBJECT KEY withholds that top-level key', () => {
    const body = realFixture();
    expect(body.robustness, 'fixture must carry robustness').toBeDefined();
    // `recommended_option_id` is a typed optional string on EnrichmentRobustnessSchema.
    body.robustness.recommended_option_id = { not: 'a string' };
    const a = assessEnrichmentContract(body);
    expect(a.ok).toBe(false);
    // No array index on the path, so the block loses integrity as a whole:
    // a nested object whose interior is corrupt cannot be vouched for piecewise.
    expect(withheldUnitsFor(a)).toEqual(['robustness']);
  });

  it('⭐ ABSENCE-shaped issues withhold NOTHING — the 0.30.0 and 0.37.0 incidents keep shipping', () => {
    // The shape both historical false alarms had: a required key simply absent.
    const a = assessEnrichmentContract({ flip_thresholds: [{}] });
    expect(a.ok).toBe(false); // still DISCLOSED …
    expect(a.issues.every((i) => i.absent)).toBe(true);
    expect(withheldUnitsFor(a)).toEqual([]); // … and never REFUSED.
  });

  it('never withholds inference_warnings — that is the disclosure channel itself', () => {
    // A corrupt warning row is presence-shaped, but withholding it would delete
    // the surface the guard uses to tell anyone what happened.
    const a = assessEnrichmentContract({ inference_warnings: [{ code: 42, message: 'x', severity: 'warning' }] });
    expect(a.ok).toBe(false);
    expect(withheldUnitsFor(a)).toEqual([]);
  });

  it('⭐ never withholds a key whose ABSENCE hard-fails CEE — withholding must never be worse than disclosing', () => {
    // Derived from the CEE consumer manifest at olumi-assistants-service
    // staging `4c835ced`, NOT assumed:
    //   - option_comparison / results — plot-client.ts:88-92 refines that one of
    //     the two must be present and non-empty; absence => PLOT_RESPONSE_MALFORMED
    //     => cause_kind 'plot_error' => user-visible HTTP 500 with NO fact
    //     persisted. Withholding would destroy the whole turn to hide one bad
    //     field, and CEE already fail-closes on the dangerous numeric case here
    //     (its own NaN/Infinity integrity guard, run-analysis.ts:759-786).
    //   - analysis_status — readAnalysisStatus (run-analysis.ts:1167) drives the
    //     status ladder; absence degrades the turn to 'unknown'.
    for (const key of ['option_comparison', 'analysis_status', 'results', 'inference_warnings']) {
      const a = assessEnrichmentContract({ [key]: 12345 });
      expect(a.ok, `${key} corruption must still be DETECTED`).toBe(false);
      expect(withheldUnitsFor(a), `${key} must never be withheld`).toEqual([]);
    }
  });

  it('⭐ DOES withhold the UI-transported family CEE never reads — where corruption becomes a user-visible lie', () => {
    // Same manifest: these are on CEE's P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP
    // (compose.ts:571-678) and are copied to the UI verbatim by a dynamic loop
    // (compose.ts:882-919) with ZERO behavioural readers CEE-side. Nothing
    // downstream validates them, so PLoT withholding them costs CEE nothing and
    // is the only thing standing between a corrupt number and a user.
    for (const key of ['decision_evpi', 'correlation_model']) {
      const a = assessEnrichmentContract({ [key]: CORRUPT_NUMBER_AS_STRING });
      expect(a.ok, `${key} corruption must be detected`).toBe(false);
      expect(withheldUnitsFor(a), `${key} must be withheld`).toEqual([key]);
    }
  });

  it('a clean body withholds nothing', () => {
    const a = assessEnrichmentContract(realFixture());
    expect(a.ok).toBe(true);
    expect(withheldUnitsFor(a)).toEqual([]);
  });
});

describe('applyEnrichmentWithholding — the guard actually bites', () => {
  it('drops the corrupt ROW and keeps every healthy sibling (bound by factor identity)', () => {
    const body = realFixture();
    const victimId = body.factor_sensitivity[1].factor_id;
    const survivorIds = body.factor_sensitivity
      .filter((_: unknown, i: number) => i !== 1)
      .map((f: { factor_id: string }) => f.factor_id);
    expect(typeof victimId, 'fixture rows must carry factor_id for identity binding').toBe('string');
    expect(survivorIds.length).toBeGreaterThan(0);
    expect(survivorIds, 'the victim id must be unique for identity binding').not.toContain(victimId);

    body.factor_sensitivity[1].influence_score = CORRUPT_NUMBER_AS_STRING;
    const withheld = applyEnrichmentWithholding(body, assessEnrichmentContract(body));

    expect(withheld).toEqual(['factor_sensitivity[1]']);
    const remainingIds = body.factor_sensitivity.map((f: { factor_id: string }) => f.factor_id);
    // Bound by IDENTITY, not by count or by a value predicate another row
    // could satisfy: the named factor is gone and every other one survived.
    expect(remainingIds).not.toContain(victimId);
    expect(remainingIds).toEqual(survivorIds);
    // The corrupt value is gone from the wire entirely.
    expect(JSON.stringify(body)).not.toContain(CORRUPT_NUMBER_AS_STRING);
  });

  it('drops the corrupt TOP-LEVEL KEY and leaves the rest of the body intact', () => {
    const body = realFixture();
    const beforeKeys = Object.keys(body).filter((k) => k !== 'decision_evpi');
    body.decision_evpi = CORRUPT_NUMBER_AS_STRING;

    const withheld = applyEnrichmentWithholding(body, assessEnrichmentContract(body));

    expect(withheld).toEqual(['decision_evpi']);
    expect('decision_evpi' in body).toBe(false);
    expect(Object.keys(body)).toEqual(beforeKeys);
    expect(JSON.stringify(body)).not.toContain(CORRUPT_NUMBER_AS_STRING);
  });

  it('⭐ leaves an ABSENCE-shaped-only body byte-identical — no honest traffic is ever refused', () => {
    const body = { flip_thresholds: [{}], analysis_status: 'computed' };
    const before = JSON.stringify(body);
    const withheld = applyEnrichmentWithholding(body, assessEnrichmentContract(body));
    expect(withheld).toEqual([]);
    expect(JSON.stringify(body)).toBe(before);
  });

  it('leaves a CLEAN body byte-identical (no mutation on the healthy path)', () => {
    const body = realFixture();
    const before = JSON.stringify(body);
    const withheld = applyEnrichmentWithholding(body, assessEnrichmentContract(body));
    expect(withheld).toEqual([]);
    expect(JSON.stringify(body)).toBe(before);
  });

  it('the withheld body PARSES CLEAN afterwards — withholding removes the violation, not just the symptom', () => {
    const body = realFixture();
    body.decision_evpi = CORRUPT_NUMBER_AS_STRING;
    applyEnrichmentWithholding(body, assessEnrichmentContract(body));
    // Re-assess the delivered body: the presence-shaped violation is gone.
    const after = assessEnrichmentContract(body);
    expect(withheldUnitsFor(after)).toEqual([]);
    expect(after.ok).toBe(true);
  });
});

describe('disclosure — a withheld field is never mistaken for an honest absence', () => {
  it('the warning NAMES the withheld unit and drops the fail-open wording', () => {
    const a = assessEnrichmentContract({ decision_evpi: CORRUPT_NUMBER_AS_STRING });
    const w = buildEnrichmentContractWarning(a, ['decision_evpi']);
    expect(w.code).toBe('ENRICHMENT_CONTRACT_MISMATCH');
    expect(w.message).toContain('decision_evpi');
    expect(w.message).toMatch(/withheld/i);
    // The old copy promised delivery was unaffected. When a unit is withheld
    // that sentence would be false, and a false disclosure is worse than none.
    expect(w.message).not.toMatch(/Delivery is unaffected/i);
    expect(w.message).not.toContain(CORRUPT_NUMBER_AS_STRING);
  });

  it('with NOTHING withheld the warning still states the fail-open outcome', () => {
    const a = assessEnrichmentContract({ flip_thresholds: [{}] });
    const w = buildEnrichmentContractWarning(a, []);
    expect(w.message).toMatch(/Delivery is unaffected/i);
    expect(w.message).not.toMatch(/withheld/i);
  });
});
