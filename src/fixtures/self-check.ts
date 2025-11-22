/**
 * Golden Scenario for Self-Check and Contract Tests
 * 
 * Fixed, deterministic scenario used for:
 * - /v1/self-check endpoint (hash stability)
 * - Contract snapshot tests
 * 
 * MUST NOT contain randomness or timestamps.
 * Seed is fixed at 42 for reproducibility.
 */

export const GOLDEN_SEED = 42;

export const GOLDEN_SCENARIO = {
  seed: GOLDEN_SEED,
  graph: {
    nodes: [
      {
        id: 'start',
        type: 'decision',
        label: 'Initial Assessment',
        question: 'Is the request valid?',
        options: ['yes', 'no']
      },
      {
        id: 'process',
        type: 'decision',
        label: 'Processing Step',
        question: 'Can we process this?',
        options: ['approved', 'rejected', 'review']
      },
      {
        id: 'approved',
        type: 'outcome',
        label: 'Approved',
        result: 'success'
      },
      {
        id: 'rejected',
        type: 'outcome',
        label: 'Rejected',
        result: 'failure'
      },
      {
        id: 'review',
        type: 'outcome',
        label: 'Needs Review',
        result: 'pending'
      }
    ],
    edges: [
      { from: 'start', to: 'process', condition: 'yes' },
      { from: 'start', to: 'rejected', condition: 'no' },
      { from: 'process', to: 'approved', condition: 'approved' },
      { from: 'process', to: 'rejected', condition: 'rejected' },
      { from: 'process', to: 'review', condition: 'review' }
    ]
  },
  inputs: {
    user_score: 0.85,
    risk_level: 'low',
    transaction_amount: 100
  }
};
