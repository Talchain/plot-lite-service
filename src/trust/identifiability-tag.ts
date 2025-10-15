/**
 * Identifiability Tag - Plain English decision-readiness cue
 * Provides simple "Decision-ready" vs "Exploratory" tags for users
 */

import type { Graph } from './types.js';
import { checkIdentifiability } from './identifiability.js';

export interface IdentifiabilityTag {
  tag: 'Decision-ready' | 'Exploratory';
  reason: string;
  adjustment_set?: string[];
}

export interface IdentifiabilityTagInputs {
  graph: Graph;
  treatment_node?: string;
  outcome_node: string;
}

/**
 * Generate plain English identifiability tag
 * 
 * Decision-ready: Clean adjustment set exists (backdoor criterion satisfied)
 * Exploratory: Confounded or no clear causal path
 */
export function generateIdentifiabilityTag(inputs: IdentifiabilityTagInputs): IdentifiabilityTag {
  const { graph, treatment_node, outcome_node } = inputs;

  // If no treatment specified, this is exploratory (outcome prediction only)
  if (!treatment_node) {
    return {
      tag: 'Exploratory',
      reason: 'No treatment specified - outcome prediction only',
    };
  }

  // Check identifiability using backdoor criterion
  const result = checkIdentifiability({
    graph,
    treatment_node,
    outcome_node,
  });

  // Decision-ready if identifiable
  if (result.identifiable) {
    if (result.adjustment_set.length === 0) {
      return {
        tag: 'Decision-ready',
        reason: 'No confounders detected - direct causal effect estimable',
        adjustment_set: [],
      };
    } else {
      const node_labels = result.adjustment_set
        .map(id => graph.nodes.find(n => n.id === id)?.label || id)
        .join(', ');
      return {
        tag: 'Decision-ready',
        reason: `Adjust for: ${node_labels}`,
        adjustment_set: result.adjustment_set,
      };
    }
  }

  // Exploratory if not identifiable
  const reason = result.reason || 'confounded';
  return {
    tag: 'Exploratory',
    reason: formatExploratoryReason(reason, result.notes),
  };
}

/**
 * Format exploratory reason in plain English
 */
function formatExploratoryReason(reason: string, notes: string[]): string {
  switch (reason) {
    case 'no causal path':
      return 'No causal path from treatment to outcome';
    case 'node not found':
      return 'Treatment or outcome node not found';
    case 'confounded':
      return 'Confounded - causal effect not identifiable';
    default:
      // Use first note if available
      if (notes.length > 0) {
        return notes[0];
      }
      return 'Causal effect not identifiable';
  }
}

/**
 * Check if graph is decision-ready (shorthand)
 */
export function isDecisionReady(inputs: IdentifiabilityTagInputs): boolean {
  const tag = generateIdentifiabilityTag(inputs);
  return tag.tag === 'Decision-ready';
}
