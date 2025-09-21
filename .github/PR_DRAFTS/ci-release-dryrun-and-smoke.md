# ci: add release-dryrun workflow and smoke:api script

This PR adds:
- A manual “Release dry-run” workflow to build, test, and upload artifacts (no tag).
- A tiny smoke:api script that runs replay-fixtures against a server if TEST_BASE_URL is set (skips otherwise).
- CI hook to run smoke:api after unit tests (harmless when TEST_BASE_URL is unset).

Local steps: none required.

Optional next steps after merge:

```
# Try a patch release and push tags to exercise the release workflow
npm run release
git push && git push --tags
```