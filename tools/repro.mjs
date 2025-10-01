#!/usr/bin/env node
// Print ready-to-copy curl commands to repro core behaviors
// Usage: node tools/repro.mjs [base]
import { execSync } from 'node:child_process';
const base = process.argv[2] || process.env.PACK_ENGINE_URL || 'http://127.0.0.1:4311';

function line(s){ process.stdout.write(s + '\n'); }

// Draft-flows 200 + ETag -> 304
line('# draft-flows 200 + ETag -> 304');
line(`curl -s "${base}/draft-flows?template=pricing_change&seed=101" -D 200.h -o 200.json`);
line(`ET=$(awk 'tolower($1)=="etag:"{print $2}' 200.h | tr -d '\r')`);
line(`curl -s -i -H "If-None-Match: $ET" "${base}/draft-flows?template=pricing_change&seed=101" -D 304.h -o /dev/null`);
line('');

// Health and version
line('# health and version');
line(`curl -s -D health.h "${base}/health" -o health.json`);
line(`curl -s -D version.h "${base}/version" -o version.json`);
line('');

// Stream canary (requires FEATURE_STREAM=1)
line('# stream canary (requires FEATURE_STREAM=1)');
line('export FEATURE_STREAM=1');
line(`curl -Ns --max-time 5 "${base}/stream" | head -n 10`);
