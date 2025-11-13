#!/usr/bin/env zsh
set -euo pipefail
setopt interactivecomments
BASE='https://plot-lite-service.onrender.com'

echo '== /v1/compare sample =='
REQ='{"graphs":[{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"label":"A"},{"graph":{"nodes":[{"id":"B","label":"B"}],"edges":[]},"label":"B"}],"seed":4242}'
curl -s "$BASE/v1/compare" -H 'Content-Type: application/json' --data-binary "$REQ" | jq '{schema,baseline,options:(.options|length)}'

echo '== /v1/inspect sample =='
REQ2='{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"seed":4242}'
curl -s "$BASE/v1/inspect" -H 'Content-Type: application/json' --data-binary "$REQ2" | jq '{schema,explain:{flags_on}}'
