# PLoT SDK Examples

## Browser Example

**File:** `browser/index.html`

Interactive browser demo showing:
- Run → Compare → Inspect happy path
- 429 retry handling with exponential backoff
- ESM CDN import (no build step)
- Visual console output

**Run:**
```bash
# Serve locally
npx serve browser/

# Or open directly in browser
open browser/index.html
```

**Features:**
- ✅ Tree-shaking (ESM)
- ✅ No User-Agent header (browser-safe)
- ✅ x-olumi-sdk header only
- ✅ Retry-After handling

## Node.js Example

**File:** `node/batch-optimise.mjs`

Command-line demo showing:
- Batch processing (runBatch)
- Budget-constrained optimisation (optimise)
- Idempotency keys
- Request ID correlation

**Run:**
```bash
# Install SDK first
npm install @olumi/plot-sdk

# Run example (requires local server)
node node/batch-optimise.mjs

# Or with custom URL
PLOT_API_URL=https://your-api.com node node/batch-optimise.mjs
```

**Features:**
- ✅ Auto-generated request IDs
- ✅ Idempotency key generation
- ✅ User-Agent header (Node.js)
- ✅ Error handling

## SDK Features Demonstrated

| Feature | Browser | Node |
|---------|---------|------|
| run() | ✅ | - |
| compare() | ✅ | - |
| inspect() | ✅ | - |
| runBatch() | - | ✅ |
| optimise() | - | ✅ |
| 429 retry | ✅ | - |
| Idempotency keys | - | ✅ |
| Request IDs | Auto | Auto |
| Tree-shaking | ✅ | ✅ |

## Notes

- **Browser**: Uses ESM CDN (esm.sh) for zero-config setup
- **Node**: Requires `@olumi/plot-sdk` installed via npm
- **Idempotency**: Keys are optional but recommended for production
- **Rate limits**: SDK handles 429 responses gracefully
- **Body size**: SDK checks 96 KB limit before sending
