# Live Rollout Docs

This directory contains live rollout documentation generated from templates.

**Do not commit simulated data here.** Only commit real deployment logs.

## Generate Live Docs

```bash
# See docs/CB_LIVE_ROLLOUT_GUIDE.md for full instructions
DATE=$(date +%Y-%m-%d)
OWNER="<your-name>"

for f in STAGING_LOADTEST_TRANSCRIPT CANARY_25_MONITORING PROGRESSIVE_ROLLOUT CB_ROLLOUT_COMPLETE; do
  sed -e "s/{{DATE}}/$DATE/g" -e "s/{{OWNER}}/$OWNER/g" \n    templates/rollout/${f}.template.md > docs/live/${f}.md
done
```

