/**
 * TRACK 2 (21 Oct 2026): `identityPartsHeldExact` holds a part of a declared sum or product exact ONLY when its today level
 * is the user's own and was stated with no spread of its own. Discriminating rows for each condition (buddy r2).
 */
import { describe, it, expect } from 'vitest';
import { identityPartsHeldExact, buildParameterUncertaintiesV3 } from '../src/integrations/isl/translator-v3.js';

const factor = (id: string, observed_state: Record<string, unknown>) => ({ id, kind: 'factor', label: id, observed_state }) as any;
const carrier = (operation: string, factor_ids: string[]) =>
  ({ id: 'total', kind: 'factor', label: 'total', observed_state: { value: 0.8, source: 'brief_extraction' }, nonlinear_identity: { operation, factor_ids, stated_in_brief: true } }) as any;

describe('Track 2: a stated part of a definition is held exact, and nothing else is', () => {
  it('a user-stated part with no spread of its own (or CEE\'s minimum) is held; the carrier itself is not a part', () => {
    const nodes = [carrier('sum', ['uk', 'eu']), factor('uk', { value: 0.6, source: 'brief_extraction' }), factor('eu', { value: 0.8, source: 'user_edited', std: 1e-4 })];
    expect([...identityPartsHeldExact(nodes)].sort()).toEqual(['eu', 'uk']);
    const pus = buildParameterUncertaintiesV3(nodes, []) ?? [];
    expect(pus.find((u) => u.node_id === 'eu')).toEqual({ node_id: 'eu', distribution: 'point_mass' });
  });

  it('NEGATIVE: a declared spread (σ 0.2, the user\'s) is kept; an Olumi level keeps its spread; an accumulation is untouched', () => {
    const declared = factor('uk', { value: 0.6, source: 'brief_extraction', std: 0.2, std_source: 'user' });
    const olumi = factor('eu', { value: 0.8, source: 'cee_inference' });
    expect(identityPartsHeldExact([carrier('sum', ['uk', 'eu']), declared, olumi]).size).toBe(0);
    const pus = buildParameterUncertaintiesV3([carrier('sum', ['uk', 'eu']), declared, olumi], []) ?? [];
    expect(pus.find((u) => u.node_id === 'uk')).toMatchObject({ distribution: 'normal', std: 0.2 });
    expect(identityPartsHeldExact([carrier('accumulation', ['uk', 'eu', 'x']), factor('uk', { value: 0.6, source: 'brief_extraction' })]).size).toBe(0);
  });

  it('CONTROL: without a declared identity, a stated level keeps CEE\'s minimum spread (nothing new is held)', () => {
    const pus = buildParameterUncertaintiesV3([factor('uk', { value: 0.6, source: 'brief_extraction', std: 1e-4 })], []) ?? [];
    expect(pus.find((u) => u.node_id === 'uk')).toMatchObject({ distribution: 'normal' });
  });
  // Codex integration review 4 (21 Oct): a spread with an owner is that owner's, whatever its size. A user's own σ 0.0001
  // (the same size as CEE's bare minimum) is kept, not turned into a point mass; only the unowned minimum is held exact.
  it('a part\'s spread is kept by its OWNER (std_source), never judged by its size', () => {
    const owned = factor('uk', { value: 0.6, source: 'brief_extraction', std: 1e-4, std_source: 'user' });
    const bare = factor('eu', { value: 0.8, source: 'brief_extraction', std: 1e-4 });
    expect([...identityPartsHeldExact([carrier('sum', ['uk', 'eu']), owned, bare])]).toEqual(['eu']);
    const pus = buildParameterUncertaintiesV3([carrier('sum', ['uk', 'eu']), owned, bare], []) ?? [];
    expect(pus.find((u) => u.node_id === 'uk')).toEqual({ node_id: 'uk', distribution: 'normal', std: 1e-4, spread_source: 'user' });
    expect(pus.find((u) => u.node_id === 'eu')).toEqual({ node_id: 'eu', distribution: 'point_mass' });
  });
});
