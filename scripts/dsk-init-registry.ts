#!/usr/bin/env npx tsx
/**
 * DSK Claim ID Registry Generator
 *
 * Generates a skeleton DSK bundle with allocated IDs and placeholder content.
 * The linter will fail on this skeleton (placeholders aren't valid), but
 * the IDs are usable immediately.
 *
 * Usage:
 *   npx tsx scripts/dsk-init-registry.ts
 *
 * Output: data/dsk/v1.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { computeDSKHash } from '../src/dsk/hash.js';
import type {
  DSKBundle, DSKClaim, DSKProtocol, DSKTrigger,
} from '../src/dsk/types.js';

// ── Planned objects ──────────────────────────────────────────────────

const planned = {
  claims: [
    { id: 'DSK-B001', title: 'Anchoring bias' },
    { id: 'DSK-B002', title: 'Confirmation bias' },
    { id: 'DSK-B003', title: 'Sunk cost fallacy' },
    { id: 'DSK-B004', title: 'Overconfidence' },
    { id: 'DSK-B005', title: 'Availability heuristic' },
    { id: 'DSK-B006', title: 'Status quo bias' },
    { id: 'DSK-B007', title: 'Narrow framing' },
    { id: 'DSK-B008', title: 'Planning fallacy' },
  ],
  protocols: [
    { id: 'DSK-T001', title: 'Pre-mortem' },
    { id: 'DSK-T002', title: 'Disconfirmation' },
    { id: 'DSK-T003', title: 'Outside view / base rates' },
    { id: 'DSK-T004', title: '10-10-10' },
    { id: 'DSK-T005', title: 'Devils advocate' },
    { id: 'DSK-T006', title: 'Evidence typing' },
  ],
  triggers: [
    { id: 'DSK-TR001', title: 'Binary framing detected' },
    { id: 'DSK-TR002', title: 'Certainty language detected' },
    { id: 'DSK-TR003', title: 'Sunk cost language detected' },
    { id: 'DSK-TR004', title: 'Defaulted confidence cluster' },
    { id: 'DSK-TR005', title: 'Single dominant factor' },
  ],
};

// ── Skeleton builders ────────────────────────────────────────────────

function makeClaim(id: string, title: string): DSKClaim {
  return {
    id,
    type: 'claim',
    title,
    evidence_strength: 'medium',
    contraindications: ['PLACEHOLDER — needs review'],
    stage_applicability: ['evaluate'],
    context_tags: ['general'],
    version: '0.1.0',
    last_reviewed_at: new Date().toISOString().split('T')[0]!,
    source_citations: [{
      doi_or_isbn: 'PLACEHOLDER — needs review',
      page_or_section: 'PLACEHOLDER — needs review',
    }],
    deprecated: false,
    claim_category: 'empirical',
    scope: {
      decision_contexts: ['general'],
      stages: ['evaluate'],
      populations: ['PLACEHOLDER — needs review'],
      exclusions: ['PLACEHOLDER — needs review'],
    },
    permitted_phrasing_band: 'medium',
    evidence_pack: {
      key_findings: 'PLACEHOLDER — needs review',
      effect_direction: 'negative',
      boundary_conditions: 'PLACEHOLDER — needs review',
      known_limitations: 'PLACEHOLDER — needs review',
    },
  };
}

function makeProtocol(id: string, title: string): DSKProtocol {
  return {
    id,
    type: 'protocol',
    title,
    evidence_strength: 'medium',
    contraindications: ['PLACEHOLDER — needs review'],
    stage_applicability: ['evaluate'],
    context_tags: ['general'],
    version: '0.1.0',
    last_reviewed_at: new Date().toISOString().split('T')[0]!,
    source_citations: [{
      doi_or_isbn: 'PLACEHOLDER — needs review',
      page_or_section: 'PLACEHOLDER — needs review',
    }],
    deprecated: false,
    steps: ['PLACEHOLDER — needs review'],
    required_inputs: ['PLACEHOLDER — needs review'],
    expected_outputs: ['PLACEHOLDER — needs review'],
  };
}

function makeTrigger(id: string, title: string): DSKTrigger {
  return {
    id,
    type: 'trigger',
    title,
    evidence_strength: 'medium',
    contraindications: ['PLACEHOLDER — needs review'],
    stage_applicability: ['evaluate'],
    context_tags: ['general'],
    version: '0.1.0',
    last_reviewed_at: new Date().toISOString().split('T')[0]!,
    source_citations: [{
      doi_or_isbn: 'PLACEHOLDER — needs review',
      page_or_section: 'PLACEHOLDER — needs review',
    }],
    deprecated: false,
    observable_signal: 'PLACEHOLDER — needs review',
    recommended_behaviour: 'PLACEHOLDER — needs review',
    negative_conditions: ['PLACEHOLDER — needs review'],
    linked_claim_ids: [],
    linked_protocol_ids: [],
  };
}

// ── Generate bundle ──────────────────────────────────────────────────

const objects = [
  ...planned.claims.map((c) => makeClaim(c.id, c.title)),
  ...planned.protocols.map((p) => makeProtocol(p.id, p.title)),
  ...planned.triggers.map((t) => makeTrigger(t.id, t.title)),
].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const bundle: DSKBundle = {
  version: '0.1.0',
  generated_at: new Date().toISOString(),
  dsk_version_hash: '', // computed below
  objects,
};

bundle.dsk_version_hash = computeDSKHash(bundle);

// ── Write output ─────────────────────────────────────────────────────

const outPath = resolve('data/dsk/v1.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');

console.log(`Generated ${outPath}`);
console.log(`  ${objects.length} objects (${planned.claims.length} claims, ${planned.protocols.length} protocols, ${planned.triggers.length} triggers)`);
console.log(`  Hash: ${bundle.dsk_version_hash}`);
console.log('');
console.log('Run `npm run dsk:lint` to see placeholder errors that need review.');
