/**
 * Canonical Comparison Utility
 *
 * Deep-equality comparison with support for:
 * - Ignoring volatile fields (timestamps, request IDs, processing times)
 * - Deterministic array sorting by configurable keys
 * - First-divergent-path diff reporting
 */

/** Default fields to ignore in comparisons (non-deterministic / volatile). Exported so callers can spread. */
export const DEFAULT_IGNORE_FIELDS = ['computed_at', 'processing_time_ms', 'request_id'];

export interface CanonicalCompareOptions {
  /**
   * Field names to skip during comparison. **Replaces** (not extends) the
   * default list. To add custom fields while keeping defaults, spread:
   * `ignoreFields: [...DEFAULT_IGNORE_FIELDS, 'my_field']`
   *
   * Defaults to DEFAULT_IGNORE_FIELDS when omitted.
   */
  ignoreFields?: string[];

  /**
   * Map of JSON paths (or top-level keys) to sort instructions.
   * - string: sort by that property (e.g., `'id'`)
   * - `'key1::key2'`: composite sort key (concatenated with `::`)
   * - function: custom sort key extractor
   */
  sortArraysBy?: Record<string, string | ((item: any) => string)>;
}

export interface CanonicalCompareResult {
  match: boolean;
  /** First divergent path + both values when match is false. */
  diff?: string;
}

/**
 * Build a sort-key function from a sort spec.
 */
function buildSortKey(spec: string | ((item: any) => string)): (item: any) => string {
  if (typeof spec === 'function') return spec;

  // Composite key: "from::to"
  if (spec.includes('::')) {
    const parts = spec.split('::');
    return (item: any) => parts.map((p) => String(item?.[p] ?? '')).join('::');
  }

  // Simple key
  return (item: any) => String(item?.[spec] ?? '');
}

/**
 * Deep-compare two values, ignoring specified fields and sorting arrays.
 * Returns the first divergent path or null if equal.
 */
function deepCompare(
  a: unknown,
  b: unknown,
  ignoreSet: Set<string>,
  sortMap: Map<string, (item: any) => string>,
  path: string,
): string | null {
  // Identical references or both null/undefined
  if (a === b) return null;

  // Type mismatch
  if (typeof a !== typeof b) {
    return `${path}: type mismatch (${typeof a} vs ${typeof b})`;
  }

  // Null checks (typeof null === 'object')
  if (a === null || b === null) {
    return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }

  // Arrays
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) {
      return `${path}: array vs non-array`;
    }

    // Sort if a sort spec exists for this path
    let sortedA = a;
    let sortedB = b;
    const sortFn = sortMap.get(path);
    if (sortFn) {
      sortedA = [...a].sort((x, y) => sortFn(x).localeCompare(sortFn(y)));
      sortedB = [...b].sort((x, y) => sortFn(x).localeCompare(sortFn(y)));
    }

    if (sortedA.length !== sortedB.length) {
      return `${path}: array length ${sortedA.length} vs ${sortedB.length}`;
    }

    for (let i = 0; i < sortedA.length; i++) {
      const result = deepCompare(sortedA[i], sortedB[i], ignoreSet, sortMap, `${path}[${i}]`);
      if (result) return result;
    }
    return null;
  }

  // Objects
  if (typeof a === 'object') {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;

    const keysA = Object.keys(objA).filter((k) => !ignoreSet.has(k)).sort();
    const keysB = Object.keys(objB).filter((k) => !ignoreSet.has(k)).sort();

    // Check for missing/extra keys
    for (const k of keysA) {
      if (!keysB.includes(k)) {
        return `${path}.${k}: present in actual, missing in expected`;
      }
    }
    for (const k of keysB) {
      if (!keysA.includes(k)) {
        return `${path}.${k}: missing in actual, present in expected`;
      }
    }

    for (const k of keysA) {
      const result = deepCompare(objA[k], objB[k], ignoreSet, sortMap, `${path}.${k}`);
      if (result) return result;
    }
    return null;
  }

  // Primitives (number, string, boolean)
  if (a !== b) {
    return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }

  return null;
}

/**
 * Compare two objects canonically.
 *
 * @example
 * ```ts
 * const result = canonicalCompare(actual, expected, {
 *   ignoreFields: ['computed_at'],
 *   sortArraysBy: { '$.nodes': 'id', '$.edges': 'from::to' },
 * });
 * expect(result.match).toBe(true);
 * ```
 */
export function canonicalCompare(
  actual: unknown,
  expected: unknown,
  options?: CanonicalCompareOptions,
): CanonicalCompareResult {
  const ignoreSet = new Set(options?.ignoreFields ?? DEFAULT_IGNORE_FIELDS);

  const sortMap = new Map<string, (item: any) => string>();
  if (options?.sortArraysBy) {
    for (const [path, spec] of Object.entries(options.sortArraysBy)) {
      sortMap.set(path, buildSortKey(spec));
    }
  }

  const diff = deepCompare(actual, expected, ignoreSet, sortMap, '$');
  return diff ? { match: false, diff } : { match: true };
}
