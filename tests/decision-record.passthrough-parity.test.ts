/**
 * Decision-record pass-through parity (ROADMAP 3.1 — Platform lane).
 *
 * The Supabase migration `20260710113000_v5_decision_records.sql`
 * (olumi-assistants-service PR #406) stores decision records with column
 * names + JSONB shapes that mirror @talchain/schemas 0.15.0
 * DecisionRecordSchema VERBATIM, and its RPCs return a `record` key built
 * with a single jsonb_build_object — the contract's own comment requires
 * "FIELD NAMES MUST MATCH THIS SCHEMA EXACTLY so the API layer between
 * them is a pass-through, not a translation layer."
 *
 * These fixtures are byte-shaped exactly like the RPC `record` envelope
 * (to_jsonb(timestamptz) offset ISO-8601 timestamps, jsonb_strip_nulls
 * omitting the absent `outcome`, `aag_v1:`-prefixed graph_hash regime).
 * They MUST parse under DecisionRecordSchema.strict(). Any rename on
 * either side (DDL or schema) breaks this test — that is the point: it
 * pins DDL↔wire field-name parity in CI, where the SQL itself cannot run.
 *
 * RED until the vendored @talchain/schemas pin reaches 0.15.0 (the schema
 * does not exist in 0.14.0).
 */

import { describe, it, expect } from 'vitest';
import {
  DecisionRecordSchema,
  DecisionRecordAnalysisSummarySchema,
} from '@talchain/schemas/boundary';

/**
 * Exactly what `create_decision_record` returns under its `record` key for
 * a freshly-captured decision (pre-outcome): `outcome` is stripped by
 * jsonb_strip_nulls, timestamps are to_jsonb(timestamptz) offset ISO-8601,
 * graph_hash carries the ratified `aag_v1:sha256:<64-hex>` regime prefix
 * (CEE computeAnalysisAffectingGraphHash — orchestrator ruling 2026-07-10).
 */
const PRE_OUTCOME_RECORD = {
  record_id: '7a1de5c0-3b58-4f6e-9a11-52dbb0f6b90c',
  scenario_id: 'd65ef101-0d8f-4b1a-a6a3-1f2c3d4e5f60',
  created_at: '2026-07-10T11:30:00.123456+00:00',
  decision: {
    chosen_option_id: 'option_hybrid',
    chosen_option_label: 'Hybrid consolidation',
    graph_hash:
      'aag_v1:sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    analysis_summary: {
      leading_option: 'Hybrid consolidation',
      win_probability: 0.92,
      goal_fit: 0.687,
      robustness_band: 'moderate',
    },
  },
  prediction: {
    statement: 'Sprint velocity rises at least 20% within two quarters.',
    confidence: 0.7,
  },
  review_date: '2026-10-10T09:00:00+00:00',
};

/**
 * The same record after `record_decision_outcome`: outcome present,
 * write-once. brier_component = (1 - 0.7)^2 for a confident hit.
 */
const POST_OUTCOME_RECORD = {
  ...PRE_OUTCOME_RECORD,
  outcome: {
    recorded_at: '2026-10-11T15:45:12.000001+00:00',
    result: 'as_expected',
    notes: 'Velocity +23% by mid-October.',
    brier_component: 0.09,
  },
};

describe('decision-record pass-through parity (schemas 0.15.0 ↔ migration 20260710113000)', () => {
  it('parses the pre-outcome RPC record envelope under DecisionRecordSchema.strict()', () => {
    const parsed = DecisionRecordSchema.safeParse(PRE_OUTCOME_RECORD);
    expect(
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2),
    ).toBe(true);
  });

  it('parses the post-outcome RPC record envelope under DecisionRecordSchema.strict()', () => {
    const parsed = DecisionRecordSchema.safeParse(POST_OUTCOME_RECORD);
    expect(
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2),
    ).toBe(true);
  });

  it('is genuinely strict — RPC-envelope metadata keys must live BESIDE record, never inside it', () => {
    // The RPCs return { record, deduped, event_id }; deduped/event_id inside
    // the record itself would break the strict contract parse.
    const contaminated = { ...PRE_OUTCOME_RECORD, deduped: false };
    expect(DecisionRecordSchema.safeParse(contaminated).success).toBe(false);
  });

  it('pins the outcome result vocabulary to the migration CHECK constraint', () => {
    // Same closed set as dr_outcome_shape: better|as_expected|worse|abandoned.
    for (const result of ['better', 'as_expected', 'worse', 'abandoned']) {
      const rec = {
        ...POST_OUTCOME_RECORD,
        outcome: { ...POST_OUTCOME_RECORD.outcome, result },
      };
      expect(DecisionRecordSchema.safeParse(rec).success).toBe(true);
    }
    const bad = {
      ...POST_OUTCOME_RECORD,
      outcome: { ...POST_OUTCOME_RECORD.outcome, result: 'mixed' },
    };
    expect(DecisionRecordSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts an analysis-summary-less decision (optional-forward by design)', () => {
    const { analysis_summary: _omitted, ...bareDecision } = PRE_OUTCOME_RECORD.decision;
    const rec = { ...PRE_OUTCOME_RECORD, decision: bareDecision };
    expect(DecisionRecordSchema.safeParse(rec).success).toBe(true);
  });

  it('analysis_summary sub-shape matches DecisionRecordAnalysisSummarySchema.strict()', () => {
    const parsed = DecisionRecordAnalysisSummarySchema.safeParse(
      PRE_OUTCOME_RECORD.decision.analysis_summary,
    );
    expect(parsed.success).toBe(true);
  });
});
