/**
 * GATE TEST — tools/numeric-egress-gate.mjs
 * ============================================================================
 * The gate stops the NEXT instance of this estate's largest defect class:
 * absence coerced into a plausible value at a boundary, where the fabricated
 * number is then ranked, scored and shown to someone.
 *
 * A guard is not a guard until something has been observed to turn it red, and
 * a single biting mutant proves sensitivity to SOMETHING, never binding to the
 * named thing. So every case below comes as a DISCRIMINATING PAIR: the same
 * fallback, in the same shape, differing only in the one property the gate
 * claims to key on.
 *
 * The fixtures are generated, not hand-written, and are large enough to clear
 * the gate's own vacuity floors — so these tests exercise the REAL floors
 * rather than a test-only escape hatch. There is deliberately no env override
 * for MIN_VOCAB / MIN_FILES.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = join(REPO, 'tools/numeric-egress-gate.mjs');

/** Run the gate against `root`. Never throws — returns the exit code and output. */
function runGate(root: string, extraEnv: Record<string, string> = {}) {
  try {
    const stdout = execFileSync('node', [GATE], {
      env: { ...process.env, NEG_ROOT: root, ...extraEnv },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: stdout };
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

let FIX: string;

/**
 * A synthetic repo: a contract declaring 60 numeric fields, 25 route files, one
 * off-path module, and an exceptions file pinning the single seeded violation.
 */
function buildFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'neg-gate-'));
  mkdirSync(join(dir, 'contracts'), { recursive: true });
  mkdirSync(join(dir, 'src/routes/v1'), { recursive: true });
  mkdirSync(join(dir, 'src/lib'), { recursive: true });
  mkdirSync(join(dir, 'tools'), { recursive: true });

  // --- contract: 60 numeric fields, clearing MIN_VOCAB=50.
  // `internal_probe_value` and `probe_count` are deliberately ABSENT — they are
  // the contrast controls for the field axis.
  const props = ['p05', 'win_probability', 'elasticity', 'n_samples']
    .concat(Array.from({ length: 56 }, (_, i) => `derived_metric_${i}`));
  writeFileSync(join(dir, 'contracts/openapi.yaml'),
    ['components:', '  schemas:', '    runResponseV3:', '      type: object', '      properties:']
      .concat(props.flatMap((p) => [`        ${p}:`, '          type: number']))
      .join('\n') + '\n');

  // --- 25 route files, clearing MIN_FILES=20.
  writeFileSync(join(dir, 'src/createServer.ts'),
    `export async function build() { await import('./routes/v1/index.js'); }\n`);
  writeFileSync(join(dir, 'src/routes/v1/index.ts'),
    Array.from({ length: 24 }, (_, i) => `import './mod${i}.js';`).join('\n')
    + `export const registerV1Routes = () => 1;\n`
    // The seeded pre-existing violation, pinned in the exceptions file below.
    + `export const seeded = (o: any) => ({ win_probability: o.win_probability ?? 0 });\n`);
  for (let i = 0; i < 24; i++) {
    writeFileSync(join(dir, `src/routes/v1/mod${i}.ts`), `export const mod${i} = () => ${i};\n`);
  }
  // Off-path: reachable from nothing the router registers.
  writeFileSync(join(dir, 'src/lib/offpath.ts'), `export const helper = () => 1;\n`);

  writeFileSync(join(dir, 'tools/numeric-egress-exceptions.json'), JSON.stringify({
    count: 1,
    exceptions: [{
      file: 'src/routes/v1/index.ts',
      key: 'win_probability',
      snippet: 'win_probability: o.win_probability ?? 0',
      line: 27,
      class: 'fabricated-probability',
    }],
  }, null, 2) + '\n');
  return dir;
}

/** Append a line to an in-fixture file, returning a restore function. */
function patch(file: string, append: string) {
  const p = join(FIX, file);
  const original = readFileSync(p, 'utf8');
  writeFileSync(p, original + append);
  return () => writeFileSync(p, original);
}

beforeAll(() => { FIX = buildFixture(); });
afterAll(() => { rmSync(FIX, { recursive: true, force: true }); });

describe('numeric-egress gate · control', () => {
  it('the pristine fixture PASSES — so every RED below is the mutation, not the fixture', () => {
    const r = runGate(FIX);
    expect(r.out).toContain('No new numeric-egress coercions');
    expect(r.code).toBe(0);
  });

  it('derives a non-empty vocabulary and file set (the gate is looking at something)', () => {
    const r = runGate(FIX);
    expect(r.out).toMatch(/contract numeric fields derived\s*:\s*60/);
    expect(r.out).toMatch(/egress files derived\s*:\s*2[5-9]/);
  });
});

describe('numeric-egress gate · FIELD AXIS (same file, same fallback, key differs)', () => {
  it('REDs on a contract-declared numeric field given a literal fallback, naming file and line', () => {
    const restore = patch('src/routes/v1/index.ts',
      `export const mutant = (o: any) => ({ p05: o.outcome.p05 ?? 0 });\n`);
    const r = runGate(FIX);
    restore();
    expect(r.code).toBe(1);
    expect(r.out).toContain('NEW numeric-egress coercion');
    expect(r.out).toContain('src/routes/v1/index.ts:');   // names the file
    expect(r.out).toMatch(/index\.ts:\d+/);                // names a line
    expect(r.out).toContain("'p05' is a contract-declared numeric response field");
  });

  it('stays GREEN on a key the contract does not declare — the twin of the case above', () => {
    const restore = patch('src/routes/v1/index.ts',
      `export const ok = (o: any) => ({ internal_probe_value: o.outcome.whatever ?? 0 });\n`);
    const r = runGate(FIX);
    restore();
    expect(r.out).toContain('No new numeric-egress coercions');
    expect(r.code).toBe(0);
  });
});

describe('numeric-egress gate · FILE AXIS (same key, same fallback, file differs)', () => {
  it('stays GREEN for the identical violation in a module no route can reach', () => {
    const restore = patch('src/lib/offpath.ts',
      `export const mutant = (o: any) => ({ p05: o.outcome.p05 ?? 0 });\n`);
    const r = runGate(FIX);
    restore();
    expect(r.out).toContain('No new numeric-egress coercions');
    expect(r.code).toBe(0);
  });
});

describe('numeric-egress gate · a MEASURED ZERO is not an absence', () => {
  it('stays GREEN on a literal measured zero — the gate fires on SUBSTITUTION, not on the value 0', () => {
    const restore = patch('src/routes/v1/index.ts',
      `export const measured = () => ({ p05: 0, win_probability: 0 });\n`);
    const r = runGate(FIX);
    restore();
    expect(r.out).toContain('No new numeric-egress coercions');
    expect(r.code).toBe(0);
  });

  it('stays GREEN on the CORRECT retrofit shape (guard result, field omitted when undefined)', () => {
    const restore = patch('src/routes/v1/index.ts',
      `export const good = (o: any, g: any) => ({\n`
      + `  p05: g.finiteNum(o.p05),\n`
      + `  ...(g.finiteNum(o.win_probability) !== undefined && { win_probability: g.finiteNum(o.win_probability) }),\n`
      + `});\n`);
    const r = runGate(FIX);
    restore();
    expect(r.out).toContain('No new numeric-egress coercions');
    expect(r.code).toBe(0);
  });

  it('stays GREEN on `?? 0` over an array .length — an absent collection genuinely has zero items', () => {
    const restore = patch('src/routes/v1/index.ts',
      `export const counted = (o: any) => ({ n_samples: o.samples?.length ?? 0 });\n`);
    const r = runGate(FIX);
    restore();
    expect(r.out).toContain('No new numeric-egress coercions');
    expect(r.code).toBe(0);
  });

  it('stays GREEN on a default for an input the CLIENT did not supply', () => {
    const restore = patch('src/routes/v1/index.ts',
      `export const req = (body: any) => ({ n_samples: body.n_samples ?? 5000 });\n`);
    const r = runGate(FIX);
    restore();
    expect(r.out).toContain('No new numeric-egress coercions');
    expect(r.code).toBe(0);
  });
});

describe('numeric-egress gate · the debt list may only shrink, and never silently', () => {
  it('REDs when an entry is DE-LISTED without the code being fixed', () => {
    const p = join(FIX, 'tools/numeric-egress-exceptions.json');
    const original = readFileSync(p, 'utf8');
    writeFileSync(p, JSON.stringify({ count: 0, exceptions: [] }, null, 2));
    const r = runGate(FIX);
    writeFileSync(p, original);
    expect(r.code).toBe(1);
    expect(r.out).toContain('NEW numeric-egress coercion');
    expect(r.out).toContain('win_probability');
  });

  it('REDs when the code IS fixed but the entry is left behind (a stale pin)', () => {
    const p = join(FIX, 'src/routes/v1/index.ts');
    const original = readFileSync(p, 'utf8');
    writeFileSync(p, original.replace(
      'win_probability: o.win_probability ?? 0',
      'win_probability: finiteNum(o.win_probability)'));
    const r = runGate(FIX);
    writeFileSync(p, original);
    expect(r.code).toBe(1);
    expect(r.out).toContain('STALE exception');
    expect(r.out).toContain('may only shrink');
  });
});

describe('numeric-egress gate · cannot pass vacuously', () => {
  it('REDs — never silently passes — when the FIELD derivation is blinded', () => {
    const empty = mkdtempSync(join(tmpdir(), 'neg-empty-contracts-'));
    const r = runGate(FIX, { NEG_CONTRACTS_DIR: empty });
    rmSync(empty, { recursive: true, force: true });
    expect(r.code).toBe(1);
    expect(r.out).toContain('derivation is blind');
    expect(r.out).not.toContain('No new numeric-egress coercions');
  });

  it('REDs — never silently passes — when the FILE derivation is blinded', () => {
    const empty = mkdtempSync(join(tmpdir(), 'neg-empty-src-'));
    const r = runGate(FIX, { NEG_SRC_DIR: empty });
    rmSync(empty, { recursive: true, force: true });
    expect(r.code).toBe(1);
    expect(r.out).toContain('derivation is blind');
    expect(r.out).not.toContain('No new numeric-egress coercions');
  });
});

describe('numeric-egress gate · the real tree', () => {
  it('passes against this repo, and the pinned debt equals the violations found', () => {
    const r = runGate(REPO, { NEG_ROOT: REPO });
    expect(r.out).toContain('No new numeric-egress coercions');
    expect(r.code).toBe(0);
    const found = /violations found\s*:\s*(\d+)/.exec(r.out);
    const pinned = /retrofit debt pinned\s*:\s*(\d+)/.exec(r.out);
    expect(found).not.toBeNull();
    expect(pinned).not.toBeNull();
    expect(found![1]).toBe(pinned![1]);
  });
});

/**
 * The gate's field axis is DERIVED from `contracts/`, so a field the contract
 * never declares is invisible to it — not by a gate defect, but by a
 * contract-documentation gap. `confidence_components.structural_certainty` is
 * emitted by `src/lib/factor-influence.ts` and was undeclared, so the gate could
 * not have caught a `structural_certainty ?? 0.5` — the very example the gate's
 * own header names ("50% certainty asserted for a factor with no incoming
 * edges").
 *
 * These pin the DECLARATION, by pointing the field axis at the REAL
 * `contracts/` directory rather than restating the names in a fixture. Delete
 * the schema entry and the first case goes RED — there is no mirror to drift.
 * The contrast control is a sibling name the real contract does NOT declare, so
 * a pass here can never be the gate agreeing with itself.
 */
describe('numeric-egress gate · the REAL contract declares the confidence_components leaves', () => {
  const REAL_CONTRACTS = { NEG_CONTRACTS_DIR: join(REPO, 'contracts') };

  it('REDs on a `structural_certainty` literal fallback, with the REAL contracts/ as the field axis', () => {
    const restore = patch('src/routes/v1/index.ts',
      `export const sc = (o: any) => ({ structural_certainty: o.cc.structural_certainty ?? 0.5 });\n`);
    const r = runGate(FIX, REAL_CONTRACTS);
    restore();
    expect(r.code).toBe(1);
    expect(r.out).toContain("'structural_certainty' is a contract-declared numeric response field");
  });

  it('REDs on a `sampling_stability` literal fallback — an explicit null is a declared absence', () => {
    const restore = patch('src/routes/v1/index.ts',
      `export const ss = (o: any) => ({ sampling_stability: o.cc.sampling_stability ?? 0 });\n`);
    const r = runGate(FIX, REAL_CONTRACTS);
    restore();
    expect(r.code).toBe(1);
    expect(r.out).toContain("'sampling_stability' is a contract-declared numeric response field");
  });

  it('stays GREEN for a sibling name the real contract does NOT declare — the contrast control', () => {
    const restore = patch('src/routes/v1/index.ts',
      `export const zz = (o: any) => ({ structural_certainty_unpublished: o.x ?? 0.5 });\n`);
    const r = runGate(FIX, REAL_CONTRACTS);
    restore();
    expect(r.out).toContain('No new numeric-egress coercions');
    expect(r.code).toBe(0);
  });

  it('a MEASURED structural_certainty still ships — the fix must not start deleting real values', () => {
    const restore = patch('src/routes/v1/index.ts',
      `export const measured = (g: any) => ({ structural_certainty: g.finiteNum(0), sampling_stability: 0 });\n`);
    const r = runGate(FIX, REAL_CONTRACTS);
    restore();
    expect(r.out).toContain('No new numeric-egress coercions');
    expect(r.code).toBe(0);
  });
});
