/**
 * E2E: Robust Prometheus metric polling
 * Replaces brittle fixed sleeps with retry logic
 */

export async function waitForMetric(
  getVal: () => Promise<number | null>,
  { timeoutMs = 20000, intervalMs = 1000, predicate = (v: number) => v > 0 } = {}
): Promise<number | null> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const v = await getVal().catch(() => null);
    if (v != null && predicate(v)) return v;
    if (Date.now() - start >= timeoutMs) return null;
    await new Promise(r => setTimeout(r, intervalMs));
  }
}
