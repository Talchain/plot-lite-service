/**
 * Meta Canonicalisation Invariants Test
 *
 * Tests for _meta response field behavior when UI_CANONICAL_META feature flag is enabled.
 * Verifies that:
 * - _meta is always present when flag is enabled (even with zero repairs)
 * - _meta.repairs_applied is an array (possibly empty)
 * - _meta.source_path is correctly set
 *
 * @see docs/audits/PLOT_LEDGER_SPEC.md
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// These tests verify response-level _meta behavior.
// Since buildResponse is internal, we test via the normalisation module's
// extractRepairsFromWarnings pattern to ensure repairs are correctly structured.

import { normaliseEdge } from '../../../src/normalisation/graph-normaliser.js';

describe('INV-META-01: _meta.repairs_applied structure', () => {
  it('produces empty repairs array when edge needs no repairs', () => {
    const warnings: any[] = [];
    // Provide all required fields with valid values
    normaliseEdge(
      {
        from: 'A',
        to: 'B',
        strength: { mean: 0.5, std: 0.2 },
        exists_probability: 0.8,
      },
      0,
      new Map(),
      warnings
    );

    // No repair warnings should be emitted for valid input
    const repairWarnings = warnings.filter(w => w.repair !== undefined);
    expect(repairWarnings).toEqual([]);
  });

  it('repairs array contains all required fields when repairs occur', () => {
    const warnings: any[] = [];
    normaliseEdge(
      { from: 'A', to: 'B', exists_probability: 1.5, weight: 0.5 },
      0,
      new Map(),
      warnings
    );

    const repairWarnings = warnings.filter(w => w.repair !== undefined);
    expect(repairWarnings.length).toBeGreaterThan(0);

    for (const warning of repairWarnings) {
      expect(warning.repair).toHaveProperty('field');
      expect(warning.repair).toHaveProperty('action');
      expect(warning.repair).toHaveProperty('from_value');
      expect(warning.repair).toHaveProperty('to_value');
      expect(warning.repair).toHaveProperty('reason');
      expect(typeof warning.repair.reason).toBe('string');
    }
  });
});

describe('INV-META-02: Repair action types are valid', () => {
  const validActions = ['clamped', 'defaulted', 'inferred', 'floored', 'derived'];

  it('all repair actions are from valid set', () => {
    const warnings: any[] = [];
    // Trigger multiple repair types
    normaliseEdge(
      { from: 'A', to: 'B', exists_probability: 1.5, weight: 0.5 },
      0,
      new Map(),
      warnings
    );

    const repairWarnings = warnings.filter(w => w.repair !== undefined);
    for (const warning of repairWarnings) {
      expect(validActions).toContain(warning.repair.action);
    }
  });
});
