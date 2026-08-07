/**
 * ROADMAP 2.879 (4) — THE LINTER'S RECOMMENDED SET MUST ACTUALLY RESOLVE.
 *
 * `eslint.config.js` IMPORTED `@eslint/js` and never SPREAD it. The config
 * therefore resolved exactly FIVE rules for a `src/**` file, and the entire core
 * recommended set was absent — `no-dupe-keys` among them.
 *
 * That is not a style gap. A duplicate object key silently overriding a
 * `value_frame: 'delta'` stamp with `'level'` is a fabrication shape this very
 * chain produced by accident (recorded in CEE #862's body: "a duplicate object
 * key silently overrode 'delta' with 'level'"), and the linter that would have
 * caught it was structurally incapable of doing so. An unspread plugin import is
 * the hand-maintained-mirror defect (trap 12) in its purest form: the config
 * LOOKED like it enabled the recommended set, and enabled none of it — and
 * `npm run lint` was GREEN throughout, which is what made it invisible.
 *
 * ⚠ THIS GUARD IS DERIVED, NOT PINNED. It imports `@eslint/js` and asserts the
 * resolved config is a SUPERSET of whatever that package currently recommends.
 * A pinned COUNT would have to be hand-updated on every eslint upgrade and would
 * drift into exactly the mirror it exists to replace — and it would still pass
 * if the set changed membership while keeping its size.
 *
 * ⚠ AND IT PINS ITS OWN PRECONDITION (trap 13b, third face). A derived
 * superset check is vacuously true if the reference set is empty, so the test
 * asserts the reference is non-empty and names `no-dupe-keys` explicitly before
 * it can conclude anything. Without that, this guard would keep passing after an
 * upgrade that renamed or emptied `configs.recommended`.
 */

import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import js from '@eslint/js';

/** A source file the `**\/*.ts` block certainly matches. */
const SRC_FILE = 'src/lib/intervention-normaliser.ts';
/** A test file, which additionally picks up the relaxed override block. */
const TEST_FILE = 'tests/gates/eslint-config-resolution.test.ts';

async function resolvedRuleNames(file: string): Promise<string[]> {
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile(file);
  return Object.keys(config.rules ?? {});
}

describe('2.879 — eslint.config.js resolves the core recommended rule set', () => {
  it('PRECONDITION: @eslint/js still exposes a non-empty recommended set containing no-dupe-keys', () => {
    // Without this, every assertion below is vacuous.
    const recommended = Object.keys(js.configs.recommended.rules ?? {});
    expect(recommended.length).toBeGreaterThan(20);
    expect(recommended).toContain('no-dupe-keys');
  });

  it('DEFECT: no-dupe-keys resolves for src/ — the rule that would have caught the delta/level key collision', async () => {
    const rules = await resolvedRuleNames(SRC_FILE);
    expect(rules).toContain('no-dupe-keys');
  });

  it('DEFECT: EVERY rule @eslint/js recommends resolves for src/ — derived, so an upgrade cannot silently shrink it', async () => {
    const recommended = Object.keys(js.configs.recommended.rules ?? {});
    const resolved = new Set(await resolvedRuleNames(SRC_FILE));

    // `no-undef` is deliberately turned OFF for TypeScript — typescript-eslint's
    // own config does the same (`@typescript-eslint/eslint-plugin/dist/configs/
    // eslint-recommended-raw.js`, "ts(2304) & ts(2552)"). An explicitly disabled
    // rule is still RESOLVED, so it appears in `resolved` and needs no carve-out
    // here. The assertion is about the set being PRESENT, not about severity.
    const missing = recommended.filter((r) => !resolved.has(r));
    expect(missing).toEqual([]);
  });

  it('DEFECT: the recommended set reaches tests/ too — the override block must relax rules, not replace them', async () => {
    const recommended = Object.keys(js.configs.recommended.rules ?? {});
    const resolved = new Set(await resolvedRuleNames(TEST_FILE));

    const missing = recommended.filter((r) => !resolved.has(r));
    expect(missing).toEqual([]);
  });

  it("the repo's own overrides still win over the recommended defaults", async () => {
    const eslint = new ESLint();
    const config = await eslint.calculateConfigForFile(SRC_FILE);
    const rules = config.rules ?? {};

    // Spread order matters: `...js.configs.recommended.rules` must come FIRST so
    // these local decisions are not reverted by it. If someone moves the spread
    // below them, this reds.
    // `calculateConfigForFile` returns NUMERIC severities (2 === 'error'),
    // measured — not the string form written in the config file.
    expect(rules['no-empty']).toEqual([2, { allowEmptyCatch: false }]);
    // 'no-undef' is OFF by local decision, against the recommended 'error' —
    // severity 0, again numeric. This is the assertion that would red if the
    // spread were moved BELOW the local rules and clobbered them back to error.
    const noUndef = rules['no-undef'];
    expect(Array.isArray(noUndef) ? noUndef[0] : noUndef).toBe(0);
  });
});
