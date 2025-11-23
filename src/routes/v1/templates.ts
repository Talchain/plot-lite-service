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
  },
  // Level 1: Simple smoke-test decisions
  ux_ab_test: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'ux_decision', label: 'Which UX variant to launch?', kind: 'decision', body: 'Choose between variant A and B for a key funnel step.' },
      { id: 'variant_a', label: 'Variant A (current)', kind: 'option', body: 'Keep existing design pattern.' },
      { id: 'variant_b', label: 'Variant B (new)', kind: 'option', body: 'Launch new streamlined design.' },
      { id: 'user_friction', label: 'User friction', kind: 'factor', body: 'Cognitive load and steps to complete action.' },
      { id: 'conversion_rate', label: 'Conversion rate', kind: 'outcome', body: 'Share of users completing the funnel step.' },
      { id: 'completion_time', label: 'Time to complete', kind: 'outcome', body: 'Average duration to finish the step.' }
    ],
    edges: [
      { from: 'ux_decision', to: 'variant_a', weight: 0.5, belief: 0.9, provenance: 'template' },
      { from: 'ux_decision', to: 'variant_b', weight: 0.5, belief: 0.9, provenance: 'template' },
      { from: 'variant_a', to: 'user_friction', weight: 0.3, belief: 0.7, provenance: 'template' },
      { from: 'variant_b', to: 'user_friction', weight: -0.4, belief: 0.75, provenance: 'template' },
      { from: 'user_friction', to: 'conversion_rate', weight: -0.6, belief: 0.8, provenance: 'template' },
      { from: 'user_friction', to: 'completion_time', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'variant_b', to: 'conversion_rate', weight: 0.35, belief: 0.65, provenance: 'template' }
    ],
    meta: { roots: ['ux_decision'], leaves: ['conversion_rate', 'completion_time'] }
  },
  hire_now_vs_delay: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'hiring_timing', label: 'When to hire key role?', kind: 'decision', body: 'Decide whether to hire now or delay one quarter.' },
      { id: 'hire_now', label: 'Hire now', kind: 'option', body: 'Fill the role immediately to accelerate roadmap.' },
      { id: 'hire_later', label: 'Hire in Q2', kind: 'option', body: 'Delay hiring to preserve runway.' },
      { id: 'talent_availability', label: 'Talent market availability', kind: 'factor', body: 'Quality and depth of candidate pool.' },
      { id: 'delivery_speed', label: 'Roadmap delivery speed', kind: 'outcome', body: 'Velocity on key initiatives.' },
      { id: 'monthly_burn', label: 'Monthly burn rate', kind: 'outcome', body: 'Operating cost increase from new hire.' },
      { id: 'hiring_risk', label: 'Mis-hire risk', kind: 'outcome', body: 'Probability of hiring wrong person under time pressure.' }
    ],
    edges: [
      { from: 'hiring_timing', to: 'hire_now', weight: 0.5, belief: 0.9, provenance: 'template' },
      { from: 'hiring_timing', to: 'hire_later', weight: 0.5, belief: 0.9, provenance: 'template' },
      { from: 'hire_now', to: 'delivery_speed', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'hire_now', to: 'monthly_burn', weight: 0.7, belief: 0.85, provenance: 'template' },
      { from: 'hire_now', to: 'hiring_risk', weight: 0.4, belief: 0.6, provenance: 'template' },
      { from: 'hire_later', to: 'delivery_speed', weight: -0.3, belief: 0.7, provenance: 'template' },
      { from: 'hire_later', to: 'monthly_burn', weight: -0.5, belief: 0.8, provenance: 'template' },
      { from: 'talent_availability', to: 'hiring_risk', weight: -0.5, belief: 0.7, provenance: 'template' }
    ],
    meta: { roots: ['hiring_timing'], leaves: ['delivery_speed', 'monthly_burn', 'hiring_risk'] }
  },
  // Level 2: Moderate complexity, multi-criteria
  experiment_vs_decide_now: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'experiment_decision', label: 'Experiment first or decide now?', kind: 'decision', body: 'Decide whether to run an experiment before committing to a risky product change.' },
      { id: 'run_experiment_first', label: 'Run experiment first', kind: 'option', body: 'Test with subset of users before full rollout.' },
      { id: 'decide_now', label: 'Decide now', kind: 'option', body: 'Skip testing and commit to direction immediately.' },
      { id: 'experiment_cost', label: 'Experiment setup cost', kind: 'factor', body: 'Engineering time to build experiment infrastructure.' },
      { id: 'time_to_market', label: 'Time to market', kind: 'factor', body: 'Calendar time until change reaches all users.' },
      { id: 'learning_value', label: 'Learning value', kind: 'factor', body: 'Insight gained to inform final decision.' },
      { id: 'signal_clarity', label: 'Signal clarity', kind: 'factor', body: 'How clearly experiment reveals user preference.' },
      { id: 'final_value', label: 'Final value delivered', kind: 'outcome', body: 'Long-term business value from the change.' },
      { id: 'sunk_cost', label: 'Sunk cost risk', kind: 'outcome', body: 'Wasted investment if we commit to wrong direction.' },
      { id: 'opportunity_cost', label: 'Opportunity cost', kind: 'outcome', body: 'Value lost from delayed rollout.' }
    ],
    edges: [
      { from: 'experiment_decision', to: 'run_experiment_first', weight: 0.5, belief: 0.9, provenance: 'template' },
      { from: 'experiment_decision', to: 'decide_now', weight: 0.5, belief: 0.9, provenance: 'template' },
      { from: 'run_experiment_first', to: 'experiment_cost', weight: 0.5, belief: 0.75, provenance: 'template' },
      { from: 'run_experiment_first', to: 'time_to_market', weight: 0.4, belief: 0.7, provenance: 'template' },
      { from: 'run_experiment_first', to: 'learning_value', weight: 0.7, belief: 0.8, provenance: 'template' },
      { from: 'decide_now', to: 'time_to_market', weight: -0.5, belief: 0.75, provenance: 'template' },
      { from: 'decide_now', to: 'sunk_cost', weight: 0.6, belief: 0.7, provenance: 'template' },
      { from: 'learning_value', to: 'final_value', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'learning_value', to: 'sunk_cost', weight: -0.6, belief: 0.75, provenance: 'template' },
      { from: 'signal_clarity', to: 'learning_value', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'time_to_market', to: 'opportunity_cost', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'experiment_cost', to: 'opportunity_cost', weight: 0.3, belief: 0.6, provenance: 'template' }
    ],
    meta: { roots: ['experiment_decision'], leaves: ['final_value', 'sunk_cost', 'opportunity_cost'] }
  },
  decommission_vs_maintain_legacy: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'legacy_strategy', label: 'How to handle legacy system?', kind: 'decision', body: 'Decide how to handle a risky legacy system.' },
      { id: 'decommission_now', label: 'Decommission now', kind: 'option', body: 'Shut down legacy system immediately.' },
      { id: 'maintain_as_is', label: 'Maintain as-is', kind: 'option', body: 'Keep running with minimal changes.' },
      { id: 'gradual_migration', label: 'Gradual migration', kind: 'option', body: 'Migrate incrementally over 6 months.' },
      { id: 'technical_debt', label: 'Technical debt burden', kind: 'factor', body: 'Ongoing cost of maintaining old code.' },
      { id: 'platform_outage_risk', label: 'Platform outage risk', kind: 'factor', body: 'Probability of system failure.' },
      { id: 'migration_complexity', label: 'Migration complexity', kind: 'factor', body: 'Engineering effort required for transition.' },
      { id: 'team_focus', label: 'Team focus', kind: 'factor', body: 'Ability to concentrate on new features vs maintenance.' },
      { id: 'operating_cost', label: 'Monthly operating cost', kind: 'outcome', body: 'Infrastructure and maintenance expenses.' },
      { id: 'reliability', label: 'System reliability', kind: 'outcome', body: 'Uptime and stability of the platform.' },
      { id: 'feature_velocity', label: 'Feature velocity', kind: 'outcome', body: 'Rate of new capability delivery.' }
    ],
    edges: [
      { from: 'legacy_strategy', to: 'decommission_now', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'legacy_strategy', to: 'maintain_as_is', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'legacy_strategy', to: 'gradual_migration', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'decommission_now', to: 'platform_outage_risk', weight: 0.5, belief: 0.65, provenance: 'template' },
      { from: 'decommission_now', to: 'operating_cost', weight: -0.7, belief: 0.85, provenance: 'template' },
      { from: 'maintain_as_is', to: 'technical_debt', weight: 0.6, belief: 0.8, provenance: 'template' },
      { from: 'maintain_as_is', to: 'platform_outage_risk', weight: 0.4, belief: 0.7, provenance: 'template' },
      { from: 'gradual_migration', to: 'migration_complexity', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'gradual_migration', to: 'team_focus', weight: -0.5, belief: 0.7, provenance: 'template' },
      { from: 'technical_debt', to: 'operating_cost', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'technical_debt', to: 'feature_velocity', weight: -0.6, belief: 0.75, provenance: 'template' },
      { from: 'platform_outage_risk', to: 'reliability', weight: -0.7, belief: 0.85, provenance: 'template' },
      { from: 'team_focus', to: 'feature_velocity', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'migration_complexity', to: 'feature_velocity', weight: -0.4, belief: 0.65, provenance: 'template' }
    ],
    meta: { roots: ['legacy_strategy'], leaves: ['operating_cost', 'reliability', 'feature_velocity'] }
  },
  // Level 3: Rich single-decision graphs
  market_expansion_choice: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'market_expansion', label: 'Which market to enter first?', kind: 'decision', body: 'Choose which new market to enter first.' },
      { id: 'expand_us', label: 'Expand to US', kind: 'option', body: 'Large market with high competition.' },
      { id: 'expand_eu', label: 'Expand to EU', kind: 'option', body: 'Fragmented market with regulatory complexity.' },
      { id: 'expand_apac', label: 'Expand to APAC', kind: 'option', body: 'Fast growth but requires localization.' },
      { id: 'stay_domestic', label: 'Stay domestic', kind: 'option', body: 'Deepen current market penetration.' },
      { id: 'market_fit', label: 'Product-market fit', kind: 'factor', body: 'How well product solves local problems.' },
      { id: 'regulatory_burden', label: 'Regulatory burden', kind: 'factor', body: 'Compliance and legal complexity.' },
      { id: 'support_cost', label: 'Support cost', kind: 'factor', body: 'Customer support infrastructure needed.' },
      { id: 'localization_effort', label: 'Localization effort', kind: 'factor', body: 'Product adaptation for local market.' },
      { id: 'competitive_intensity', label: 'Competitive intensity', kind: 'factor', body: 'Strength of existing players.' },
      { id: 'revenue_potential', label: 'Revenue potential', kind: 'outcome', body: 'Addressable market size and growth rate.' },
      { id: 'gross_margin', label: 'Gross margin', kind: 'outcome', body: 'Profitability after market-specific costs.' },
      { id: 'roadmap_distraction', label: 'Roadmap distraction', kind: 'outcome', body: 'Impact on core product development focus.' },
      { id: 'brand_strength', label: 'Brand strength', kind: 'outcome', body: 'Market presence and customer awareness.' }
    ],
    edges: [
      { from: 'market_expansion', to: 'expand_us', weight: 0.25, belief: 0.9, provenance: 'template' },
      { from: 'market_expansion', to: 'expand_eu', weight: 0.25, belief: 0.9, provenance: 'template' },
      { from: 'market_expansion', to: 'expand_apac', weight: 0.25, belief: 0.9, provenance: 'template' },
      { from: 'market_expansion', to: 'stay_domestic', weight: 0.25, belief: 0.9, provenance: 'template' },
      { from: 'expand_us', to: 'revenue_potential', weight: 0.7, belief: 0.8, provenance: 'template' },
      { from: 'expand_us', to: 'competitive_intensity', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'expand_eu', to: 'regulatory_burden', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'expand_eu', to: 'support_cost', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'expand_apac', to: 'localization_effort', weight: 0.7, belief: 0.8, provenance: 'template' },
      { from: 'expand_apac', to: 'revenue_potential', weight: 0.6, belief: 0.7, provenance: 'template' },
      { from: 'stay_domestic', to: 'market_fit', weight: 0.6, belief: 0.8, provenance: 'template' },
      { from: 'stay_domestic', to: 'roadmap_distraction', weight: -0.6, belief: 0.75, provenance: 'template' },
      { from: 'market_fit', to: 'revenue_potential', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'regulatory_burden', to: 'gross_margin', weight: -0.5, belief: 0.7, provenance: 'template' },
      { from: 'support_cost', to: 'gross_margin', weight: -0.6, belief: 0.75, provenance: 'template' },
      { from: 'localization_effort', to: 'roadmap_distraction', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'competitive_intensity', to: 'brand_strength', weight: -0.4, belief: 0.65, provenance: 'template' },
      { from: 'competitive_intensity', to: 'gross_margin', weight: -0.5, belief: 0.7, provenance: 'template' },
      { from: 'roadmap_distraction', to: 'brand_strength', weight: -0.3, belief: 0.6, provenance: 'template' }
    ],
    meta: { roots: ['market_expansion'], leaves: ['revenue_potential', 'gross_margin', 'roadmap_distraction', 'brand_strength'] }
  },
  architecture_choice: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'architecture_decision', label: 'Choose platform architecture', kind: 'decision', body: 'Choose the future architecture of the platform.' },
      { id: 'monolith', label: 'Monolith', kind: 'option', body: 'Single deployable unit, simple operations.' },
      { id: 'modular_monolith', label: 'Modular monolith', kind: 'option', body: 'Structured modules within single deployment.' },
      { id: 'microservices', label: 'Microservices', kind: 'option', body: 'Distributed services with independent deployment.' },
      { id: 'development_speed', label: 'Current development speed', kind: 'factor', body: 'Velocity on features in near term.' },
      { id: 'operational_complexity', label: 'Operational complexity', kind: 'factor', body: 'Infrastructure and deployment overhead.' },
      { id: 'team_coordination', label: 'Team coordination overhead', kind: 'factor', body: 'Communication cost across team boundaries.' },
      { id: 'future_change_cost', label: 'Future change cost', kind: 'factor', body: 'Effort to modify and extend over time.' },
      { id: 'scalability_ceiling', label: 'Scalability ceiling', kind: 'factor', body: 'Maximum load the architecture can handle.' },
      { id: 'failure_blast_radius', label: 'Failure blast radius', kind: 'factor', body: 'Impact scope when component fails.' },
      { id: 'delivery_throughput', label: 'Feature delivery throughput', kind: 'outcome', body: 'Rate of shipping new capabilities now.' },
      { id: 'long_term_flexibility', label: 'Long-term flexibility', kind: 'outcome', body: 'Ability to adapt to changing requirements.' },
      { id: 'reliability', label: 'System reliability', kind: 'outcome', body: 'Uptime and fault tolerance.' },
      { id: 'infrastructure_cost', label: 'Infrastructure cost', kind: 'outcome', body: 'Monthly cloud and tooling expenses.' }
    ],
    edges: [
      { from: 'architecture_decision', to: 'monolith', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'architecture_decision', to: 'modular_monolith', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'architecture_decision', to: 'microservices', weight: 0.33, belief: 0.9, provenance: 'template' },
      { from: 'monolith', to: 'development_speed', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'monolith', to: 'operational_complexity', weight: -0.6, belief: 0.8, provenance: 'template' },
      { from: 'monolith', to: 'future_change_cost', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'modular_monolith', to: 'development_speed', weight: 0.4, belief: 0.7, provenance: 'template' },
      { from: 'modular_monolith', to: 'future_change_cost', weight: 0.2, belief: 0.65, provenance: 'template' },
      { from: 'microservices', to: 'operational_complexity', weight: 0.7, belief: 0.85, provenance: 'template' },
      { from: 'microservices', to: 'team_coordination', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'microservices', to: 'scalability_ceiling', weight: 0.7, belief: 0.8, provenance: 'template' },
      { from: 'development_speed', to: 'delivery_throughput', weight: 0.7, belief: 0.8, provenance: 'template' },
      { from: 'operational_complexity', to: 'infrastructure_cost', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'operational_complexity', to: 'reliability', weight: -0.4, belief: 0.65, provenance: 'template' },
      { from: 'team_coordination', to: 'delivery_throughput', weight: -0.5, belief: 0.7, provenance: 'template' },
      { from: 'future_change_cost', to: 'long_term_flexibility', weight: -0.7, belief: 0.85, provenance: 'template' },
      { from: 'scalability_ceiling', to: 'reliability', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'failure_blast_radius', to: 'reliability', weight: -0.6, belief: 0.75, provenance: 'template' },
      { from: 'monolith', to: 'failure_blast_radius', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'microservices', to: 'failure_blast_radius', weight: -0.5, belief: 0.7, provenance: 'template' }
    ],
    meta: { roots: ['architecture_decision'], leaves: ['delivery_throughput', 'long_term_flexibility', 'reliability', 'infrastructure_cost'] }
  },
  // Level 4: Higher complexity / stress tests
  portfolio_prioritisation: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'portfolio_selection', label: 'Select initiative portfolio', kind: 'decision', body: 'Select a portfolio of initiatives for next quarter under budget constraint.' },
      { id: 'project_a', label: 'Project A: Core platform', kind: 'option', body: 'Foundational reliability and performance work.' },
      { id: 'project_b', label: 'Project B: New feature set', kind: 'option', body: 'Customer-facing capabilities for enterprise tier.' },
      { id: 'project_c', label: 'Project C: Integration', kind: 'option', body: 'Third-party integration to expand ecosystem.' },
      { id: 'project_d', label: 'Project D: Analytics', kind: 'option', body: 'Advanced analytics and reporting tools.' },
      { id: 'project_e', label: 'Project E: Mobile', kind: 'option', body: 'Mobile app for on-the-go access.' },
      { id: 'eng_capacity', label: 'Engineering capacity', kind: 'factor', body: 'Available developer bandwidth this quarter.' },
      { id: 'design_capacity', label: 'Design capacity', kind: 'factor', body: 'Available design resources.' },
      { id: 'customer_demand_enterprise', label: 'Enterprise customer demand', kind: 'factor', body: 'Requests from high-value customers.' },
      { id: 'customer_demand_smb', label: 'SMB customer demand', kind: 'factor', body: 'Requests from smaller customers.' },
      { id: 'technical_risk', label: 'Technical risk', kind: 'factor', body: 'Uncertainty in implementation complexity.' },
      { id: 'market_timing', label: 'Market timing pressure', kind: 'factor', body: 'Urgency to ship before competitors.' },
      { id: 'platform_stability', label: 'Platform stability', kind: 'factor', body: 'Foundation for future features.' },
      { id: 'revenue_impact', label: 'Revenue impact', kind: 'outcome', body: 'Expected increase in ARR or conversion.' },
      { id: 'customer_satisfaction', label: 'Customer satisfaction', kind: 'outcome', body: 'NPS and retention improvement.' },
      { id: 'technical_debt', label: 'Technical debt', kind: 'outcome', body: 'Accumulated maintenance burden.' },
      { id: 'competitive_position', label: 'Competitive position', kind: 'outcome', body: 'Strength vs alternatives in market.' },
      { id: 'team_burnout', label: 'Team burnout risk', kind: 'outcome', body: 'Stress and turnover risk from overload.' }
    ],
    edges: [
      { from: 'portfolio_selection', to: 'project_a', weight: 0.2, belief: 0.85, provenance: 'template' },
      { from: 'portfolio_selection', to: 'project_b', weight: 0.2, belief: 0.85, provenance: 'template' },
      { from: 'portfolio_selection', to: 'project_c', weight: 0.2, belief: 0.85, provenance: 'template' },
      { from: 'portfolio_selection', to: 'project_d', weight: 0.2, belief: 0.85, provenance: 'template' },
      { from: 'portfolio_selection', to: 'project_e', weight: 0.2, belief: 0.85, provenance: 'template' },
      { from: 'project_a', to: 'platform_stability', weight: 0.7, belief: 0.8, provenance: 'template' },
      { from: 'project_a', to: 'eng_capacity', weight: -0.5, belief: 0.75, provenance: 'template' },
      { from: 'project_b', to: 'customer_demand_enterprise', weight: 0.7, belief: 0.8, provenance: 'template' },
      { from: 'project_b', to: 'eng_capacity', weight: -0.6, belief: 0.8, provenance: 'template' },
      { from: 'project_b', to: 'design_capacity', weight: -0.6, belief: 0.75, provenance: 'template' },
      { from: 'project_c', to: 'technical_risk', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'project_c', to: 'revenue_impact', weight: 0.4, belief: 0.65, provenance: 'template' },
      { from: 'project_d', to: 'customer_demand_smb', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'project_d', to: 'eng_capacity', weight: -0.4, belief: 0.7, provenance: 'template' },
      { from: 'project_e', to: 'market_timing', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'project_e', to: 'eng_capacity', weight: -0.7, belief: 0.8, provenance: 'template' },
      { from: 'eng_capacity', to: 'team_burnout', weight: -0.6, belief: 0.75, provenance: 'template' },
      { from: 'design_capacity', to: 'team_burnout', weight: -0.4, belief: 0.65, provenance: 'template' },
      { from: 'customer_demand_enterprise', to: 'revenue_impact', weight: 0.7, belief: 0.8, provenance: 'template' },
      { from: 'customer_demand_smb', to: 'customer_satisfaction', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'technical_risk', to: 'technical_debt', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'market_timing', to: 'competitive_position', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'platform_stability', to: 'technical_debt', weight: -0.6, belief: 0.8, provenance: 'template' },
      { from: 'platform_stability', to: 'customer_satisfaction', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'team_burnout', to: 'customer_satisfaction', weight: -0.4, belief: 0.65, provenance: 'template' }
    ],
    meta: { roots: ['portfolio_selection'], leaves: ['revenue_impact', 'customer_satisfaction', 'technical_debt', 'competitive_position', 'team_burnout'] }
  },
  multi_stage_launch: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'launch_strategy', label: 'Choose launch strategy', kind: 'decision', body: 'Decide launch strategy for new product with multi-stage approach.' },
      { id: 'closed_beta', label: 'Closed beta first', kind: 'option', body: 'Private beta with selected users before wider rollout.' },
      { id: 'open_beta', label: 'Open beta first', kind: 'option', body: 'Public beta to gather broad feedback quickly.' },
      { id: 'beta_quality', label: 'Beta product quality', kind: 'factor', body: 'Stability and polish level at beta launch.' },
      { id: 'user_feedback_volume', label: 'User feedback volume', kind: 'factor', body: 'Amount of feedback collected during beta.' },
      { id: 'feedback_quality', label: 'Feedback quality', kind: 'factor', body: 'Depth and actionability of user insights.' },
      { id: 'market_learning', label: 'Market learning', kind: 'factor', body: 'Understanding of product-market fit.' },
      { id: 'reputational_risk', label: 'Reputational risk', kind: 'factor', body: 'Risk of negative public perception from bugs.' },
      { id: 'beta_to_scale', label: 'Beta → Scale', kind: 'option', body: 'Proceed from beta to full launch.' },
      { id: 'beta_to_pivot', label: 'Beta → Pivot', kind: 'option', body: 'Make significant changes based on beta feedback.' },
      { id: 'beta_to_kill', label: 'Beta → Kill', kind: 'option', body: 'Abandon product after negative beta results.' },
      { id: 'engineering_cost', label: 'Engineering cost', kind: 'factor', body: 'Development and iteration expenses.' },
      { id: 'time_to_revenue', label: 'Time to revenue', kind: 'factor', body: 'Calendar time until product generates income.' },
      { id: 'long_term_revenue', label: 'Long-term revenue potential', kind: 'outcome', body: 'Expected revenue over 3 years.' },
      { id: 'total_cost', label: 'Total development cost', kind: 'outcome', body: 'All-in investment to reach scale or kill decision.' },
      { id: 'brand_impact', label: 'Brand impact', kind: 'outcome', body: 'Net effect on company reputation.' },
      { id: 'product_quality', label: 'Final product quality', kind: 'outcome', body: 'Quality and user satisfaction at full launch.' }
    ],
    edges: [
      { from: 'launch_strategy', to: 'closed_beta', weight: 0.5, belief: 0.9, provenance: 'template' },
      { from: 'launch_strategy', to: 'open_beta', weight: 0.5, belief: 0.9, provenance: 'template' },
      { from: 'closed_beta', to: 'feedback_quality', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'closed_beta', to: 'user_feedback_volume', weight: -0.4, belief: 0.7, provenance: 'template' },
      { from: 'closed_beta', to: 'reputational_risk', weight: -0.5, belief: 0.7, provenance: 'template' },
      { from: 'open_beta', to: 'user_feedback_volume', weight: 0.7, belief: 0.8, provenance: 'template' },
      { from: 'open_beta', to: 'reputational_risk', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'beta_quality', to: 'reputational_risk', weight: -0.6, belief: 0.75, provenance: 'template' },
      { from: 'user_feedback_volume', to: 'market_learning', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'feedback_quality', to: 'market_learning', weight: 0.7, belief: 0.8, provenance: 'template' },
      { from: 'market_learning', to: 'beta_to_scale', weight: 0.4, belief: 0.7, provenance: 'template' },
      { from: 'market_learning', to: 'beta_to_pivot', weight: 0.3, belief: 0.65, provenance: 'template' },
      { from: 'market_learning', to: 'beta_to_kill', weight: 0.3, belief: 0.65, provenance: 'template' },
      { from: 'beta_to_scale', to: 'long_term_revenue', weight: 0.7, belief: 0.8, provenance: 'template' },
      { from: 'beta_to_scale', to: 'time_to_revenue', weight: -0.5, belief: 0.7, provenance: 'template' },
      { from: 'beta_to_pivot', to: 'engineering_cost', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'beta_to_pivot', to: 'product_quality', weight: 0.5, belief: 0.7, provenance: 'template' },
      { from: 'beta_to_kill', to: 'total_cost', weight: -0.4, belief: 0.7, provenance: 'template' },
      { from: 'beta_to_kill', to: 'long_term_revenue', weight: -0.9, belief: 0.95, provenance: 'template' },
      { from: 'reputational_risk', to: 'brand_impact', weight: -0.7, belief: 0.8, provenance: 'template' },
      { from: 'engineering_cost', to: 'total_cost', weight: 0.7, belief: 0.85, provenance: 'template' },
      { from: 'time_to_revenue', to: 'total_cost', weight: 0.4, belief: 0.65, provenance: 'template' },
      { from: 'market_learning', to: 'product_quality', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'product_quality', to: 'long_term_revenue', weight: 0.6, belief: 0.75, provenance: 'template' },
      { from: 'product_quality', to: 'brand_impact', weight: 0.5, belief: 0.7, provenance: 'template' }
    ],
    meta: { roots: ['launch_strategy'], leaves: ['long_term_revenue', 'total_cost', 'brand_impact', 'product_quality'] }
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
  { id: 'ux_ab_test', label: 'UX A/B Test', summary: 'Simple A/B choice for UX variant', updated_at: UPDATED_AT },
  { id: 'hire_now_vs_delay', label: 'Hiring Timing', summary: 'Hire now vs delay for runway and delivery', updated_at: UPDATED_AT },
  { id: 'experiment_vs_decide_now', label: 'Experiment vs Decide', summary: 'Test first or commit immediately', updated_at: UPDATED_AT },
  { id: 'decommission_vs_maintain_legacy', label: 'Legacy System Strategy', summary: 'Decommission, maintain, or migrate legacy platform', updated_at: UPDATED_AT },
  { id: 'market_expansion_choice', label: 'Market Expansion', summary: 'Choose which market to enter first', updated_at: UPDATED_AT },
  { id: 'architecture_choice', label: 'Architecture Decision', summary: 'Monolith vs modular vs microservices', updated_at: UPDATED_AT },
  { id: 'portfolio_prioritisation', label: 'Portfolio Prioritisation', summary: 'Select initiative portfolio under capacity constraint', updated_at: UPDATED_AT },
  { id: 'multi_stage_launch', label: 'Multi-Stage Launch', summary: 'Sequential beta and launch strategy', updated_at: UPDATED_AT },
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
