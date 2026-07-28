/**
 * ⭐ DERIVED CENSUS — every surface still using the STAMP-ONLY lever predicate.
 *
 * ## Why this exists, and what it is atoning for
 *
 * There are two lever predicates in this codebase (`src/lib/intervention-override.ts`):
 *
 *   · the **D-U union** (`isOptionControlledLever` / `interventionTargetIdsFromOptions`)
 *     — canonical: a factor ANY option intervenes on is a lever, stamped or not;
 *   · the **ISL stamp** (`isInterventionOverride` / `filterInterventionOverrides`
 *     / `interventionOverrideFactorIds`) — a SYMPTOM, which **under-covers**. ISL
 *     stamps only elasticity≈0 first-option pins, so a lever pinned by a
 *     non-first option arrives unstamped with a nonzero measured elasticity and
 *     survives the filter (the live `fac_salary_cost` case,
 *     `intervention-override.ts:9-15`).
 *
 * Family-4 S1b moved `decision_brief.top_drivers` off the stamp and onto
 * `driver_order.lever_ids`. The other stamp-only sites were left in place, out
 * of scope — and the PROJECTION REGISTER in `src/lib/driver-order.ts` recorded
 * that fact as a **hand-written sentence naming two of them.**
 *
 * ⚠ **That sentence was wrong the moment it was written**: an adversarial review
 * of PR #288 found at least four more. It was the exact defect this codebase
 * names as its dominant one — *"a list a human must remember to sync WILL drift,
 * and the drift reads as complete"* (CLAUDE.md trap 12) — reproduced inside the
 * register that exists to prevent it, and wrong at birth rather than by decay.
 *
 * So the census is no longer prose. It is EXTRACTED from the sources here, and
 * this spec fails loud in BOTH directions:
 *
 *   · a file that starts using the stamp-only predicate ⇒ RED (a new surface
 *     cannot quietly join the under-covering set);
 *   · a file that stops ⇒ RED (so a slice that migrates one to the D-U union
 *     must delete its row, and the register cannot claim a debt already paid).
 *
 * ## ⛔ This spec asserts NOTHING about whether stamp-only is correct
 *
 * Several of these sites may be perfectly fine — some are mitigated on the
 * primary path because the merge already applied the D-U union upstream. This
 * spec makes the SET visible and stable; adjudicating each row is the later
 * slice `lever_policy: 'stamp_only'` was reserved for.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** The stamp-only predicate surface. The D-U union members are NOT here. */
const STAMP_ONLY_IDENTIFIERS = [
  'isInterventionOverride',
  'filterInterventionOverrides',
  'interventionOverrideFactorIds',
] as const;

/**
 * Modules that DEFINE or RE-EXPORT the predicate rather than consuming it.
 * Naming a definition site as a consumer would be noise; these are structural
 * and a reviewer can check them in one line.
 */
const DEFINITION_MODULES = new Set([
  'lib/intervention-override.ts', // the single definition
  'coaching/sensitivity-filter.ts', // a pure re-export shim
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Strip comments — a mention in prose is not a call site.
 *
 * ⚠ Deliberately does NOT strip imports or re-exports, and that is a finding
 * rather than an omission. An earlier revision did, until a mutant showed the
 * lines were **unfalsifiable**: breaking them changed no result, because
 * `import { X } from '…'` and `export { X } from '…'` can never contain the
 * form `X(` that the detector matches. Defensive code that cannot fail is the
 * same theatre this spec exists to hunt (CLAUDE.md trap 15 — *"your own script
 * is not exempt"*), so it is gone rather than kept for comfort. Import lines are
 * additionally moot here because a module that imports the predicate without
 * calling it is not a consumer.
 */
function executableText(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments (incl. JSDoc)
    .replace(/^\s*\/\/.*$/gm, ''); // line comments
}

/** @returns sorted `"<relative path>"` of every module that CALLS a stamp-only predicate. */
function deriveStampOnlyConsumers(): string[] {
  const hits = new Set<string>();
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split(/[\\/]/).join('/');
    if (DEFINITION_MODULES.has(rel)) continue;
    const body = executableText(readFileSync(file, 'utf8'));
    if (STAMP_ONLY_IDENTIFIERS.some((id) => new RegExp(`\\b${id}\\s*\\(`).test(body))) {
      hits.add(rel);
    }
  }
  return [...hits].sort();
}

/**
 * The census AS MEASURED at PR #288's head. Every row is a real call site,
 * derived and then reviewed — not a remembered list.
 *
 * ⚠ If this fails: do not "fix" it by editing this array to match. Work out
 * WHICH surface changed and whether it should have, then update the array and
 * the reason in the same commit.
 */
const EXPECTED_STAMP_ONLY_CONSUMERS: Readonly<Record<string, string>> = {
  'assembly/decision-brief.ts':
    'buildWhatWouldChange, the value-defaulted disclosure block, and the LEGACY fallback in buildTopDrivers (used only when driver_order is absent — the S1b path uses lever_ids).',
  'coaching/critiques.ts':
    'filters factor sensitivity before critique generation, and tests the stamp directly when classifying a factor.',
  'coaching/headlines.ts':
    'selects "tunable" factors for headline copy, twice.',
  'lib/factor-influence.ts':
    'MITIGATED — the stamp is OR-ed with the structural lever flag, so this site is effectively D-U at the call.',
  'routes/v2/run.ts':
    'the ISL-ingest filter in transformFactorSensitivity, and the evidence-priority review card.',
};

describe('stamp-only lever predicate — derived census', () => {
  it('positive control: the extraction finds real call sites across several modules', () => {
    const consumers = deriveStampOnlyConsumers();
    // An empty or near-empty result would make the comparison below vacuous.
    expect(consumers.length, 'extraction found nothing — the census is vacuous').toBeGreaterThan(2);
    // The definition module must be excluded, or every result is trivially "yes".
    expect(consumers).not.toContain('lib/intervention-override.ts');
  });

  /**
   * ⭐ This control was VACUOUS in its first revision, and a mutant caught it.
   *
   * It originally asserted only that `lib/driver-order.ts` — which mentions
   * these identifiers in prose — stays out of the derived set. But no comment in
   * this repo happens to contain the exact form `identifier(`, so **breaking
   * the comment stripper entirely still left that assertion green.** An absence
   * assertion that cannot see a presence is testing nothing (CLAUDE.md trap 13),
   * and this one was guarding the census's own discrimination.
   *
   * The stripper is now exercised DIRECTLY, on synthetic input built to contain
   * exactly what the real sources do not.
   */
  it('positive control: comment stripping works — a mention is not a call site, and a real call survives', () => {
    const mentionsOnly = [
      '/** doc: filterInterventionOverrides(rows) is the stamp-only filter */',
      '// note: isInterventionOverride(f) under-covers',
      '/*\n * multi-line: interventionOverrideFactorIds(rows)\n */',
      'export const unrelated = 1;',
    ].join('\n');
    const stripped = executableText(mentionsOnly);
    for (const id of STAMP_ONLY_IDENTIFIERS) {
      expect(
        new RegExp(`\\b${id}\\s*\\(`).test(stripped),
        `${id}: a mention in a comment was counted as a call site`,
      ).toBe(false);
    }

    // …and the stripper must NOT eat real code, or the census would report an
    // empty set and pass by finding nothing.
    const realCall = executableText('const t = filterInterventionOverrides(rows);');
    expect(/\bfilterInterventionOverrides\s*\(/.test(realCall)).toBe(true);
  });

  it('⭐ the set of stamp-only consumers is exactly the reviewed census — no additions, no silent departures', () => {
    expect(deriveStampOnlyConsumers()).toEqual(Object.keys(EXPECTED_STAMP_ONLY_CONSUMERS).sort());
  });

  it('every census row carries a reason a reviewer can check against the bytes', () => {
    for (const [file, reason] of Object.entries(EXPECTED_STAMP_ONLY_CONSUMERS)) {
      expect(reason.length, `${file}: reason too thin to be checkable`).toBeGreaterThan(30);
    }
  });

  it('⭐ decision_brief top_drivers is OFF the stamp on the S1b path — the debt this slice actually paid', () => {
    // The census row for decision-brief.ts must remain true for the LEGACY path
    // only. If `lever_ids` ever stops being consulted, this goes RED.
    const brief = readFileSync(join(SRC, 'assembly', 'decision-brief.ts'), 'utf8');
    expect(brief).toContain('new Set(driverOrder.lever_ids)');
  });
});
