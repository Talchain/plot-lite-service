#!/usr/bin/env node
/**
 * Derive the DOMAIN of the driver-quantity register (amendment §3.2).
 *
 * ## Why this is derived and not written down
 *
 * The amendment's own headline census dropped items between two sections of one
 * document, written in one sitting, by one author who was actively looking for
 * them:
 *
 * > *The count is itself a hand-maintained mirror […] a list a human must
 * > remember to sync WILL drift, and the drift reads as complete.*
 * > ⇒ **"The authority table must not ship as a table. It must ship as a
 * > DERIVED REGISTER with a fail-loud gate."**
 *
 * So the DOMAIN — *which* numeric quantities ride on a driver-bearing row — is
 * extracted from the contract type declarations themselves, by AST, never from
 * a list. The REGISTER (`src/lib/driver-quantity-register.ts`) supplies the
 * things a type cannot state: `{role, disposition, unit, sign}`. A new numeric
 * field is then a RED in `tests/driver-quantity-register.derived.test.ts`, not
 * a silent fifteenth quantity.
 *
 * Same instrument, same reasoning and the same `typescript` dependency as
 * `tools/gen-structural-keys.mjs`, which derives the structural key set from
 * these same files.
 *
 * ## ⛔ UNPARSEABLE FAILS LOUD
 *
 * Every failure mode of this extraction — file missing, type renamed or
 * deleted, an interface that yields zero members — THROWS. It must never
 * return an empty or partial domain, because an empty domain makes the gate
 * pass by testing nothing (trap 13: an absence assertion that cannot see a
 * presence).
 *
 * Side-effect free on import: this module only reads.
 *
 * Usage: node tools/derive-driver-quantities.mjs   (prints the derived domain)
 */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The DRIVER-BEARING ROW TYPES. These are the shapes a consumer ranks, bands or
 * crowns on — the amendment's `FactorSensitivityV2` / `EdgeSensitivityV2` /
 * `SensitiveFactorV2` stated at PLoT's own names.
 *
 * ⚠ This list names the TYPES, not the fields. Naming a type is a structural
 * choice a reviewer can check in one line; naming fields would be the mirror
 * this module exists to avoid.
 */
export const DRIVER_ROW_TYPES = [
  { file: 'src/types/engine-v3.ts', type: 'FactorSensitivityResultV3' },
  { file: 'src/types/engine-v3.ts', type: 'EdgeSensitivityResultV3' },
];

/** Does this type node admit a `number`? Unwraps unions, parens and arrays. */
function admitsNumber(node) {
  if (node === undefined) return false;
  if (ts.isParenthesizedTypeNode(node)) return admitsNumber(node.type);
  if (ts.isUnionTypeNode(node)) return node.types.some(admitsNumber);
  if (ts.isArrayTypeNode(node)) return admitsNumber(node.elementType);
  return node.kind === ts.SyntaxKind.NumberKeyword;
}

/** The source text of a type node, whitespace-collapsed, for the report. */
function typeText(node, source) {
  return node === undefined
    ? 'unknown'
    : source.text.slice(node.pos, node.end).trim().replace(/\s+/g, ' ');
}

function collectNumericMembers(members, source, typeName, prefix, out) {
  for (const member of members) {
    if (!ts.isPropertySignature(member) || member.name === undefined) continue;
    const name = member.name.getText?.(source) ?? source.text.slice(member.name.pos, member.name.end).trim();
    const field = prefix === '' ? name : `${prefix}.${name}`;
    const type = member.type;

    // Recurse into INLINE object literals (e.g. `confidence_components`), so a
    // quantity cannot hide from the register one level down.
    if (type !== undefined && ts.isTypeLiteralNode(type)) {
      collectNumericMembers(type.members, source, typeName, field, out);
      continue;
    }
    if (admitsNumber(type)) {
      out.push({
        type: typeName,
        field,
        ts_type: typeText(type, source),
        optional: member.questionToken !== undefined,
      });
    }
  }
}

/**
 * Derive every numeric field carried by a driver-bearing row.
 *
 * @returns {{type: string, field: string, ts_type: string, optional: boolean}[]}
 *   sorted by `type` then `field` — a stable domain a test can diff.
 * @throws if any declared type cannot be found or yields no members.
 */
export function deriveDriverQuantityFields() {
  const derived = [];
  for (const { file, type: typeName } of DRIVER_ROW_TYPES) {
    const path = join(ROOT, file);
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (cause) {
      // UNPARSEABLE ⇒ LOUD. Never fall through to an empty domain.
      throw new Error(`driver-quantity domain: cannot read ${file}`, { cause });
    }
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);

    let decl;
    source.forEachChild((node) => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) decl = node;
    });
    if (decl === undefined) {
      throw new Error(
        `driver-quantity domain: interface ${typeName} not found in ${file}. ` +
          'It was renamed, deleted or converted to a type alias — the register ' +
          'domain is now unverifiable and must not silently shrink.',
      );
    }
    if (decl.members.length === 0) {
      throw new Error(`driver-quantity domain: interface ${typeName} parsed with ZERO members (${file})`);
    }

    const before = derived.length;
    collectNumericMembers(decl.members, source, typeName, '', derived);
    if (derived.length === before) {
      throw new Error(
        `driver-quantity domain: ${typeName} yielded NO numeric fields. A ` +
          'driver-bearing row with no quantities is not a state this contract ' +
          'has — treat it as a parse failure, not as an empty result.',
      );
    }
  }
  derived.sort((a, b) => (a.type === b.type ? a.field.localeCompare(b.field) : a.type.localeCompare(b.type)));
  return derived;
}

/** Stable `"Type.field"` keys — the join between the domain and the register. */
export function deriveDriverQuantityKeys() {
  return deriveDriverQuantityFields().map((f) => `${f.type}.${f.field}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of deriveDriverQuantityFields()) {
    console.log(`${f.type}.${f.field}${f.optional ? '?' : ''}: ${f.ts_type}`);
  }
}
