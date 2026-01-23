#!/bin/bash

# STAGING ONLY - Safe to use for staging deployments
# DO NOT MODIFY THIS URL

STAGING_URL="https://plot-lite-service-staging.onrender.com"
MAX_ATTEMPTS=60
ATTEMPT=0

echo "========================================="
echo "  STAGING Deployment Monitor"
echo "  Target: $STAGING_URL"
echo "========================================="
echo ""

# Safety check - verify URL contains staging
if [[ "$STAGING_URL" != *"staging"* ]]; then
  echo "❌ SAFETY ERROR: URL does not contain 'staging'"
  exit 1
fi

EXPECTED_COMMIT="${1:-}"
if [ -n "$EXPECTED_COMMIT" ]; then
  echo "Expected commit: $EXPECTED_COMMIT"
fi
echo ""

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))

  RESPONSE=$(curl -s "$STAGING_URL/health" 2>/dev/null)
  STATUS=$(echo "$RESPONSE" | jq -r '.status' 2>/dev/null)
  BUILD=$(echo "$RESPONSE" | jq -r '.build' 2>/dev/null)

  if [ "$STATUS" = "ok" ]; then
    echo "✅ STAGING is healthy"
    echo "   Build: $BUILD"

    if [ -n "$EXPECTED_COMMIT" ]; then
      if [[ "$BUILD" == "$EXPECTED_COMMIT"* ]]; then
        echo "   ✅ Build matches expected commit"
        exit 0
      else
        echo "   ⏳ Build $BUILD does not match expected $EXPECTED_COMMIT - waiting..."
      fi
    else
      exit 0
    fi
  else
    echo "[$ATTEMPT/$MAX_ATTEMPTS] Waiting for STAGING... (status: $STATUS)"
  fi

  sleep 5
done

echo "❌ Timeout waiting for STAGING deployment"
exit 1
