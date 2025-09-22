# Risks & Mitigations
- LLM non-determinism → flag OFF by default, record prompts, cap retries.
- Hidden coupling in steps → strict interfaces, schema validation.
- “One more feature” creep → enforce roadmap; tiny PRs; flags.
