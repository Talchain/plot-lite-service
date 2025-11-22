/**
 * Text → Model Drafting
 * Given short description, return 2-3 starter boards
 * Keep ≤12 nodes, auto-hide weak edges
 */

import type { Graph, CritiqueItem } from '../trust/types.js';
import { buildCritique } from '../trust/critique-builder.js';

export interface DraftRequest {
  description: string;
  domain?: 'pricing' | 'product' | 'marketing';
}

export interface StarterBoard {
  name: string;
  description: string;
  graph: Graph;
  critique: CritiqueItem[];
  simplified: boolean;
}

/**
 * Generate 2-3 starter boards from text description
 */
export function generateStarterBoards(req: DraftRequest): StarterBoard[] {
  const { description, domain = 'pricing' } = req;

  const boards: StarterBoard[] = [];

  // Detect keywords to determine appropriate templates
  const lower_desc = description.toLowerCase();
  
  if (domain === 'pricing' || lower_desc.includes('price') || lower_desc.includes('subscription')) {
    boards.push(createPriceFirstBoard());
  }

  if (domain === 'product' || lower_desc.includes('freemium') || lower_desc.includes('feature')) {
    boards.push(createFreemiumFirstBoard());
  }

  if (domain === 'marketing' || lower_desc.includes('acquisition') || lower_desc.includes('campaign')) {
    boards.push(createAcquisitionFirstBoard());
  }

  // If no specific match, provide all three
  if (boards.length === 0) {
    boards.push(createPriceFirstBoard());
    boards.push(createFreemiumFirstBoard());
    boards.push(createAcquisitionFirstBoard());
  }

  // Ensure ≤12 nodes and add critique to each
  for (const board of boards) {
    if (board.graph.nodes.length > 12) {
      board.graph = simplifyGraph(board.graph, 12);
      board.simplified = true;
    }

    board.critique = buildCritique({
      graph: board.graph,
      assumptions: [],
      identifiable: true,
      node_limit: 12,
    });
  }

  // Return max 3 boards
  return boards.slice(0, 3);
}

/**
 * Price-First template
 */
function createPriceFirstBoard(): StarterBoard {
  return {
    name: 'Price-First',
    description: 'Optimise pricing with demand elasticity and competitor response',
    simplified: false,
    graph: {
      nodes: [
        { id: 'current_price', label: 'Current Price' },
        { id: 'new_price', label: 'New Price' },
        { id: 'demand', label: 'Demand Elasticity' },
        { id: 'competitor', label: 'Competitor Price' },
        { id: 'volume', label: 'Sales Volume' },
        { id: 'revenue', label: 'Revenue' },
        { id: 'churn', label: 'Churn Risk' },
        { id: 'ltv', label: 'Customer LTV' },
      ],
      edges: [
        { from: 'current_price', to: 'new_price', weight: 1.0 },
        { from: 'new_price', to: 'demand', weight: 0.85 },
        { from: 'competitor', to: 'demand', weight: 0.7 },
        { from: 'demand', to: 'volume', weight: 0.9 },
        { from: 'new_price', to: 'churn', weight: 0.6 },
        { from: 'volume', to: 'revenue', weight: 0.95 },
        { from: 'churn', to: 'ltv', weight: 0.8 },
        { from: 'revenue', to: 'ltv', weight: 0.75 },
      ],
    },
    critique: [],
  };
}

/**
 * Freemium-First template
 */
function createFreemiumFirstBoard(): StarterBoard {
  return {
    name: 'Freemium-First',
    description: 'Convert free users to paid with feature gating and trial experience',
    simplified: false,
    graph: {
      nodes: [
        { id: 'free_users', label: 'Free User Signups' },
        { id: 'engagement', label: 'Product Engagement' },
        { id: 'value_realisation', label: 'Value Realised' },
        { id: 'trial', label: 'Trial Started' },
        { id: 'conversion', label: 'Paid Conversion' },
        { id: 'retention', label: 'Retention Rate' },
        { id: 'expansion', label: 'Expansion Revenue' },
      ],
      edges: [
        { from: 'free_users', to: 'engagement', weight: 0.8 },
        { from: 'engagement', to: 'value_realisation', weight: 0.85 },
        { from: 'value_realisation', to: 'trial', weight: 0.75 },
        { from: 'trial', to: 'conversion', weight: 0.65 },
        { from: 'conversion', to: 'retention', weight: 0.9 },
        { from: 'retention', to: 'expansion', weight: 0.7 },
      ],
    },
    critique: [],
  };
}

/**
 * Acquisition-First template
 */
function createAcquisitionFirstBoard(): StarterBoard {
  return {
    name: 'Acquisition-First',
    description: 'Optimise marketing spend across channels with CAC and payback',
    simplified: false,
    graph: {
      nodes: [
        { id: 'ad_spend', label: 'Ad Spend' },
        { id: 'impressions', label: 'Impressions' },
        { id: 'clicks', label: 'Clicks (CTR)' },
        { id: 'signups', label: 'Signups' },
        { id: 'qualified', label: 'Qualified Leads' },
        { id: 'conversions', label: 'Conversions' },
        { id: 'cac', label: 'CAC' },
        { id: 'payback', label: 'Payback Period' },
      ],
      edges: [
        { from: 'ad_spend', to: 'impressions', weight: 0.95 },
        { from: 'impressions', to: 'clicks', weight: 0.7 },
        { from: 'clicks', to: 'signups', weight: 0.6 },
        { from: 'signups', to: 'qualified', weight: 0.5 },
        { from: 'qualified', to: 'conversions', weight: 0.7 },
        { from: 'ad_spend', to: 'cac', weight: 0.9 },
        { from: 'conversions', to: 'cac', weight: -0.8 },
        { from: 'cac', to: 'payback', weight: 0.85 },
      ],
    },
    critique: [],
  };
}

/**
 * Simplify graph by removing weak edges and limiting nodes
 */
function simplifyGraph(graph: Graph, max_nodes: number): Graph {
  // Sort edges by weight (descending)
  const sorted_edges = [...graph.edges].sort((a, b) => {
    const w_a = Math.abs(a.weight || 0);
    const w_b = Math.abs(b.weight || 0);
    return w_b - w_a;
  });

  // Keep strong edges
  const strong_edges = sorted_edges.filter(e => Math.abs(e.weight || 0) >= 0.3);

  // Find connected nodes
  const connected_nodes = new Set<string>();
  for (const edge of strong_edges) {
    connected_nodes.add(edge.from);
    connected_nodes.add(edge.to);
  }

  // Limit nodes if still too many
  let final_nodes = graph.nodes.filter(n => connected_nodes.has(n.id));
  if (final_nodes.length > max_nodes) {
    final_nodes = final_nodes.slice(0, max_nodes);
  }

  const final_node_ids = new Set(final_nodes.map(n => n.id));
  const final_edges = strong_edges.filter(
    e => final_node_ids.has(e.from) && final_node_ids.has(e.to)
  );

  return {
    nodes: final_nodes,
    edges: final_edges,
  };
}
