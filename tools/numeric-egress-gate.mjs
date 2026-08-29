#!/usr/bin/env node
/**
 * NUMERIC-EGRESS COERCION GATE
 * ============================================================================
 * Fails when a numeric field that PLoT's own wire contract declares is assigned
 * a LITERAL FALLBACK (`?? 0`, `|| 0`, `?? 0.5`, `?? 1.0`, …) instead of being
 * validated through `src/routes/v2/numeric-egress-guards.ts` and OMITTED when
 * the producer did not measure it.
 *
 * THE DEFECT CLASS THIS PREVENTS
 * -----------------------------------------------------------------------------
 * Absence coerced into a plausible value at a boundary. Missing and measured
 * share a representation, so the missing thing becomes a number — and the number
 * is then ranked, scored and shown to someone. Shipped instances:
 *   · `elasticity: fs.elasticity ?? fs.sensitivity_score ?? 0` — a DIFFERENT
 *     quantity substituted, then zeroed, feeding a card ranked by abs(elasticity)
 *   · `effective_sample_size ?? 0` — publishes "zero effective samples" for
 *     "ISL did not report"
 *   · `p10/p50/p90 ?? 0` — an option with no interval described to a review
 *     model as a degenerate zero distribution
 *   · `structural_certainty ?? 0.5` — 50% certainty asserted for a factor with
 *     no incoming edges
 * The correct shape is already in this repo: the guards return `undefined` so the
 * caller OMITS the field. See `numeric-egress-guards.ts` — "never clamp or
 * coerce; out-of-range is treated as 'not measured'".
 *
 * A MEASURED ZERO IS A REAL VALUE. This gate never pushes anyone toward dropping
 * genuine zeros — it fires on the SUBSTITUTION of a literal for an absent
 * measurement, never on the emission of a measured 0. `?? 0` on an array
 * `.length` / `.size` is a genuinely measured count and is exempt by derivation.
 *
 * WHY IT DOES NOT CRY WOLF (both axes DERIVED, neither hand-maintained)
 * -----------------------------------------------------------------------------
 * 1. FIELD AXIS — the vocabulary is derived from `contracts/` (openapi.yaml +
 *    the JSON Schemas): the set of property names the wire contract declares as
 *    `number`/`integer`. A name is in scope because the CONTRACT says it crosses
 *    the boundary as a number, not because anyone listed it. Counters and
 *    lengths (`node_count`, `edge_count`, `brief_length`, `sensitivity_count`)
 *    are excluded because the contract does not declare them — a derived
 *    exclusion, not a hand-list. New response fields enter the vocabulary
 *    automatically: the contract-drift gate already forces every runtime
 *    response key to be documented, so this gate inherits that guarantee.
 * 2. FILE AXIS — `src/routes/**` (egress by construction) UNION the transitive
 *    import closure of the route entry points parsed out of `src/createServer.ts`.
 *    Tools, tests and modules no route can reach are out of scope.
 * 3. Request-rooted defaults (`body.x ?? 4242`) are exempt: choosing a default
 *    for an input the CLIENT did not supply is not an egress fabrication.
 *
 * It parses with the TypeScript AST, not a regex — `run.ts` carries several
 * prose comments quoting `?? 0` while describing defects already fixed, and a
 * regex gate would fire on its own documentation.
 *
 * THE EXCEPTION LIST IS THE HONEST RETROFIT DEBT
 * -----------------------------------------------------------------------------
 * `tools/numeric-egress-exceptions.json` pins the violations that EXISTED when
 * this gate was written. It is not a suppression list — it is the bill.
 * It can only SHRINK: a NEW violation REDs, and so does a STALE entry, so a site
 * can only leave the list by being fixed in the same commit that de-lists it.
 *
 * Usage:  node tools/numeric-egress-gate.mjs [--json] [--list]
 * Exit 0 = pass · 1 = fail
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
// NEG_ROOT relocates the whole derivation (used by the gate's own tests to run
// against a throwaway worktree). Paths are reported relative to it, so an
// exception entry's identity is stable wherever the tree is checked out.
const ROOT = resolve(process.env.NEG_ROOT || resolve(__dirname, '..'));

// Vacuity floors. A blinded derivation must FAIL LOUD, never sail through on an
// empty set — an absence probe with no positive control proves nothing. These are
// plausibility floors, not targets: measured 200 / 283 when written.
const MIN_VOCAB = 50;
const MIN_FILES = 20;

const CONTRACTS_DIR = process.env.NEG_CONTRACTS_DIR || join(ROOT, 'contracts');
const SRC_DIR = process.env.NEG_SRC_DIR || join(ROOT, 'src');
const EXCEPTIONS_FILE = process.env.NEG_EXCEPTIONS_FILE || join(ROOT, 'tools', 'numeric-egress-exceptions.json');

const fail = (msg) => { console.error(`\n❌ NUMERIC-EGRESS GATE: ${msg}`); process.exit(1); };

/* ========================================================================== *
 * 1. FIELD AXIS — numeric vocabulary derived from the wire contract
 * ========================================================================== */

function numericNamesFromYaml(file) {
  const names = new Set();
  if (!existsSync(file)) return names;
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const key = /^(\s+)([A-Za-z_][A-Za-z0-9_]*):\s*$/.exec(lines[i]);
    if (!key) continue;
    const indent = key[1].length;
    // Only a SCALAR schema node counts. Walk the immediate child block and stop at
    // the first nested block key (a bare `name:`), so container nodes — `components`,
    // `schemas`, `properties`, and any object schema whose first numeric leaf happens
    // to sit a few lines below — never enter the vocabulary. Without this the gate
    // would flag a property named after a container and cry wolf.
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') continue;
      if (/^(\s*)/.exec(l)[1].length <= indent) break;
      if (/^\s*[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(l)) break;   // nested block ⇒ container
      if (/^\s*(-|\$ref:)/.test(l)) break;                     // list / $ref ⇒ not a scalar decl
      if (/^\s*type:\s*(number|integer)\s*$/.test(l)) { names.add(key[2]); break; }
    }
  }
  return names;
}

function numericNamesFromJsonSchema(node, names) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) numericNamesFromJsonSchema(n, names); return; }
  if (node.properties && typeof node.properties === 'object') {
    for (const [k, v] of Object.entries(node.properties)) {
      const t = v && v.type;
      const types = Array.isArray(t) ? t : [t];
      if (types.includes('number') || types.includes('integer')) names.add(k);
      numericNamesFromJsonSchema(v, names);
    }
  }
  for (const [k, v] of Object.entries(node)) if (k !== 'properties') numericNamesFromJsonSchema(v, names);
}

function deriveVocabulary() {
  const names = new Set();
  if (!existsSync(CONTRACTS_DIR)) fail(`contracts directory not found at ${CONTRACTS_DIR} — derivation is blind`);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
        for (const n of numericNamesFromYaml(p)) names.add(n);
      } else if (entry.endsWith('.json')) {
        try { numericNamesFromJsonSchema(JSON.parse(readFileSync(p, 'utf8')), names); } catch { /* non-schema JSON */ }
      }
    }
  };
  walk(CONTRACTS_DIR);
  return names;
}

/* ========================================================================== *
 * 2. FILE AXIS — src/routes/** ∪ transitive import closure of the entry points
 * ========================================================================== */

function parse(file) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function importSpecifiers(file) {
  const out = [];
  const visit = (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push(n.moduleSpecifier.text);
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword
        && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) out.push(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(parse(file));
  return out;
}

function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function tsFilesUnder(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function deriveEgressFiles() {
  // Egress by construction: everything under src/routes/.
  const routeFiles = tsFilesUnder(join(SRC_DIR, 'routes'));
  if (routeFiles.length === 0) fail(`no route files under ${join(SRC_DIR, 'routes')} — file derivation is blind`);

  // Plus everything a route can reach. Entry points are read out of
  // createServer.ts rather than listed here, so a new route module registered
  // there is picked up without touching this gate.
  const serverFile = join(SRC_DIR, 'createServer.ts');
  const entries = existsSync(serverFile)
    ? importSpecifiers(serverFile).filter((s) => s.includes('routes/'))
        .map((s) => resolveSpecifier(serverFile, s)).filter(Boolean)
    : [];

  const seen = new Set(routeFiles);
  const queue = [...routeFiles, ...entries];
  while (queue.length) {
    const f = queue.pop();
    for (const spec of importSpecifiers(f)) {
      const r = resolveSpecifier(f, spec);
      if (r && !seen.has(r) && r.startsWith(SRC_DIR)) { seen.add(r); queue.push(r); }
    }
  }
  return [...seen].sort();
}

/* ========================================================================== *
 * 3. SCAN — object-literal property whose key the contract declares numeric,
 *    fed by a literal substitution, DIRECTLY or through a local binding
 * ========================================================================== *
 *
 * TWO AXES, WIDENED TOGETHER (2026-08-29). Either alone leaves a live sibling
 * invisible, and a gate that cannot see the defect it was built for is a guard
 * agreeing with itself.
 *
 *   · FORM       `a ?? 0.5` · `a || 0.5` · `cond ? real : 0.5`.
 *                A ternary substitutes a literal for an absence exactly as `??`
 *                does. This gate's own header names the defect
 *                "structural_certainty ?? 0.5 — 50% certainty asserted for a
 *                factor with no incoming edges"; the site it describes
 *                (`src/lib/factor-influence.ts`) is written as a TERNARY, so
 *                the gate documented a defect it could not see.
 *                Both branches literal (`flag ? 1 : 0`) is a computed MAPPING,
 *                not a substitution, and stays out of scope.
 *
 *   · LAUNDERING one hop through a local `const`/`let` in the same file:
 *                `const sc = x ?? 0.5; return { structural_certainty: sc };`
 *                The lie is identical; only the AST shape differs. One hop, not
 *                a dataflow analysis — a second hop needs a type checker, and a
 *                gate that pretends to more reach than it has is worse than one
 *                whose limit is written down. Chained laundering is a known,
 *                stated blind spot.
 *
 * RESOLUTION IS BY SCOPE, NEVER BY NAME. `factor-influence.ts` declares two
 * different `structuralCertainty` locals in two different functions — one a
 * coercion, one not. A name-keyed lookup would answer for whichever it recorded
 * last: a verdict bound to its object by a predicate another object satisfies.
 * Candidates are filtered to those whose enclosing scope contains the use, and
 * the NARROWEST is taken.
 */

const unwrap = (n) => {
  let x = n;
  while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isAsExpression(x)) x = x.expression;
  return x;
};

/** The literal text if `n` is a numeric literal (optionally signed), else null. */
function literalFallback(n) {
  const x = unwrap(n);
  if (ts.isNumericLiteral(x)) return x.getText();
  if (ts.isPrefixUnaryExpression(x)
      && (x.operator === ts.SyntaxKind.MinusToken || x.operator === ts.SyntaxKind.PlusToken)
      && ts.isNumericLiteral(x.operand)) return x.getText();
  return null;
}

/** Terminal property name of an access chain: `a.b?.length` → "length". */
function terminalProperty(n) {
  const x = unwrap(n);
  if (ts.isPropertyAccessExpression(x)) return x.name.getText();
  if (ts.isBinaryExpression(x)) return terminalProperty(x.left);
  return null;
}

/** Root identifier of an access chain: `body.x?.y` → "body". */
function rootIdentifier(n) {
  let x = unwrap(n);
  for (;;) {
    if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) { x = unwrap(x.expression); continue; }
    if (ts.isBinaryExpression(x)) { x = unwrap(x.left); continue; }
    if (ts.isCallExpression(x)) { x = unwrap(x.expression); continue; }
    break;
  }
  return ts.isIdentifier(x) ? x.text : null;
}

// A default chosen for an input the CLIENT did not supply is not an egress
// fabrication — it is the documented default for an absent request field.
const REQUEST_ROOTS = new Set(['body', 'req', 'request', 'payload', 'input', 'params', 'query', 'opts', 'options']);

const normalise = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * A SUBSTITUTION: an expression that puts a numeric literal where an absent
 * value belongs. Returns `{ lit, value }` — `value` being the expression the
 * literal stands in for, which the exemptions below are asked about — or null.
 */
function substitution(node) {
  const e = unwrap(node);

  if (ts.isBinaryExpression(e)
      && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
       || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    const lit = literalFallback(e.right);
    return lit === null ? null : { lit, value: e.left };
  }

  if (ts.isConditionalExpression(e)) {
    const t = literalFallback(e.whenTrue);
    const f = literalFallback(e.whenFalse);
    // Both literal ⇒ a computed mapping (`flag ? 1 : 0`), not a substitution.
    // Neither literal ⇒ a choice between two real values.
    if (t !== null && f === null) return { lit: t, value: e.whenFalse };
    if (f !== null && t === null) return { lit: f, value: e.whenTrue };
    return null;
  }

  return null;
}

/** True when this substitution is one the gate deliberately does not fire on. */
function isExempt(sub) {
  const term = terminalProperty(sub.value);
  const root = rootIdentifier(sub.value);
  // `.length` / `.size` of an absent collection is a MEASURED zero.
  if (term === 'length' || term === 'size') return true;
  // A default chosen for an input the CLIENT did not supply is not an egress
  // fabrication — it is the documented default for an absent request field.
  if (root !== null && REQUEST_ROOTS.has(root)) return true;
  return false;
}

/**
 * The scope node a declaration belongs to: the nearest enclosing block, function
 * body, arrow body, case block, for-statement or source file.
 */
function enclosingScope(node) {
  let p = node.parent;
  while (p) {
    if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseBlock(p)
        || ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p)
        || ts.isModuleBlock(p) || ts.isArrowFunction(p)) return p;
    p = p.parent;
  }
  return node.getSourceFile();
}

/**
 * Every `const`/`let`/`var` in the file whose name is a plain identifier and
 * whose initializer is a substitution, recorded with the range of its scope so
 * a use site can be resolved by containment rather than by name.
 */
function collectCoercedLocals(sf) {
  const out = [];
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const sub = substitution(n.initializer);
      if (sub && !isExempt(sub)) {
        const scope = enclosingScope(n);
        out.push({
          name: n.name.text,
          lit: sub.lit,
          declLine: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          declText: normalise(n.getText()).slice(0, 160),
          scopeStart: scope.getStart(),
          scopeEnd: scope.getEnd(),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * The coerced local this identifier resolves to, or null. Candidates must share
 * the name AND contain the use position; the NARROWEST scope wins, so a
 * same-named sibling in another function can never answer for this one.
 */
function resolveCoercedLocal(locals, name, pos) {
  let best = null;
  for (const l of locals) {
    if (l.name !== name) continue;
    if (pos < l.scopeStart || pos > l.scopeEnd) continue;
    const span = l.scopeEnd - l.scopeStart;
    if (best === null || span < best.scopeEnd - best.scopeStart) best = l;
  }
  return best;
}

function scanFile(file, vocab) {
  const text = readFileSync(file, 'utf8');
  const sf = parse(file);
  const lines = text.split('\n');
  const locals = collectCoercedLocals(sf);
  const found = [];

  const record = (n, key, lit, via) => {
    const line = sf.getLineAndCharacterOfPosition(n.getStart()).line;
    found.push({
      file: relative(ROOT, file),
      key,
      fallback: lit,
      line: line + 1,
      snippet: normalise(n.getText()).slice(0, 160),
      source: normalise(lines[line]).slice(0, 160),
      ...(via ? { via } : {}),
    });
  };

  const visit = (n) => {
    // `{ structural_certainty: <expr> }`
    if (ts.isPropertyAssignment(n)) {
      const nameNode = n.name;
      const key = ts.isIdentifier(nameNode) ? nameNode.text
        : (ts.isStringLiteral(nameNode) ? nameNode.text : null);
      if (key && vocab.has(key)) {
        const init = unwrap(n.initializer);
        const direct = substitution(init);
        if (direct !== null) {
          if (!isExempt(direct)) record(n, key, direct.lit, null);
        } else if (ts.isIdentifier(init)) {
          const l = resolveCoercedLocal(locals, init.text, init.getStart());
          if (l) record(n, key, l.lit, `${l.declText}   (declared line ${l.declLine})`);
        }
      }
    }
    // `{ structural_certainty }` — key and local share a name.
    if (ts.isShorthandPropertyAssignment(n) && vocab.has(n.name.text)) {
      const l = resolveCoercedLocal(locals, n.name.text, n.getStart());
      if (l) record(n, n.name.text, l.lit, `${l.declText}   (declared line ${l.declLine})`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/* ========================================================================== *
 * 4. COMPARE against the shrinking exception list
 * ========================================================================== */

const idOf = (v) => `${v.file}|${v.key}|${v.snippet}`;

function main() {
  const args = process.argv.slice(2);
  const vocab = deriveVocabulary();
  if (vocab.size < MIN_VOCAB) {
    fail(`derived only ${vocab.size} numeric contract fields from ${relative(ROOT, CONTRACTS_DIR)} `
       + `(floor ${MIN_VOCAB}). The derivation is blind — this gate would pass vacuously. `
       + `Fix the derivation; do not lower the floor.`);
  }
  const files = deriveEgressFiles();
  if (files.length < MIN_FILES) {
    fail(`derived only ${files.length} egress files (floor ${MIN_FILES}). `
       + `The derivation is blind — this gate would pass vacuously.`);
  }

  const violations = [];
  for (const f of files) violations.push(...scanFile(f, vocab));
  violations.sort((a, b) => idOf(a).localeCompare(idOf(b)) || a.line - b.line);

  if (args.includes('--list')) {
    console.log(JSON.stringify({ vocabulary: vocab.size, files: files.length, violations }, null, 2));
    return;
  }

  let declared = [];
  if (existsSync(EXCEPTIONS_FILE)) {
    const raw = JSON.parse(readFileSync(EXCEPTIONS_FILE, 'utf8'));
    declared = raw.exceptions || [];
  }

  const count = (arr, k) => arr.reduce((m, x) => m.set(k(x), (m.get(k(x)) || 0) + 1), new Map());
  const actual = count(violations, idOf);
  const expected = count(declared, (d) => `${d.file}|${d.key}|${d.snippet}`);

  const added = [], stale = [];
  for (const [id, n] of actual) {
    const e = expected.get(id) || 0;
    if (n > e) added.push({ id, extra: n - e });
  }
  for (const [id, n] of expected) {
    const a = actual.get(id) || 0;
    if (n > a) stale.push({ id, extra: n - a });
  }

  console.log(`\nNumeric-egress coercion gate`);
  console.log(`  contract numeric fields derived : ${vocab.size}`);
  console.log(`  egress files derived            : ${files.length}`);
  console.log(`  violations found                : ${violations.length}`);
  console.log(`  retrofit debt pinned            : ${declared.length}`);

  if (added.length) {
    const newOccurrences = added.reduce((n, a) => n + a.extra, 0);
    console.error(`\n❌ ${newOccurrences} NEW numeric-egress coercion(s) at ${added.length} distinct site identit(y/ies):\n`);
    for (const { id, extra } of added) {
      // Identity is file|key|snippet, so two textually identical egress sites in
      // one file share an id. Print EVERY occurrence: printing only the first
      // under-reports the debt, and an under-reported bill is how a list stops
      // being the bill.
      const all = violations.filter((x) => idOf(x) === id);
      if (all.length > 1) console.error(`   (${extra} unpinned occurrence(s) of an identical egress expression)`);
      for (const v of all) {
        console.error(`   ${v.file}:${v.line}`);
        console.error(`      ${v.source}`);
        if (v.via) console.error(`      via local: ${v.via}`);
        console.error(`      '${v.key}' is a contract-declared numeric response field; '${v.fallback}' `
                    + `substitutes a value for an absent measurement.\n`);
      }
    }
    console.error(`   Validate through src/routes/v2/numeric-egress-guards.ts and OMIT the field when the`);
    console.error(`   producer did not measure it — a fabricated number is ranked, scored and shown to a user.`);
    console.error(`   A MEASURED zero is fine: the guards test finiteness and range, never truthiness.`);
  }
  if (stale.length) {
    console.error(`\n❌ ${stale.length} STALE exception(s) — the code no longer matches the pin:\n`);
    for (const { id } of stale) console.error(`   ${id.split('|')[0]}  ${id.split('|').slice(2).join('|')}`);
    console.error(`\n   If you FIXED these, delete their entries from ${relative(ROOT, EXCEPTIONS_FILE)} in the`);
    console.error(`   same commit — the debt list may only shrink, and it may not shrink silently.`);
  }
  if (added.length || stale.length) process.exit(1);

  console.log(`\n✅ No new numeric-egress coercions. Retrofit debt: ${violations.length} pinned site(s).`);
}

main();
