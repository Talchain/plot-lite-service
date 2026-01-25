# Contracts

Single source of truth (SSOT) for cross-service contracts between PLoT and its dependencies.

## Purpose

This directory contains:

- **JSON Schemas**: Define the structure and constraints of API requests/responses
- **Example Fixtures**: Real-world payloads used for validation and testing
- **Validation Script**: Ensures examples conform to schemas with completeness checks

## Structure

```
contracts/
├── schemas/
│   ├── isl-request.schema.json    # ISL API request format
│   ├── isl-response.schema.json   # ISL API response format
│   ├── plot-response.schema.json  # PLoT /v2/run response format
│   └── cee-response.schema.json   # CEE /api/v1/review response format
├── examples/
│   └── pricing-canary/            # Minimal scenario (CEE skipped)
│       ├── isl-response.json      # ISL computation results
│       └── plot-response.json     # Expected PLoT output
├── validate.ts                    # Validation script
└── README.md
```

## Scenario Types

Scenarios are categorized by completeness level:

| Type | Required Files | Use Case |
|------|---------------|----------|
| **minimal** | `isl-response.json`, `plot-response.json` | Basic ISL→PLoT transformation testing |
| **full** | All 4 files (ISL request/response, PLoT response, CEE response) | End-to-end with CEE enabled |

### Defined Scenarios

```typescript
const SCENARIO_REQUIREMENTS = {
  'pricing-canary': {
    type: 'minimal',
    requiredFiles: ['isl-response.json', 'plot-response.json'],
  },
  'cee-graph-supplied': {
    type: 'full',
    requiredFiles: ['cee-graph.json', 'isl-request.json', 'isl-response.json', 'plot-response.json'],
  },
};
```

### cee-graph-supplied (full scenario)

Tests graph coherence when a CEE-generated graph is supplied to PLoT.

**What it tests:**
- Goal alignment (CEE goal = ISL request goal)
- Option equality (CEE options = ISL request options)
- Edge coverage (≥80% of ISL edges trace to CEE)

**What it does NOT test:**
- Same-run CEE wiring (CEE graph was generated in a prior request)

**Files:** cee-graph.json, isl-request.json, isl-response.json, plot-response.json

Unknown scenarios default to `minimal` requirements with a warning.

## Running Validation

Validate all examples against their schemas:

```bash
npm run validate:contracts
```

Expected output:
```
Validating contracts...

Scenario: pricing-canary (minimal)
  ✓ Required files present (2/2)
  ✓ isl-response.json → isl-response.schema.json
  ✓ plot-response.json → plot-response.schema.json

Summary: Validated 2 files across 1 scenario (0 failed, 0 incomplete)

✓ All validations passed!
```

### Validation Checks

1. **Scenario completeness** - All required files for scenario type exist
2. **Schema validation** - Each file validates against its schema
3. **Unmapped file detection** - Fails if JSON files have no schema mapping
4. **Missing schema detection** - Fails if mapped schema file doesn't exist

## Adding New Scenarios

### Minimal Scenario (No CEE)

1. Create directory and capture fixtures from same run:
   ```bash
   mkdir contracts/examples/my-scenario
   ```

2. Add required files (must be from the **same debug bundle**):
   - `isl-response.json` - ISL computation results
   - `plot-response.json` - Expected PLoT output

3. Register in `contracts/validate.ts`:
   ```typescript
   'my-scenario': {
     type: 'minimal',
     requiredFiles: ['isl-response.json', 'plot-response.json'],
   },
   ```

4. Run validation:
   ```bash
   npm run validate:contracts
   ```

### Full Scenario (With CEE)

1. All 4 files must be from the **same debug bundle** to ensure coherence:
   - `isl-request.json` - Original ISL request
   - `isl-response.json` - ISL computation results
   - `plot-response.json` - Expected PLoT output
   - `cee-response.json` - CEE review response

2. Verify `cee_status: "success"` in `plot-response.json`

3. Register as `type: 'full'` in `SCENARIO_REQUIREMENTS`

### Fixture Coherence Rule

**All files in a scenario must come from the same run.**

Mismatched fixtures (e.g., CEE response from one run, ISL response from another) will cause:
- Node ID mismatches
- False test confidence
- Silent integration bugs

## Schema Design Principles

1. **additionalProperties: true** - Allow extra fields for forward compatibility
2. **Required fields** - Only fields that integration tests assert
3. **Nullable fields** - Use `type: ["string", "null"]` for nullable fields
4. **Range checks** - Only for invariants (probabilities in [0, 1])
5. **Derived from fixtures** - Schemas reflect actual data, not documentation

## File Mapping

| Example File | Schema | Description |
|--------------|--------|-------------|
| `isl-response.json` | `isl-response.schema.json` | ISL computation results |
| `plot-response.json` | `plot-response.schema.json` | PLoT /v2/run response |
| `isl-request.json` | `isl-request.schema.json` | ISL API request |
| `cee-response.json` | `cee-response.schema.json` | CEE M1 review response |
| `cee-graph.json` | `cee-graph.schema.json` | CEE graph draft (M0/M2 output) |

**Note:** `cee-response.json` and `cee-graph.json` are different formats:
- `cee-response.json` - CEE M1 orchestration review (intent, readiness, blocks)
- `cee-graph.json` - CEE graph generation output (nodes, edges, options)

## CI Integration

Contract validation runs in CI on every PR:

```yaml
- name: Validate contracts
  run: npm run validate:contracts
```

Failures block merge.

## Schema Reference

### ISL Response Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `robustness.recommendation_stability` | number [0,1] | Probability recommendation holds |
| `robustness.fragile_edges[].edge_id` | string | Edge identifier |
| `robustness.fragile_edges[].switch_probability` | number [0,1] | Joint switch probability |
| `options[].id` | string | Option identifier |
| `options[].win_probability` | number [0,1] | Probability option wins |
| `options[].outcome.mean` | number | Expected outcome value |

### Optional Fields (ISL/PLoT)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fragile_edges[].marginal_switch_probability` | number [0,1] | 0 | Marginal switch probability. ISL may omit; PLoT defaults to 0 for `flip_risk_category` computation |

**Note:** When `marginal_switch_probability` is missing:
- Schema validation passes (field is optional)
- PLoT adapter defaults to 0
- `computeFlipRiskCategory` treats missing values as 0

### PLoT Response Required Fields

Same as ISL Response, plus:

| Field | Type | Description |
|-------|------|-------------|
| `factor_sensitivity[].factor_id` | string | Factor identifier |
| `factor_sensitivity[].flip_risk_category` | enum | `isolated`, `correlated`, or `negligible` |

### ISL Request Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `graph.nodes` | array | Graph nodes |
| `graph.edges` | array | Graph edges |
| `options` | array | Decision options |
| `goal_node_id` | string | Goal node identifier |

### CEE Response Required Fields (M1 Review)

| Field | Type | Description |
|-------|------|-------------|
| `intent` | string | User intent classification |
| `analysis_state` | enum | `ran`, `skipped`, or `failed` |
| `readiness.level` | enum | `ready`, `needs_attention`, or `not_ready` |
| `readiness.headline` | string | Summary headline |
| `readiness.factors` | array | Contributing factors |
| `blocks[].id` | string | Block identifier |
| `blocks[].status` | enum | `ok`, `warning`, `error`, or `skipped` |

### CEE Graph Required Fields (M0/M2 Draft)

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | string | CEE graph schema version |
| `nodes` | array | Graph nodes (factor, decision, option, outcome, goal, risk) |
| `nodes[].id` | string | Node identifier |
| `nodes[].kind` | enum | Node type |
| `nodes[].label` | string | Human-readable label |
| `edges` | array | Graph edges with causal relationships |
| `edges[].from` | string | Source node ID |
| `edges[].to` | string | Target node ID |
| `goal_node_id` | string | Goal node identifier |

## Integration Test Guards

Integration tests (`tests/golden/integration.test.ts`) include scenario-aware guards:

```typescript
// CEE assertions only run when:
// 1. cee_status === "success" (CEE actually ran)
// 2. Scenario has both cee-response.json and isl-request.json
if (!ceeRan || !hasCeeFixtures) {
  it.skip('CEE-origin checks skipped', () => {});
  return;
}
```

This prevents false confidence from:
- Running CEE assertions on minimal scenarios
- Testing with mismatched fixtures

## Backwards Compatibility

**Breaking changes require major version bump.**

A breaking change is:
- Removing a required field
- Changing a field type
- Adding new required fields (without defaults)

Non-breaking changes:
- Adding optional fields
- Relaxing constraints
- Adding enum values
