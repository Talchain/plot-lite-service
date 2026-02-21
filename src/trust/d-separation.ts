/**
 * D-separation for identifiability (F3)
 * Full Bayes-ball algorithm implementation for d-separation testing.
 *
 * The Bayes-ball algorithm (Shachter 1998) determines d-separation in O(n+e) time
 * by simulating "balls" bouncing through the graph following specific rules:
 *
 * Rules at each node based on conditioning set Z:
 * - Chain (A → B → C): blocked if B ∈ Z
 * - Fork (A ← B → C): blocked if B ∈ Z
 * - Collider (A → B ← C): blocked unless B ∈ Z or descendant(B) ∈ Z
 *
 * Ball directions:
 * - "up" = traveling toward parents (against edge direction)
 * - "down" = traveling toward children (with edge direction)
 */

export interface DAG {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
}

export interface DAGValidationResult {
  valid: boolean;
  isDAG: boolean;
  issues: string[];
  cycleNodes?: string[];
  missingNodes?: string[];
}

type Direction = 'up' | 'down';
type VisitState = `${string}:${Direction}`;

/**
 * Validate that a graph is a proper DAG (no cycles) and all edge endpoints exist.
 * Uses Kahn's algorithm for topological sort to detect cycles in O(n+e) time.
 */
export function validateDAG(dag: DAG): DAGValidationResult {
  const issues: string[] = [];
  const nodeSet = new Set(dag.nodes);

  // Check for missing nodes in edges
  const missingNodes: string[] = [];
  for (const edge of dag.edges) {
    if (!nodeSet.has(edge.from)) {
      missingNodes.push(edge.from);
    }
    if (!nodeSet.has(edge.to)) {
      missingNodes.push(edge.to);
    }
  }

  if (missingNodes.length > 0) {
    const uniqueMissing = [...new Set(missingNodes)];
    issues.push(`Edge references non-existent nodes: ${uniqueMissing.join(', ')}`);
  }

  // Check for cycles using Kahn's algorithm (topological sort)
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of dag.nodes) {
    inDegree.set(node, 0);
    adjacency.set(node, []);
  }

  for (const edge of dag.edges) {
    if (nodeSet.has(edge.from) && nodeSet.has(edge.to)) {
      adjacency.get(edge.from)?.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }
  }

  // Start with nodes that have no incoming edges
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  let processedCount = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    processedCount++;

    for (const neighbor of adjacency.get(node) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If we couldn't process all nodes, there's a cycle
  const hasCycle = processedCount < dag.nodes.length;
  let cycleNodes: string[] | undefined;

  if (hasCycle) {
    // Find nodes that are part of cycles (those with remaining in-degree > 0)
    cycleNodes = [];
    for (const [node, degree] of inDegree) {
      if (degree > 0) {
        cycleNodes.push(node);
      }
    }
    issues.push(`Graph contains cycle(s) involving nodes: ${cycleNodes.join(', ')}`);
  }

  return {
    valid: issues.length === 0,
    isDAG: !hasCycle,
    issues,
    cycleNodes: hasCycle ? cycleNodes : undefined,
    missingNodes: missingNodes.length > 0 ? [...new Set(missingNodes)] : undefined,
  };
}

/**
 * Validate that specified nodes exist in the DAG.
 * Returns list of missing nodes, or empty array if all exist.
 */
export function validateNodesExist(dag: DAG, nodes: string[]): string[] {
  const nodeSet = new Set(dag.nodes);
  return nodes.filter((n) => !nodeSet.has(n));
}

/**
 * Build adjacency lists for efficient graph traversal
 */
function buildAdjacencyLists(dag: DAG): {
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
} {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();

  for (const node of dag.nodes) {
    parents.set(node, []);
    children.set(node, []);
  }

  for (const edge of dag.edges) {
    children.get(edge.from)?.push(edge.to);
    parents.get(edge.to)?.push(edge.from);
  }

  return { parents, children };
}

/**
 * Find all ancestors of a node (transitive closure of parent relation)
 */
function findAllAncestors(dag: DAG, node: string): Set<string> {
  const { parents } = buildAdjacencyLists(dag);
  const ancestors = new Set<string>();
  const queue = [node];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const parent of parents.get(current) || []) {
      if (!ancestors.has(parent)) {
        ancestors.add(parent);
        queue.push(parent);
      }
    }
  }

  return ancestors;
}

/**
 * Find all descendants of a node (transitive closure of child relation)
 */
function findAllDescendants(dag: DAG, node: string): Set<string> {
  const { children } = buildAdjacencyLists(dag);
  const descendants = new Set<string>();
  const queue = [node];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const child of children.get(current) || []) {
      if (!descendants.has(child)) {
        descendants.add(child);
        queue.push(child);
      }
    }
  }

  return descendants;
}

/**
 * Bayes-ball algorithm for d-separation testing.
 *
 * Determines if X and Y are d-separated given conditioning set Z.
 * Returns true if X ⊥ Y | Z (d-separated), false otherwise.
 *
 * @param dag - The directed acyclic graph
 * @param x - Source node(s)
 * @param y - Target node(s)
 * @param z - Conditioning set (nodes we observe/condition on)
 */
export function isDSeparated(
  dag: DAG,
  x: string | string[],
  y: string | string[],
  z: string[] = []
): boolean {
  const sources = Array.isArray(x) ? x : [x];
  const targets = new Set(Array.isArray(y) ? y : [y]);
  const conditioned = new Set(z);

  const { parents, children } = buildAdjacencyLists(dag);

  // BFS queue: [node, direction]
  // direction: 'up' = came from child, 'down' = came from parent
  const queue: Array<[string, Direction]> = [];
  const visited = new Set<VisitState>();
  const reachable = new Set<string>();

  // Initialize: start from source nodes, send balls in both directions
  for (const source of sources) {
    queue.push([source, 'up']);
    queue.push([source, 'down']);
  }

  while (queue.length > 0) {
    const [node, direction] = queue.shift()!;
    const state: VisitState = `${node}:${direction}`;

    if (visited.has(state)) continue;
    visited.add(state);

    // Mark node as reachable (if not source)
    if (!sources.includes(node)) {
      reachable.add(node);
    }

    // Check if we've reached a target - if so, not d-separated
    if (targets.has(node) && !sources.includes(node)) {
      return false;
    }

    const isConditioned = conditioned.has(node);

    if (direction === 'up') {
      // Ball came from a child (traveling up toward parents)
      // This node could be part of a collider structure (A → node ← B)

      if (!isConditioned) {
        // Node NOT conditioned:
        // - Can continue UP to parents (chain going backward)
        // - Can bounce DOWN to other children (fork structure)
        for (const parent of parents.get(node) || []) {
          queue.push([parent, 'up']);
        }
        for (const child of children.get(node) || []) {
          queue.push([child, 'down']);
        }
      } else {
        // Node IS conditioned:
        // - Ball is BLOCKED for chains/forks
        // - But if this is a collider, conditioning OPENS it
        // - Can go UP to parents (collider is open)
        for (const parent of parents.get(node) || []) {
          queue.push([parent, 'up']);
        }
      }
    } else {
      // direction === 'down'
      // Ball came from a parent (traveling down toward children)
      // This node is part of a chain or could be a collider

      if (!isConditioned) {
        // Node NOT conditioned:
        // - Can continue DOWN to children (chain)
        // - CANNOT go UP to other parents (would traverse a collider, which is blocked)
        for (const child of children.get(node) || []) {
          queue.push([child, 'down']);
        }
        // Note: We do NOT allow going up to parents here - that would be
        // traversing a v-structure (collider) which is blocked when not conditioned
      } else {
        // Node IS conditioned:
        // - Ball is blocked for chains
        // - But conditioning opens collider - can go UP to parents
        for (const parent of parents.get(node) || []) {
          queue.push([parent, 'up']);
        }
      }
    }
  }

  // If we never reached any target, X and Y are d-separated given Z
  return true;
}

/**
 * Find all nodes reachable from source via active paths given conditioning set.
 * Useful for determining which variables are dependent.
 */
export function findReachable(
  dag: DAG,
  source: string | string[],
  conditioned: string[] = []
): Set<string> {
  const sources = Array.isArray(source) ? source : [source];
  const z = new Set(conditioned);

  const { parents, children } = buildAdjacencyLists(dag);

  const queue: Array<[string, Direction]> = [];
  const visited = new Set<VisitState>();
  const reachable = new Set<string>();

  for (const s of sources) {
    queue.push([s, 'up']);
    queue.push([s, 'down']);
  }

  while (queue.length > 0) {
    const [node, direction] = queue.shift()!;
    const state: VisitState = `${node}:${direction}`;

    if (visited.has(state)) continue;
    visited.add(state);

    if (!sources.includes(node)) {
      reachable.add(node);
    }

    const isConditioned = z.has(node);

    if (direction === 'up') {
      // Ball came from a child (traveling up)
      if (!isConditioned) {
        // Can continue up to parents and bounce down to children
        for (const parent of parents.get(node) || []) {
          queue.push([parent, 'up']);
        }
        for (const child of children.get(node) || []) {
          queue.push([child, 'down']);
        }
      } else {
        // Conditioned: collider opens, can go up to parents
        for (const parent of parents.get(node) || []) {
          queue.push([parent, 'up']);
        }
      }
    } else {
      // Ball came from a parent (traveling down)
      if (!isConditioned) {
        // Can continue down to children only (not up - would traverse collider)
        for (const child of children.get(node) || []) {
          queue.push([child, 'down']);
        }
      } else {
        // Conditioned: collider opens, can go up to parents
        for (const parent of parents.get(node) || []) {
          queue.push([parent, 'up']);
        }
      }
    }
  }

  return reachable;
}

/**
 * Find a valid adjustment set for causal effect identification using
 * the backdoor criterion with proper d-separation testing.
 *
 * The backdoor criterion requires finding a set Z such that:
 * 1. Z blocks all backdoor paths from treatment to outcome
 * 2. Z contains no descendants of treatment
 *
 * @param dag - The directed acyclic graph
 * @param treatment - The treatment/intervention variable
 * @param outcome - The outcome variable
 * @param excludeFromAdjustment - Optional set of node IDs to exclude from candidates
 *   (e.g., latent nodes injected during bidirected edge expansion)
 */
export function findBackdoorAdjustmentSet(
  dag: DAG,
  treatment: string,
  outcome: string,
  excludeFromAdjustment?: Set<string>
): string[] {
  const treatmentDescendants = findAllDescendants(dag, treatment);

  // Candidate adjustment variables: all nodes except treatment, outcome, descendants of treatment,
  // and any explicitly excluded nodes (e.g., latent nodes from bidirected edge expansion)
  const candidates = dag.nodes.filter(
    (n) => n !== treatment && n !== outcome && !treatmentDescendants.has(n)
      && !(excludeFromAdjustment?.has(n))
  );

  // Start with minimal set: common ancestors (potential confounders)
  const treatmentAncestors = findAllAncestors(dag, treatment);
  const outcomeAncestors = findAllAncestors(dag, outcome);

  const confounders: string[] = [];
  for (const anc of treatmentAncestors) {
    if (outcomeAncestors.has(anc) && candidates.includes(anc)) {
      confounders.push(anc);
    }
  }

  // Sort for deterministic output
  confounders.sort();

  // Verify this set blocks all backdoor paths using d-separation
  // Create a modified DAG with treatment's outgoing edges removed
  const backdoorDAG: DAG = {
    nodes: dag.nodes,
    edges: dag.edges.filter((e) => e.from !== treatment),
  };

  // Check if confounders block all paths
  if (confounders.length > 0) {
    const separated = isDSeparated(backdoorDAG, treatment, outcome, confounders);
    if (separated) {
      return confounders;
    }
  }

  // If minimal set doesn't work, try adding more candidates
  // (greedy approach - add candidates that help block paths)
  const adjustmentSet = [...confounders];

  for (const candidate of candidates) {
    if (adjustmentSet.includes(candidate)) continue;

    const testSet = [...adjustmentSet, candidate];
    const separated = isDSeparated(backdoorDAG, treatment, outcome, testSet);

    if (separated) {
      return testSet.sort();
    }

    // Check if adding this candidate helps (reduces reachable nodes)
    const currentReachable = findReachable(backdoorDAG, treatment, adjustmentSet);
    const newReachable = findReachable(backdoorDAG, treatment, testSet);

    if (newReachable.size < currentReachable.size) {
      adjustmentSet.push(candidate);
    }
  }

  return adjustmentSet.sort();
}

/**
 * Compute identifiability of causal effect using backdoor criterion
 * with full Bayes-ball d-separation testing.
 */
export function computeIdentifiability(
  dag: DAG,
  treatment: string,
  outcome: string
): { identifiable: boolean; adjustment_set: string[] } {
  if (process.env.IDENT_DSEP_ENABLE !== '1') {
    return { identifiable: true, adjustment_set: [] };
  }

  // Check if treatment and outcome exist in the graph
  if (!dag.nodes.includes(treatment) || !dag.nodes.includes(outcome)) {
    return { identifiable: false, adjustment_set: [] };
  }

  // Find adjustment set using backdoor criterion
  const adjustmentSet = findBackdoorAdjustmentSet(dag, treatment, outcome);

  // Verify identifiability: check if adjustment set blocks all backdoor paths
  const backdoorDAG: DAG = {
    nodes: dag.nodes,
    edges: dag.edges.filter((e) => e.from !== treatment),
  };

  const separated = isDSeparated(backdoorDAG, treatment, outcome, adjustmentSet);

  return {
    identifiable: separated || adjustmentSet.length === 0,
    adjustment_set: adjustmentSet,
  };
}
