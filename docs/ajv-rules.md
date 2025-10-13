# Ajv Validation Rules Catalogue

## Schema Validation

All artifacts use [Ajv](https://ajv.js.org/) JSON Schema validation with strict mode enabled.

## Core Rules

### 1. Bounded Integers
```json
{
  "type": "integer",
  "minimum": 0,
  "maximum": 10000
}
```
**Rationale**: Prevents unbounded memory allocation

### 2. Enum Constraints
```json
{
  "type": "string",
  "enum": ["PASS", "FAIL", "WARN"]
}
```
**Rationale**: Ensures type safety and exhaustive handling

### 3. Required Fields
```json
{
  "type": "object",
  "required": ["schema", "timestamp", "status"]
}
```
**Rationale**: Guarantees presence of critical fields

### 4. String Formats
```json
{
  "type": "string",
  "format": "date-time"
}
```
**Supported formats**:
- `date-time` (ISO 8601)
- `uri` (RFC 3986)
- `email` (RFC 5322)
- `uuid` (RFC 4122)

### 5. Array Bounds
```json
{
  "type": "array",
  "minItems": 1,
  "maxItems": 1000
}
```
**Rationale**: Prevents DOS via large arrays

### 6. Pattern Validation
```json
{
  "type": "string",
  "pattern": "^[a-z0-9-]+$"
}
```
**Rationale**: Enforces naming conventions

## Schema Catalog

### report.v1
- **status**: enum ["PASS", "FAIL", "WARN"]
- **violations**: array (0-100 items)
- **warnings**: array (0-100 items)
- **timestamp**: ISO 8601 date-time

### slos.v1
- **engine_get_p95_ms**: integer (0-10000)
- **k_per_sec**: integer (0-100000)
- **samples**: integer (1-10000)
- **source**: enum ["live", "mock"]

### manifest.v1
- **schema**: const "pack-manifest.v1"
- **commit**: pattern "^[a-f0-9]{7,40}$"
- **version**: pattern "^\\d+\\.\\d+\\.\\d+$"

## Strict Mode

All schemas use `additionalProperties: false` to reject unknown fields.

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": { ... }
}
```

## Custom Keywords

### content_hash
Computed SHA-256 hash of stable content (excluding volatile fields like timestamps).

### provenance
Metadata about artifact origin (builder, source, commit).

## Validation Workflow

1. **Parse JSON**: Reject malformed JSON
2. **Schema lookup**: Match `schema` field to registered schema
3. **Ajv validation**: Run strict validation
4. **Custom checks**: Apply domain-specific rules (e.g., plausibility)
5. **Output**: PASS/FAIL/WARN with violations array

## Error Handling

Validation errors include:
- **dataPath**: JSON pointer to invalid field
- **keyword**: Failed validation keyword
- **message**: Human-readable error
- **params**: Additional context

Example:
```json
{
  "dataPath": "/engine_get_p95_ms",
  "keyword": "maximum",
  "message": "should be <= 10000",
  "params": { "comparison": "<=", "limit": 10000 }
}
```

## References
- [Ajv Documentation](https://ajv.js.org/)
- [JSON Schema Specification](https://json-schema.org/)
- [OpenAPI 3.1 Schema](https://spec.openapis.org/oas/v3.1.0)
