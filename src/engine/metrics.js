export function createMetrics() {
  const metrics = {
    steps: 0,
    ok: 0,
    failed: 0,
    durations: [],
    startStep(id) {
      return { id, t0: Date.now() };
    },
    endStep(token) {
      const d = Date.now() - token.t0;
      metrics.durations.push(d);
      return d;
    }
  };
  return metrics;
}
