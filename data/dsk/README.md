# DSK — Deterministic Science Knowledge Base

The DSK is Olumi's curated, versioned repository of decision science claims, technique protocols, and behavioural triggers. Every scientific claim the AI makes in conversation references a specific DSK object with evidence strength, scope, and peer-reviewed citations. The bundle is loaded at CEE startup as a static JSON file.

## Files

- `v1.json` — the active bundle loaded at CEE startup

## Authoring workflow

### Generate the skeleton bundle

```bash
npm run dsk:init
```

This creates `v1.json` with allocated IDs and placeholder content. The linter will fail on this skeleton because placeholders aren't valid content, but the IDs are usable immediately for cross-referencing.

### Validate the bundle

```bash
npm run dsk:lint
```

Reports errors and warnings. Exit codes: `0` = clean, `1` = errors, `2` = warnings only.

To auto-fix object ordering:

```bash
npx tsx scripts/dsk-lint.ts data/dsk/v1.json --fix-order
```

### Compute the canonical hash

```bash
npm run dsk:hash
```

Prints the SHA-256 hash of the canonical bundle representation. This hash covers `version` + `objects` only — `generated_at` and `dsk_version_hash` are excluded so that metadata changes don't invalidate the hash.
