/**
 * ROADMAP 2.645 — the normalisation-warning humaniser copy is actively wrong
 * for every producer class except one.
 *
 * THE DEFECT. `/v2/run` turns each informational normalisation warning into a
 * critique with `code: 'NORMALIZATION_WARNING'` (`routes/v2/run.ts:7010`) —
 * DISCARDING the producer's own class (`NormalisationWarning.code`). The
 * humaniser then renders every one of them as
 *
 *     "<label> is an option and was excluded from factor analysis. This is expected."
 *
 * That sentence is true for exactly one of the producer's classes and false for
 * the others: the node is not an option, it was not excluded from factor
 * analysis, and nothing about it is "expected".
 *
 * THE PRODUCER DOMAIN, derived at the bytes and confirmed by EXECUTION at
 * `c03e36fe` (trap 13c — the oracle comes from the producer, not from a
 * reading of what the field ought to mean). `normaliseGraphWithRepairs`
 * PARTITIONS the normaliser's warnings: any warning carrying `repair` becomes a
 * `RepairEntry` in `_meta.repairs_applied` and NEVER a critique; only the
 * repair-less ones survive as `warnings` and reach `run.ts:7010`. Enumerating
 * all nine `warnings.push` sites in `graph-normaliser.ts`, exactly three
 * classes can reach the humaniser:
 *
 *   NORMALIZATION_WARNING   node has kind='option', filtered before analysis
 *   UNKNOWN_NODE_KIND       node kind is not a recognised causal/non-causal kind
 *   PRIOR_ON_NON_EXTERNAL   prior supplied on a node whose category is not external
 *
 * The corpus below drives the REAL normaliser rather than a hand-written
 * warning list, so the classes under test are the ones the producer actually
 * emits (trap 16: a fixture you wrote yourself is not evidence about the wire).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  humaniseCritique,
  addUserMessages,
  NORMALISATION_WARNING_COPY,
} from '../src/critique-humaniser.js';
import { normalisationWarningToCritique } from '../src/lib/normalisation-critiques.js';
import { normaliseGraphWithRepairs } from '../src/normalisation/normalise-and-repair.js';
import { REPAIR_CODES } from '../src/normalisation/repair-codes.js';
import type { NormalisationWarning } from '../src/normalisation/graph-normaliser.js';

/**
 * A graph that provokes all three reachable classes at once, plus a
 * repair-bearing edge so the partition itself is exercised.
 */
const CORPUS_GRAPH = {
  nodes: [
    { id: 'opt_keep_price', kind: 'option', label: 'Keep price' },
    { id: 'fac_pro_price', kind: 'factor', label: 'Pro price' },
    { id: 'fac_sparkle', kind: 'sparkle', label: 'Sparkle' },
    {
      id: 'fac_churn',
      kind: 'factor',
      label: 'Churn',
      category: 'controllable',
      prior: { distribution: 'normal', range_min: 0, range_max: 1 },
    },
    { id: 'out_revenue', kind: 'outcome', label: 'Revenue' },
  ],
  edges: [
    { from: 'opt_keep_price', to: 'fac_pro_price', exists_probability: 0.9, strength: { mean: 0.5, std: 0.2 } },
    // No strength/exists_probability — provokes repair-bearing warnings, which
    // must NOT appear as critiques.
    { from: 'fac_pro_price', to: 'out_revenue' },
  ],
} as never;

/** The graph the humaniser is handed for label resolution. */
const LABEL_GRAPH = {
  nodes: [
    { id: 'opt_keep_price', label: 'Keep price' },
    { id: 'fac_sparkle', label: 'Sparkle' },
    { id: 'fac_churn', label: 'Churn' },
  ],
};

/**
 * The critique `/v2/run` actually builds — the SAME constructor the route
 * calls, so this test cannot pass against a shape the route does not emit.
 */
function toCritique(warning: NormalisationWarning) {
  return normalisationWarningToCritique(warning, randomUUID());
}

function warningsByProducerCode(): Map<string, NormalisationWarning> {
  const result = normaliseGraphWithRepairs(CORPUS_GRAPH);
  const byCode = new Map<string, NormalisationWarning>();
  for (const w of result.warnings) byCode.set(w.code, w);
  return byCode;
}

function humanisedFor(producerCode: string): string {
  const warning = warningsByProducerCode().get(producerCode);
  // Precondition pin (trap 13b): the corpus must actually reproduce the class,
  // or the assertion below would pass on a warning that was never emitted.
  expect(
    warning,
    `corpus did not emit producer class ${producerCode}; the test proves nothing`,
  ).toBeDefined();
  return humaniseCritique(toCritique(warning!), LABEL_GRAPH);
}

describe('2.645 — normalisation-warning copy must be TRUE for each producer class', () => {
  it('PRECONDITION: the corpus reproduces exactly the three reachable producer classes', () => {
    const codes = [...warningsByProducerCode().keys()].sort();
    expect(codes).toEqual([
      'NORMALIZATION_WARNING',
      'PRIOR_ON_NON_EXTERNAL',
      'UNKNOWN_NODE_KIND',
    ]);
  });

  it('PRECONDITION: repair-bearing warnings never become critiques (they are repairs)', () => {
    const result = normaliseGraphWithRepairs(CORPUS_GRAPH);
    expect(result.repairs.length).toBeGreaterThan(0);
    for (const w of result.warnings) expect(w.repair).toBeUndefined();
  });

  it('CONTROL — the option class keeps its true copy', () => {
    // The option warning carries no `node_id`, so the label is humanised from
    // the id found in the message ('opt_keep_price' → 'Keep Price'), not read
    // from the graph. Recorded as measured, not as intended.
    const msg = humanisedFor('NORMALIZATION_WARNING');
    expect(msg).toContain('Keep Price');
    expect(msg).toContain('is an option');
  });

  it('RED — UNKNOWN_NODE_KIND must not be described as an option excluded from factor analysis', () => {
    const msg = humanisedFor('UNKNOWN_NODE_KIND');
    expect(msg).not.toContain('is an option');
    expect(msg).not.toContain('excluded from factor analysis');
    expect(msg).not.toContain('This is expected.');
  });

  it('RED — PRIOR_ON_NON_EXTERNAL must not be described as an option excluded from factor analysis', () => {
    const msg = humanisedFor('PRIOR_ON_NON_EXTERNAL');
    expect(msg).not.toContain('is an option');
    expect(msg).not.toContain('excluded from factor analysis');
    expect(msg).not.toContain('This is expected.');
  });

  it('UNKNOWN_NODE_KIND says what the producer actually did — forwarded the kind unchanged', () => {
    const msg = humanisedFor('UNKNOWN_NODE_KIND');
    expect(msg).toContain('Sparkle');
    expect(msg).toContain('does not recognise');
    expect(msg).toContain('passed to the engine unchanged');
  });

  it('PRIOR_ON_NON_EXTERNAL says what the producer actually declared — the prior is used only without a stated value', () => {
    const msg = humanisedFor('PRIOR_ON_NON_EXTERNAL');
    expect(msg).toContain('Churn');
    expect(msg).toContain('external');
    expect(msg).toContain('no stated value');
    // ⚠ The copy asserted 'ignored' until the translator stopped gating its
    // prior pass on `category === 'external'`. A prior on a non-external factor
    // is now FORWARDED to ISL when the factor has no stated value, so claiming
    // it is ignored would be the class-6 defect (the product stating a
    // consequence it does not produce). This assertion is what keeps the old
    // sentence from coming back.
    expect(msg).not.toContain('ignored');
  });

  it('RED — an untagged normalisation critique must not claim the option class', () => {
    // A critique replayed from a debug bundle carries no producer class. The
    // class is UNKNOWN, so the copy must not assert one.
    const msg = humaniseCritique(
      {
        id: 'dbg-1',
        code: 'NORMALIZATION_WARNING',
        severity: 'info',
        message: "Node 'fac_sparkle' was touched during normalisation.",
        source: 'validation',
        blocks_analysis: false,
      },
      LABEL_GRAPH,
    );
    expect(msg).not.toContain('is an option');
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe('2.645 — `normalisation_code` is internal and must never reach the wire', () => {
  it('addUserMessages strips it while every other field survives', () => {
    const warning = warningsByProducerCode().get('UNKNOWN_NODE_KIND');
    expect(warning).toBeDefined();
    const critique = toCritique(warning!);
    // Positive control: the field IS present before humanisation, so the
    // assertion below can distinguish "stripped" from "never set".
    expect(critique.normalisation_code).toBe('UNKNOWN_NODE_KIND');

    const [humanised] = addUserMessages([critique], LABEL_GRAPH);
    expect(Object.keys(humanised)).not.toContain('normalisation_code');
    expect(humanised.code).toBe('NORMALIZATION_WARNING');
    expect(humanised.message).toBe(critique.message);
    expect(humanised.severity).toBe('info');
    expect(humanised.blocks_analysis).toBe(false);
    // …and the class still reached the copy on its way out.
    expect(humanised.user_message).toContain('does not recognise');
  });
});

// ---------------------------------------------------------------------------
// Completeness guard (trap 12d). The corpus above proves each class we KNOW
// about reads true. It is structurally blind to a class nobody wrote a row for.
// This scan reads the PRODUCER's source and fails loud when a fourth appears.
// ---------------------------------------------------------------------------

interface ScannedWarningSite {
  code: string;
  bearsRepair: boolean;
}

/**
 * Enumerate every `warnings.push({...})` site in the normaliser and classify it
 * by whether it carries `repair` — the exact predicate
 * `normaliseGraphWithRepairs` partitions on. Repair-bearing sites become
 * `_meta.repairs_applied` entries; the rest become critiques and so need copy.
 */
function scanNormaliserWarningSites(): ScannedWarningSite[] {
  const source = readFileSync(
    join(__dirname, '..', 'src', 'normalisation', 'graph-normaliser.ts'),
    'utf8',
  );
  const sites: ScannedWarningSite[] = [];
  const opener = /warnings\??\.push\(\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    // Brace-match from the `{` that the pattern consumed.
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
    }
    if (depth !== 0) throw new Error(`unbalanced warnings.push at index ${match.index}`);
    const body = source.slice(match.index + match[0].length, i - 1);

    const bearsRepair = /(^|[\s,{])repair\s*[:,]/.test(body);
    const codeMatch =
      body.match(/code:\s*REPAIR_CODES\.([A-Z_]+)/) ??
      body.match(/code:\s*'([A-Z_]+)'/);
    let code: string;
    if (codeMatch) {
      code = (REPAIR_CODES as Record<string, string>)[codeMatch[1]] ?? codeMatch[1];
    } else if (/(^|[\s,{])code\s*,/.test(body)) {
      // Shorthand `code,` — the shared repair-pushing helper. It is only ever
      // reached with a repair payload, which the check above already recorded.
      code = '<helper>';
    } else {
      throw new Error(`warnings.push site with no resolvable code:\n${body}`);
    }
    sites.push({ code, bearsRepair });
  }
  return sites;
}

describe('2.645 — completeness: every non-repair normaliser warning class has copy', () => {
  const sites = scanNormaliserWarningSites();

  it('CONTROL — the scan is not vacuous and its repair-detection half works', () => {
    expect(sites.length).toBeGreaterThanOrEqual(6);
    const repairBearing = sites.filter((s) => s.bearsRepair);
    expect(repairBearing.length).toBeGreaterThanOrEqual(3);
    // Bound by identity: a code known to carry a repair must be classified as
    // one, or the exclusion below would be hiding classes rather than skipping
    // repairs.
    expect(repairBearing.map((s) => s.code)).toContain(REPAIR_CODES.INVALID_CATEGORY);
  });

  it('the repair-less classes are exactly the three with copy', () => {
    const critiqueClasses = [
      ...new Set(sites.filter((s) => !s.bearsRepair).map((s) => s.code)),
    ].sort();
    expect(critiqueClasses).toEqual([
      'NORMALIZATION_WARNING',
      REPAIR_CODES.PRIOR_ON_NON_EXTERNAL,
      REPAIR_CODES.UNKNOWN_NODE_KIND,
    ]);
    for (const code of critiqueClasses) {
      expect(
        Object.keys(NORMALISATION_WARNING_COPY),
        `producer class ${code} reaches users with no copy of its own — it would ` +
          `fall back to the class-free generic. Add a row to NORMALISATION_WARNING_COPY.`,
      ).toContain(code);
    }
  });
});
