#!/bin/bash
set -e

# Deployment script for DecisionGuideAI PoC to Netlify
# Usage: ./deploy-netlify.sh

echo "🚀 DecisionGuideAI Netlify Deployment"
echo "======================================"

# Check required env vars
if [ -z "$NETLIFY_AUTH_TOKEN" ]; then
  echo "❌ ERROR: NETLIFY_AUTH_TOKEN not set"
  echo "Get your token from: https://app.netlify.com/user/applications/personal"
  echo "Then run: export NETLIFY_AUTH_TOKEN=<your-token>"
  exit 1
fi

if [ -z "$ENGINE_URL" ]; then
  echo "❌ ERROR: ENGINE_URL not set"
  echo "Example: export ENGINE_URL=https://your-engine.onrender.com"
  exit 1
fi

export NETLIFY_SITE_NAME="${NETLIFY_SITE_NAME:-decisionguideai-poc}"
export CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-poc.decisionguide.ai}"

echo "Configuration:"
echo "  Site name: $NETLIFY_SITE_NAME"
echo "  Engine URL: $ENGINE_URL"
echo "  Custom domain: $CUSTOM_DOMAIN"
echo ""

# 1) Check Netlify CLI
echo "📦 Checking Netlify CLI..."
npx netlify --version

# 2) Link or create the site
echo ""
echo "🔗 Linking to Netlify site..."
npx netlify link --name "$NETLIFY_SITE_NAME" || (
  echo "Creating new site: $NETLIFY_SITE_NAME"
  npx netlify sites:create --name "$NETLIFY_SITE_NAME" &&
  npx netlify link --name "$NETLIFY_SITE_NAME"
)

# 3) Set the engine URL environment variable
echo ""
echo "⚙️  Setting VITE_EDGE_GATEWAY_URL=$ENGINE_URL"
npx netlify env:set VITE_EDGE_GATEWAY_URL "$ENGINE_URL"

# 4) Build and deploy
echo ""
echo "🔨 Building application..."
npm ci
npm run build

echo ""
echo "☁️  Deploying to Netlify..."
npx netlify deploy --prod --dir=dist --message "poc deploy $(date -u +%F\ %T)"

# 5) Attach custom domain
echo ""
echo "🌐 Adding custom domain: $CUSTOM_DOMAIN"
npx netlify domains:add "$CUSTOM_DOMAIN" || echo "Domain may already be added"

# 6) Print results
echo ""
echo "✅ Deployment Complete!"
echo "======================="

SITE_URL=$(npx netlify status --json 2>/dev/null | jq -r .siteUrl 2>/dev/null || echo "https://$NETLIFY_SITE_NAME.netlify.app")
SITE_HOST=${SITE_URL#https://}

echo ""
echo "📍 URLs:"
echo "  Netlify URL: $SITE_URL"
echo "  Custom domain: https://$CUSTOM_DOMAIN"
echo ""
echo "🔧 DNS Configuration (if external DNS):"
echo "  Type: CNAME"
echo "  Host: poc"
echo "  Target: ${SITE_HOST}"
echo ""
echo "🧪 Test in browser console:"
echo "  fetch('$ENGINE_URL/health').then(r => r.json()).then(console.log)"
echo ""
