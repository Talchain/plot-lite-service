/**
 * Result-voice vocabulary — single source of truth for the phrase every
 * user-facing PLoT string uses when it has to say the answer could move.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULING (Paul, 2026-09-10), AND WHY A BANNED-WORDS LIST IS THE WRONG FIX.
 *
 * "There's never a winner." The analysis is a tool for helping a team think, so
 * no copy may frame it as a contest with a front-runner. That bans the FRAMING,
 * not a list of tokens: renaming `winner` to `leader`, or `leads` to `ahead`,
 * keeps the race intact and closes nothing. `X leads` compares the options TO
 * EACH OTHER. The sanctioned move is to re-anchor the same fact to the USER'S
 * GOAL, which relates an option to the person who asked:
 *
 *     "On the data so far, X is most likely to achieve your goal."
 *
 * Every results sentence traces to three questions: what is the most likely
 * outcome on the data so far, how confident can we be in it, and which option
 * is most likely to achieve THEIR goal. The human remains the author.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A CONSTANT AND NOT A STYLE NOTE.
 *
 * Two modules emit the phrase — `assembly/decision-brief.ts` (the brief's
 * robustness caveat) and `routes/v2/robustness-display-verdict.ts` (the
 * footer's verdict reason). Typed out twice, they are a hand-maintained mirror
 * of each other and the copy that drifts is the one that reopens the race
 * framing (CLAUDE.md trap 12). Their GUARDS import it too, so a test can never
 * go on policing wording the product no longer emits (trap 12b: a control
 * pinned to something that moves decays into a tautology the first time it
 * moves).
 *
 * ⚠ NOT A RENAME OF THE WIRE. `band` (`very_close` | `clearly_ahead` |
 * `slightly_ahead`), `display_verdict`, `CLEARLY_AHEAD_GAP_THRESHOLD` and
 * `NEAR_TIE_THRESHOLD` are untouched. A wire enum is implementation and crosses
 * the contract; it is never the vocabulary.
 *
 * ⚠ NO EM DASHES in any string built from this (Paul, same ruling). Split into
 * separate sentences, or cut the clause. Keep it tight, not waffly.
 */

/**
 * The goal-anchored noun phrase. Interpolate it; never retype it.
 *
 * Reads naturally in both tenses the surfaces need:
 *   `changed ${GOAL_FIT_PHRASE}`            (attestation, past)
 *   `could change ${GOAL_FIT_PHRASE}`       (fragility, conditional)
 */
export const GOAL_FIT_PHRASE = 'which option is most likely to achieve your goal';
