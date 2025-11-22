#!/bin/bash

ENGINE_URL="https://plot-lite-service.onrender.com"
MAX_ATTEMPTS=60  # 5 minutes (5 second intervals)
ATTEMPT=0

echo "🔍 Monitoring Render deployment..."
echo "Target: $ENGINE_URL"
echo ""

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$ENGINE_URL/v1/health" 2>/dev/null)
  
  if [ "$STATUS" = "200" ]; then
    echo "✅ Deployment complete! Service is live (200 OK)"
    echo ""
    echo "Running quick health check..."
    curl -s "$ENGINE_URL/v1/health" | jq '{status, uptime_ms}'
    echo ""
    echo "🎯 Next step: Run smoke tests"
    echo "   ./STAGING_SMOKE_TESTS.sh"
    exit 0
  elif [ "$STATUS" = "502" ] || [ "$STATUS" = "503" ]; then
    echo "[$ATTEMPT/$MAX_ATTEMPTS] Deploying... (HTTP $STATUS)"
  else
    echo "[$ATTEMPT/$MAX_ATTEMPTS] Unexpected status: $STATUS"
  fi
  
  sleep 5
done

echo "❌ Deployment timeout after 5 minutes"
echo "Check Render dashboard: https://dashboard.render.com"
exit 1
