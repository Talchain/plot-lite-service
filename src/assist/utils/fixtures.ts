/**
 * Fixture graphs for testing without API keys.
 * Used when LLM_PROVIDER='fixtures' or as 2.5s fallback in streaming.
 */

import type { AssistGraph } from '../schemas/graph.js';

/**
 * Minimal buy-vs-build decision graph fixture
 */
export const fixtureGraph: AssistGraph = {
  version: '1',
  default_seed: 17,
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Deliver capability on time' },
    { id: 'dec_1', kind: 'decision', label: 'Buy vs Build decision' },
    { id: 'opt_buy', kind: 'option', label: 'Buy commercial solution' },
    { id: 'opt_build', kind: 'option', label: 'Build custom solution' },
    { id: 'out_cost', kind: 'outcome', label: 'Total cost of ownership' },
  ],
  edges: [
    { from: 'goal_1', to: 'dec_1' },
    { from: 'dec_1', to: 'opt_buy' },
    { from: 'dec_1', to: 'opt_build' },
    {
      from: 'opt_buy',
      to: 'out_cost',
      weight: 80000,
      belief: 0.9,
      provenance: { source: 'hypothesis' },
    },
    {
      from: 'opt_build',
      to: 'out_cost',
      weight: 120000,
      belief: 0.7,
      provenance: { source: 'hypothesis' },
    },
  ],
  meta: {
    roots: ['goal_1'],
    leaves: ['out_cost'],
    suggested_positions: {},
    source: 'assistant',
  },
};

/**
 * Get fixture graph for a given brief (pattern matching)
 */
export function getFixtureForBrief(brief: string): AssistGraph {
  const lower = brief.toLowerCase();

  // For now, return the same fixture for all briefs
  // TODO: Add more archetypes based on brief patterns (hire, expand, migrate, etc.)
  return fixtureGraph;
}
