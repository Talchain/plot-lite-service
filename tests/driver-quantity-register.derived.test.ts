/**
 * ⭐ THE DERIVED PRODUCER REGISTER GATE (family 4, amendment §3.2 leg 1).
 *
 * > *"a test that enumerates every numeric field on a driver-bearing row […]
 * > **from the schema objects themselves — never from a list** — and fails on
 * > any field that has no declared `{role, disposition, unit, sign}` entry. A
 * > new quantity is then a RED, not a silent fifteenth."*
 *
 * The instrument is `tools/derive-driver-quantities.mjs` (AST over the contract
 * type declarations, same dependency and same reasoning as
 * `tools/gen-structural-keys.mjs`). This spec is the fail-loud half.
 *
 * ## Why the vacuity controls come FIRST
 *
 * Every assertion here is of the form "the derived domain and the register
 * agree". Two sets agree trivially when both are empty — so an extraction that
 * silently returned nothing would turn this whole gate green while covering
 * nothing at all. That is the exact shape of the guarantee-theatre this family
 * exists to hunt, so the derivation is REQUIRED to throw rather than degrade,
 * and the controls below prove it does.
 */

import { describe, it, expect } from 'vitest';
import {
  DRIVER_QUANTITY_REGISTER,
  DRIVER_QUANTITY_EXEMPTIONS,
} from '../src/lib/driver-quantity-register.js';

const derive = await import('../tools/derive-driver-quantities.mjs');

describe('the register DOMAIN is derived from the contract types, and cannot silently shrink', () => {
  // -----------------------------------------------------------------------
  // VACUITY CONTROLS — trap 13. Prove the extraction can SEE something.
  // -----------------------------------------------------------------------
  it('positive control: the extraction finds a non-trivial domain across BOTH declared row types', () => {
    const fields = derive.deriveDriverQuantityFields();
    expect(fields.length, 'an empty domain would make every assertion below vacuous').toBeGreaterThan(5);
    const types = new Set(fields.map((f: any) => f.type));
    expect(types).toEqual(new Set(derive.DRIVER_ROW_TYPES.map((t: any) => t.type)));
  });

  it('positive control: the extraction reads TYPES, not names — it finds a NESTED quantity too', () => {
    // `confidence_components.sampling_stability` lives one level down inside an
    // inline object literal. A grep for `: number` at the top level would miss
    // it, and so would any hand-written list that forgot to recurse.
    const keys = derive.deriveDriverQuantityKeys();
    expect(keys).toContain('FactorSensitivityResultV3.confidence_components.sampling_stability');
  });

  it('positive control: it discriminates — non-numeric members are NOT in the domain', () => {
    const keys: string[] = derive.deriveDriverQuantityKeys();
    // If the extraction collected every property regardless of type, the gate
    // would be measuring the wrong thing (and would demand a `unit` for a
    // string id).
    for (const notAQuantity of [
      'FactorSensitivityResultV3.factor_id',
      'FactorSensitivityResultV3.direction',
      'FactorSensitivityResultV3.driver_label',
      'FactorSensitivityResultV3.attribution_stability',
      'EdgeSensitivityResultV3.interpretation',
    ]) {
      expect(keys, `${notAQuantity} is not a quantity`).not.toContain(notAQuantity);
    }
  });

  it('⛔ UNPARSEABLE FAILS LOUD — a missing type THROWS rather than yielding an empty domain', async () => {
    // The failure mode that would make this gate worthless: the type is renamed
    // or deleted, the extraction returns [], and "every derived field has an
    // entry" passes by testing nothing. Prove it throws instead.
    const original = [...derive.DRIVER_ROW_TYPES];
    try {
      derive.DRIVER_ROW_TYPES.length = 0;
      derive.DRIVER_ROW_TYPES.push({ file: 'src/types/engine-v3.ts', type: 'ThisTypeDoesNotExistV9' });
      expect(() => derive.deriveDriverQuantityFields()).toThrow(/not found/i);

      derive.DRIVER_ROW_TYPES.length = 0;
      derive.DRIVER_ROW_TYPES.push({ file: 'src/types/does-not-exist.ts', type: 'Whatever' });
      expect(() => derive.deriveDriverQuantityFields()).toThrow(/cannot read/i);
    } finally {
      derive.DRIVER_ROW_TYPES.length = 0;
      derive.DRIVER_ROW_TYPES.push(...original);
    }
    // …and the domain is intact afterwards, so this control cannot poison the
    // assertions that follow.
    expect(derive.deriveDriverQuantityFields().length).toBeGreaterThan(5);
  });

  // -----------------------------------------------------------------------
  // ⭐ THE GATE — both directions
  // -----------------------------------------------------------------------
  it('⭐ every derived numeric quantity has a declared {role, disposition, unit, sign} entry', () => {
    const keys: string[] = derive.deriveDriverQuantityKeys();
    const missing = keys.filter(
      (k) => !(k in DRIVER_QUANTITY_REGISTER) && !(k in DRIVER_QUANTITY_EXEMPTIONS),
    );
    expect(
      missing,
      `unregistered driver quantities — declare them in src/lib/driver-quantity-register.ts:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('⭐ and the reverse: no register entry names a field the contract no longer has', () => {
    // A stale row is the same defect facing the other way — it makes the
    // register read as complete while describing something that is gone.
    const keys = new Set<string>(derive.deriveDriverQuantityKeys());
    const stale = Object.keys(DRIVER_QUANTITY_REGISTER).filter((k) => !keys.has(k));
    expect(stale, `register rows for fields that no longer exist:\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('a quantity is registered OR exempt, never both — an exemption must not hide a live declaration', () => {
    const both = Object.keys(DRIVER_QUANTITY_REGISTER).filter((k) => k in DRIVER_QUANTITY_EXEMPTIONS);
    expect(both).toEqual([]);
  });

  it('exemptions are EMITTED as data (§3.2 point 3), never argued in prose', () => {
    // Empty today — and the emptiness is the claim. What matters is that the
    // mechanism EXISTS and is machine-readable, so "considered and excluded" is
    // distinguishable from "never found".
    expect(DRIVER_QUANTITY_EXEMPTIONS).toBeDefined();
    expect(typeof DRIVER_QUANTITY_EXEMPTIONS).toBe('object');
    for (const [key, value] of Object.entries(DRIVER_QUANTITY_EXEMPTIONS)) {
      expect(value.reason.length, `${key} must state its exclusion reason`).toBeGreaterThan(20);
    }
  });

  // -----------------------------------------------------------------------
  // ENTRY QUALITY — the part a type cannot state must actually be stated
  // -----------------------------------------------------------------------
  it('every entry states a REAL unit — "unknown" is a finding, not an answer', () => {
    for (const [key, entry] of Object.entries(DRIVER_QUANTITY_REGISTER)) {
      expect(entry.unit, `${key}: unit`).toBeTruthy();
      expect(entry.unit.toLowerCase(), `${key}: unit must not be a placeholder`).not.toMatch(
        /^(unknown|tbd|n\/a|todo)$/,
      );
      expect(entry.note.length, `${key}: note must be checkable against the bytes`).toBeGreaterThan(30);
    }
  });

  it('the two quantities that share the sensitivity_score/elasticity confusion are declared DIFFERENTLY', () => {
    // The family's sharpest live defect was elasticity published under the name
    // sensitivity_score — opposite sign, 2.84× apart, one response. If the
    // register described them identically it would not have caught it.
    const s = DRIVER_QUANTITY_REGISTER['FactorSensitivityResultV3.sensitivity_score'];
    const e = DRIVER_QUANTITY_REGISTER['FactorSensitivityResultV3.elasticity'];
    expect(s.unit).not.toBe(e.unit);
  });

  it('the DESIGNATIONS are declared as designations, not as measurements', () => {
    // §3.1: the harm is a designation published as a measurement (ISL's
    // importance_score was a linear function of rank). Ranks are ordinals.
    for (const key of [
      'FactorSensitivityResultV3.importance_rank',
      'FactorSensitivityResultV3.influence_rank',
      'EdgeSensitivityResultV3.importance_rank',
    ]) {
      expect(DRIVER_QUANTITY_REGISTER[key].role, key).toBe('designation');
      expect(DRIVER_QUANTITY_REGISTER[key].unit, key).toBe('rank_ordinal');
      expect(DRIVER_QUANTITY_REGISTER[key].sign, key).toBe('positive_ordinal');
    }
  });
});
