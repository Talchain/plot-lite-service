# Changelog

All notable changes to the PLoT Lite SDK will be documented in this file.

## [0.5.0] - 2025-11-15

### Added
- Initial release of TypeScript SDK
- Support for 7 inference methods:
  - `run()` - Basic causal inference
  - `compare()` - Compare multiple scenarios
  - `inspect()` - Graph structure inspection
  - `intervene()` - Causal intervention analysis
  - `optimise()` - Budget-constrained optimization
  - `runBundle()` - Evaluate graph variations
  - `runTimeslices()` - Temporal graph evaluation
- Utility methods:
  - `getLimits()` - Get service capacity limits
  - `health()` - Health check
- **Priors support** with two formats:
  - Number format (0-1)
  - Distribution format `{mean, sd}`
- **Evidence annotations** with fields:
  - `node_id` (required)
  - `source` (required, ≤200 chars)
  - `note` (optional, ≤500 chars, not echoed)
  - `weight` (optional, 0-1)
- **Timeslices endpoint** support:
  - Up to 12 timeslices per request
  - Optional slice overrides
  - Priors and evidence support
- **Client-side validation**:
  - Priors validation (range, node existence)
  - Evidence validation (required fields, length limits)
  - Timeslices validation (max 12)
- **TypeScript types** for all requests and responses
- **Dual build system**:
  - ESM (ES2020 modules)
  - CommonJS (for older Node.js)
- **Browser and Node.js compatibility**
- **Comprehensive examples**:
  - Node.js examples (basic-run, timeslices)
  - Browser examples (basic.html)
- **Unit tests** for validators
- **Documentation**:
  - Complete README with API reference
  - TypeScript type definitions
  - Usage examples

### Features
- Deterministic results with seed parameter
- Automatic request timeout (configurable, default 30s)
- Custom headers support
- Structured error messages with field pointers
- Sanitized evidence echo in responses

### Developer Experience
- Full TypeScript support with strict typing
- IntelliSense-friendly API
- Clear validation error messages
- Comprehensive test coverage

### Performance
- Lightweight bundle (no heavy dependencies)
- Tree-shakeable ESM build
- Efficient client-side validation

### Security
- No sensitive data in client-side validation
- Evidence notes not echoed in responses
- Configurable timeout to prevent hanging requests

---

## Future Releases

### [0.6.0] - Planned
- Streaming support for long-running requests
- Batch request API
- Response caching
- Retry logic with exponential backoff

### [0.7.0] - Planned
- React hooks for common patterns
- Vue composables
- Response type guards
- Enhanced error types

---

**Note**: This SDK requires PLoT Lite Engine v1.6.0 or later for full feature support (priors, evidence, timeslices).
