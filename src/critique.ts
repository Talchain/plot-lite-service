import { CRITIQUE_CODES, type CritiqueCode } from './trust/critique-codes.js';

/**
 * Standardized critique item with code for filtering/analytics (P1.4)
 * Uses `message` field (standard) with `note` alias for backwards compatibility
 */
export interface CritiqueItem {
  /** Standardized code for filtering (P1.4) */
  code?: CritiqueCode | string;
  /** Human-readable message */
  message: string;
  /** Backwards-compatible alias for message */
  note: string;
  severity: 'BLOCKER' | 'IMPROVEMENT' | 'OBSERVATION';
  fix_available?: boolean;
  /** Source of critique */
  source?: 'engine' | 'isl' | 'cee';
}

/**
 * Get node kind with backward compatibility fallback
 * Prefers `kind` but falls back to `type` for legacy graphs
 */
function getNodeKind(node: any): string | undefined {
  return node?.kind ?? node?.type;
}

/**
 * Helper to create critique item with both message and note fields
 */
function createCritique(
  message: string,
  severity: CritiqueItem['severity'],
  fix_available: boolean,
  code?: CritiqueCode | string
): CritiqueItem {
  return {
    code,
    message,
    note: message, // Backwards compatibility
    severity,
    fix_available,
    source: 'engine',
  };
}

export function critiqueFlow(flow: any): CritiqueItem[] {
  const items: CritiqueItem[] = [];
  const nodes: any[] = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const edges: any[] = Array.isArray(flow?.edges) ? flow.edges : [];
  const byId = new Map<string, any>();
  for (const n of nodes) byId.set(n.id, n);

  // 1) Missing baseline for any outcome node
  for (const n of nodes) {
    if (getNodeKind(n) === 'outcome' && (n.baseline === undefined || n.baseline === null)) {
      const label = String(n.label || 'outcome');
      items.push(createCritique(
        `Missing baseline: ${label.toLowerCase()}`,
        'BLOCKER',
        true,
        CRITIQUE_CODES.MISSING_BASELINE
      ));
    }
  }

  // 2) Circular reference detection (simple: any cycle length >= 2)
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  let foundCycle = false;
  function dfs(u: string) {
    if (stack.has(u)) { foundCycle = true; return; }
    if (visited.has(u)) return;
    visited.add(u);
    stack.add(u);
    for (const v of adj.get(u) || []) dfs(v);
    stack.delete(u);
  }
  for (const n of nodes) {
    if (foundCycle) break;
    dfs(n.id);
  }
  if (foundCycle) {
    items.push(createCritique(
      'Circular reference detected',
      'BLOCKER',
      true,
      CRITIQUE_CODES.GRAPH_CYCLE_DETECTED
    ));
  }

  // 3) Collider risk: node with two incoming edges where both sources also connect elsewhere
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, new Set());
    incoming.get(e.to)!.add(e.from);
    if (!outgoing.has(e.from)) outgoing.set(e.from, new Set());
    outgoing.get(e.from)!.add(e.to);
  }
  for (const [to, sources] of incoming) {
    if (sources.size >= 2) {
      let allElsewhere = true;
      for (const s of sources) {
        const outs = outgoing.get(s) || new Set();
        if (outs.size <= 1) { allElsewhere = false; break; }
        if (outs.size === 1 && outs.has(to)) { allElsewhere = false; break; }
      }
      if (allElsewhere) {
        const label = byId.get(to)?.label || to;
        items.push(createCritique(
          `Potential collider risk at ${String(label)}`,
          'IMPROVEMENT',
          false,
          CRITIQUE_CODES.COLLIDER_RISK
        ));
      }
    }
  }

  // 4) Competitor response missing heuristic
  const hasDecisionPrice = nodes.some(n => String(n.label || '').toLowerCase().includes('price') && getNodeKind(n) === 'decision');
  const hasCompetitorNode = nodes.some(n => String(n.label || '').toLowerCase().includes('competitor'));
  if (hasDecisionPrice && !hasCompetitorNode) {
    items.push(createCritique(
      'Consider competitor response',
      'IMPROVEMENT',
      true,
      CRITIQUE_CODES.MISSING_COMPETITOR_RESPONSE
    ));
  }

  // 5) Threshold observation (if metadata thresholds include 99 or 199)
  const thresholds: number[] = Array.isArray(flow?.metadata?.thresholds) ? flow.metadata.thresholds : [];
  if (thresholds.includes(99)) {
    items.push(createCritique(
      '£99 psychological threshold',
      'OBSERVATION',
      false,
      CRITIQUE_CODES.PSYCHOLOGICAL_THRESHOLD
    ));
  }

  // Order: BLOCKERS, then IMPROVEMENTS, then OBSERVATIONS; stable alpha by message within group
  const rank: Record<string, number> = { BLOCKER: 0, IMPROVEMENT: 1, OBSERVATION: 2 };
  items.sort((a, b) => (rank[a.severity] - rank[b.severity]) || a.message.localeCompare(b.message));
  return items;
}