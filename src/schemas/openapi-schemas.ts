/**
 * OpenAPI Schemas for route documentation
 * These describe existing API contracts without changing runtime behavior
 */

export const runRequestSchema = {
  type: 'object',
  required: ['graph', 'outcome_node'],
  properties: {
    graph: {
      type: 'object',
      required: ['nodes', 'edges'],
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'label'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
            },
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            required: ['from', 'to'],
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              weight: { type: 'number' },
              belief: { type: 'number' },
            },
          },
        },
      },
    },
    outcome_node: { type: 'string' },
    seed: { type: 'number' },
    k_samples: { type: 'number' },
    treatment_node: { type: 'string' },
    baseline_value: { type: 'number' },
  },
};

export const runResponseSchema = {
  type: 'object',
  required: ['schema', 'results', 'confidence', 'model_card'],
  properties: {
    schema: { type: 'string', enum: ['run.v1'] },
    results: {
      type: 'object',
      required: ['conservative', 'most_likely', 'optimistic'],
      properties: {
        conservative: {
          type: 'object',
          properties: {
            outcome: { type: 'number' },
            percentile: { type: 'number' },
          },
        },
        most_likely: {
          type: 'object',
          properties: {
            outcome: { type: 'number' },
            percentile: { type: 'number' },
          },
        },
        optimistic: {
          type: 'object',
          properties: {
            outcome: { type: 'number' },
            percentile: { type: 'number' },
          },
        },
      },
    },
    confidence: {
      type: 'object',
      required: ['level', 'factors'],
      properties: {
        level: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        factors: {
          type: 'object',
          properties: {
            mask_diversity: { type: 'number' },
            path_stability: { type: 'number' },
            linearity_distance: { type: 'number' },
          },
        },
      },
    },
    meta: {
      type: 'object',
      properties: {
        seed: { type: 'number' },
      },
    },
    model_card: {
      type: 'object',
      required: ['response_hash'],
      properties: {
        response_hash: { type: 'string' },
        bma_hash: { type: 'string' },
        compute_budget: {
          type: 'object',
          properties: {
            k_samples: { type: 'number' },
          },
        },
      },
    },
  },
};

export const healthResponseSchema = {
  type: 'object',
  required: ['status', 'api_version'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    api_version: { type: 'string' },
    p95_ms: { type: 'number' },
    version: { type: 'string' },
    uptime_s: { type: 'number' },
    engine_p95_ms: { type: 'number' },
    engine_p95_ms_rolling: { type: 'number' },
    json_429_count: { type: 'number' },
    sse_429_count: { type: 'number' },
    idem_cache_size: { type: 'number' },
  },
};

export const versionResponseSchema = {
  type: 'object',
  required: ['version', 'commit', 'build_time_iso', 'flags'],
  properties: {
    version: { type: 'string' },
    commit: { type: 'string' },
    build_time_iso: { type: 'string', format: 'date-time' },
    flags: {
      type: 'object',
      required: ['scm_lite_enable', 'auth_enabled', 'rate_limit_enabled'],
      properties: {
        scm_lite_enable: { type: 'boolean' },
        auth_enabled: { type: 'boolean' },
        rate_limit_enabled: { type: 'boolean' },
      },
    },
    // Legacy fields
    api: { type: 'string' },
    build: { type: 'string' },
    model: { type: 'string' },
  },
};
