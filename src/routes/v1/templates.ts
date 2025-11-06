import type { FastifyInstance } from 'fastify';
import { canonicalStringify, sha256Hex } from '../../util/canonical.js';
import { normalizeGraph } from '../../util/normalize.js';

type Graph = { 
  version?: string;
  default_seed?: number;
  nodes: any[]; 
  edges: any[];
  meta?: { roots?: string[]; leaves?: string[]; suggested_positions?: Record<string, {x: number; y: number}> };
};
const UPDATED_AT = '2025-01-01T00:00:00.000Z';

const graphs: Record<string, Graph> = {
  small: {
    version: '1.2',
    default_seed: 4242,
    nodes: [ 
      { id: 'A', label: 'A', kind: 'option' }, 
      { id: 'B', label: 'B', kind: 'outcome', utility: 0.5 } 
    ],
    edges: [ 
      { from: 'A', to: 'B', label: 'A->B', weight: 0.7, belief: 0.85, provenance: 'template' } 
    ],
    meta: { roots: ['A'], leaves: ['B'] }
  },
  medium: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'Price', label: 'Price', kind: 'decision', body: 'Set product price' },
      { id: 'Demand', label: 'Demand', kind: 'option', prior: 0.5 },
      { id: 'Revenue', label: 'Revenue', kind: 'outcome', utility: 0.7 },
      { id: 'Marketing', label: 'Marketing', kind: 'option', prior: 0.3 }
    ],
    edges: [
      { from: 'Price', to: 'Demand', weight: 0.6, belief: 0.8, provenance: 'template' },
      { from: 'Demand', to: 'Revenue', weight: 0.8, belief: 0.9, provenance: 'template' },
      { from: 'Marketing', to: 'Demand', weight: 0.4, belief: 0.7, provenance: 'assumption' }
    ],
    meta: { roots: ['Price', 'Marketing'], leaves: ['Revenue'] }
  },
  edge: {
    version: '1.2',
    default_seed: 4242,
    nodes: [ 
      { id: 'X', label: 'Baseline Near Zero', kind: 'option' }, 
      { id: 'Y', label: 'Output', kind: 'outcome', utility: 0.0 } 
    ],
    edges: [ 
      { from: 'X', to: 'Y', weight: 0.01, belief: 1.0, provenance: 'template' } 
    ],
    meta: { roots: ['X'], leaves: ['Y'] }
  },
  supplier_selection_resilience: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'supplier_choice', label: 'Which supplier strategy?', kind: 'decision', body: 'Choose a sourcing strategy balancing cost, quality, and continuity.' },
      { id: 'supplier_a', label: 'Supplier A (cheapest)', kind: 'option', body: 'Lower unit cost with higher variability.' },
      { id: 'supplier_b', label: 'Supplier B (stable quality)', kind: 'option', body: 'Higher cost but consistent quality and lead times.' },
      { id: 'dual_source', label: 'Dual-source A + B', kind: 'option', body: 'Split demand across two suppliers to reduce risk.' },
      { id: 'unit_cost', label: 'Unit cost (delivered)', kind: 'factor', body: 'All-in unit cost including freight and duties.' },
      { id: 'quality_variance', label: 'Quality variability', kind: 'factor', body: 'How often quality drifts or fails spec.' },
      { id: 'lead_time', label: 'Lead time reliability', kind: 'factor', body: 'Likelihood orders arrive on schedule.' },
      { id: 'moq', label: 'MOQ pressure', kind: 'factor', body: 'Order size constraints that cause over/under-stock.' },
      { id: 'financial_stability', label: 'Supplier financial stability', kind: 'factor', body: 'Risk of insolvency or disruption.' },
      { id: 'compliance_risk', label: 'Compliance risk', kind: 'factor', body: 'Risk of failing audits or losing certifications.' },
      { id: 'gross_margin', label: 'Gross margin %', kind: 'outcome', body: 'Revenue minus COGS as a percentage of revenue.' },
      { id: 'stockouts', label: 'Stockouts', kind: 'outcome', body: 'Orders lost due to no inventory.' },
      { id: 'defect_returns', label: 'Defect-driven returns', kind: 'outcome', body: 'Returns caused by quality faults.' },
      { id: 'brand_impact', label: 'Brand impact', kind: 'outcome', body: 'Reputation change from quality and availability.' }
    ],
    edges: [
      { from: 'supplier_choice', to: 'supplier_a', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'supplier_choice', to: 'supplier_b', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'supplier_choice', to: 'dual_source', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'supplier_a', to: 'unit_cost', weight: 0.7, belief: 0.85, provenance: 'template' },
      { from: 'supplier_b', to: 'unit_cost', weight: -0.5, belief: 0.7, provenance: 'template' },
      { from: 'supplier_a', to: 'quality_variance', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'supplier_b', to: 'lead_time', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'dual_source', to: 'stockouts', weight: -0.5, belief: 0.7, provenance: 'template' },
      { from: 'dual_source', to: 'quality_variance', weight: -0.3, belief: 0.5, provenance: 'template' },
      { from: 'quality_variance', to: 'defect_returns', weight: 0.7, belief: 0.85, provenance: 'template' },
      { from: 'lead_time', to: 'stockouts', weight: -0.6, belief: 0.8, provenance: 'template' },
      { from: 'unit_cost', to: 'gross_margin', weight: -0.7, belief: 0.85, provenance: 'template' },
      { from: 'moq', to: 'stockouts', weight: 0.3, belief: 0.5, provenance: 'template' },
      { from: 'defect_returns', to: 'brand_impact', weight: -0.6, belief: 0.75, provenance: 'template' },
      { from: 'stockouts', to: 'brand_impact', weight: -0.5, belief: 0.7, provenance: 'template' },
      { from: 'financial_stability', to: 'lead_time', weight: 0.3, belief: 0.5, provenance: 'template' },
      { from: 'compliance_risk', to: 'brand_impact', weight: -0.3, belief: 0.5, provenance: 'template' },
      { from: 'brand_impact', to: 'gross_margin', weight: 0.4, belief: 0.6, provenance: 'template' }
    ],
    meta: { roots: ['supplier_choice'], leaves: ['gross_margin', 'stockouts', 'defect_returns', 'brand_impact'] }
  },
  feature_rollout_phased_learning: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'rollout_strategy', label: 'How to roll out the feature?', kind: 'decision', body: 'Pick a go-live strategy balancing speed and safety.' },
      { id: 'big_bang', label: 'Big-bang launch', kind: 'option', body: 'Ship to all users at once for maximum impact.' },
      { id: 'phased_3step', label: 'Phased rollout (3 waves)', kind: 'option', body: 'Expand gradually while learning and fixing.' },
      { id: 'delay_polish', label: 'Delay to polish', kind: 'option', body: 'Ship later after additional hardening.' },
      { id: 'eng_readiness', label: 'Engineering readiness', kind: 'factor', body: 'Confidence the system meets performance/quality bars.' },
      { id: 'defect_rate', label: 'Defect discovery rate', kind: 'factor', body: 'Rate of new defects found during rollout.' },
      { id: 'support_capacity', label: 'Support capacity', kind: 'factor', body: 'Ability to absorb tickets and incidents.' },
      { id: 'marketing_lift', label: 'Marketing lift', kind: 'factor', body: 'Promo/PR that drives adoption.' },
      { id: 'onboarding_friction', label: 'Onboarding friction', kind: 'factor', body: 'Effort users need to reach first value.' },
      { id: 'activation', label: 'Activation rate', kind: 'outcome', body: 'Share reaching first value soon after exposure.' },
      { id: 'retention', label: 'Retention', kind: 'outcome', body: 'Users still active after N weeks.' },
      { id: 'incidents', label: 'Incidents & tickets', kind: 'outcome', body: 'Operational/user-facing incident volume.' },
      { id: 'delivery_cost', label: 'Delivery cost', kind: 'outcome', body: 'Incremental dev/support costs of the strategy.' }
    ],
    edges: [
      { from: 'rollout_strategy', to: 'big_bang', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'rollout_strategy', to: 'phased_3step', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'rollout_strategy', to: 'delay_polish', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'big_bang', to: 'marketing_lift', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'big_bang', to: 'incidents', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'phased_3step', to: 'defect_rate', weight: -0.5, belief: 0.7, provenance: 'template' },
      { from: 'delay_polish', to: 'eng_readiness', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'eng_readiness', to: 'defect_rate', weight: -0.4, belief: 0.6, provenance: 'template' },
      { from: 'defect_rate', to: 'incidents', weight: 0.7, belief: 0.85, provenance: 'template' },
      { from: 'support_capacity', to: 'incidents', weight: -0.5, belief: 0.7, provenance: 'template' },
      { from: 'onboarding_friction', to: 'activation', weight: -0.6, belief: 0.8, provenance: 'template' },
      { from: 'marketing_lift', to: 'activation', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'activation', to: 'retention', weight: 0.6, belief: 0.8, provenance: 'template' },
      { from: 'incidents', to: 'retention', weight: -0.4, belief: 0.6, provenance: 'template' },
      { from: 'big_bang', to: 'delivery_cost', weight: 0.4, belief: 0.6, provenance: 'template' },
      { from: 'phased_3step', to: 'delivery_cost', weight: 0.3, belief: 0.6, provenance: 'template' },
      { from: 'delay_polish', to: 'delivery_cost', weight: 0.2, belief: 0.5, provenance: 'template' }
    ],
    meta: { roots: ['rollout_strategy'], leaves: ['activation', 'retention', 'incidents', 'delivery_cost'] }
  }  ,
  funding_strategy_runway: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'funding_choice', label: 'Which funding path now?', kind: 'decision', body: 'Choose a route to extend runway and hit milestones.' },
      { id: 'apply_grants', label: 'Apply for grants', kind: 'option', body: 'Pursue non-dilutive grants to fund R&D.' },
      { id: 'raise_bridge', label: 'Raise bridge round', kind: 'option', body: 'Small round from angels to extend runway quickly.' },
      { id: 'raise_seed_now', label: 'Raise seed now', kind: 'option', body: 'Larger round at current traction.' },
      { id: 'delay_seed', label: 'Delay seed 3–6 months', kind: 'option', body: 'Wait to raise at better terms after traction.' },
      { id: 'grant_fit', label: 'Grant eligibility & fit', kind: 'factor', body: 'How well proposals match programme criteria.' },
      { id: 'time_to_cash', label: 'Time to cash', kind: 'factor', body: 'How fast funds arrive after decision.' },
      { id: 'dilution_rate', label: 'Expected dilution %', kind: 'factor', body: 'Dilution for equity rounds at current valuation.' },
      { id: 'milestone_risk', label: 'Risk to milestones', kind: 'factor', body: 'Likelihood of slipping key deliverables.' },
      { id: 'team_bandwidth', label: 'Team bandwidth', kind: 'factor', body: 'Capacity to apply, pitch, and execute.' },
      { id: 'runway_months', label: 'Runway months', kind: 'outcome', body: 'Months of operating cash at current burn.' },
      { id: 'dilution_total', label: 'Total dilution', kind: 'outcome', body: 'Cumulative equity given up this cycle.' },
      { id: 'milestone_success', label: 'Milestone success chance', kind: 'outcome', body: 'Probability of achieving the next milestone.' }
    ],
    edges: [
      { from: 'funding_choice', to: 'apply_grants', weight: 0.25, belief: 0.9, provenance: 'template' },
      { from: 'funding_choice', to: 'raise_bridge', weight: 0.25, belief: 0.9, provenance: 'template' },
      { from: 'funding_choice', to: 'raise_seed_now', weight: 0.25, belief: 0.9, provenance: 'template' },
      { from: 'funding_choice', to: 'delay_seed', weight: 0.25, belief: 0.9, provenance: 'template' },
      { from: 'apply_grants', to: 'dilution_total', weight: -0.6, belief: 0.8, provenance: 'template' },
      { from: 'apply_grants', to: 'time_to_cash', weight: -0.4, belief: 0.6, provenance: 'template' },
      { from: 'raise_bridge', to: 'time_to_cash', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'raise_seed_now', to: 'dilution_total', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'delay_seed', to: 'dilution_total', weight: -0.3, belief: 0.6, provenance: 'template' },
      { from: 'team_bandwidth', to: 'grant_fit', weight: 0.4, belief: 0.6, provenance: 'template' },
      { from: 'time_to_cash', to: 'runway_months', weight: 0.6, belief: 0.8, provenance: 'template' },
      { from: 'dilution_rate', to: 'dilution_total', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'milestone_risk', to: 'milestone_success', weight: -0.7, belief: 0.85, provenance: 'template' },
      { from: 'runway_months', to: 'milestone_success', weight: 0.4, belief: 0.6, provenance: 'template' }
    ],
    meta: { roots: ['funding_choice'], leaves: ['runway_months', 'dilution_total', 'milestone_success'] }
  }  ,
  hiring_strategy_tech_lead: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'hiring_route', label: 'How to secure a tech lead?', kind: 'decision', body: 'Choose the best route to add senior technical leadership.' },
      { id: 'perm_hire', label: 'Permanent hire', kind: 'option', body: 'Full-time lead engineer with long-term ownership.' },
      { id: 'contractor_6m', label: '6-month contractor', kind: 'option', body: 'Senior contractor to accelerate delivery now.' },
      { id: 'agency_delivery', label: 'Specialist agency', kind: 'option', body: 'External team to deliver scoped outcomes.' },
      { id: 'salary_budget', label: 'Salary budget headroom', kind: 'factor', body: 'Room to pay competitive salary.' },
      { id: 'talent_pipeline', label: 'Qualified candidate pipeline', kind: 'factor', body: 'Depth of strong applicants available.' },
      { id: 'handover_risk', label: 'Handover/knowledge loss risk', kind: 'factor', body: 'Risk of losing context at contract end.' },
      { id: 'delivery_velocity', label: 'Delivery velocity', kind: 'factor', body: 'Throughput of key features to milestones.' },
      { id: 'mentoring_capacity', label: 'Mentoring & culture lift', kind: 'factor', body: 'Ability to raise overall engineering level.' },
      { id: 'monthly_burn', label: 'Monthly burn', kind: 'outcome', body: 'Total monthly cost impact of the route.' },
      { id: 'delivery_confidence', label: 'Delivery confidence', kind: 'outcome', body: 'Likelihood to hit milestones on time.' },
      { id: 'knowledge_retention', label: 'Knowledge retention', kind: 'outcome', body: 'Durable system/context knowledge retained.' }
    ],
    edges: [
      { from: 'hiring_route', to: 'perm_hire', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'hiring_route', to: 'contractor_6m', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'hiring_route', to: 'agency_delivery', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'perm_hire', to: 'mentoring_capacity', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'contractor_6m', to: 'delivery_velocity', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'agency_delivery', to: 'delivery_velocity', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'agency_delivery', to: 'monthly_burn', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'handover_risk', to: 'knowledge_retention', weight: -0.7, belief: 0.85, provenance: 'template' },
      { from: 'mentoring_capacity', to: 'delivery_confidence', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'delivery_velocity', to: 'delivery_confidence', weight: 0.6, belief: 0.8, provenance: 'template' },
      { from: 'salary_budget', to: 'monthly_burn', weight: 0.4, belief: 0.6, provenance: 'template' },
      { from: 'talent_pipeline', to: 'delivery_confidence', weight: 0.4, belief: 0.6, provenance: 'template' }
    ],
    meta: { roots: ['hiring_route'], leaves: ['monthly_burn', 'delivery_confidence', 'knowledge_retention'] }
  }
};

const catalog = [
  { id: 'small', label: 'Small Demo', summary: 'Minimal A→B graph', updated_at: UPDATED_AT },
  { id: 'medium', label: 'Medium Demo', summary: 'Price→Demand→Revenue (+Marketing)', updated_at: UPDATED_AT },
  { id: 'edge', label: 'Edge Case', summary: 'Near-zero baseline', updated_at: UPDATED_AT },
  { id: 'supplier_selection_resilience', label: 'Supplier Selection', summary: 'Balance cost, quality, and supply continuity', updated_at: UPDATED_AT },
  { id: 'feature_rollout_phased_learning', label: 'Feature Rollout', summary: 'Balance speed, safety, and learning', updated_at: UPDATED_AT },
  { id: 'funding_strategy_runway', label: 'Funding Strategy', summary: 'Extend runway while controlling dilution', updated_at: UPDATED_AT },
  { id: 'hiring_strategy_tech_lead', label: 'Tech Lead Hiring', summary: 'Delivery confidence vs knowledge retention vs burn', updated_at: UPDATED_AT },
];

export async function registerTemplatesRoutes(app: FastifyInstance) {
  app.get('/v1/templates', async (_req, reply) => {
    reply.header('Content-Type', 'application/json');
    reply.header('Cache-Control', 'no-cache');
    return catalog;
  });

  app.get('/v1/templates/:id/graph', async (req: any, reply) => {
    const id = String(req.params?.id || '');
    const g = (graphs as any)[id];
    if (!g) {
      return reply.code(404).send({ schema: 'error.v1', code: 'NOT_FOUND', message: `Template '${id}' not found` });
    }
    // Strong ETag over canonical JSON
    const canonical = canonicalStringify(g);
    const etag = '"' + sha256Hex(canonical) + '"';
    const inm = String(req.headers['if-none-match'] || '');
    reply.header('Content-Type', 'application/json');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Last-Modified', UPDATED_AT);
    reply.header('Vary', 'If-None-Match');
    reply.header('ETag', etag);
    if (inm && inm === etag) {
      return reply.code(304).send();
    }
    return normalizeGraph(g, true); // Add default belief=1.0 for UI clarity
  });
}
