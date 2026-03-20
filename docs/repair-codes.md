# PLoT Repair Code Inventory

Single source of truth: [`src/normalisation/repair-codes.ts`](../src/normalisation/repair-codes.ts)

Every graph normalisation transform that modifies a value logs a `RepairEntry` with one of these codes. Repairs appear in `_meta.repairs_applied` on the V2 run response.

> **Drift prevention:** This document is manually maintained and can fall out of sync with the `REPAIR_CODES` enum. If you add or remove a code in `repair-codes.ts`, update this file to match. Consider adding a CI check that diffs the `REPAIR_CODES` keys against the codes documented here.

## RepairEntry shape

```typescript
interface RepairEntry {
  code: RepairCode;          // Canonical code from table below
  layer: 'plot';             // Always 'plot' for PLoT transforms
  field_path: string;        // Dotted path (e.g., 'a->b.exists_probability')
  before: unknown;           // Value before repair (null if missing)
  after: unknown;            // Value after repair
  reason: string;            // Human-readable reason
  severity: 'info' | 'warn'; // 'info' = silent default, 'warn' = user-visible
  action: RepairAction;      // 'clamped'|'defaulted'|'inferred'|'floored'|'derived'|'normalised'|'removed'
}
```

## Edge repairs — exists_probability

| Code | Description | Trigger | Default / Range | Severity |
|------|-------------|---------|-----------------|----------|
| `DEFAULT_EXISTS_PROBABILITY` | Missing `exists_probability` defaulted | Field absent after fallback chain (`exists_probability` → `belief_exists` → `belief`) | 0.8 | info |
| `CLAMP_EXISTS_PROBABILITY` | Value outside valid range, clamped | `exists_probability` < 0 or > 1 | Clamped to [0, 1] | warn |
| `INVALID_EXISTS_PROBABILITY` | Non-numeric value replaced | `typeof` is not `number` or not finite | 0.8 | warn |

## Edge repairs — strength.mean

| Code | Description | Trigger | Default / Range | Severity |
|------|-------------|---------|-----------------|----------|
| `DEFAULT_STRENGTH_MEAN` | Missing `strength.mean` derived | No explicit mean from nested (`strength.mean`) or flat (`strength_mean`) format | 0.5 (DEFAULT_WEIGHT) | info |
| `INVALID_STRENGTH_MEAN` | Non-numeric mean replaced | `typeof` is not `number` or not finite | 0.5 | warn |
| `CLAMP_STRENGTH_MEAN` | Mean outside valid range, clamped | `strength.mean` < -1 or > 1 | Clamped to [-1, +1] | warn |

## Edge repairs — strength.std

| Code | Description | Trigger | Default / Range | Severity |
|------|-------------|---------|-----------------|----------|
| `DEFAULT_STRENGTH_STD` | Missing `strength.std` derived | No explicit std; derived from `mean` + `exists_probability` | Derived via `deriveStd()` | info |
| `INVALID_STRENGTH_STD` | Non-numeric std replaced | `typeof` is not `number` or not finite | Derived from mean + belief | warn |
| `CLAMP_STRENGTH_STD` | Std outside valid range, clamped | `std` < floor or > 0.4 | Clamped to [floor, 0.4] | warn |
| `FLOOR_STRENGTH_STD` | Std below ISL minimum, floored | `std` < 0.05 (causal) or < 0.01 (structural) | Causal: 0.05, Structural: 0.01 | info |
| `DERIVE_STD_FROM_BELIEF_STRENGTH` | Std derived from `belief_strength` | `belief_strength` field present, no explicit `std` | `(1 - belief_strength) × 0.5 × |mean| + 0.05` | info |

## Edge repairs — direction

| Code | Description | Trigger | Default / Range | Severity |
|------|-------------|---------|-----------------|----------|
| `INFER_EFFECT_DIRECTION` | Effect direction inferred from node kind | No explicit `effect_direction` field; inferred from source node kind (e.g., `risk` → negative) | Inferred direction | info |
| `APPLY_SIGN_FROM_DIRECTION` | Sign applied to mean from direction | Explicit `effect_direction: 'negative'` but `mean > 0` | Mean sign flipped to negative | info |

## Node repairs

| Code | Description | Trigger | Default / Range | Severity |
|------|-------------|---------|-----------------|----------|
| `INVALID_CATEGORY` | Non-standard category dropped | `category` not in allowed set (`controllable`, `observable`, `external`) | Set to `undefined` | info |
| `INVALID_PRIOR` | Malformed prior dropped | `prior` object fails structural validation | Set to `undefined` | warn |
| `PRIOR_ON_NON_EXTERNAL` | Prior on non-external node | `prior` present on node with `kind` ≠ `external` | Warning only (prior preserved) | info |
| `UNKNOWN_NODE_KIND` | Unrecognised node kind | `kind` not in known set | Warning only (kind preserved) | info |
| `CLEAN_LABEL_ANNOTATION` | Scale/encoding suffix stripped | Label contains annotation pattern (e.g., `(0-100)`, `[binary]`) | Annotation removed from label | info |

## Structural repairs

| Code | Description | Trigger | Default / Range | Severity |
|------|-------------|---------|-----------------|----------|
| `CASCADE_REMOVE_EDGE` | Edge removed on node deletion | Connected node deleted via patch operation | Edge removed from graph | info |

## Constraint transforms (F.6 Data Responsibility)

| Code | Description | Trigger | Default / Range | Severity |
|------|-------------|---------|-----------------|----------|
| `STRIP_RAW_CONSTRAINT_FIELDS` | Non-canonical CEE fields stripped | Constraint has fields not in the canonical schema | Non-canonical fields removed | info |
| `FILTER_TEMPORAL_CONSTRAINT` | Temporal constraint removed | Constraint has `deadline_metadata` or targets goal with temporal unit + value > 1.0 | Constraint excluded before ISL | warn |

## Compatibility

| Code | Description | Trigger | Default / Range | Severity |
|------|-------------|---------|-----------------|----------|
| `LEGACY_REPAIR` | Pre-F.5 repair upcast | `RepairRecord` entry from before canonical codes were introduced | Placeholder code assigned | info |
