#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-https://plot-lite-service.onrender.com}"
echo "Health:" && curl -sfS "$BASE/v1/health" && echo

echo -e "\nHEAD /v1/run:" && curl -si -X HEAD "$BASE/v1/run" | sed -n '1,10p'

echo -e "\nOpenAPI:" && curl -si "$BASE/v1/openapi.json" | sed -n '1,10p'

echo -e "\nTemplates (count):" && curl -sfS "$BASE/v1/templates" | jq length

echo -e "\nTemplate small/graph (headers):"
etag=$(curl -si "$BASE/v1/templates/small/graph" | tee /dev/stderr | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')

echo -e "\nRevalidate (If-None-Match):"
curl -si -H "If-None-Match: $etag" "$BASE/v1/templates/small/graph" | sed -n '1,10p'

echo -e "\nOK ✅"
