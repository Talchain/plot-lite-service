# Determinism & JCS Normalization

## Overview

PLoT Engine guarantees **byte-stable determinism**: running the same template with the same seed produces **identical** `response_hash` values, enabling cryptographic verification of reproducibility.

## Response Hash Computation

Every response includes a `model_card` with:

```json
{
  "model_card": {
    "response_hash": "abc123...",
    "response_hash_algo": "sha256",
    "normalized": true,
    ...
  },
  "meta": {
    "seed": 42,
    "response_id": "uuid-here",
    "elapsed_ms": 123
  }
}
```

### Hash Algorithm

- **Algorithm**: SHA-256
- **Input**: JCS-normalized JSON (RFC 8785)
- **Output**: Hex-encoded digest

### JCS Normalization Rules (RFC 8785)

1. **Key Ordering**: All object keys sorted lexicographically (Unicode code points)
2. **Number Formatting**: 
   - No leading zeros
   - No trailing zeros after decimal point
   - Use scientific notation for very large/small numbers
   - `-0` normalized to `0`
3. **String Escaping**: Minimal escaping (only required control characters)
4. **No Whitespace**: No spaces, newlines, or indentation
5. **Omit null/undefined**: Fields with `null` or `undefined` are excluded

### Excluded Fields

The following fields are **excluded** from `response_hash` computation to allow non-deterministic metadata:

- `trace_id` (optional debug trace)
- `meta.response_id` (unique per response)
- `meta.elapsed_ms` (varies by system load)
- Any future `_debug` or `_trace` prefixed fields

## Verification Example

### Step 1: Run Template 5 Times

```bash
TOKEN="your-token-here"
BASE="https://api.example.com"

for i in {1..5}; do
  curl -s -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -X POST "$BASE/v1/run" \
    -d '{
      "template_id": "pricing-v1",
      "seed": 4242,
      "belief_mode": "strict",
      "graph": { ... }
    }' \
    | jq -r '.model_card.response_hash'
done | sort | uniq -c
```

**Expected Output:**
```
5 abc123def456...
```

All 5 runs produce the **same hash**.

### Step 2: Verify Normalization

```bash
# Get response
RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  -X POST "$BASE/v1/run" -d @template.json)

# Extract normalized payload (server-side logic)
# Keys sorted, numbers normalized, no whitespace
echo "$RESPONSE" | jq -cS '
  del(.trace_id, .meta.response_id, .meta.elapsed_ms)
'
```

### Step 3: Compute Hash Locally

```bash
# Normalize and hash
echo "$RESPONSE" | jq -cS '
  del(.trace_id, .meta.response_id, .meta.elapsed_ms)
' | sha256sum
```

Should match `model_card.response_hash`.

## Proof Script

Copy-paste verification:

```bash
#!/bin/bash
set -euo pipefail

TOKEN="${PLOT_TOKEN:-}"
BASE="${PLOT_BASE:-https://api.example.com}"
TEMPLATE_FILE="${1:-template.json}"

if [[ -z "$TOKEN" ]]; then
  echo "Error: Set PLOT_TOKEN environment variable"
  exit 1
fi

echo "Running template 5 times with seed=4242..."
HASHES=()

for i in {1..5}; do
  HASH=$(curl -s -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -X POST "$BASE/v1/run" \
    -d @"$TEMPLATE_FILE" \
    | jq -r '.model_card.response_hash')
  
  HASHES+=("$HASH")
  echo "Run $i: $HASH"
done

# Check uniqueness
UNIQUE=$(printf '%s\n' "${HASHES[@]}" | sort -u | wc -l)

if [[ "$UNIQUE" -eq 1 ]]; then
  echo "✅ PASS: All 5 runs produced identical hash"
  echo "Hash: ${HASHES[0]}"
  exit 0
else
  echo "❌ FAIL: Got $UNIQUE unique hashes (expected 1)"
  printf '%s\n' "${HASHES[@]}" | sort | uniq -c
  exit 1
fi
```

## Implementation Details

### Server-Side (src/routes/v1/run.ts)

```typescript
// 1. Build response
const base = {
  confidence,
  critique,
  graph,
  meta: {
    seed,
    response_id: randomUUID(),  // Excluded from hash
    elapsed_ms: Math.round(...)  // Excluded from hash
  },
  model_card,
  results
};

// 2. Normalize (JCS)
const normalised = normaliseReport(base);  // Strips excluded fields
const canonical = stableStringify(normalised);  // RFC 8785

// 3. Hash
const response_hash = createHash('sha256')
  .update(canonical, 'utf8')
  .digest('hex');

// 4. Stamp
base.model_card.response_hash = response_hash;
base.model_card.response_hash_algo = 'sha256';
base.model_card.normalized = true;
```

### Key Functions

- `normaliseReport(obj)`: Strips `trace_id`, `meta.response_id`, `meta.elapsed_ms`
- `stableStringify(obj)`: JCS serialization (RFC 8785)
- `createHash('sha256')`: Node.js crypto

## Guarantees

1. **Same seed → Same hash**: Deterministic for audit trails
2. **Byte-stable**: No floating-point drift, no key-order variance
3. **Verifiable**: Clients can recompute hash locally
4. **Excludes metadata**: `response_id`, `elapsed_ms` don't affect hash

## Non-Deterministic Fields

These fields **vary** between runs but don't affect `response_hash`:

- `meta.response_id`: Unique UUID per response
- `meta.elapsed_ms`: System load dependent
- `trace_id`: Optional debug trace (TRACE_MIN=1)

## Testing

See `tests/determinism.stability.test.ts` and `tests/determinism.byteorder.test.ts`.

## References

- [RFC 8785: JSON Canonicalization Scheme (JCS)](https://datatracker.ietf.org/doc/html/rfc8785)
- [SHA-256 Specification](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf)
