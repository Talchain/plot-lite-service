export function critiqueFlow(flow) {
    const items = [];
    const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
    const edges = Array.isArray(flow?.edges) ? flow.edges : [];
    const byId = new Map();
    for (const n of nodes)
        byId.set(n.id, n);
    // 1) Missing baseline for any outcome node
    for (const n of nodes) {
        if (n?.type === 'outcome' && (n.baseline === undefined || n.baseline === null)) {
            const label = String(n.label || 'outcome');
            items.push({ note: `Missing baseline: ${label.toLowerCase()}`, severity: 'BLOCKER', fix_available: true });
        }
    }
    // 2) Circular reference detection (simple: any cycle length >= 2)
    const adj = new Map();
    for (const e of edges) {
        if (!adj.has(e.from))
            adj.set(e.from, []);
        adj.get(e.from).push(e.to);
    }
    const visited = new Set();
    const stack = new Set();
    let foundCycle = false;
    function dfs(u) {
        if (stack.has(u)) {
            foundCycle = true;
            return;
        }
        if (visited.has(u))
            return;
        visited.add(u);
        stack.add(u);
        for (const v of adj.get(u) || [])
            dfs(v);
        stack.delete(u);
    }
    for (const n of nodes) {
        if (foundCycle)
            break;
        dfs(n.id);
    }
    if (foundCycle) {
        items.push({ note: 'Circular reference detected', severity: 'BLOCKER', fix_available: true });
    }
    // 3) Collider risk: node with two incoming edges where both sources also connect elsewhere
    const incoming = new Map();
    const outgoing = new Map();
    for (const e of edges) {
        if (!incoming.has(e.to))
            incoming.set(e.to, new Set());
        incoming.get(e.to).add(e.from);
        if (!outgoing.has(e.from))
            outgoing.set(e.from, new Set());
        outgoing.get(e.from).add(e.to);
    }
    for (const [to, sources] of incoming) {
        if (sources.size >= 2) {
            let allElsewhere = true;
            for (const s of sources) {
                const outs = outgoing.get(s) || new Set();
                if (outs.size <= 1) {
                    allElsewhere = false;
                    break;
                }
                if (outs.size === 1 && outs.has(to)) {
                    allElsewhere = false;
                    break;
                }
            }
            if (allElsewhere) {
                const label = byId.get(to)?.label || to;
                items.push({ note: `Potential collider risk at ${String(label)}`, severity: 'IMPROVEMENT', fix_available: false });
            }
        }
    }
    // 4) Competitor response missing heuristic
    const hasDecisionPrice = nodes.some(n => String(n.label || '').toLowerCase().includes('price') && n.type === 'decision');
    const hasCompetitorNode = nodes.some(n => String(n.label || '').toLowerCase().includes('competitor'));
    if (hasDecisionPrice && !hasCompetitorNode) {
        items.push({ note: 'Consider competitor response', severity: 'IMPROVEMENT', fix_available: true });
    }
    // 5) Threshold observation (if metadata thresholds include 99 or 199)
    const thresholds = Array.isArray(flow?.metadata?.thresholds) ? flow.metadata.thresholds : [];
    if (thresholds.includes(99)) {
        items.push({ note: '£99 psychological threshold', severity: 'OBSERVATION', fix_available: false });
    }
    // Order: BLOCKERS, then IMPROVEMENTS, then OBSERVATIONS; stable alpha by note within group
    const rank = { BLOCKER: 0, IMPROVEMENT: 1, OBSERVATION: 2 };
    items.sort((a, b) => (rank[a.severity] - rank[b.severity]) || a.note.localeCompare(b.note));
    return items;
}
