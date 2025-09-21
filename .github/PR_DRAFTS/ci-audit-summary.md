# ci: add audit summary & release polish

This PR adds a non-blocking npm audit summary step and uploads the JSON report as an artifact. It also:
- Refines release-drafter sections by labels (feat/fix/docs/test/ci/chore)
- Adds a "Smoke on tag" step to release.yml (skips unless TEST_BASE_URL is set)
- Adds a release checklist markdown under .github/PR_DRAFTS/release-checklist.md

Local steps: none required.

Optional after merge:
- Trigger the "Release dry-run" workflow (manual) to verify artifacts.
- Try a patch release:

```
npm run release
git push && git push --tags
```