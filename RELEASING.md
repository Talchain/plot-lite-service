# Releasing PLoT-lite service

Follow this checklist to cut a release:

1. npm ci && npm run build && npm test
2. npm run replay   # Expect: All fixtures match
3. npm run loadcheck   # Record p95/max/RPS into README Overnight log
4. Update README “Overnight log” with metrics
5. git tag -a v0.1.0 -m "v0.1.0" && git push origin v0.1.0
6. (optional) gh release create v0.1.0 --generate-notes --latest
