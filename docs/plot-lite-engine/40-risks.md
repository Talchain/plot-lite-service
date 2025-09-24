# Risks & Mitigations
- LLM non-determinism → flag off by default, record prompts, cap retries.
- Hidden coupling in steps → strict interfaces, schema validation.
- “Just one more feature” creep → enforce roadmap; tiny PRs; flags.
