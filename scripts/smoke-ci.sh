#!/usr/bin/env bash
set -euo pipefail
BASE="http://127.0.0.1:4311"
REQ_C='{"graphs":[{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"label":"A"},{"graph":{"nodes":[{"id":"B","label":"B"}],"edges":[]},"label":"B"}],"seed":4242}'
REQ_I='{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"seed":4242}'
echo "== /v1/compare =="; curl -s "$BASE/v1/compare" -H 'Content-Type: application/json' --data-binary "$REQ_C" | jq '{schema, options:(.options|length)}'
echo "== /v1/inspect =="; curl -s "$BASE/v1/inspect" -H 'Content-Type: application/json' --data-binary "$REQ_I" | jq '{schema, explain:{flags_on}}'
