/**
 * P1 pin: "is this entry a stage definition?" must be ONE predicate.
 *
 * DEFECT (structural). After #265, `sequential-validation.ts` asked that
 * question at three sites at three different strictnesses:
 *
 *   | site                            | object | !Array | numeric index | finite |
 *   |---------------------------------|--------|--------|---------------|--------|
 *   | readStageDefinitions (:132)     |   yes  |  yes   |      yes      |  yes   |
 *   | buildNodeStageMap    (:352)     |   yes  |  no    |      yes      |  no    |
 *   | getMaxStage          (:400)     |   no   |  no    |      yes      |  yes   |
 *
 * The three drifted apart INSIDE a single PR, and the drift is observable:
 * `readStageDefinitions` can REJECT an entry as INVALID_STAGE_DEFINITION while
 * the other two still consume it, so a stage definition the validator has
 * already refused goes on to influence the forward-reference map and the
 * reported stage count.
 *
 * SCOPE HONESTY — read before treating this as a live bug. The two checks that
 * differ (the array check and the finite check) cannot be tripped by a strict
 * JSON request body: JSON has no `Infinity`/`NaN` literal, and a JSON array
 * cannot carry a named `index` property. For every JSON-representable input the
 * three predicates happen to AGREE today. These tests therefore construct the
 * graph object directly, which is the honest level for the claim being pinned:
 * `validateSequentialGraph`'s own header declares its input "UNTRUSTED JSON
 * whatever the TypeScript types promise" and requires the function to be TOTAL,
 * so its predicates are part of its contract independent of any one caller.
 * This is a latent-divergence pin, not a reproduction of a user-visible 500.
 *
 * Each absence assertion below is paired with a POSITIVE CONTROL proving the
 * assertion can see the thing whose absence it claims.
 */

import { describe, it, expect } from 'vitest';
import {
  validateSequentialGraph,
  getMaxStage,
  isStageDefinition,
} from '../src/util/sequential-validation.js';

/** An array that also carries a numeric `index` — an object to `typeof`, an array to `Array.isArray`. */
function arrayWithIndexProperty(index: number, decisions: string[]): unknown {
  const entry: unknown[] & { index?: number; decisions?: string[] } = [];
  entry.index = index;
  entry.decisions = decisions;
  return entry;
}

describe('P1: one stage-definition predicate, used at every site', () => {
  describe('a stage rejected by readStageDefinitions must not seed the forward-reference map', () => {
    /**
     * `buildNodeStageMap` omitted the finite check, so a stage with a
     * non-finite `index` was refused by `readStageDefinitions` (error issue)
     * and yet still had its `decisions` list folded into the node→stage map.
     * `Infinity > 0` then fabricated a FORWARD_REFERENCE attributed to a stage
     * definition the validator had already thrown away.
     */
    const graphWithNonFiniteStage = () =>
      ({
        nodes: [
          { id: 'a', label: 'A', kind: 'decision', stage: 0 },
          { id: 'b', label: 'B', kind: 'factor' },
        ],
        edges: [{ from: 'b', to: 'a', weight: 1 }],
        sequential_metadata: {
          is_sequential: true,
          stages: [
            { index: 0, label: 'first', decisions: ['a'], resolved_uncertainties: [] },
            {
              index: Number.POSITIVE_INFINITY,
              label: 'bogus',
              decisions: ['b'],
              resolved_uncertainties: [],
            },
          ],
        },
      }) as any;

    it('rejects the non-finite stage (shared precondition)', () => {
      const result = validateSequentialGraph(graphWithNonFiniteStage());
      expect(result.issues.map((i) => i.code)).toContain('INVALID_STAGE_DEFINITION');
      expect(result.valid).toBe(false);
    });

    it('RED-first: emits no FORWARD_REFERENCE derived from the rejected stage', () => {
      const result = validateSequentialGraph(graphWithNonFiniteStage());
      // Before the fix: buildNodeStageMap accepted index=Infinity, mapped
      // b -> Infinity, and Infinity > 0 produced a FORWARD_REFERENCE.
      expect(result.issues.map((i) => i.code)).not.toContain('FORWARD_REFERENCE');
    });

    it('POSITIVE CONTROL: a genuine forward reference in the same shape IS reported', () => {
      // Identical graph, except the second stage is well-formed (index 1) and
      // `b` really does sit at a later stage than its edge target. If the
      // assertion above could not see a FORWARD_REFERENCE at all, this fails.
      const graph = {
        nodes: [
          { id: 'a', label: 'A', kind: 'decision', stage: 0 },
          { id: 'b', label: 'B', kind: 'factor' },
        ],
        edges: [{ from: 'b', to: 'a', weight: 1 }],
        sequential_metadata: {
          is_sequential: true,
          stages: [
            { index: 0, label: 'first', decisions: ['a'], resolved_uncertainties: [] },
            { index: 1, label: 'second', decisions: ['b'], resolved_uncertainties: [] },
          ],
        },
      } as any;

      const result = validateSequentialGraph(graph);
      expect(result.issues.map((i) => i.code)).toContain('FORWARD_REFERENCE');
    });
  });

  describe('a stage rejected by readStageDefinitions must not raise getMaxStage', () => {
    /**
     * `getMaxStage` omitted both the object and the array check, so an array
     * entry carrying `index: 7` was refused by `readStageDefinitions` and yet
     * still set the maximum stage — which feeds the `maxStage > MAX_STAGES`
     * 400 gate and `model_card.stages` on both analysis routes.
     */
    const graphWithArrayStage = () =>
      ({
        nodes: [{ id: 'a', label: 'A', kind: 'decision', stage: 0 }],
        edges: [],
        sequential_metadata: {
          is_sequential: true,
          stages: [
            { index: 0, label: 'first', decisions: ['a'], resolved_uncertainties: [] },
            arrayWithIndexProperty(7, ['a']),
          ],
        },
      }) as any;

    it('rejects the array stage entry (shared precondition)', () => {
      const result = validateSequentialGraph(graphWithArrayStage());
      const invalid = result.issues.filter((i) => i.code === 'INVALID_STAGE_DEFINITION');
      expect(invalid).toHaveLength(1);
      expect(invalid[0].message).toContain('received array');
    });

    it('RED-first: getMaxStage ignores the rejected array entry', () => {
      // Before the fix: 7.
      expect(getMaxStage(graphWithArrayStage())).toBe(0);
    });

    it('POSITIVE CONTROL: getMaxStage does report a legitimately high stage index', () => {
      const graph = {
        nodes: [{ id: 'a', label: 'A', kind: 'decision', stage: 0 }],
        edges: [],
        sequential_metadata: {
          is_sequential: true,
          stages: [
            { index: 0, label: 'first', decisions: ['a'], resolved_uncertainties: [] },
            { index: 7, label: 'seventh', decisions: [], resolved_uncertainties: [] },
          ],
        },
      } as any;
      expect(getMaxStage(graph)).toBe(7);
    });
  });

  describe('isStageDefinition is the single exported predicate', () => {
    it('accepts an object with a finite numeric index', () => {
      expect(isStageDefinition({ index: 0 })).toBe(true);
      expect(isStageDefinition({ index: 3, label: 'x' })).toBe(true);
      expect(isStageDefinition({ index: -1 })).toBe(true); // out-of-range is a separate issue code
    });

    it('rejects every non-stage shape the three old sites disagreed about', () => {
      expect(isStageDefinition(null)).toBe(false);
      expect(isStageDefinition(undefined)).toBe(false);
      expect(isStageDefinition(42)).toBe(false);
      expect(isStageDefinition('stage')).toBe(false);
      expect(isStageDefinition([])).toBe(false);
      expect(isStageDefinition({})).toBe(false);
      expect(isStageDefinition({ index: '0' })).toBe(false);
      expect(isStageDefinition({ index: Number.NaN })).toBe(false);
      expect(isStageDefinition({ index: Number.POSITIVE_INFINITY })).toBe(false);
      expect(isStageDefinition(arrayWithIndexProperty(3, []))).toBe(false);
    });
  });

  describe('normalising once removes the double-parse, not the single report', () => {
    /**
     * `readStageIdList` used to take an optional `issues` sink, and
     * `buildNodeStageMap` re-parsed the same stages a second time WITHOUT it
     * purely so the same omission was not reported twice. After normalisation
     * there is one parse and no optional parameter, so this count is now
     * structural rather than a convention a future editor must remember.
     */
    it('reports each missing stage id list exactly once', () => {
      const graph = {
        nodes: [
          { id: 'd1', label: 'D1', kind: 'decision', stage: 0 },
          { id: 'd2', label: 'D2', kind: 'decision', stage: 1 },
        ],
        edges: [],
        sequential_metadata: {
          is_sequential: true,
          // Two stages, each omitting BOTH declared id lists -> 4 warnings, no more.
          stages: [
            { index: 0, label: 'first', decision_node_id: 'd1' },
            { index: 1, label: 'second', decision_node_id: 'd2' },
          ],
        },
      } as any;

      const result = validateSequentialGraph(graph);
      const missing = result.issues.filter((i) => i.code === 'MISSING_STAGE_ID_LIST');
      expect(missing).toHaveLength(4);

      // One per (stage, field) pair, and each names its own field. The message
      // format is: `Stage 0 ("first") is missing "decisions". ...`
      const keys = missing.map((i) => {
        const m = /^Stage (.+?) is missing "(\w+)"\./.exec(i.message);
        expect(m, `unparseable MISSING_STAGE_ID_LIST message: ${i.message}`).not.toBeNull();
        return `${m![1]}|${m![2]}`;
      });
      expect([...new Set(keys)].sort()).toEqual([
        '0 ("first")|decisions',
        '0 ("first")|resolved_uncertainties',
        '1 ("second")|decisions',
        '1 ("second")|resolved_uncertainties',
      ]);
    });

    it('reports each wrong-typed stage id list exactly once', () => {
      const graph = {
        nodes: [{ id: 'd1', label: 'D1', kind: 'decision', stage: 0 }],
        edges: [],
        sequential_metadata: {
          is_sequential: true,
          stages: [{ index: 0, label: 'first', decisions: 'd1', resolved_uncertainties: { a: 1 } }],
        },
      } as any;

      const result = validateSequentialGraph(graph);
      expect(result.issues.filter((i) => i.code === 'INVALID_STAGE_ID_LIST')).toHaveLength(2);
    });
  });
});
