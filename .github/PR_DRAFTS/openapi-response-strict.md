# test: OpenAPI response strictness (dev-time)

- Adds test/openapi-responses.test.ts
  - Starts an isolated test server
  - Calls /draft-flows across all fixtures
  - Validates each live response against openapi/openapi-plot-lite-v1.yaml (Ajv)
  - Enforces no additional properties by comparing to the fixture shape
- No changes to runtime behavior or endpoints

Local (optional):

```
# From repo root
npm run build
npm test
```