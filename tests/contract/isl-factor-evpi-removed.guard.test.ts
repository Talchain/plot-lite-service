/**
 * CROSS-REPO FAIL-LOUD GUARD (F3, ruling D-23.15).
 *
 * ISL removed the top-level `factor_evpi` wire field in ISL #103 (renamed:
 * the win-probability successor is `p_win_sensitivity`; the real outcome-unit
 * value of partial perfect information is `factor_evppi`). PLoT's old
 * evidence-ranking consumer read `islResult.factor_evpi` and, finding it
 * absent on every current-generation response, SILENTLY fell back to the
 * VOI×spread heuristic — a consumer stranded by a producer rename with zero
 * signal. This guard makes that class of drift LOUD:
 *
 *   PLoT source must NOT read the removed `factor_evpi` name as a wire field.
 *
 * DERIVE-DON'T-MIRROR: this scans the live `src/` tree (not a hand-maintained
 * list) and fails when the removed name reappears as a property read. It is
 * the runtime companion to the COMPILE-TIME pin
 * `src/types/isl-no-factor-evpi.type-pin.ts` (which fails `tsc` if the field
 * is re-declared on ISLRobustnessAnalyzeV2Response). Both are needed because
 * run.ts types `islResult` as `any`, so the type pin alone cannot see an
 * untyped read.
 *
 * The new outcome-unit `factor_evppi` is deliberately NOT wired into the
 * win-probability `evpi_percentage_points` ranking surface (unit mismatch;
 * withheld pending the S5 typed-surface reconciliation, D-23.8). It rides the
 * raw top-level passthrough only.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** Recursively collect every .ts file under src/. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * True for a PURE comment line (JSDoc/banner or full-line `//`). We skip these
 * so a historical reference to the old name inside a doc-comment (e.g.
 * "honestly-named successor to factor_evpi") counts as provenance, not a live
 * consumer. We deliberately DO NOT try to strip string literals — naive
 * string-stripping mangles a large real file (regex literals, apostrophes in
 * comments) and silently deletes the very tokens we scan for. The CONSUMER
 * regex below is precise enough (dot-access / object-key read) that ordinary
 * prose never matches it, so line-level comment skipping is sufficient.
 */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/');
}

// A read/consume of the OLD name: `.factor_evpi` (dot access), `factor_evpi:`
// (object-key read/bind), or `['factor_evpi']` / `["factor_evpi"]` (bracket /
// dynamic access) — but NEVER `factor_evpi` immediately followed by another
// letter/digit/underscore (so `factor_evppi` never matches). Bracket coverage
// closes the dynamic-access gap (e.g. `islResult['factor_evpi']`) that a
// dot-only matcher would miss. NOTE: a bare-token scan is deliberately NOT used
// — it would false-positive on this guard's own compile-time sibling
// (isl-no-factor-evpi.type-pin.ts references `'factor_evpi'` to FORBID it) and
// on legitimate historical trailing-comment provenance.
// D-23.19 (Codex re-confirm F3): two SHORTHAND-DESTRUCTURING branches added —
// `const { factor_evpi } = isl` has no dot, no colon, no bracket, so the
// original three branches missed it (Codex's positive-control attack).
//   [{,]\s*factor_evpi\s*(?=[,}=])  — same-line shorthand ({ factor_evpi },
//                                     { factor_evpi, x }, { factor_evpi = d })
//   ^\s*factor_evpi\s*(?=[,}=])     — multiline destructure/object lines that
//                                     START with the bare name
// Both require [,}=] AFTER the name, so the type-pin's `factor_evpi?: never`
// (the `?` intervenes) and `factor_evppi` (trailing guard) still never match.
const OLD_NAME_CONSUMER =
  /(?:\.\s*factor_evpi|\bfactor_evpi\s*:|\[\s*['"]factor_evpi['"]\s*\]|[{,]\s*factor_evpi\s*(?=[,}=])|^\s*factor_evpi\s*(?=[,}=]))(?![A-Za-z0-9_])/;
// The retained successor as a bare token — present in src as the field name
// `factor_evppi` (engine-v3.ts) and the passthrough key (run-contract-keys.ts).
const NEW_NAME_TOKEN = /\bfactor_evppi\b/;

describe('F3 fail-loud guard — PLoT must not consume the removed ISL `factor_evpi` wire field', () => {
  const files = collectTsFiles(SRC_DIR);

  it('positive control: the matcher discriminates old-name reads (dot/key/bracket) from the new names (not vacuous)', () => {
    // MUST see a genuine old-name read in every access form...
    expect(OLD_NAME_CONSUMER.test('const x = isl.factor_evpi;')).toBe(true);
    expect(OLD_NAME_CONSUMER.test('return { factor_evpi: src.factor_evpi };')).toBe(true);
    expect(OLD_NAME_CONSUMER.test("const w = islResult['factor_evpi'];")).toBe(true);
    // D-23.19: shorthand destructuring — Codex's positive-control attack showed
    // `const { factor_evpi } = isl` evaded all three original branches.
    expect(OLD_NAME_CONSUMER.test('const { factor_evpi } = isl;')).toBe(true);
    expect(OLD_NAME_CONSUMER.test('const { factor_evpi, other } = isl;')).toBe(true);
    expect(OLD_NAME_CONSUMER.test('const { a, factor_evpi } = isl;')).toBe(true);
    expect(OLD_NAME_CONSUMER.test('const { factor_evpi = [] } = isl;')).toBe(true);
    expect(OLD_NAME_CONSUMER.test('  factor_evpi,')).toBe(true); // multiline destructure line
    // ...and MUST NOT fire on the retained new names (the p_win/EVPPI successors)
    // nor on the type-pin's forbidding declaration.
    expect(OLD_NAME_CONSUMER.test('const y = isl.factor_evppi;')).toBe(false);
    expect(OLD_NAME_CONSUMER.test("const y2 = isl['factor_evppi'];")).toBe(false);
    expect(OLD_NAME_CONSUMER.test('const z = isl.p_win_sensitivity;')).toBe(false);
    expect(OLD_NAME_CONSUMER.test('const { factor_evppi } = isl;')).toBe(false);
    expect(OLD_NAME_CONSUMER.test('  factor_evpi?: never;')).toBe(false); // type-pin form
  });

  it('positive control: the scan reaches real code (the retained successor `factor_evppi` IS present in src/)', () => {
    const anyNewName = files.some((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .some((line) => !isCommentLine(line) && NEW_NAME_TOKEN.test(line)),
    );
    expect(anyNewName).toBe(true);
  });

  it('no src file reads the removed `factor_evpi` name as a wire field', () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!isCommentLine(line) && OLD_NAME_CONSUMER.test(line)) {
            offenders.push(`${f.replace(SRC_DIR, 'src')}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders, `stranded consumer(s) of removed ISL field factor_evpi:\n${offenders.join('\n')}`).toEqual([]);
  });
});
