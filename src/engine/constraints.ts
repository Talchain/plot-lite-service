/**
 * Constraint validation and enforcement
 * Supports budget, must, must_not, and max_changed_nodes constraints
 */

export interface Constraints {
  budget?: number;
  must?: string[];
  must_not?: string[];
  max_changed_nodes?: number;
}

export interface ConstraintViolation {
  type: string;
  message: string;
  constraint?: string;
  node_id?: string;
  required?: number;
  available?: number;
  reason?: string;
}

export interface Action {
  id: string;
  cost: number;
  do?: Array<{ node_id: string; set_to?: number; value?: number }>;
}

/**
 * Validate constraints against a set of selected actions
 * Returns array of violations (empty if valid)
 */
export function validateConstraints(
  selectedActions: Action[],
  allActions: Action[],
  constraints: Constraints
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  // Budget constraint
  if (constraints.budget !== undefined) {
    const totalCost = selectedActions.reduce((sum, a) => sum + a.cost, 0);
    if (totalCost > constraints.budget) {
      violations.push({
        type: 'BUDGET_EXCEEDED',
        message: `Total cost ${totalCost} exceeds budget ${constraints.budget}`,
        constraint: 'budget',
        required: totalCost,
        available: constraints.budget
      });
    }
  }

  // Must constraints
  if (constraints.must && constraints.must.length > 0) {
    const selectedIds = new Set(selectedActions.map(a => a.id));
    for (const mustId of constraints.must) {
      if (!selectedIds.has(mustId)) {
        const action = allActions.find(a => a.id === mustId);
        if (!action) {
          violations.push({
            type: 'MUST_ACTION_NOT_FOUND',
            message: `Required action '${mustId}' not found in action list`,
            constraint: 'must',
            node_id: mustId
          });
        } else if (constraints.budget !== undefined && action.cost > constraints.budget) {
          violations.push({
            type: 'MUST_ACTION_EXCEEDS_BUDGET',
            message: `Required action '${mustId}' costs ${action.cost} but budget is ${constraints.budget}`,
            constraint: 'must',
            node_id: mustId,
            reason: 'exceeds_budget'
          });
        } else {
          violations.push({
            type: 'MUST_ACTION_MISSING',
            message: `Required action '${mustId}' not selected`,
            constraint: 'must',
            node_id: mustId
          });
        }
      }
    }
  }

  // Must_not constraints
  if (constraints.must_not && constraints.must_not.length > 0) {
    const selectedIds = new Set(selectedActions.map(a => a.id));
    for (const mustNotId of constraints.must_not) {
      if (selectedIds.has(mustNotId)) {
        violations.push({
          type: 'MUST_NOT_ACTION_SELECTED',
          message: `Forbidden action '${mustNotId}' was selected`,
          constraint: 'must_not',
          node_id: mustNotId
        });
      }
    }
  }

  // Max changed nodes constraint
  if (constraints.max_changed_nodes !== undefined) {
    const affectedNodes = new Set<string>();
    for (const action of selectedActions) {
      if (action.do) {
        for (const intervention of action.do) {
          affectedNodes.add(intervention.node_id);
        }
      }
    }
    if (affectedNodes.size > constraints.max_changed_nodes) {
      violations.push({
        type: 'MAX_CHANGED_NODES_EXCEEDED',
        message: `Actions affect ${affectedNodes.size} nodes but max is ${constraints.max_changed_nodes}`,
        constraint: 'max_changed_nodes',
        required: affectedNodes.size,
        available: constraints.max_changed_nodes
      });
    }
  }

  return violations;
}

/**
 * Filter actions to satisfy constraints
 * Returns filtered list and any violations that make the problem infeasible
 */
export function filterActionsByConstraints(
  actions: Action[],
  constraints: Constraints
): { filtered: Action[]; violations: ConstraintViolation[] } {
  const violations: ConstraintViolation[] = [];
  let filtered = [...actions];

  // Filter out must_not actions
  if (constraints.must_not && constraints.must_not.length > 0) {
    const mustNotSet = new Set(constraints.must_not);
    filtered = filtered.filter(a => !mustNotSet.has(a.id));
  }

  // Check if must actions exist and are affordable
  if (constraints.must && constraints.must.length > 0) {
    for (const mustId of constraints.must) {
      const action = actions.find(a => a.id === mustId);
      if (!action) {
        violations.push({
          type: 'MUST_ACTION_NOT_FOUND',
          message: `Required action '${mustId}' not found`,
          constraint: 'must',
          node_id: mustId
        });
      } else if (constraints.budget !== undefined && action.cost > constraints.budget) {
        violations.push({
          type: 'MUST_ACTION_EXCEEDS_BUDGET',
          message: `Required action '${mustId}' costs ${action.cost} but budget is ${constraints.budget}`,
          constraint: 'must',
          node_id: mustId,
          reason: 'exceeds_budget'
        });
      }
    }
  }

  // Check for conflicting must/must_not
  if (constraints.must && constraints.must_not) {
    const mustNotSet = new Set(constraints.must_not);
    const conflicts = constraints.must.filter(id => mustNotSet.has(id));
    if (conflicts.length > 0) {
      violations.push({
        type: 'CONFLICTING_CONSTRAINTS',
        message: `Actions ${conflicts.join(', ')} are both required and forbidden`,
        constraint: 'must/must_not'
      });
    }
  }

  return { filtered, violations };
}

/**
 * Check if a set of actions is feasible under constraints
 */
export function isFeasible(
  actions: Action[],
  constraints: Constraints
): { feasible: boolean; violations: ConstraintViolation[] } {
  const { violations: filterViolations } = filterActionsByConstraints(actions, constraints);
  
  if (filterViolations.length > 0) {
    return { feasible: false, violations: filterViolations };
  }

  // Check if must actions can fit in budget
  if (constraints.must && constraints.budget !== undefined) {
    const mustActions = actions.filter(a => constraints.must!.includes(a.id));
    const mustCost = mustActions.reduce((sum, a) => sum + a.cost, 0);
    if (mustCost > constraints.budget) {
      return {
        feasible: false,
        violations: [{
          type: 'INFEASIBLE',
          message: `Required actions cost ${mustCost} but budget is ${constraints.budget}`,
          constraint: 'budget',
          required: mustCost,
          available: constraints.budget
        }]
      };
    }
  }

  return { feasible: true, violations: [] };
}
