import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Lightweight YAML duplicate-keys guard (best-effort, deterministic).
// Scans indentation-based maps and asserts no duplicate keys are defined
// at the same indentation level.

describe('OpenAPI YAML unique keys', () => {
  it('has no duplicate mapping keys at the same indentation (list-aware)', () => {
    const p = resolve(process.cwd(), 'contracts', 'openapi.yaml');
    const txt = readFileSync(p, 'utf8');
    const lines = txt.split(/\r?\n/);
    const seenByIndent: Map<number, Set<string>> = new Map();
    let lastIndent = 0;
    let blockIndent: number | null = null; // when inside a block scalar (|), ignore keys until dedent
    const keyRe = /^(\s*)(?!-\s)([A-Za-z0-9_/[\]$#{}.'"-]+):\s*(?:\S.*)?$/;
    const listRe = /^(\s*)-\s/;

    for (const line of lines) {
      // When a new list item starts at indent I, clear any deeper or equal child-map contexts
      const lm = line.match(listRe);
      if (lm) {
        const li = lm[1].length;
        for (const k of Array.from(seenByIndent.keys())) {
          if (k >= li + 2) seenByIndent.delete(k);
        }
      }
      // Track entering/leaving block scalars (value: |)
      // Enter when we see key with trailing '|', leave when indent <= blockIndent
      if (blockIndent != null) {
        const currentIndent = (/^(\s*)/.exec(line)?.[1].length) ?? 0;
        if (currentIndent <= blockIndent) blockIndent = null;
      }
      const m = line.match(keyRe);
      if (!m) continue;
      const indent = m[1].length;
      const key = m[2];

      // Detect entering a block scalar (|)
      if (line.trimEnd().endsWith('|')) {
        blockIndent = indent;
      }

      // Ignore keys while inside block scalars
      if (blockIndent != null && indent > blockIndent) continue;

      // Reset deeper indent maps when indentation decreases
      for (const k of Array.from(seenByIndent.keys())) {
        if (k > indent) seenByIndent.delete(k);
      }
      if (indent > lastIndent && !seenByIndent.has(indent)) {
        seenByIndent.set(indent, new Set());
      }
      lastIndent = indent;

      const set = seenByIndent.get(indent) || new Set<string>();
      if (set.has(key)) {
        throw new Error(`Duplicate key at indent ${indent}: ${key}`);
      }
      set.add(key);
      seenByIndent.set(indent, set);
    }

    // If we reached here, no duplicates were detected by the guard
    expect(true).toBe(true);
  });
});
