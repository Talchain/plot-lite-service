/**
 * ROADMAP 2.274 — `ISL_DECLARED_OBSERVED_STATE_FIELDS` is a mirror of another
 * repo's model. Make it fail LOUD.
 *
 * `toISLObservedState` projects a PLoT-internal `observed_state` onto the fields
 * ISL declares, using a hand-written allowlist. Anything absent from that list
 * is dropped SILENTLY — no warning, no metric, no type error. The list's own
 * comment used to concede this and stop there: "until [the drift pairing]
 * lands, this comment IS the disclosure." A comment is not an alarm; a list a
 * human must remember to sync WILL drift, and the drift always reads as green
 * (programme trap 12).
 *
 * The drift is silent in both directions:
 *  - ISL ADDS a field → PLoT quietly stops forwarding something ISL would accept;
 *  - ISL REMOVES one → PLoT resumes sending an undeclared key.
 *
 * ⚠ AND ONE ENTRY IS NOT A DEGRADATION BUT A CAPABILITY KILL. `baseline` is what
 * ISL needs to convert a `'level'` goal threshold
 * (`threshold − goal_baseline + goal_intercept`). Strip it and ISL refuses every
 * `'level'` threshold with `missing_goal_baseline` — the goal-probability
 * capability stops working outright, and NO type error is raised anywhere.
 *
 * This suite DERIVES the expected member set from ISL's own machine-generated
 * OpenAPI document, vendored and sha256-pinned under tests/fixtures/isl-pinned/.
 * That artifact is produced by ISL's `scripts/generate_openapi.py` from the
 * mounted Pydantic models and is checked by ISL CI on every PR touching them, so
 * it is ISL's description of itself — not a second hand-copy. Re-pin ISL and
 * this list must follow, or CI REDs.
 *
 * The other edge — list ↔ PLoT's own TS type — is pinned at COMPILE time in
 * translator-v3.ts (a `satisfies` clause plus an exhaustiveness type), which
 * `npm run build` enforces as a required check.
 */

import { describe, it, expect } from 'vitest';
import { ISL_DECLARED_OBSERVED_STATE_FIELDS } from '../src/integrations/isl/translator-v3.js';
import { loadOpenApi, loadPin, sha256File } from './helpers/isl-pinned-artifacts.js';

/** The members ISL's own OpenAPI declares on `ObservedState`, at the pinned sha. */
function islDeclaredObservedStateFields(): string[] {
  const doc = loadOpenApi();
  const schema = doc.components.schemas.ObservedState;
  const props = (schema?.properties ?? {}) as Record<string, unknown>;
  return Object.keys(props).sort();
}

describe('ISL_DECLARED_OBSERVED_STATE_FIELDS is derived from ISL, not remembered', () => {
  it('POSITIVE CONTROL: the pinned artifact is intact and actually declares ObservedState', () => {
    // An absence assertion needs to prove it can see a presence first (trap 13).
    // If the vendored spec were missing, empty, or renamed, every comparison
    // below would pass by comparing two empty lists.
    const pin = loadPin();
    expect(sha256File('tests/fixtures/isl-pinned/isl-openapi.json')).toBe(
      pin.artifacts.isl_openapi_json.sha256,
    );
    const declared = islDeclaredObservedStateFields();
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).toContain('value');
  });

  it('the allowlist matches ISL’s ObservedState EXACTLY — no member added or dropped', () => {
    // Set equality, both directions. An extra entry means PLoT would send a key
    // ISL no longer declares; a missing one means PLoT silently drops a field
    // ISL would accept.
    expect([...ISL_DECLARED_OBSERVED_STATE_FIELDS].sort()).toEqual(islDeclaredObservedStateFields());
  });

  it('`baseline` is on the list — dropping it does not degrade goal probability, it KILLS it', () => {
    // Named separately from the set-equality above on purpose. If someone ever
    // relaxes that assertion, this one still has to be deleted deliberately, and
    // deleting it means reading this sentence.
    expect(ISL_DECLARED_OBSERVED_STATE_FIELDS).toContain('baseline');
    expect(islDeclaredObservedStateFields()).toContain('baseline');
  });

  it('the list is what the projection actually uses — every declared field survives a round trip', () => {
    // Binds the assertions above to the RUNTIME behaviour. Without this, the
    // list could be correct and the projection could still use something else.
    const input: Record<string, unknown> = {};
    for (const f of ISL_DECLARED_OBSERVED_STATE_FIELDS) input[f] = 1;
    const projected = toISLObservedStateFor(input);
    expect(Object.keys(projected).sort()).toEqual([...ISL_DECLARED_OBSERVED_STATE_FIELDS].sort());
  });

  it('a field NOT on the list is dropped — the documented behaviour, pinned so a change is deliberate', () => {
    const projected = toISLObservedStateFor({ value: 1, metadata: { operator: '>=' } });
    expect(projected).toHaveProperty('value');
    expect(projected).not.toHaveProperty('metadata');
  });
});

// Imported lazily via a helper so the round-trip test reads clearly above.
import { toISLObservedState } from '../src/integrations/isl/translator-v3.js';

function toISLObservedStateFor(o: Record<string, unknown>): Record<string, unknown> {
  return (toISLObservedState(o) ?? {}) as Record<string, unknown>;
}
