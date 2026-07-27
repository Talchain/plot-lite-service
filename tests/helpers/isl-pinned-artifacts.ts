/**
 * Readers + the schema walk for the pinned ISL request contract.
 *
 * Contract step-2 slice 2. Everything here is hermetic: it reads the committed
 * artifacts under tests/fixtures/isl-pinned/ and needs no network and no Python.
 * The Python driver (tools/isl-contract/replay-through-pinned-model.py) is what
 * produced them by executing ISL's own pinned models.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../..');
export const PINNED_DIR = resolve(REPO_ROOT, 'tests/fixtures/isl-pinned');

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256File(relPath: string): string {
  return createHash('sha256').update(readFileSync(resolve(REPO_ROOT, relPath))).digest('hex');
}

/**
 * Canonical JSON digest. MUST stay byte-compatible with the driver's
 * `canonical_pin_digest()` — Python `json.dumps(sort_keys=True,
 * separators=(',', ':'), ensure_ascii=False)`. This is what makes "the pin moved
 * but the transcript did not" detectable.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const rec = value as Record<string, unknown>;
  const body = Object.keys(rec)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`)
    .join(',');
  return `{${body}}`;
}

export function canonicalDigest(value: unknown): string {
  return sha256(canonicalJson(value));
}

// -----------------------------------------------------------------------------
// Artifact readers
// -----------------------------------------------------------------------------

function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, relPath), 'utf8')) as T;
}

export interface Pin {
  isl: { repo: string; ref: string; sha: string; committed_at: string; pinned_by: string };
  runtime: Record<string, string>;
  artifacts: {
    isl_openapi_json: { vendored_as: string; upstream_path: string; sha256: string };
  };
  source_sha256: Record<string, string>;
  mounted_request_models: Record<string, { model: string; module: string; handler: string }>;
  unmounted_at_this_pin: Record<string, string>;
}

export interface OpenApiDoc {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, Schema> };
}

export interface EgressFixture {
  producer: string;
  endpoint: string;
  site: string;
  liveness: string;
  note: string;
  wire_bytes_length: number;
  wire_bytes_sha256: string;
  body: unknown;
}

export interface ReplayEntry {
  fixture: string;
  endpoint: string;
  model: string | null;
  parses: boolean | null;
  validation_errors: Array<{ loc: string[]; type: string; msg: string }>;
  parsed_dump: unknown;
  wire_bytes_sha256?: string;
  file_sha256?: string;
  liveness?: string;
  unpairable_reason?: string;
}

export interface Transcript {
  pin_digest: string;
  isl_sha: string;
  pydantic_version: string;
  python_version: string;
  models: Record<string, string>;
  schema_agreement: Record<
    string,
    { model: string; classes_compared: string[]; agrees: boolean; only_in_artifact: unknown; only_in_model: unknown }
  >;
  egress: Record<string, ReplayEntry>;
  captured_live: Record<string, ReplayEntry>;
}

export const loadPin = (): Pin => readJson<Pin>('tests/fixtures/isl-pinned/PIN.json');
export const loadOpenApi = (): OpenApiDoc => readJson<OpenApiDoc>('tests/fixtures/isl-pinned/isl-openapi.json');
export const loadTranscript = (): Transcript =>
  readJson<Transcript>('tests/fixtures/isl-pinned/replay-transcript.json');

export function loadEgressFixtures(): Map<string, EgressFixture> {
  const dir = resolve(PINNED_DIR, 'egress');
  const out = new Map<string, EgressFixture>();
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue;
    const fixture = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as EgressFixture;
    out.set(fixture.producer, fixture);
  }
  return out;
}

// -----------------------------------------------------------------------------
// JSON path derivation — shared vocabulary for both pairing methods
// -----------------------------------------------------------------------------

/**
 * Every JSON path present in `value`, with array indices collapsed to `[]`.
 * Byte-compatible with the driver's `paths_of()`, so the executed-model pairing
 * and the schema pairing speak the same path language.
 */
export function jsonPaths(value: unknown, prefix = ''): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown, p: string): void => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item, `${p}[]`);
      return;
    }
    if (v !== null && typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        const path = p ? `${p}.${k}` : k;
        out.add(path);
        visit(child, path);
      }
    }
  };
  visit(value, prefix);
  return out;
}

// -----------------------------------------------------------------------------
// Method 2: the schema walk over the vendored (Pydantic-generated) artifact
// -----------------------------------------------------------------------------

export type Schema = Record<string, unknown>;

function deref(schema: Schema | undefined, doc: OpenApiDoc): Schema {
  let cur = schema;
  for (let i = 0; cur && typeof cur.$ref === 'string' && i < 32; i += 1) {
    const name = (cur.$ref as string).replace('#/components/schemas/', '');
    cur = doc.components.schemas[name];
  }
  return cur ?? {};
}

/** anyOf / oneOf / allOf flattened to the branches a value could match. */
function branches(schema: Schema | undefined, doc: OpenApiDoc): Schema[] {
  const d = deref(schema, doc);
  const combos = [
    ...((d.anyOf as Schema[] | undefined) ?? []),
    ...((d.oneOf as Schema[] | undefined) ?? []),
    ...((d.allOf as Schema[] | undefined) ?? []),
  ];
  const out: Schema[] = [];
  for (const b of combos) out.push(...branches(b, doc));
  out.push(d);
  return out;
}

export interface UndeclaredHit {
  /** Concrete path with real array indices, e.g. `goal_constraints[0].constraint_id`. */
  path: string;
  /** Array indices collapsed, e.g. `goal_constraints[].constraint_id`. */
  normalised: string;
}

/**
 * Walk a request body against the pinned schema and report every key the model
 * does not declare.
 *
 * Descent stops at a free-form mapping (`additionalProperties` present, no
 * `properties`) — e.g. `options[].interventions: Dict[str, float]`, whose keys
 * are node ids and can never be "undeclared".
 */
export function undeclaredPaths(body: unknown, rootSchemaName: string, doc: OpenApiDoc): UndeclaredHit[] {
  const hits: UndeclaredHit[] = [];

  const visit = (value: unknown, schema: Schema | undefined, path: string, norm: string): void => {
    const bs = branches(schema, doc);

    if (Array.isArray(value)) {
      const itemSchema = bs.map((b) => b.items as Schema | undefined).find(Boolean);
      if (!itemSchema) return;
      value.forEach((el, i) => visit(el, itemSchema, `${path}[${i}]`, `${norm}[]`));
      return;
    }

    if (value === null || typeof value !== 'object') return;

    const declared = new Set<string>();
    let sawDeclaringSchema = false;
    let freeForm = false;
    for (const b of bs) {
      const props = b.properties as Record<string, Schema> | undefined;
      if (props) {
        sawDeclaringSchema = true;
        for (const k of Object.keys(props)) declared.add(k);
      }
      if (b.additionalProperties !== undefined && b.additionalProperties !== false) freeForm = true;
      // A bare `{"type": "object"}` with nothing declared is an untyped mapping.
      if (!props && b.type === 'object' && b.additionalProperties === undefined) freeForm = true;
    }
    // Nothing in the schema tree declares members here → we cannot call anything
    // undeclared without inventing a claim. Stop.
    if (!sawDeclaringSchema) return;

    for (const [k, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${k}` : k;
      const childNorm = norm ? `${norm}.${k}` : k;
      if (!declared.has(k)) {
        if (!freeForm) hits.push({ path: childPath, normalised: childNorm });
        continue;
      }
      const propSchema = bs.map((b) => (b.properties as Record<string, Schema> | undefined)?.[k]).find(Boolean);
      visit(child, propSchema, childPath, childNorm);
    }
  };

  visit(body, { $ref: `#/components/schemas/${rootSchemaName}` }, '', '');
  return hits;
}

/**
 * Does the pinned model DECLARE this normalised path? Used by the stale-exemption
 * check: a `knownUndeclared` entry that ISL has since adopted is an exemption
 * that must be deleted, and one naming a path ISL's tree cannot contain is a
 * typo that would silently exempt nothing.
 */
export function schemaPathStatus(
  normalisedPath: string,
  rootSchemaName: string,
  doc: OpenApiDoc,
): 'declared' | 'undeclared-under-declaring-parent' | 'parent-not-in-tree' {
  const segments = normalisedPath.split('.');
  let bs = branches({ $ref: `#/components/schemas/${rootSchemaName}` }, doc);

  for (let i = 0; i < segments.length; i += 1) {
    const raw = segments[i]!;
    const isArray = raw.endsWith('[]');
    const key = isArray ? raw.slice(0, -2) : raw;

    const declaring = bs.filter((b) => b.properties);
    if (declaring.length === 0) return 'parent-not-in-tree';

    const propSchema = declaring.map((b) => (b.properties as Record<string, Schema>)[key]).find(Boolean);
    if (!propSchema) {
      return i === segments.length - 1 ? 'undeclared-under-declaring-parent' : 'parent-not-in-tree';
    }
    if (i === segments.length - 1) return 'declared';

    bs = branches(propSchema, doc);
    if (isArray) {
      const itemSchema = bs.map((b) => b.items as Schema | undefined).find(Boolean);
      if (!itemSchema) return 'parent-not-in-tree';
      bs = branches(itemSchema, doc);
    }
  }
  return 'parent-not-in-tree';
}
