/**
 * Weight Schema Tests
 *
 * Phase 2: Schema & Contracts - Task 2.1
 * Tests for weight normalisation, schema versioning, and migration.
 */

import { describe, it, expect } from 'vitest';
import {
  normaliseWeight,
  weightFromUI,
  weightToUI,
  normaliseGraphWeights,
  isWeightInBounds,
  getWeightBounds,
  detectWeightSchema,
  getMigrationPath,
  WEIGHT_SCHEMAS,
  DEFAULT_WEIGHT_SCHEMA,
  INTERNAL_WEIGHT_SCHEMA,
  type WeightSchemaVersion,
} from '../src/engine/weight-schema.js';

describe('Weight Schema Definitions', () => {
  it('defines v1 schema with [-1, +1] bounds', () => {
    const v1 = WEIGHT_SCHEMAS.v1;
    expect(v1.min_bound).toBe(-1);
    expect(v1.max_bound).toBe(1);
    expect(v1.ui_default).toBe(true);
  });

  it('defines v2 schema with [-3, +3] bounds', () => {
    const v2 = WEIGHT_SCHEMAS.v2;
    expect(v2.min_bound).toBe(-3);
    expect(v2.max_bound).toBe(3);
    expect(v2.ui_default).toBe(false);
  });

  it('defines v3 schema as unbounded', () => {
    const v3 = WEIGHT_SCHEMAS.v3;
    expect(v3.min_bound).toBe(null);
    expect(v3.max_bound).toBe(null);
    expect(v3.ui_default).toBe(false);
  });

  it('default schema is v2', () => {
    expect(DEFAULT_WEIGHT_SCHEMA).toBe('v2');
  });

  it('internal schema is v3 (unbounded)', () => {
    expect(INTERNAL_WEIGHT_SCHEMA).toBe('v3');
  });
});

describe('Weight Normalisation', () => {
  describe('Same schema conversion', () => {
    it('v1 to v1 returns same value', () => {
      const result = normaliseWeight(0.5, 'v1', 'v1');
      expect(result.weight).toBe(0.5);
      expect(result.clamped).toBe(false);
    });

    it('v2 to v2 returns same value', () => {
      const result = normaliseWeight(2.5, 'v2', 'v2');
      expect(result.weight).toBe(2.5);
      expect(result.clamped).toBe(false);
    });
  });

  describe('v1 to v2 conversion', () => {
    it('scales 0 to 0', () => {
      const result = normaliseWeight(0, 'v1', 'v2');
      expect(result.weight).toBe(0);
    });

    it('scales 1 to 3', () => {
      const result = normaliseWeight(1, 'v1', 'v2');
      expect(result.weight).toBe(3);
    });

    it('scales -1 to -3', () => {
      const result = normaliseWeight(-1, 'v1', 'v2');
      expect(result.weight).toBe(-3);
    });

    it('scales 0.5 to 1.5', () => {
      const result = normaliseWeight(0.5, 'v1', 'v2');
      expect(result.weight).toBe(1.5);
    });
  });

  describe('v2 to v1 conversion', () => {
    it('scales 3 to 1', () => {
      const result = normaliseWeight(3, 'v2', 'v1');
      expect(result.weight).toBe(1);
    });

    it('scales -3 to -1', () => {
      const result = normaliseWeight(-3, 'v2', 'v1');
      expect(result.weight).toBe(-1);
    });

    it('clamps values outside bounds', () => {
      const result = normaliseWeight(5, 'v2', 'v1');
      expect(result.weight).toBe(1);
      expect(result.clamped).toBe(true);
      expect(result.warning).toContain('clamped');
    });
  });

  describe('To unbounded (v3) conversion', () => {
    it('v1 to v3 passes through unchanged', () => {
      const result = normaliseWeight(0.8, 'v1', 'v3');
      expect(result.weight).toBe(0.8);
      expect(result.clamped).toBe(false);
    });

    it('v2 to v3 passes through unchanged', () => {
      const result = normaliseWeight(2.5, 'v2', 'v3');
      expect(result.weight).toBe(2.5);
      expect(result.clamped).toBe(false);
    });
  });

  describe('From unbounded (v3) conversion', () => {
    it('v3 to v1 clamps large values', () => {
      const result = normaliseWeight(5, 'v3', 'v1');
      expect(result.weight).toBe(1);
      expect(result.clamped).toBe(true);
    });

    it('v3 to v2 clamps large values', () => {
      const result = normaliseWeight(10, 'v3', 'v2');
      expect(result.weight).toBe(3);
      expect(result.clamped).toBe(true);
    });

    it('v3 to v1 passes small values unchanged', () => {
      const result = normaliseWeight(0.5, 'v3', 'v1');
      expect(result.weight).toBe(0.5);
      expect(result.clamped).toBe(false);
    });
  });
});

describe('UI Weight Conversion', () => {
  describe('weightFromUI', () => {
    it('accepts v1 weights', () => {
      expect(weightFromUI(0.5, 'v1')).toBe(0.5);
      expect(weightFromUI(-1, 'v1')).toBe(-1);
      expect(weightFromUI(1, 'v1')).toBe(1);
    });

    it('accepts v2 weights', () => {
      expect(weightFromUI(2.5, 'v2')).toBe(2.5);
    });
  });

  describe('weightToUI', () => {
    it('converts to v1 with clamping', () => {
      const result = weightToUI(5, 'v1');
      expect(result.weight).toBe(1);
      expect(result.clamped).toBe(true);
    });

    it('converts to v2 with clamping', () => {
      const result = weightToUI(10, 'v2');
      expect(result.weight).toBe(3);
      expect(result.clamped).toBe(true);
    });

    it('preserves small values', () => {
      const result = weightToUI(0.5, 'v1');
      expect(result.weight).toBe(0.5);
      expect(result.clamped).toBe(false);
    });
  });
});

describe('Graph Weight Normalisation', () => {
  it('normalises all edge weights', () => {
    const edges = [
      { from: 'A', to: 'B', weight: 0.5 },
      { from: 'B', to: 'C', weight: 1.0 },
      { from: 'C', to: 'D', weight: -0.5 },
    ];

    const result = normaliseGraphWeights(edges, 'v1', 'v2');

    expect(result.edges[0].weight).toBe(1.5);
    expect(result.edges[1].weight).toBe(3);
    expect(result.edges[2].weight).toBe(-1.5);
    expect(result.metadata.weight_schema_version).toBe('v2');
    expect(result.metadata.normalised).toBe(true);
    expect(result.metadata.original_schema).toBe('v1');
  });

  it('preserves edges without weights', () => {
    const edges = [
      { from: 'A', to: 'B', weight: 0.5 },
      { from: 'B', to: 'C' }, // No weight
    ];

    const result = normaliseGraphWeights(edges, 'v1', 'v2');

    expect(result.edges[0].weight).toBe(1.5);
    expect(result.edges[1].weight).toBeUndefined();
  });

  it('collects warnings for clamped values', () => {
    const edges = [
      { from: 'A', to: 'B', weight: 5 }, // Will be clamped
    ];

    const result = normaliseGraphWeights(edges, 'v3', 'v1');

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('A->B');
    expect(result.warnings[0]).toContain('clamped');
  });
});

describe('Weight Bounds Checking', () => {
  describe('isWeightInBounds', () => {
    it('returns true for v1 bounds', () => {
      expect(isWeightInBounds(0.5, 'v1')).toBe(true);
      expect(isWeightInBounds(-1, 'v1')).toBe(true);
      expect(isWeightInBounds(1, 'v1')).toBe(true);
    });

    it('returns false for out-of-bounds v1', () => {
      expect(isWeightInBounds(1.5, 'v1')).toBe(false);
      expect(isWeightInBounds(-1.5, 'v1')).toBe(false);
    });

    it('returns true for any v3 value', () => {
      expect(isWeightInBounds(1000, 'v3')).toBe(true);
      expect(isWeightInBounds(-1000, 'v3')).toBe(true);
    });
  });

  describe('getWeightBounds', () => {
    it('returns v1 bounds', () => {
      expect(getWeightBounds('v1')).toEqual([-1, 1]);
    });

    it('returns v2 bounds', () => {
      expect(getWeightBounds('v2')).toEqual([-3, 3]);
    });

    it('returns null for unbounded v3', () => {
      expect(getWeightBounds('v3')).toEqual([null, null]);
    });
  });
});

describe('Weight Schema Detection', () => {
  it('detects v1 for weights in [-1, 1]', () => {
    expect(detectWeightSchema([0.5, -0.5, 1, -1])).toBe('v1');
  });

  it('detects v2 for weights in [-3, 3]', () => {
    expect(detectWeightSchema([0.5, 2, -2.5])).toBe('v2');
  });

  it('detects v3 for large weights', () => {
    expect(detectWeightSchema([0.5, 10, -5])).toBe('v3');
  });

  it('returns default for empty array', () => {
    expect(detectWeightSchema([])).toBe(DEFAULT_WEIGHT_SCHEMA);
  });
});

describe('Migration Path', () => {
  it('returns no migration for same schema', () => {
    const path = getMigrationPath('v1', 'v1');
    expect(path?.method).toBe('No migration needed');
    expect(path?.reversible).toBe(true);
  });

  it('returns reversible migration for v1 to v2', () => {
    const path = getMigrationPath('v1', 'v2');
    expect(path?.method).toContain('×3');
    expect(path?.reversible).toBe(true);
  });

  it('returns non-reversible migration for v3 to v1', () => {
    const path = getMigrationPath('v3', 'v1');
    expect(path?.method).toContain('Clamping');
    expect(path?.reversible).toBe(false);
    expect(path?.warning).toContain('lose information');
  });

  it('returns reversible migration for v2 to v3', () => {
    const path = getMigrationPath('v2', 'v3');
    expect(path?.method).toContain('pass-through');
    expect(path?.reversible).toBe(true);
  });
});
