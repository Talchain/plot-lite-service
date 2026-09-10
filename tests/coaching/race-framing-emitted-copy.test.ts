/**
 * NO RACE FRAMING IN EMITTED COPY.
 *
 * The product owner's standing ruling (raised numerous times) is that a
 * decision must not be framed as a CONTEST. The three questions the product is
 * meant to answer instead are: which option is most likely to produce the best
 * outcome, how confident are we, and what would change that. "X leads",
 * "X is clearly ahead", "X outperforms Y", "a strong current lead" all frame
 * the decision as a race and are banned from EMITTED COPY.
 *
 * ⚠ THE BAN IS ON EMITTED COPY, NOT ON SOURCE TOKENS. PLoT `src/` carries
 * hundreds of hits for this vocabulary in identifiers, comments, wire enums
 * (`band: 'clearly_ahead' | ...`) and threshold constant names. Those are
 * implementation, never vocabulary, and rewriting them would churn ~200 files
 * and fix nothing a user sees. This test therefore drives the PRODUCERS and
 * sweeps what they RETURN — it never greps the source.
 *
 * WHY A BRANCH MATRIX, NOT A HAPPY-PATH CALL: every emission site in these
 * modules sits behind a headlineType / readiness / tone / robustness branch.
 * A single fixture executes one of them, so a sweep over one call would pass
 * while every other branch still shipped the framing (the estate's dominant
 * defect: a guard that agrees with itself because it never reached the code).
 * The matrices below enumerate the full cross-product of the discriminators
 * each producer actually branches on.
 *
 * WHY THE POSITIVE CONTROL IS LOAD-BEARING: `BANNED_RACE_FRAMING` carves out
 * the causal/temporal senses of "lead" ("paths lead to", "lead time",
 * "team lead") which are legitimate English and appear in unrelated template
 * copy. A carve-out can silently hollow a guard until it matches nothing
 * (trap 13b). The control below asserts the pattern still matches EVERY
 * pre-repair string verbatim, so the guard's discrimination is pinned in-test
 * and a future widening of the carve-out fails HERE rather than shipping.
 *
 * ⛔ THE LIMIT OF THIS GUARD, STATED SO NOBODY MISTAKES IT FOR MORE. It bounds
 * VOCABULARY. It cannot bound FRAMING. Mutant M11 demonstrated the gap on a
 * real emission site: "this option is still out in front" passed while the same
 * site with "currently leads" went red. The idiom list below was widened in
 * response, but a word list is a hand-maintained mirror and the next idiom
 * nobody listed will pass it too.
 *
 * ⭐ AND THERE IS A THIRD FACE THIS FILE CANNOT SEE AT ALL: the SUBJECT of every
 * sentence swept here is chosen by RANK (`inputs.options[0]`, `sorted[0]`), not
 * by the user. Copy that answers about the top-ranked option when the user
 * asked about their own is a race frame with a perfectly clean grep — measured
 * live elsewhere in the estate, and repaired on the UI side in #1421. A green
 * run here is evidence about wording and is silent about referent.
 *
 * So: this guard stops a regression in the words. The review is still the only
 * instrument that bounds the frame.
 */
import { describe, it, expect } from 'vitest';
import { generateExecutiveSummary } from '../../src/coaching/executive-summary.js';
import { generateNextActions } from '../../src/coaching/next-actions.js';
import { generateHeadlines } from '../../src/coaching/headlines.js';
import { assembleBrief } from '../../src/assembly/decision-brief.js';
import { ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP } from '../../src/routes/v2/robustness-display-verdict.js';
import { TEMPLATE_MAP } from '../../src/critique-humaniser.js';
import type { CoachingInputs, HeadlineType, Readiness } from '../../src/coaching/types.js';
import type { ReadinessTone, ReadinessToneResult } from '../../src/coaching/readiness-tone.js';

/**
 * The banned framing, as a property over emitted text.
 *
 * Carve-outs (each a legitimate non-race sense that appears in real copy):
 *   - `lead(s|ing) to`      — causation ("paths lead to below-average outcomes")
 *   - `lead time(s)`        — supply-chain term in the template corpus
 *   - `team lead`/`tech lead`/`lead engineer`/`qualified leads` — job titles and
 *     sales vocabulary in the template corpus
 * Everything else in this family is race framing.
 */
const BANNED_RACE_FRAMING = new RegExp(
  [
    // "lead" family, EXCLUDING the causal and job-title senses
    // `lead to` / `leads there` are DIRECTIONAL-CAUSAL ("paths lead to X",
    // "a factor that already leads there"), not positional. `lead time(s)` and
    // `lead engineer` are supply-chain and job-title senses in the template
    // corpus. None frames a decision as a contest.
    String.raw`\blead(?:s|ing)?\b(?!\s+(?:to|there|times?|engineers?)\b)`,
    String.raw`\bleader\b`,
    String.raw`\bahead\b`,
    String.raw`\bwinner\b`,
    String.raw`\bwins\b`,
    String.raw`\bwinning\b`,
    String.raw`\boutperform\w*\b`,
    String.raw`\bfront-?runner\b`,
    String.raw`\btrail(?:s|ing)?\b`,
    String.raw`\bbeats\b`,
    String.raw`\bvictor\w*\b`,
    String.raw`\btop option\b`,
    String.raw`\bclose race\b`,
    // ⭐ RACE IDIOM WITHOUT ANY OF THE ABOVE WORDS. Added after mutant M11
    // restored "this option is still out in front" at a real emission site and
    // SURVIVED, while the same site with "currently leads" went red — a
    // discriminating pair proving the site was reached and the GUARD was
    // narrow, not the sweep blind. See the limitation note on this constant.
    String.raw`\bout in front\b`,
    String.raw`\bin front\b`,
    String.raw`\bfirst place\b`,
    String.raw`\bpull(?:s|ing)? ahead\b`,
    String.raw`\bneck and neck\b`,
    String.raw`\bphoto finish\b`,
    String.raw`\brunner-?up\b`,
    String.raw`\bovertak(?:e|es|ing)\b`,
    String.raw`\btoo close to call\b`,
    String.raw`\bcomes? (?:first|second|last)\b`,
  ].join('|'),
  'i',
);

/** Job-title / sales senses are stripped before the test, not carved into the regex. */
const JOB_TITLE_SENSE = /\b(?:team|tech|technical|qualified|sales)\s+leads?\b/gi;

function offends(text: string): boolean {
  return BANNED_RACE_FRAMING.test(text.replace(JOB_TITLE_SENSE, ''));
}

/** Every string reachable in a value, with its path (derived, never listed). */
function collectProse(value: unknown, path: string): Array<{ path: string; text: string }> {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => collectProse(v, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => collectProse(v, `${path}.${k}`));
  }
  return [];
}

/**
 * Wire enums and identifiers are NOT copy and are explicitly out of scope.
 * `band` ('very_close' | 'clearly_ahead' | 'slightly_ahead') crosses the
 * contract; renaming it is a schema change across olumi-schemas and every
 * consumer. Same for the ISL-sourced status/reason tokens. They are dropped by
 * PATH, so a new PROSE field is never silently exempted.
 */
const OUT_OF_SCOPE_PATHS = [
  /\.band$/,
  /\.status$/,
  /\.basis$/,
  /\.doctrine$/,
  /\.robustness$/,
  /_id$/,
  /_ids\[\d+\]$/,
  /\.code$/,
  /\btarget_type$/,
  /\.headline_type$/,
  /\.readiness$/,
  /\.tone$/,
  /\.reasons\[\d+\]$/,
  /\.impact$/,
  /\.dimension$/,
  /\.type$/,
  /\.severity$/,
  /\.flip_reason$/,
  /\.version$/,
  /\.config_version$/,
  /\.created_at$/,
  /\.brief_id$/,
  /\.graph_hash$/,
];

function copyOnly(prose: Array<{ path: string; text: string }>) {
  return prose.filter((p) => !OUT_OF_SCOPE_PATHS.some((rx) => rx.test(p.path)));
}

function assertNoRaceFraming(prose: Array<{ path: string; text: string }>, label: string) {
  const swept = copyOnly(prose);
  // Positive control: this sweep can SEE copy at all. An empty sweep makes
  // every absence assertion below vacuous (trap 13).
  expect(swept.length, `${label}: sweep collected no copy — absence would be vacuous`)
    .toBeGreaterThan(0);
  const offenders = swept.filter((p) => offends(p.text));
  expect(
    offenders.map((o) => `${o.path}: ${o.text}`),
    `${label}: emitted copy must not frame the decision as a race`,
  ).toEqual([]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Producer-grounded inputs
// ─────────────────────────────────────────────────────────────────────────────

function makeOptions(gap: number) {
  return [
    { id: 'opt-a', label: 'Option A', winProbability: 0.5 + gap / 2, outcomeMean: 120, outcomeP10: 90, outcomeP90: 150 },
    { id: 'opt-b', label: 'Option B', winProbability: 0.5 - gap / 2, outcomeMean: 100, outcomeP10: 70, outcomeP90: 130 },
  ];
}

function makeInputs(
  gap: number,
  robustLevel: 'high' | 'moderate' | 'low' | 'very_low' | undefined,
  isRobust: boolean | undefined,
  stability = 0.6,
): CoachingInputs {
  return {
    factorSensitivity: [
      {
        node_id: 'f1', label: 'Demand growth', elasticity: 0.42, importance_rank: 1,
        confidence: 0.6, direction: 'positive', influence_score: 0.42, zero_reason: undefined,
      },
    ],
    fragileEdges: [],
    options: makeOptions(gap),
    graph: { nodes: [], edges: [] } as any,
    robustness: { level: robustLevel, recommendationStability: stability, isRobust },
    interventionTargetIds: new Set<string>(),
  } as CoachingInputs;
}

const HEADLINE_TYPES: HeadlineType[] = [
  'clear_winner', 'moderate_winner', 'close_call', 'high_uncertainty', 'needs_evidence',
];
const READINESSES: Readiness[] = ['ready', 'close_call', 'needs_evidence', 'needs_framing'];
const TONES: ReadinessTone[] = ['confident', 'tempered', 'caution'];

function tone(t: ReadinessTone, withReasons = true): ReadinessToneResult {
  return { tone: t, reasons: t === 'confident' || !withReasons ? [] : ['EVIDENCE_GAPS'] };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('emitted copy carries no race framing', () => {
  // ─── THE GUARD'S OWN DISCRIMINATION (must run first: everything else is an
  // absence assertion and is worthless if the pattern matches nothing) ───
  describe('positive control — the pattern still catches every pre-repair string', () => {
    const PRE_REPAIR_STRINGS = [
      'Option A leads, but the top options are very close.',
      'Option A is clearly ahead.',
      'Option A is slightly ahead.',
      'Option A has a strong current lead with a 23-point advantage.',
      'Option A currently leads by 23 points, but the model is not yet strong enough for an unqualified decision.',
      'Option A currently leads by 23 points on the current model.',
      'Option A edges ahead by 4 points.',
      'Option A currently leads, but the outcome is highly uncertain.',
      'Option A is the top option on the current model.',
      'Treat this as a provisional lead until the fragile assumptions are checked.',
      'This option leads on the current model, with important caveats.',
      'None of the factors we could test changed which option leads on its own.',
      'Changing at least one tested factor on its own could change which option leads.',
      'This ranking was only moderately stable under the perturbations tested — treat the lead as provisional.',
      'This ranking was fragile under the perturbations tested — small changes to assumptions could change which option leads.',
      'Option A leads by only 4 points; within model uncertainty',
      'Option A has a strong current lead by 23 points',
      'the leading option',
      '{option} outperforms by {deltaPoints} points with high confidence',
      '{option} leads by {deltaPoints} points, though some uncertainty remains',
      '{option} edges ahead, but the {deltaPoints}-point margin is within uncertainty',
      '{option} leads, but {fragileEdgeLabel} could swing the outcome to {altWinner}',
      'Option A outperforms Option B by 12% (0.30 units). This ranking is stable.',
      'Leads by a margin of 0.30 over alternatives',
      'Every option produced almost the same outcome, so there is no meaningful winner to report.',
      'none of the factors we could test changed which option leads on its own, but this result scored low on our other robustness checks',
      'flip_thresholds is empty because computation failed, not because no factor could flip the leading option.',
      // Race idioms carrying NONE of the primary banned words (M11's class).
      'Significant evidence gaps remain, but this option is still out in front.',
      'Define tie-breaker criteria — margin is too close to call',
      'The top two are neck and neck.',
      'Option A overtakes Option B once demand recovers.',
    ];

    for (const s of PRE_REPAIR_STRINGS) {
      it(`catches: ${s.slice(0, 62)}`, () => {
        expect(offends(s), 'the guard must still bite this pre-repair string').toBe(true);
      });
    }

    // OPPOSITE-DIRECTION TWIN: the carve-outs must NOT have been widened into
    // a guard that passes everything. These legitimate senses must stay clean.
    const MUST_NOT_OFFEND = [
      'Higher cost but consistent quality and lead times.',
      'Lead time reliability',
      'How to secure a tech lead?',
      'Full-time lead engineer with long-term ownership.',
      'Qualified Leads',
      '3 potential paths lead to significantly below-average outcomes',
      'Connect what it changes through to the goal, or point it at a factor that already leads there.',
      'Option A is most likely to produce the best outcome on the current model.',
      'This ranking held up under the perturbations tested. That is not a guarantee — defaulted or uncertain inputs can still change the result.',
    ];
    for (const s of MUST_NOT_OFFEND) {
      it(`does NOT fire on the legitimate sense: ${s.slice(0, 50)}`, () => {
        expect(offends(s), 'the guard must not fire on a non-race sense').toBe(false);
      });
    }
  });

  // ─── generateExecutiveSummary: headlineType × readiness × tone ───
  describe('generateExecutiveSummary', () => {
    for (const ht of HEADLINE_TYPES) {
      for (const rd of READINESSES) {
        for (const t of TONES) {
          it(`${ht} / ${rd} / ${t}`, () => {
            const summary = generateExecutiveSummary(
              makeInputs(0.3, 'high', true), rd, ht, [], [], tone(t),
            );
            assertNoRaceFraming(collectProse(summary, 'executive_summary'), `${ht}/${rd}/${t}`);
          });
        }
      }
    }
  });

  // ⭐ THE DEFENSIVE `default:` BRANCH. Every member of the HeadlineType union
  // is handled by an explicit case, so the switch default is unreachable
  // through the TYPE — and mutant M9 proved it: "is the top option on the
  // current model" could be restored there with the whole matrix green.
  // It is NOT unreachable at RUNTIME: headlineType arrives from a payload, and
  // an unrecognised value falls through to exactly this branch. So it is copy a
  // user can see, and it is swept here with an out-of-union value.
  describe('generateDecisionStatement defensive default branch', () => {
    for (const rd of READINESSES) {
      for (const t of TONES) {
        it(`unrecognised headline type / ${rd} / ${t}`, () => {
          const summary = generateExecutiveSummary(
            makeInputs(0.3, 'high', true), rd,
            'an_unrecognised_headline_type' as unknown as HeadlineType,
            [], [], tone(t),
          );
          // PRECONDITION PIN: prove we actually landed on the default branch,
          // so a future refactor that stops reaching it fails HERE rather than
          // leaving an unswept emission site behind a green sweep.
          expect(
            summary.decision_statement,
            'this case must exercise the switch default',
          ).toMatch(/on the current model\.$/);
          assertNoRaceFraming(collectProse(summary, 'executive_summary'), `default/${rd}/${t}`);
        });
      }
    }
  });

  // ─── generateNextActions: headlineType × tone × gap ───
  describe('generateNextActions', () => {
    // ⭐ `withReasons` is a MEASURED necessity, not thoroughness. The priority-7
    // rationale has two shapes — one interpolating a reason summary and one
    // bare fallback for when there is none. A matrix that always supplies a
    // reason NEVER EXECUTES the fallback: proven by mutant M3, which restored
    // "currently leads by N points" at exactly that site and SURVIVED.
    for (const ht of HEADLINE_TYPES) {
      for (const t of TONES) {
        for (const withReasons of [true, false]) {
          it(`${ht} / ${t} / reasons=${withReasons}`, () => {
            const actions = generateNextActions(
              makeInputs(0.04, 'high', true), ht, [], [], tone(t, withReasons),
            );
            assertNoRaceFraming(collectProse(actions, 'next_actions'), `${ht}/${t}/${withReasons}`);
          });
        }
      }
    }

    // COVERAGE PIN: the bare fallback rationale must actually be produced by
    // this matrix. Without it the sweep above could stop reaching that site
    // and stay green — the exact way M3 survived.
    it('COVERAGE: the matrix reaches the bare (no-reason-summary) rationale', () => {
      const rationales: string[] = [];
      for (const ht of HEADLINE_TYPES) {
        for (const t of TONES) {
          for (const withReasons of [true, false]) {
            for (const a of generateNextActions(makeInputs(0.04, 'high', true), ht, [], [], tone(t, withReasons))) {
              rationales.push(a.rationale);
            }
          }
        }
      }
      expect(
        rationales.some((r) => /produce the best outcome by \d+ points$/.test(r)),
        'the bare priority-7 rationale must be reached, or its emission site is unswept',
      ).toBe(true);
    });
  });

  // ─── generateHeadlines: across gaps that select each template ───
  describe('generateHeadlines', () => {
    // ⭐ STABILITY IS A SELECTOR, NOT DECORATION. `clear_winner` requires
    // winProbDelta >= 0.20 AND stability >= 0.70 (thresholds.ts). A matrix
    // pinned at stability 0.6 NEVER SELECTS IT — proven by mutant M4, which
    // restored "{option} outperforms by ..." and SURVIVED. Each row below
    // names the template it is there to reach.
    const SHAPES: Array<{ gap: number; stability: number; reaches: string }> = [
      { gap: 0.6, stability: 0.9, reaches: 'clear_winner' },
      { gap: 0.3, stability: 0.9, reaches: 'clear_winner' },
      { gap: 0.3, stability: 0.6, reaches: 'moderate_winner' },
      { gap: 0.12, stability: 0.6, reaches: 'moderate_winner' },
      { gap: 0.02, stability: 0.9, reaches: 'close_call' },
      { gap: 0.02, stability: 0.6, reaches: 'close_call' },
    ];
    for (const sh of SHAPES) {
      it(`gap ${sh.gap} / stability ${sh.stability} (${sh.reaches})`, () => {
        const headlines = generateHeadlines(makeInputs(sh.gap, 'high', true, sh.stability));
        assertNoRaceFraming(collectProse(headlines, 'headlines'), `gap ${sh.gap}/${sh.stability}`);
      });
    }

    // COVERAGE PIN, by the templates' own distinctive tails. A template this
    // matrix stops selecting is an unswept emission site, and this fails first.
    it('COVERAGE: the matrix reaches every headline template', () => {
      const seen = new Set<string>();
      const MARKERS: Array<[string, RegExp]> = [
        ['clear_winner', /with high confidence$/],
        ['moderate_winner', /though some uncertainty remains$/],
        ['close_call', /margin is within uncertainty$/],
        ['high_uncertainty', /could swing the outcome to /],
      ];
      const fragile = {
        edgeId: 'e1', fromId: 'f1', toId: 'goal', fromLabel: 'Cost', toLabel: 'Goal',
        displayLabel: 'Cost → Goal', switchProb: 0.4, altWinnerId: 'opt-b', altWinnerLabel: 'Option B',
      };
      const shapes = [
        ...SHAPES.map((sh) => makeInputs(sh.gap, 'high', true, sh.stability)),
        { ...makeInputs(0.3, 'high', true, 0.9), fragileEdges: [fragile] } as CoachingInputs,
      ];
      for (const inputs of shapes) {
        for (const text of Object.values(generateHeadlines(inputs))) {
          for (const [name, rx] of MARKERS) if (typeof text === 'string' && rx.test(text)) seen.add(name);
        }
      }
      expect([...seen].sort(), 'every headline template must be reached by this matrix')
        .toEqual(['clear_winner', 'close_call', 'high_uncertainty', 'moderate_winner']);
    });
  });

  // ─── assembleBrief: band × robustness × flip evidence ───
  describe('assembleBrief', () => {
    const FLIP_SHAPES: Array<{ name: string; flips: any }> = [
      { name: 'no flip data', flips: undefined },
      {
        name: 'attested no-flip',
        flips: [{ factor_id: 'f1', factor_label: 'Demand growth', flip_value: null, flip_reason: 'no_flip_in_range' }],
      },
      {
        name: 'computed flip',
        flips: [{ factor_id: 'f1', factor_label: 'Demand growth', flip_value: 0.7, flip_reason: 'computed' }],
      },
    ];
    const ROBUSTNESS_SHAPES: Array<{ name: string; robustness: any }> = [
      { name: 'is_robust true', robustness: { is_robust: true, level: 'high' } },
      { name: 'is_robust false only', robustness: { is_robust: false } },
      { name: 'level moderate', robustness: { level: 'moderate' } },
      { name: 'level low', robustness: { level: 'low' } },
      { name: 'level unrecognised', robustness: { is_robust: false, level: 'high' } },
    ];

    for (const gap of [0.05, 0.3, 0.15]) {
      for (const rs of ROBUSTNESS_SHAPES) {
        for (const fs of FLIP_SHAPES) {
          it(`gap ${gap} / ${rs.name} / ${fs.name}`, () => {
            const brief = assembleBrief({
              analysis_status: 'complete',
              critiques: [],
              option_comparison: [
                { option_id: 'opt-a', label: 'Option A', win_probability: 0.5 + gap / 2, expected_outcome: 120 },
                { option_id: 'opt-b', label: 'Option B', win_probability: 0.5 - gap / 2, expected_outcome: 100 },
              ] as any,
              robustness: rs.robustness,
              flip_thresholds: fs.flips,
              meta: { seed_used: '4242' },
            } as any);
            expect(brief, 'the brief must assemble for this shape').not.toBeNull();
            assertNoRaceFraming(collectProse(brief, 'decision_brief'), `${gap}/${rs.name}/${fs.name}`);
          });
        }
      }
    }
  });

  // ─── Exported copy tables ───
  it('robustness display-verdict attested-no-flip reasons', () => {
    assertNoRaceFraming(
      collectProse(ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP, 'verdict_reasons'),
      'verdict reasons',
    );
  });

  it('critique humaniser user-facing template copy', () => {
    const messages = Object.entries(TEMPLATE_MAP).map(([code, entry]: [string, any]) => ({
      path: `template_map.${code}`,
      text: typeof entry === 'string' ? entry : String(entry?.message ?? entry?.text ?? ''),
    })).filter((m) => m.text.length > 0);
    assertNoRaceFraming(messages, 'critique templates');
  });
});
