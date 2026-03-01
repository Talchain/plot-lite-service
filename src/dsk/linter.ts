/**
 * DSK Bundle Linter
 *
 * Validates a DSK JSON bundle against structural, type-specific,
 * and cross-referencing rules. Produces deterministic, sorted output.
 */

import { checkObjectOrder } from './canonicalise.js';
import { computeDSKHash } from './hash.js';
import type { DSKBundle, DSKObject, DSKClaim, DSKProtocol, DSKTrigger } from './types.js';
import { DECISION_STAGES as STAGES, CONTEXT_TAGS_VOCABULARY as VOCAB } from './types.js';

// ── Result types ─────────────────────────────────────────────────────

export type Severity = 'error' | 'warning';

export interface LintIssue {
  severity: Severity;
  object_id: string;
  field_path: string;
  message: string;
}

export interface LintResult {
  errors: LintIssue[];
  warnings: LintIssue[];
  /** 0 = clean, 1 = errors, 2 = warnings only */
  exitCode: 0 | 1 | 2;
  computedHash?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function issue(
  severity: Severity,
  object_id: string,
  field_path: string,
  message: string,
): LintIssue {
  return { severity, object_id, field_path, message };
}

function err(object_id: string, field_path: string, message: string): LintIssue {
  return issue('error', object_id, field_path, message);
}

function warn(object_id: string, field_path: string, message: string): LintIssue {
  return issue('warning', object_id, field_path, message);
}

const ID_REGEX = /^DSK-(B|T|TR)\d{3}$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isNonEmptyArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0;
}

function checkPlaceholder(value: unknown, objectId: string, fieldPath: string, issues: LintIssue[]): void {
  if (typeof value === 'string' && /PLACEHOLDER/i.test(value)) {
    issues.push(err(objectId, fieldPath, `Placeholder content — needs review: ${objectId}.${fieldPath}`));
  }
}

function checkPlaceholderInArray(arr: unknown[], objectId: string, fieldPath: string, issues: LintIssue[]): void {
  for (let i = 0; i < arr.length; i++) {
    checkPlaceholder(arr[i], objectId, `${fieldPath}[${i}]`, issues);
  }
}

// ── Structural validation ────────────────────────────────────────────

function validateBase(obj: DSKObject, issues: LintIssue[]): void {
  const id = obj.id ?? '(missing)';

  // id format
  if (!isNonEmptyString(obj.id)) {
    issues.push(err(id, 'id', 'Missing or empty id'));
  } else if (!ID_REGEX.test(obj.id)) {
    issues.push(err(id, 'id', `Invalid id format: expected /^DSK-(B|T|TR)\\d{3}$/, got '${obj.id}'`));
  }

  // type discriminant
  if (!['claim', 'protocol', 'trigger'].includes(obj.type)) {
    issues.push(err(id, 'type', `Invalid type discriminant: '${obj.type}'`));
  }

  // title
  if (!isNonEmptyString(obj.title)) {
    issues.push(err(id, 'title', 'Missing or empty title'));
  }
  checkPlaceholder(obj.title, id, 'title', issues);

  // evidence_strength
  if (!['strong', 'medium', 'weak', 'mixed'].includes(obj.evidence_strength)) {
    issues.push(err(id, 'evidence_strength', `Invalid evidence_strength: '${obj.evidence_strength}'`));
  }

  // contraindications — must be an array (can be empty)
  if (!Array.isArray(obj.contraindications)) {
    issues.push(err(id, 'contraindications', 'Missing contraindications array'));
  } else {
    checkPlaceholderInArray(obj.contraindications, id, 'contraindications', issues);
  }

  // stage_applicability
  if (!isNonEmptyArray(obj.stage_applicability)) {
    issues.push(err(id, 'stage_applicability', 'Missing or empty stage_applicability'));
  } else {
    for (let i = 0; i < obj.stage_applicability.length; i++) {
      const s = obj.stage_applicability[i];
      if (!(STAGES as readonly string[]).includes(s)) {
        issues.push(err(id, `stage_applicability[${i}]`, `Invalid DecisionStage: '${s}'`));
      }
    }
  }

  // context_tags
  if (!Array.isArray(obj.context_tags)) {
    issues.push(err(id, 'context_tags', 'Missing context_tags array'));
  } else {
    for (let i = 0; i < obj.context_tags.length; i++) {
      const tag = obj.context_tags[i];
      if (!(VOCAB as readonly string[]).includes(tag)) {
        issues.push(err(id, `context_tags[${i}]`, `Invalid context_tag: '${tag}' — allowed: ${VOCAB.join(', ')}`));
      }
    }
  }

  // version
  if (!isNonEmptyString(obj.version)) {
    issues.push(err(id, 'version', 'Missing or empty version'));
  } else if (!SEMVER_REGEX.test(obj.version)) {
    issues.push(err(id, 'version', `Invalid semver: '${obj.version}'`));
  }

  // last_reviewed_at
  if (!isNonEmptyString(obj.last_reviewed_at)) {
    issues.push(err(id, 'last_reviewed_at', 'Missing or empty last_reviewed_at'));
  } else if (!ISO_8601_REGEX.test(obj.last_reviewed_at)) {
    issues.push(err(id, 'last_reviewed_at', `Invalid ISO 8601 date: '${obj.last_reviewed_at}'`));
  }

  // source_citations
  if (!isNonEmptyArray(obj.source_citations)) {
    issues.push(err(id, 'source_citations', 'Missing or empty source_citations — at least one required'));
  } else {
    for (let i = 0; i < obj.source_citations.length; i++) {
      const c = obj.source_citations[i];
      if (!isNonEmptyString(c?.doi_or_isbn)) {
        issues.push(err(id, `source_citations[${i}].doi_or_isbn`, 'Missing or empty doi_or_isbn'));
      }
      checkPlaceholder(c?.doi_or_isbn, id, `source_citations[${i}].doi_or_isbn`, issues);
      if (!isNonEmptyString(c?.page_or_section)) {
        issues.push(err(id, `source_citations[${i}].page_or_section`, 'Missing or empty page_or_section'));
      }
      checkPlaceholder(c?.page_or_section, id, `source_citations[${i}].page_or_section`, issues);
    }
  }

  // deprecated
  if (typeof obj.deprecated !== 'boolean') {
    issues.push(err(id, 'deprecated', 'Missing or non-boolean deprecated field'));
  } else if (obj.deprecated && !isNonEmptyString(obj.deprecated_reason)) {
    issues.push(err(id, 'deprecated_reason', 'Deprecated objects must have deprecated_reason'));
  }
  if (obj.deprecated_reason !== undefined) {
    checkPlaceholder(obj.deprecated_reason, id, 'deprecated_reason', issues);
  }
}

// ── Claim-specific ───────────────────────────────────────────────────

function validateClaim(obj: DSKClaim, issues: LintIssue[]): void {
  const id = obj.id ?? '(missing)';

  // claim_category
  if (!['empirical', 'technique_efficacy', 'causal_rule', 'population'].includes(obj.claim_category)) {
    issues.push(err(id, 'claim_category', `Invalid claim_category: '${obj.claim_category}'`));
  }

  // scope
  if (!obj.scope || typeof obj.scope !== 'object') {
    issues.push(err(id, 'scope', 'Missing scope object'));
    return;
  }

  // scope.decision_contexts
  if (!isNonEmptyArray(obj.scope.decision_contexts)) {
    issues.push(err(id, 'scope.decision_contexts', 'Missing or empty scope.decision_contexts'));
  } else {
    for (let i = 0; i < obj.scope.decision_contexts.length; i++) {
      const ctx = obj.scope.decision_contexts[i];
      if (!(VOCAB as readonly string[]).includes(ctx)) {
        issues.push(err(id, `scope.decision_contexts[${i}]`, `Invalid context_tag: '${ctx}' — allowed: ${VOCAB.join(', ')}`));
      }
    }
    checkPlaceholderInArray(obj.scope.decision_contexts, id, 'scope.decision_contexts', issues);
  }

  // scope.stages
  if (!isNonEmptyArray(obj.scope.stages)) {
    issues.push(err(id, 'scope.stages', 'Missing or empty scope.stages'));
  } else {
    for (let i = 0; i < obj.scope.stages.length; i++) {
      const s = obj.scope.stages[i];
      if (!(STAGES as readonly string[]).includes(s as string)) {
        issues.push(err(id, `scope.stages[${i}]`, `Invalid DecisionStage: '${s}'`));
      }
    }
  }

  // scope.populations
  if (!isNonEmptyArray(obj.scope.populations)) {
    issues.push(err(id, 'scope.populations', 'Missing or empty scope.populations'));
  } else {
    checkPlaceholderInArray(obj.scope.populations, id, 'scope.populations', issues);
  }

  // scope.exclusions
  if (!isNonEmptyArray(obj.scope.exclusions)) {
    issues.push(err(id, 'scope.exclusions', "Missing or empty scope.exclusions — Use ['none'] if genuinely universal — scope must be explicit"));
  } else {
    checkPlaceholderInArray(obj.scope.exclusions, id, 'scope.exclusions', issues);
  }

  // permitted_phrasing_band vs evidence_strength consistency
  const phrasingMap: Record<string, string> = {
    strong: 'strong',
    medium: 'medium',
    weak: 'weak',
    mixed: 'weak',
  };
  const expectedBand = phrasingMap[obj.evidence_strength];
  if (expectedBand && obj.permitted_phrasing_band !== expectedBand) {
    issues.push(err(id, 'permitted_phrasing_band',
      `Inconsistent with evidence_strength '${obj.evidence_strength}': expected '${expectedBand}', got '${obj.permitted_phrasing_band}'`));
  }

  // evidence_pack
  if (!obj.evidence_pack || typeof obj.evidence_pack !== 'object') {
    issues.push(err(id, 'evidence_pack', 'Missing evidence_pack object'));
    return;
  }
  for (const field of ['key_findings', 'boundary_conditions', 'known_limitations'] as const) {
    if (!isNonEmptyString(obj.evidence_pack[field])) {
      issues.push(err(id, `evidence_pack.${field}`, `Missing or empty evidence_pack.${field}`));
    }
    checkPlaceholder(obj.evidence_pack[field], id, `evidence_pack.${field}`, issues);
  }
  if (!['positive', 'negative', 'mixed', 'null'].includes(obj.evidence_pack.effect_direction)) {
    issues.push(err(id, 'evidence_pack.effect_direction', `Invalid effect_direction: '${obj.evidence_pack.effect_direction}'`));
  }
}

// ── Protocol-specific ────────────────────────────────────────────────

function validateProtocol(obj: DSKProtocol, issues: LintIssue[]): void {
  const id = obj.id ?? '(missing)';

  if (!isNonEmptyArray(obj.steps)) {
    issues.push(err(id, 'steps', 'Missing or empty steps'));
  } else {
    checkPlaceholderInArray(obj.steps, id, 'steps', issues);
  }

  if (!isNonEmptyArray(obj.required_inputs)) {
    issues.push(err(id, 'required_inputs', 'Missing or empty required_inputs'));
  } else {
    checkPlaceholderInArray(obj.required_inputs, id, 'required_inputs', issues);
  }

  if (!isNonEmptyArray(obj.expected_outputs)) {
    issues.push(err(id, 'expected_outputs', 'Missing or empty expected_outputs'));
  } else {
    checkPlaceholderInArray(obj.expected_outputs, id, 'expected_outputs', issues);
  }
}

// ── Trigger-specific ─────────────────────────────────────────────────

function validateTrigger(obj: DSKTrigger, issues: LintIssue[]): void {
  const id = obj.id ?? '(missing)';

  if (!isNonEmptyString(obj.observable_signal)) {
    issues.push(err(id, 'observable_signal', 'Missing or empty observable_signal'));
  }
  checkPlaceholder(obj.observable_signal, id, 'observable_signal', issues);

  if (!isNonEmptyString(obj.recommended_behaviour)) {
    issues.push(err(id, 'recommended_behaviour', 'Missing or empty recommended_behaviour'));
  }
  checkPlaceholder(obj.recommended_behaviour, id, 'recommended_behaviour', issues);

  if (!isNonEmptyArray(obj.negative_conditions)) {
    issues.push(err(id, 'negative_conditions', 'Missing or empty negative_conditions — Every trigger must have at least one negative condition to prevent false positives'));
  } else {
    checkPlaceholderInArray(obj.negative_conditions, id, 'negative_conditions', issues);
  }

  // linked_claim_ids and linked_protocol_ids are validated in cross-ref checks
  if (!Array.isArray(obj.linked_claim_ids)) {
    issues.push(err(id, 'linked_claim_ids', 'Missing linked_claim_ids array'));
  }
  if (!Array.isArray(obj.linked_protocol_ids)) {
    issues.push(err(id, 'linked_protocol_ids', 'Missing linked_protocol_ids array'));
  }
}

// ── Cross-referencing ────────────────────────────────────────────────

function validateCrossReferences(objects: DSKObject[], issues: LintIssue[]): void {
  const objectMap = new Map<string, DSKObject>();
  for (const obj of objects) {
    objectMap.set(obj.id, obj);
  }

  for (const obj of objects) {
    const id = obj.id ?? '(missing)';

    // replacement_id checks
    if (obj.replacement_id !== undefined && obj.replacement_id !== null) {
      const replacement = objectMap.get(obj.replacement_id);
      if (!replacement) {
        issues.push(err(id, 'replacement_id', `References non-existent ID: '${obj.replacement_id}'`));
      } else {
        if (replacement.type !== obj.type) {
          issues.push(err(id, 'replacement_id', `Cross-type replacement: '${obj.replacement_id}' is type '${replacement.type}', expected '${obj.type}'`));
        }
        if (replacement.deprecated) {
          issues.push(err(id, 'replacement_id', `References deprecated object: '${obj.replacement_id}'`));
        }
      }
    }

    // Trigger cross-references
    if (obj.type === 'trigger') {
      const trigger = obj as DSKTrigger;
      if (Array.isArray(trigger.linked_claim_ids)) {
        for (let i = 0; i < trigger.linked_claim_ids.length; i++) {
          const refId = trigger.linked_claim_ids[i];
          const referenced = objectMap.get(refId);
          if (!referenced) {
            issues.push(err(id, `linked_claim_ids[${i}]`, `References non-existent claim: '${refId}'`));
          } else if (referenced.type !== 'claim') {
            issues.push(err(id, `linked_claim_ids[${i}]`, `'${refId}' is not a claim (type: '${referenced.type}')`));
          }
        }
      }
      if (Array.isArray(trigger.linked_protocol_ids)) {
        for (let i = 0; i < trigger.linked_protocol_ids.length; i++) {
          const refId = trigger.linked_protocol_ids[i];
          const referenced = objectMap.get(refId);
          if (!referenced) {
            issues.push(err(id, `linked_protocol_ids[${i}]`, `References non-existent protocol: '${refId}'`));
          } else if (referenced.type !== 'protocol') {
            issues.push(err(id, `linked_protocol_ids[${i}]`, `'${refId}' is not a protocol (type: '${referenced.type}')`));
          }
        }
      }
    }
  }

  // Circular replacement chain detection
  for (const obj of objects) {
    if (obj.replacement_id) {
      const visited = new Set<string>();
      let current: string | undefined = obj.id;
      while (current) {
        if (visited.has(current)) {
          issues.push(err(obj.id, 'replacement_id', `Circular replacement chain detected: ${[...visited, current].join(' → ')}`));
          break;
        }
        visited.add(current);
        current = objectMap.get(current)?.replacement_id;
      }
    }
  }
}

// ── Hash validation ──────────────────────────────────────────────────

function validateHash(bundle: DSKBundle, issues: LintIssue[]): string {
  const computed = computeDSKHash(bundle);

  if (!bundle.dsk_version_hash || bundle.dsk_version_hash === '') {
    issues.push(err('(bundle)', 'dsk_version_hash', `Empty or missing dsk_version_hash — should be: ${computed}`));
  } else if (bundle.dsk_version_hash !== computed) {
    issues.push(err('(bundle)', 'dsk_version_hash',
      `Hash mismatch: stored '${bundle.dsk_version_hash}', computed '${computed}'`));
  }

  return computed;
}

// ── Main lint function ───────────────────────────────────────────────

export function lint(bundle: DSKBundle): LintResult {
  const allIssues: LintIssue[] = [];

  // Bundle-level validation
  if (!isNonEmptyString(bundle.version)) {
    allIssues.push(err('(bundle)', 'version', 'Missing or empty bundle version'));
  } else if (!SEMVER_REGEX.test(bundle.version)) {
    allIssues.push(err('(bundle)', 'version', `Invalid bundle semver: '${bundle.version}'`));
  }

  if (!Array.isArray(bundle.objects)) {
    allIssues.push(err('(bundle)', 'objects', 'Missing or non-array objects'));
    return finalise(allIssues);
  }

  // Filter out malformed entries (non-object, null, primitives)
  const validObjects: DSKObject[] = [];
  for (let i = 0; i < bundle.objects.length; i++) {
    const entry = bundle.objects[i];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      allIssues.push(err('(bundle)', `objects[${i}]`,
        `Invalid entry at index ${i}: expected object, got ${entry === null ? 'null' : typeof entry}`));
      continue;
    }
    validObjects.push(entry as DSKObject);
  }

  // Duplicate ID check
  const seenIds = new Set<string>();
  for (const obj of validObjects) {
    if (obj.id && seenIds.has(obj.id)) {
      allIssues.push(err(obj.id, 'id', `Duplicate id: '${obj.id}'`));
    }
    seenIds.add(obj.id);
  }

  // Per-object validation
  for (const obj of validObjects) {
    validateBase(obj, allIssues);

    switch (obj.type) {
      case 'claim':
        validateClaim(obj as DSKClaim, allIssues);
        break;
      case 'protocol':
        validateProtocol(obj as DSKProtocol, allIssues);
        break;
      case 'trigger':
        validateTrigger(obj as DSKTrigger, allIssues);
        break;
    }
  }

  // Cross-referencing
  validateCrossReferences(validObjects, allIssues);

  // Hash validation — skip when malformed entries exist (hash would be meaningless)
  const hasMalformed = validObjects.length !== bundle.objects.length;
  const computedHash = hasMalformed ? undefined : validateHash(bundle, allIssues);

  // Ordering check (warning) — only if all entries are valid objects
  const sortedOrder = validObjects.length === bundle.objects.length
    ? checkObjectOrder(validObjects)
    : null;
  if (sortedOrder) {
    allIssues.push(warn('(bundle)', 'objects',
      `Objects not in canonical order by id. Expected: ${sortedOrder.join(', ')}`));
  }

  return finalise(allIssues, computedHash);
}

function finalise(issues: LintIssue[], computedHash?: string): LintResult {
  // Sort deterministically by (object_id, field_path)
  issues.sort((a, b) => {
    const cmp = a.object_id.localeCompare(b.object_id);
    if (cmp !== 0) return cmp;
    return a.field_path.localeCompare(b.field_path);
  });

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  let exitCode: 0 | 1 | 2 = 0;
  if (errors.length > 0) exitCode = 1;
  else if (warnings.length > 0) exitCode = 2;

  return { errors, warnings, exitCode, computedHash };
}

// ── Format output ────────────────────────────────────────────────────

export function formatLintResult(result: LintResult): string {
  const lines: string[] = [];

  for (const e of result.errors) {
    lines.push(`ERROR  ${e.object_id} → ${e.field_path}: ${e.message}`);
  }
  for (const w of result.warnings) {
    lines.push(`WARN   ${w.object_id} → ${w.field_path}: ${w.message}`);
  }

  lines.push('');
  lines.push(`${result.errors.length} error(s), ${result.warnings.length} warning(s)`);

  if (result.computedHash) {
    lines.push(`Computed hash: ${result.computedHash}`);
  }

  return lines.join('\n');
}
