/**
 * Real ISL V2 process-pool captures from /api/v1/robustness/analyze/v2?response_version=2:
 * - isl-da33003b-pool-applied.json: ISL #229 @ da33003b restores the event-risk echo.
 * - isl-3be42750-pool-echo-dropped.json: the served staging defect drops the echo.
 * Both live in fixtures/isl-event-risk-echo-20261007/, beside capture_env.py.
 * Staging incident: PLoT logged `event_risk_not_applied` at 18:18:24Z, 7 Oct 2026,
 * returning 502 EVENT_RISK_NOT_APPLIED for event-risk Runs. Pin the real producer
 * shape and fail-closed behaviour against the same sent ids.
 */

import { expect, it } from 'vitest';
import { eventRiskEchoMatches, eventRiskIdsSent } from '../src/integrations/isl/event-risk.js';
import applied from './fixtures/isl-event-risk-echo-20261007/isl-da33003b-pool-applied.json';
import dropped from './fixtures/isl-event-risk-echo-20261007/isl-3be42750-pool-echo-dropped.json';

it('accepts the applied pool echo and refuses the served dropped echo for identical event-risk ids', () => {
  const appliedIds = eventRiskIdsSent(applied.request.graph.nodes);
  const droppedIds = eventRiskIdsSent(dropped.request.graph.nodes);

  expect(appliedIds.length).toBeGreaterThan(0);
  expect(appliedIds).toEqual(['supplier_fails']);
  expect(droppedIds).toEqual(appliedIds);

  expect(eventRiskEchoMatches(appliedIds, applied.envelope)).toBe(true);
  expect(eventRiskEchoMatches(droppedIds, dropped.envelope)).toBe(false);

  expect(applied.envelope.event_risks_applied.length).toBeGreaterThan(0);
  for (const entry of applied.envelope.event_risks_applied) {
    for (const key of ['node_id', 'occurrence_used', 'p_low', 'p_high']) {
      expect(entry).toHaveProperty(key);
    }
  }
});
