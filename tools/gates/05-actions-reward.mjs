#!/usr/bin/env node
/**
 * Phase 5: Actions, reward, explainability
 * - Action semantics: set vs delta relative to current_state
 * - Linear reward computation
 * - Compute best_action, top_k[], regret
 * - Explain-Δ with adjustment-set proof
 */

import { computeActionsReward } from '../../lib/actions/reward.mjs';

const testGraph = {
  nodes: [{ id: 'price' }, { id: 'demand' }, { id: 'revenue' }],
  edges: [
    { from: 'price', to: 'demand' },
    { from: 'demand', to: 'revenue' },
  ],
};

const mockBmaResult = {
  bma_hash: 'abc123',
  K_evaluated: 1000,
  K_used: 100,
  mass_covered: 0.95,
};

async function main() {
  console.log('GATES: Phase 5 — Actions, reward, explainability');

  const result = computeActionsReward(testGraph, mockBmaResult);

  // Validate structure
  if (!result.actions || !Array.isArray(result.actions)) {
    throw new Error('Missing actions array');
  }

  if (!result.reward || !result.reward.best_action) {
    throw new Error('Missing reward.best_action');
  }

  if (!result.reward.top_k || result.reward.top_k.length === 0) {
    throw new Error('Missing reward.top_k');
  }

  if (typeof result.reward.regret !== 'number' || result.reward.regret < 0) {
    throw new Error(`Invalid regret: ${result.reward.regret}`);
  }

  if (!result.explain_delta || !result.explain_delta.adjustment_set) {
    throw new Error('Missing explain_delta.adjustment_set');
  }

  // Validate action types
  for (const action of result.actions) {
    if (!['set', 'delta'].includes(action.type)) {
      throw new Error(`Invalid action type: ${action.type}`);
    }
    if (action.type === 'delta' && !action.relative_to) {
      throw new Error(`Delta action missing relative_to: ${action.action_id}`);
    }
  }

  // Validate top_k ordering
  for (let i = 1; i < result.reward.top_k.length; i++) {
    if (result.reward.top_k[i].rank !== i + 1) {
      throw new Error(`top_k rank mismatch at index ${i}`);
    }
    if (result.reward.top_k[i].expected_reward > result.reward.top_k[i - 1].expected_reward) {
      throw new Error(`top_k not sorted by reward`);
    }
  }

  console.log(`GATES: PASS — actions+reward OK (best=${result.reward.best_action}, regret=${result.reward.regret}, top_k=${result.reward.top_k.length})`);
  process.exit(0);
}

main().catch(err => {
  console.error('GATES: FAIL — actions-reward:', err.message);
  import('node:fs').then(({ writeFileSync }) => {
    writeFileSync('reports/diag/05-actions-reward.json', JSON.stringify({
      phase: '05-actions-reward',
      error: err.message,
      timestamp: new Date().toISOString(),
    }, null, 2));
  });
  process.exit(1);
});
