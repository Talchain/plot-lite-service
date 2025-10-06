# Schema Compatibility Report

**Generated**: 2025-10-06T17:32:05.590Z
**Baseline**: /Users/paulslee/olumi/olumi-tools/packages/schema-compat/baselines/report.v1.schema.json
**Candidate**: /Users/paulslee/olumi/olumi-contracts/schemas/report.v1.schema.json

## Summary

- **Risk Level**: LOW
- **Breaking Changes**: 0
- **Type Changes**: 0
- **Additive Fields**: 181
- **OpenAPI Parity**: ✅ OK

## Additive Fields

- `$.$id` (string)
- `$.title` (string)
- `$.description` (string)
- `$.properties.schema.description` (string)
- `$.properties.meta.description` (string)
- `$.properties.meta.properties.seed.description` (string)
- `$.properties.meta.properties.generated_at.description` (string)
- `$.properties.summary.description` (string)
- `$.properties.summary.properties.option_best.description` (string)
- `$.properties.summary.properties.confidence.description` (string)
- `$.properties.kpis.description` (string)
- `$.properties.kpis.items.properties.name.description` (string)
- `$.properties.kpis.items.properties.p10.description` (string)
- `$.properties.kpis.items.properties.p50.description` (string)
- `$.properties.kpis.items.properties.p90.description` (string)
- `$.properties.kpis.items.properties.unit.description` (string)
- `$.properties.kpis.items.additionalProperties` (boolean)
- `$.properties.model_averaging` (object)
- `$.properties.model_averaging.type` (string)
- `$.properties.model_averaging.description` (string)

... and 133 more

## Assessment

✅ **All changes are additive.** Existing consumers unaffected.
