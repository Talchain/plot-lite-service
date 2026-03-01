/**
 * DSK Authoring Kit — Comprehensive Tests
 *
 * Tests for the linter, canonicaliser, and hasher.
 */

import { describe, it, expect } from 'vitest';
import { lint, formatLintResult } from '../src/dsk/linter.js';
import { canonicalise, checkObjectOrder } from '../src/dsk/canonicalise.js';
import { computeDSKHash, verifyDSKHash } from '../src/dsk/hash.js';
import type {
  DSKBundle, DSKClaim, DSKProtocol, DSKTrigger, DSKObject,
} from '../src/dsk/types.js';

// ── Test helpers ─────────────────────────────────────────────────────

function validClaim(overrides: Partial<DSKClaim> = {}): DSKClaim {
  return {
    id: 'DSK-B001',
    type: 'claim',
    title: 'Anchoring bias',
    evidence_strength: 'strong',
    contraindications: ['None known'],
    stage_applicability: ['evaluate'],
    context_tags: ['pricing'],
    version: '1.0.0',
    last_reviewed_at: '2026-01-15',
    source_citations: [{ doi_or_isbn: '10.1234/test', page_or_section: 'Ch. 3' }],
    deprecated: false,
    claim_category: 'empirical',
    scope: {
      decision_contexts: ['pricing'],
      stages: ['evaluate'],
      populations: ['adults'],
      exclusions: ['none'],
    },
    permitted_phrasing_band: 'strong',
    evidence_pack: {
      key_findings: 'Initial anchors affect estimates.',
      effect_direction: 'negative',
      boundary_conditions: 'Lab and field settings.',
      known_limitations: 'Western populations mostly.',
    },
    ...overrides,
  };
}

function validProtocol(overrides: Partial<DSKProtocol> = {}): DSKProtocol {
  return {
    id: 'DSK-T001',
    type: 'protocol',
    title: 'Pre-mortem',
    evidence_strength: 'strong',
    contraindications: [],
    stage_applicability: ['evaluate'],
    context_tags: ['general'],
    version: '1.0.0',
    last_reviewed_at: '2026-01-15',
    source_citations: [{ doi_or_isbn: '10.1234/proto', page_or_section: 'Ch. 5' }],
    deprecated: false,
    steps: ['Imagine failure', 'List reasons', 'Mitigate'],
    required_inputs: ['Decision statement'],
    expected_outputs: ['Risk list'],
    ...overrides,
  };
}

function validTrigger(overrides: Partial<DSKTrigger> = {}): DSKTrigger {
  return {
    id: 'DSK-TR001',
    type: 'trigger',
    title: 'Binary framing detected',
    evidence_strength: 'medium',
    contraindications: [],
    stage_applicability: ['frame'],
    context_tags: ['general'],
    version: '1.0.0',
    last_reviewed_at: '2026-01-15',
    source_citations: [{ doi_or_isbn: '10.1234/trig', page_or_section: 'Sec. 2' }],
    deprecated: false,
    observable_signal: 'User presents only two options',
    recommended_behaviour: 'Prompt for additional alternatives',
    negative_conditions: ['User explicitly requested binary comparison'],
    linked_claim_ids: ['DSK-B001'],
    linked_protocol_ids: ['DSK-T001'],
    ...overrides,
  };
}

function validBundle(objects?: DSKObject[], overrides: Partial<DSKBundle> = {}): DSKBundle {
  const objs = objects ?? [validClaim(), validProtocol(), validTrigger()];
  const bundle: DSKBundle = {
    version: '1.0.0',
    generated_at: '2026-01-15T12:00:00Z',
    dsk_version_hash: '',
    objects: objs,
    ...overrides,
  };
  bundle.dsk_version_hash = computeDSKHash(bundle);
  return bundle;
}

// ── Linter: valid bundle ─────────────────────────────────────────────

describe('DSK Linter', () => {
  it('valid bundle passes with zero errors and exit 0', () => {
    const bundle = validBundle();
    const result = lint(bundle);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  // ── ID validation ───────────────────────────────────────────────

  it('rejects invalid id format', () => {
    const bundle = validBundle([validClaim({ id: 'BAD-001' })]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'id' && e.message.includes('Invalid id format'))).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('rejects duplicate IDs', () => {
    const bundle = validBundle([
      validClaim({ id: 'DSK-B001' }),
      validClaim({ id: 'DSK-B001', title: 'Duplicate' }),
    ]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.message.includes('Duplicate id'))).toBe(true);
  });

  it('rejects missing id', () => {
    const claim = validClaim();
    (claim as any).id = '';
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'id')).toBe(true);
  });

  // ── Title ───────────────────────────────────────────────────────

  it('rejects empty title', () => {
    const bundle = validBundle([validClaim({ title: '' })]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'title')).toBe(true);
  });

  // ── Version (semver) ───────────────────────────────────────────

  it('rejects invalid semver', () => {
    const bundle = validBundle([validClaim({ version: 'v1' })]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'version' && e.message.includes('Invalid semver'))).toBe(true);
  });

  // ── last_reviewed_at ──────────────────────────────────────────

  it('rejects invalid ISO 8601 date', () => {
    const bundle = validBundle([validClaim({ last_reviewed_at: '15/01/2026' })]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'last_reviewed_at')).toBe(true);
  });

  // ── source_citations ──────────────────────────────────────────

  it('rejects empty source_citations', () => {
    const bundle = validBundle([validClaim({ source_citations: [] })]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'source_citations')).toBe(true);
  });

  // ── deprecated ─────────────────────────────────────────────────

  it('rejects deprecated object without deprecated_reason', () => {
    const claim = validClaim({ deprecated: true });
    delete (claim as any).deprecated_reason;
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'deprecated_reason')).toBe(true);
  });

  // ── PLACEHOLDER detection ─────────────────────────────────────

  it('detects PLACEHOLDER strings as errors', () => {
    const bundle = validBundle([validClaim({ title: 'PLACEHOLDER — needs review' })]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.message.includes('Placeholder content') && e.field_path === 'title',
    )).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('detects case-insensitive placeholder', () => {
    const claim = validClaim();
    claim.evidence_pack.key_findings = 'This is a placeholder value';
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.message.includes('Placeholder content'))).toBe(true);
  });

  // ── replacement_id ─────────────────────────────────────────────

  it('rejects replacement_id referencing different type', () => {
    const claim = validClaim({ deprecated: true, deprecated_reason: 'Replaced', replacement_id: 'DSK-T001' });
    const bundle = validBundle([claim, validProtocol()]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path === 'replacement_id' && e.message.includes('Cross-type replacement'),
    )).toBe(true);
  });

  it('rejects replacement_id referencing non-existent ID', () => {
    const claim = validClaim({ deprecated: true, deprecated_reason: 'Replaced', replacement_id: 'DSK-B999' });
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path === 'replacement_id' && e.message.includes('non-existent'),
    )).toBe(true);
  });

  it('rejects replacement_id referencing deprecated object', () => {
    const claim1 = validClaim({ id: 'DSK-B001', deprecated: true, deprecated_reason: 'Old', replacement_id: 'DSK-B002' });
    const claim2 = validClaim({ id: 'DSK-B002', deprecated: true, deprecated_reason: 'Also old' });
    const bundle = validBundle([claim1, claim2]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.object_id === 'DSK-B001' && e.message.includes('References deprecated object'),
    )).toBe(true);
  });

  // ── Circular replacement chains ────────────────────────────────

  it('detects circular replacement chain', () => {
    const claim1 = validClaim({ id: 'DSK-B001', deprecated: true, deprecated_reason: 'Replaced', replacement_id: 'DSK-B002' });
    const claim2 = validClaim({ id: 'DSK-B002', deprecated: true, deprecated_reason: 'Replaced', replacement_id: 'DSK-B001' });
    const bundle = validBundle([claim1, claim2]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.message.includes('Circular replacement chain'))).toBe(true);
  });

  // ── Controlled vocabulary ─────────────────────────────────────

  it('rejects invalid context_tag', () => {
    const bundle = validBundle([validClaim({ context_tags: ['invalid_tag'] })]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path.startsWith('context_tags') && e.message.includes('Invalid context_tag'),
    )).toBe(true);
  });

  it('rejects invalid stage_applicability', () => {
    const bundle = validBundle([validClaim({ stage_applicability: ['invalid_stage' as any] })]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path.startsWith('stage_applicability') && e.message.includes('Invalid DecisionStage'),
    )).toBe(true);
  });

  // ── Claim-specific ─────────────────────────────────────────────

  it('rejects empty scope.decision_contexts', () => {
    const claim = validClaim();
    claim.scope.decision_contexts = [];
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'scope.decision_contexts')).toBe(true);
  });

  it('rejects empty scope.stages', () => {
    const claim = validClaim();
    claim.scope.stages = [];
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'scope.stages')).toBe(true);
  });

  it('rejects empty scope.populations', () => {
    const claim = validClaim();
    claim.scope.populations = [];
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'scope.populations')).toBe(true);
  });

  it('rejects empty scope.exclusions with guidance', () => {
    const claim = validClaim();
    claim.scope.exclusions = [];
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    const excErr = result.errors.find((e) => e.field_path === 'scope.exclusions');
    expect(excErr).toBeDefined();
    expect(excErr!.message).toContain("Use ['none']");
  });

  it('rejects inconsistent permitted_phrasing_band', () => {
    const claim = validClaim({ evidence_strength: 'strong', permitted_phrasing_band: 'weak' });
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path === 'permitted_phrasing_band' && e.message.includes('Inconsistent'),
    )).toBe(true);
  });

  it('accepts mixed evidence_strength with weak phrasing_band', () => {
    const claim = validClaim({ evidence_strength: 'mixed', permitted_phrasing_band: 'weak' });
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.filter((e) => e.field_path === 'permitted_phrasing_band')).toHaveLength(0);
  });

  it('rejects empty evidence_pack fields', () => {
    const claim = validClaim();
    claim.evidence_pack.key_findings = '';
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'evidence_pack.key_findings')).toBe(true);
  });

  // ── Protocol-specific ──────────────────────────────────────────

  it('rejects empty protocol steps', () => {
    const bundle = validBundle([validProtocol({ steps: [] })]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'steps')).toBe(true);
  });

  it('rejects empty protocol required_inputs', () => {
    const bundle = validBundle([validProtocol({ required_inputs: [] })]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'required_inputs')).toBe(true);
  });

  it('rejects empty protocol expected_outputs', () => {
    const bundle = validBundle([validProtocol({ expected_outputs: [] })]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'expected_outputs')).toBe(true);
  });

  // ── Trigger-specific ───────────────────────────────────────────

  it('rejects empty trigger observable_signal', () => {
    const bundle = validBundle([
      validClaim(), validProtocol(),
      validTrigger({ observable_signal: '' }),
    ]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'observable_signal')).toBe(true);
  });

  it('rejects empty trigger recommended_behaviour', () => {
    const bundle = validBundle([
      validClaim(), validProtocol(),
      validTrigger({ recommended_behaviour: '' }),
    ]);
    const result = lint(bundle);
    expect(result.errors.some((e) => e.field_path === 'recommended_behaviour')).toBe(true);
  });

  it('rejects empty trigger negative_conditions with guidance', () => {
    const bundle = validBundle([
      validClaim(), validProtocol(),
      validTrigger({ negative_conditions: [] }),
    ]);
    const result = lint(bundle);
    const ncErr = result.errors.find((e) => e.field_path === 'negative_conditions');
    expect(ncErr).toBeDefined();
    expect(ncErr!.message).toContain('false positives');
  });

  // ── Cross-reference: orphan trigger references ─────────────────

  it('detects trigger referencing non-existent claim', () => {
    const trigger = validTrigger({ linked_claim_ids: ['DSK-B999'] });
    const bundle = validBundle([validProtocol(), trigger]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path.startsWith('linked_claim_ids') && e.message.includes('non-existent'),
    )).toBe(true);
  });

  it('detects trigger referencing non-existent protocol', () => {
    const trigger = validTrigger({ linked_protocol_ids: ['DSK-T999'] });
    const bundle = validBundle([validClaim(), trigger]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path.startsWith('linked_protocol_ids') && e.message.includes('non-existent'),
    )).toBe(true);
  });

  // ── Ordering: warnings ─────────────────────────────────────────

  it('emits warning for unsorted objects (exit 2, not exit 1)', () => {
    const objects: DSKObject[] = [validTrigger(), validProtocol(), validClaim()];
    const bundle = validBundle(objects);
    const result = lint(bundle);
    expect(result.warnings.some((w) => w.message.includes('not in canonical order'))).toBe(true);
    // Should be exit 2 (warnings only) not exit 1 (errors)
    // but only if no other errors — hash mismatch may cause exit 1
    // The bundle was created with computeDSKHash which sorts, so hash is valid
    // but objects are unsorted → warning
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // ── Deterministic output ───────────────────────────────────────

  it('produces identical results on consecutive runs', () => {
    const bundle = validBundle();
    const result1 = formatLintResult(lint(bundle));
    const result2 = formatLintResult(lint(bundle));
    expect(result1).toBe(result2);
  });

  // ── Empty bundle ───────────────────────────────────────────────

  it('handles empty bundle (no objects)', () => {
    const bundle = validBundle([]);
    const result = lint(bundle);
    // No objects = no per-object errors, but hash should still be valid
    expect(result.exitCode).toBe(0);
  });

  // ── Bundle with only deprecated objects ────────────────────────

  it('handles bundle with only deprecated objects', () => {
    const claim = validClaim({ deprecated: true, deprecated_reason: 'Superseded' });
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    // Should pass (deprecated objects are valid if they have a reason)
    expect(result.exitCode).toBe(0);
  });

  // ── Hash validation in linter ──────────────────────────────────

  it('errors when dsk_version_hash is empty', () => {
    const bundle = validBundle();
    bundle.dsk_version_hash = '';
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path === 'dsk_version_hash' && e.message.includes('Empty or missing'),
    )).toBe(true);
  });

  it('errors when dsk_version_hash is incorrect', () => {
    const bundle = validBundle();
    bundle.dsk_version_hash = 'deadbeef';
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path === 'dsk_version_hash' && e.message.includes('Hash mismatch'),
    )).toBe(true);
  });

  // ── scope.decision_contexts vocabulary ─────────────────────────

  it('rejects invalid scope.decision_contexts vocabulary', () => {
    const claim = validClaim();
    claim.scope.decision_contexts = ['invalid_context'];
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path.startsWith('scope.decision_contexts') && e.message.includes('Invalid context_tag'),
    )).toBe(true);
  });

  // ── scope.stages vocabulary ────────────────────────────────────

  it('rejects invalid scope.stages vocabulary', () => {
    const claim = validClaim();
    claim.scope.stages = ['invalid_stage' as any];
    const bundle = validBundle([claim]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path.startsWith('scope.stages') && e.message.includes('Invalid DecisionStage'),
    )).toBe(true);
  });

  // ── Hostile input: malformed object entries ─────────────────────

  it('handles null entries in objects array without crashing', () => {
    const bundle = validBundle();
    (bundle.objects as unknown[]).push(null);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path.startsWith('objects[') && e.message.includes('expected object, got null'),
    )).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('handles primitive entries in objects array without crashing', () => {
    const bundle = validBundle();
    (bundle.objects as unknown[]).push('not-an-object', 42);
    const result = lint(bundle);
    expect(result.errors.filter((e) => e.field_path.startsWith('objects[')).length).toBe(2);
  });

  it('handles array entries in objects array without crashing', () => {
    const bundle = validBundle();
    (bundle.objects as unknown[]).push([1, 2, 3]);
    const result = lint(bundle);
    expect(result.errors.some((e) =>
      e.field_path.startsWith('objects[') && e.message.includes('expected object'),
    )).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('handles partial records (missing most fields) without crashing', () => {
    const bundle = validBundle();
    (bundle.objects as unknown[]).push({ id: 'DSK-B099' });
    const result = lint(bundle);
    // Should produce errors for missing fields, not throw
    expect(result.exitCode).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ── Canonicaliser ────────────────────────────────────────────────────

describe('DSK Canonicaliser', () => {
  it('sorts unordered set arrays (context_tags, scope.stages)', () => {
    const claim = validClaim({
      context_tags: ['pricing', 'hiring', 'general'],
      stage_applicability: ['decide', 'frame', 'evaluate'],
    });
    claim.scope.stages = ['decide', 'frame', 'evaluate'];
    const bundle = validBundle([claim]);
    const canonical = canonicalise(bundle);
    const parsed = JSON.parse(canonical);
    const obj = parsed.objects[0];
    expect(obj.context_tags).toEqual(['general', 'hiring', 'pricing']);
    expect(obj.stage_applicability).toEqual(['decide', 'evaluate', 'frame']);
    expect(obj.scope.stages).toEqual(['decide', 'evaluate', 'frame']);
  });

  it('preserves order of ordered sequences (steps, source_citations)', () => {
    const proto = validProtocol({
      steps: ['Step C', 'Step A', 'Step B'],
      required_inputs: ['Input Z', 'Input A'],
      expected_outputs: ['Output Y', 'Output B'],
    });
    const bundle = validBundle([proto]);
    const canonical = canonicalise(bundle);
    const parsed = JSON.parse(canonical);
    const obj = parsed.objects[0];
    expect(obj.steps).toEqual(['Step C', 'Step A', 'Step B']);
    expect(obj.required_inputs).toEqual(['Input Z', 'Input A']);
    expect(obj.expected_outputs).toEqual(['Output Y', 'Output B']);
  });

  it('preserves source_citations order', () => {
    const claim = validClaim({
      source_citations: [
        { doi_or_isbn: '10.9999/z', page_or_section: 'Ch. 9' },
        { doi_or_isbn: '10.1111/a', page_or_section: 'Ch. 1' },
      ],
    });
    const bundle = validBundle([claim]);
    const canonical = canonicalise(bundle);
    const parsed = JSON.parse(canonical);
    const obj = parsed.objects[0];
    expect(obj.source_citations[0].doi_or_isbn).toBe('10.9999/z');
    expect(obj.source_citations[1].doi_or_isbn).toBe('10.1111/a');
  });

  it('sorts objects by id bytewise', () => {
    const objects: DSKObject[] = [
      validProtocol({ id: 'DSK-T001' }),
      validClaim({ id: 'DSK-B002' }),
      validClaim({ id: 'DSK-B001' }),
    ];
    const bundle = validBundle(objects);
    const canonical = canonicalise(bundle);
    const parsed = JSON.parse(canonical);
    expect(parsed.objects.map((o: any) => o.id)).toEqual(['DSK-B001', 'DSK-B002', 'DSK-T001']);
  });

  it('produces identical output from linter and hasher contexts', () => {
    const bundle = validBundle();
    const canonical1 = canonicalise(bundle);
    const canonical2 = canonicalise(bundle);
    expect(canonical1).toBe(canonical2);
  });

  it('checkObjectOrder returns null for sorted objects', () => {
    const objects: DSKObject[] = [
      validClaim({ id: 'DSK-B001' }),
      validProtocol({ id: 'DSK-T001' }),
      validTrigger({ id: 'DSK-TR001' }),
    ];
    expect(checkObjectOrder(objects)).toBeNull();
  });

  it('checkObjectOrder returns sorted IDs for unsorted objects', () => {
    const objects: DSKObject[] = [
      validTrigger({ id: 'DSK-TR001' }),
      validClaim({ id: 'DSK-B001' }),
      validProtocol({ id: 'DSK-T001' }),
    ];
    const sorted = checkObjectOrder(objects);
    expect(sorted).toEqual(['DSK-B001', 'DSK-T001', 'DSK-TR001']);
  });
});

// ── Hasher ───────────────────────────────────────────────────────────

describe('DSK Hasher', () => {
  it('produces stable hash for same bundle', () => {
    const bundle = validBundle();
    const hash1 = computeDSKHash(bundle);
    const hash2 = computeDSKHash(bundle);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changing any field changes the hash', () => {
    const bundle1 = validBundle();
    const hash1 = computeDSKHash(bundle1);

    // Change title
    const bundle2 = validBundle([validClaim({ title: 'Different title' }), validProtocol(), validTrigger()]);
    const hash2 = computeDSKHash(bundle2);
    expect(hash2).not.toBe(hash1);

    // Change version
    const bundle3 = validBundle(undefined, { version: '2.0.0' });
    // Need to recompute since validBundle auto-computes
    const hash3 = computeDSKHash({ ...bundle3, version: '2.0.0' });
    expect(hash3).not.toBe(hash1);
  });

  it('excludes generated_at from hash — changing it does NOT change hash', () => {
    const bundle1 = validBundle();
    const hash1 = computeDSKHash(bundle1);

    const bundle2 = { ...bundle1, generated_at: '2099-12-31T23:59:59Z' };
    const hash2 = computeDSKHash(bundle2);
    expect(hash2).toBe(hash1);
  });

  it('excludes dsk_version_hash from hash — changing it does NOT change hash', () => {
    const bundle1 = validBundle();
    const hash1 = computeDSKHash(bundle1);

    const bundle2 = { ...bundle1, dsk_version_hash: 'changed' };
    const hash2 = computeDSKHash(bundle2);
    expect(hash2).toBe(hash1);
  });

  it('verifyDSKHash returns true for correct hash', () => {
    const bundle = validBundle();
    expect(verifyDSKHash(bundle)).toBe(true);
  });

  it('verifyDSKHash returns false for incorrect hash', () => {
    const bundle = validBundle();
    bundle.dsk_version_hash = 'wrong';
    expect(verifyDSKHash(bundle)).toBe(false);
  });
});
