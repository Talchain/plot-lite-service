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
 * ---------------------------------------------------------------------------
 * ⚠ WHY THIS IS AN AST WALK AND NO LONGER A LINE REGEX (Codex round-3, P2).
 * ---------------------------------------------------------------------------
 * The previous matcher was a per-line regular expression. Round 2 had already
 * patched it once for shorthand destructuring; round 3 found the next hole in
 * the same class — a MULTILINE destructure:
 *
 *     const {
 *       factor_evpi
 *     } = islResult;
 *
 * The bare name sits alone on its line with no trailing `,`/`}`/`=`, so every
 * same-line lookahead branch missed it. That miss was reproduced at the bytes
 * before this rewrite: the read above, planted in `src/integrations/isl/
 * v2-envelope.ts`, left the old guard passing 3/3 — a stranded consumer, live
 * in src, invisible to its own guard. The AST walker fails on that same plant,
 * naming `v2-envelope.ts:52 [destructuring-bind]`. That plant, not the synthetic
 * snippets, is the load-bearing proof this rewrite bites.
 *
 * Patching a regex per reported hole is the hand-maintained-mirror defect
 * (root CLAUDE.md trap #12) wearing a different hat: the list of syntactic
 * forms a human remembered to encode WILL drift from the syntax TypeScript
 * actually accepts, and the drift always reads as green. So the matcher is now
 * DERIVED from the parse tree — line breaks, whitespace, comments, string
 * literals, nesting and renaming all stop mattering, because we ask the
 * compiler what the code MEANS instead of what it LOOKS LIKE.
 *
 * (An ESLint rule was the other option Codex named. Same AST, but it would
 * need a custom-plugin package plus `eslint.config.js` wiring, and it would
 * move the check out of `npm test` — where this gate already runs — into a
 * separate lint lane. Rowed as an option if PLoT ever grows a family of these
 * cross-repo pins; not worth the scaffolding for one.)
 *
 * ---------------------------------------------------------------------------
 * ⚠⚠ ROUND-3 P2: THE AST REWRITE ABOVE WAS ITSELF BYPASSABLE. Read this before
 * "simplifying" the broad net away.
 * ---------------------------------------------------------------------------
 * The first AST version matched SYNTACTIC SHAPES (property access, element
 * access with a literal key, binding elements, …). Codex defeated all of them
 * with one move — put the name in a variable:
 *
 *     const OLD = 'factor_evpi' as const; islResult[OLD];
 *     const OLD = 'factor_evpi' as const; const { [OLD]: x } = islResult;
 *     Reflect.get(islResult, 'factor_evpi');
 *
 * Reproduced at the bytes before this fix: all three returned ZERO findings —
 * the vector [0,0,0] Codex reported. The guard read as protection and did not
 * discriminate, which is worse than no guard because it buys false confidence.
 * That is the estate's dominant defect class, and this file had been carrying a
 * long comment about that class while being an instance of it.
 *
 * THE FIX, and why it is shaped this way: shape-matching is a losing game —
 * every new indirection is a new shape, and enumerating shapes is the
 * hand-maintained mirror again, one level up. So the NAME ITSELF is now
 * contraband in any runtime value position. That cannot be defeated by
 * indirection, because every indirection must still spell the name once
 * somewhere. The precise shape detectors are kept ONLY because they produce a
 * better failure message; the broad net is what actually holds the line.
 *
 * Consequence, accepted deliberately: a bare value-position string
 * `'factor_evpi'` is now a FINDING (it used to be a negative control here).
 * Every bypass begins as exactly that token.
 *
 * THE ONE FAILURE MODE AN AST WALK HAS THAT A TEXT SCAN DOES NOT, and why it is
 * already closed: `createSourceFile` is error-tolerant and never throws, so a
 * file the parser could not make sense of would yield no nodes and contribute
 * zero findings SILENTLY. It cannot happen here — `tsconfig.json` includes all
 * .ts under src recursively and excludes only node_modules/dist, so the set tsc
 * checks is the same set this walk collects (measured: 315 files each), and
 * `npm run typecheck` runs in both CI and `scripts/pre-push-validate.sh`. An
 * unparseable src file fails tsc long before it reaches this guard.
 * Deliberately NOT re-asserted here: a "every file yields ≥1 statement" check
 * would fire on a legitimate comment-only module (measured: comment-only source
 * parses to zero statements), i.e. it would be a broken alarm guarding
 * something an existing derived gate already guarantees.
 *
 * WHAT THIS GUARD DELIBERATELY DOES NOT FLAG: a `factor_evpi` PropertySignature
 * in a type/interface declaration, and the bare string literal in the type
 * pin's `Extract<..., 'factor_evpi'>`. Re-DECLARATION of the field is the
 * compile-time pin's job; flagging it here would fail on the very file that
 * forbids it. This guard owns READS.
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
import ts from 'typescript';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** The removed ISL wire field this guard exists to keep out of PLoT src. */
const REMOVED_NAME = 'factor_evpi';

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

interface Read {
  /** 1-indexed line of the offending read. */
  line: number;
  /** Which syntactic form matched — reported so a failure is actionable. */
  form: string;
  /** The source line, trimmed. */
  text: string;
}

/**
 * Return every READ of `name` in `source`, derived from the TypeScript parse
 * tree. Covers, by construction and regardless of formatting:
 *
 *   property access        isl.factor_evpi          isl?.factor_evpi
 *   element access         isl['factor_evpi']       isl["factor_evpi"]
 *   destructuring bind     const { factor_evpi } = isl          (any layout)
 *                          const { factor_evpi: alias } = isl
 *                          const { factor_evpi = fallback } = isl
 *                          const { robustness: { factor_evpi } } = isl
 *                          function f({ factor_evpi }) {}
 *   object-literal key     { factor_evpi: value }   { factor_evpi }
 *   destructuring assign   ({ factor_evpi } = isl)
 *
 * `createSourceFile` is error-tolerant, so a file that does not typecheck still
 * parses far enough to be scanned — this never silently skips a file.
 */
function findReads(fileName: string, source: string, name: string): Read[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS);
  // Keyed by source position so the broad net and the shape detectors cannot
  // double-report the same token. A specific form (property-access,
  // destructuring-bind, …) overwrites the generic `value-position-name`,
  // because the specific label is the more useful failure message.
  const found = new Map<number, Read>();

  const record = (node: ts.Node, form: string): void => {
    const pos = node.getStart(sf);
    const existing = found.get(pos);
    if (existing && existing.form !== 'value-position-name') return;
    const { line } = sf.getLineAndCharacterOfPosition(pos);
    found.set(pos, { line: line + 1, form, text: (sf.text.split('\n')[line] ?? '').trim() });
  };

  /** True for an identifier or string-literal key whose text is the hunted name. */
  const isHuntedKey = (node: ts.Node | undefined): boolean =>
    node !== undefined && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === name;

  /**
   * TYPE-ONLY position — the removed name is allowed to appear here, because
   * re-DECLARATION is the compile-time pin's job (see header). Derived from node
   * kinds, NOT from a filename allowlist: the type pin's
   * `Extract<keyof R, 'factor_evpi'>` sits inside a TypeNode and is excluded
   * structurally, so no file is ever exempted by name.
   */
  const isTypeOnlyPosition = (node: ts.Node): boolean => {
    for (let a: ts.Node | undefined = node.parent; a; a = a.parent) {
      if (ts.isTypeNode(a) || ts.isInterfaceDeclaration(a) || ts.isPropertySignature(a)) return true;
    }
    return false;
  };

  const visit = (node: ts.Node): void => {
    // ── BROAD NET (Codex round-3 P2) ────────────────────────────────────────
    // Any occurrence of the removed name as a value-position string literal or
    // identifier. The precise detectors below match SYNTACTIC SHAPES, so they
    // are defeated by any indirection that moves the name out of the shape:
    //
    //   const OLD = 'factor_evpi' as const; islResult[OLD]           // const key
    //   const OLD = 'factor_evpi' as const; const { [OLD]: x } = isl // computed key
    //   Reflect.get(islResult, 'factor_evpi')                        // reflective
    //
    // All three returned ZERO findings from the shape-matchers — reproduced at
    // the bytes as [0,0,0], exactly as Codex reported. A guard you can step
    // around by renaming a variable is not a guard.
    //
    // So the name itself is now contraband in any runtime value position. This
    // is deliberately BROADER than "a read": it cannot be defeated by
    // indirection, because every indirection must still spell the name once.
    if (
      (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) &&
      node.text === name &&
      !isTypeOnlyPosition(node)
    ) {
      record(node, 'value-position-name');
    }

    if (ts.isPropertyAccessExpression(node) && node.name.text === name) {
      record(node.name, 'property-access');
    } else if (ts.isElementAccessExpression(node) && isHuntedKey(node.argumentExpression)) {
      record(node.argumentExpression, 'element-access');
    } else if (ts.isBindingElement(node)) {
      // `propertyName` is set only when the binding renames (`{ factor_evpi: a }`);
      // otherwise the bound `name` IS the property being read.
      const key = node.propertyName ?? node.name;
      if (isHuntedKey(key)) record(key, 'destructuring-bind');
    } else if (ts.isPropertyAssignment(node) && isHuntedKey(node.name)) {
      record(node.name, 'object-literal-key');
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === name) {
      // Covers both `{ factor_evpi }` in an object literal and the
      // destructuring-ASSIGNMENT form `({ factor_evpi } = isl)`, which the
      // parser represents as a shorthand property, not a binding element.
      record(node.name, 'shorthand-property');
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return [...found.values()].sort((a, b) => a.line - b.line);
}

/** Convenience: scan a synthetic snippet for the removed name. */
const reads = (source: string): Read[] => findReads('snippet.ts', source, REMOVED_NAME);
/** Positive-control helper: the snippet MUST produce at least one finding. */
const caught = (source: string): boolean => reads(source).length > 0;

describe('F3 fail-loud guard — PLoT must not consume the removed ISL `factor_evpi` wire field', () => {
  const files = collectTsFiles(SRC_DIR);

  it('⭐ positive control: THE INDIRECTION BYPASSES (Codex round-3 P2) — the shape-matchers alone returned [0,0,0]', () => {
    // These three are the reason the broad value-position net exists. Each
    // moves the name OUT of every syntactic shape the precise detectors match,
    // and each was reproduced at the bytes against the shipped shape-only
    // walker as ZERO findings — the vector Codex reported, [0,0,0].
    // A guard you can step around by renaming a variable is not a guard.
    expect(caught("const OLD_FIELD = 'factor_evpi' as const; const x = islResult[OLD_FIELD];")).toBe(true);
    expect(caught("const OLD_FIELD = 'factor_evpi' as const; const { [OLD_FIELD]: x } = islResult;")).toBe(true);
    expect(caught("const x = Reflect.get(islResult, 'factor_evpi');")).toBe(true);
    // Same class, not in Codex's list — indirection via a lookup table, a
    // template literal, and an aliased reflective read.
    expect(caught("const KEYS = { old: 'factor_evpi' }; const x = islResult[KEYS.old];")).toBe(true);
    expect(caught("const x = islResult[`factor_evpi`];")).toBe(true);
    expect(caught("const get = Reflect.get; const x = get(islResult, 'factor_evpi');")).toBe(true);
  });

  it('positive control: every direct read form, including the multiline destructure', () => {
    // Round-1 forms.
    expect(caught('const x = isl.factor_evpi;')).toBe(true);
    expect(caught('const x = isl?.factor_evpi;')).toBe(true);
    expect(caught("const w = islResult['factor_evpi'];")).toBe(true);
    expect(caught('const w = islResult["factor_evpi"];')).toBe(true);
    expect(caught('return { factor_evpi: src.other };')).toBe(true);

    // Round-2 form (shorthand destructuring, same line).
    expect(caught('const { factor_evpi } = isl;')).toBe(true);
    expect(caught('const { factor_evpi, other } = isl;')).toBe(true);
    expect(caught('const { a, factor_evpi } = isl;')).toBe(true);
    expect(caught('const { factor_evpi = [] } = isl;')).toBe(true);
    expect(caught('const { factor_evpi: alias } = isl;')).toBe(true);

    // Round-3 multiline forms — the two the previous REGEX missed (measured:
    // the only 2 of these direct forms it missed; the rest it also caught, so
    // they are regression coverage, not evidence for that rewrite).
    expect(caught('const {\n  factor_evpi\n} = islResult;')).toBe(true);
    expect(caught('const {\n  factor_evpi\n    : alias\n} = islResult;')).toBe(true);

    expect(caught('const {\n  factor_evpi,\n  other,\n} = islResult;')).toBe(true);
    expect(caught('const { robustness: { factor_evpi } } = isl;')).toBe(true);
    expect(caught('function f({ factor_evpi }) { return factor_evpi; }')).toBe(true);
    expect(caught('({ factor_evpi } = isl);')).toBe(true);
    expect(caught('const x = isl\n  .factor_evpi;')).toBe(true);
  });

  it('negative control: the walker does NOT fire on the successors, on comments, or on the type pin', () => {
    // The retained successors must never trip the guard.
    expect(reads('const y = isl.factor_evppi;')).toEqual([]);
    expect(reads("const y2 = isl['factor_evppi'];")).toEqual([]);
    expect(reads('const { factor_evppi } = isl;')).toEqual([]);
    expect(reads('const z = isl.p_win_sensitivity;')).toEqual([]);

    // Provenance prose is not a consumer — and unlike the regex, the AST never
    // sees comment text at all, so this holds for any comment shape.
    expect(reads('// honestly-named successor to factor_evpi')).toEqual([]);
    expect(reads('/** reads factor_evpi and isl.factor_evpi */')).toEqual([]);
    // ⚠ DELIBERATE WIDENING (Codex round-3 P2) — a bare value-position string
    // used to be a negative control here ("not an access, so harmless"). It is
    // now a POSITIVE one, and that reclassification is the whole fix: every
    // indirection bypass BEGINS as exactly this token. Treating it as harmless
    // is what made the guard steppable. Asserted in the bypass block above; the
    // line is kept here so the change of verdict is visible, not silent.
    expect(caught('const s = "factor_evpi";')).toBe(true);

    // Re-DECLARATION is the compile-time pin's job, not this guard's; flagging
    // it here would fail on the file whose whole purpose is forbidding the field.
    expect(reads('interface R { factor_evpi?: never }')).toEqual([]);
    expect(reads("type T = Extract<keyof R, 'factor_evpi'>;")).toEqual([]);
  });

  it('positive control: the scan reaches real src code (a live ISL field read IS found there)', () => {
    // Trap #13 — an absence assertion must first prove it can SEE a presence.
    // This runs the SAME walker over the REAL tree, hunting a field PLoT genuinely
    // reads (`islResult?.robustness?.edge_e_values` and friends). Non-zero here
    // proves: collectTsFiles found real files, they parsed, and the detector fires
    // on live source — not just on synthetic strings.
    // If this ever drops to zero, RE-ANCHOR it to another live read; do not delete it.
    expect(files.length).toBeGreaterThan(0);
    const liveReads = files.flatMap((f) => findReads(f, readFileSync(f, 'utf8'), 'edge_e_values'));
    expect(liveReads.length).toBeGreaterThan(0);
  });

  it('no src file reads the removed `factor_evpi` name as a wire field', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const r of findReads(f, readFileSync(f, 'utf8'), REMOVED_NAME)) {
        offenders.push(`${f.replace(SRC_DIR, 'src')}:${r.line} [${r.form}]: ${r.text}`);
      }
    }
    expect(offenders, `stranded consumer(s) of removed ISL field factor_evpi:\n${offenders.join('\n')}`).toEqual([]);
  });
});
