import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { parse } from 'yaml';

const spec = parse(readFileSync(new URL('../contracts/openapi.yaml', import.meta.url), 'utf8'));
const carrierSchema = spec.components.schemas.nodeV3.properties.nonlinear_identity;
const carrier = {
  operation: 'accumulation',
  factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'],
  horizon_months: 12,
  rate_scale: 0.01,
  stated_in_brief: false,
};

// Translate the existing OpenAPI 3 request-only boolean exclusive bounds
// into JSON Schema's numeric form without changing the published schema.
function requestSchemaForAjv(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(requestSchemaForAjv);
  if (value === null || typeof value !== 'object') return value;
  const schema = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, requestSchemaForAjv(child)]),
  );
  for (const suffix of ['Minimum', 'Maximum']) {
    const exclusive = `exclusive${suffix}`;
    const inclusive = suffix.toLowerCase();
    if (schema[exclusive] === true) {
      schema[exclusive] = schema[inclusive];
      delete schema[inclusive];
    } else if (schema[exclusive] === false) {
      delete schema[exclusive];
    }
  }
  return schema;
}

const validate = new Ajv({ strict: false, strictNumbers: true, validateFormats: false })
  .compile(requestSchemaForAjv(carrierSchema) as object);

function booleanExclusiveBounds(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}/${key}`;
    if ((key === 'exclusiveMinimum' || key === 'exclusiveMaximum') && typeof child === 'boolean') {
      return [childPath];
    }
    return booleanExclusiveBounds(child, childPath);
  });
}

describe('accumulation rate_sigma_log published contract', () => {
  it('publishes an optional positional pair of nonnegative numbers without a wire default', () => {
    expect(carrierSchema.properties.rate_sigma_log).toMatchObject({
      type: 'array', minItems: 2, maxItems: 2,
      items: { type: 'number', minimum: 0 },
    });
    expect(carrierSchema.required).not.toContain('rate_sigma_log');
    expect(carrierSchema.properties.rate_sigma_log).not.toHaveProperty('default');
    expect(validate(carrier), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each([[0, 0], [0.136, 0.246], [0.246, 0.136], [0, Number.MAX_VALUE]])(
    'accepts the exact churn/inflow pair %j',
    (...rate_sigma_log) => {
      expect(validate({ ...carrier, rate_sigma_log }), JSON.stringify(validate.errors)).toBe(true);
    },
  );

  it.each([
    { rate_sigma_log: [-0.1, 0.2] },
    { rate_sigma_log: [0.1, -0.2] },
    { rate_sigma_log: [] },
    { rate_sigma_log: [0.1] },
    { rate_sigma_log: [0.1, 0.2, 0.3] },
    { rate_sigma_log: [NaN, 0.1] },
    { rate_sigma_log: [Infinity, 0.1] },
    { rate_sigma_log: [0.1, -Infinity] },
    { rate_sigma_log: ['0.1', 0.2] },
    { rate_sigma_log: [true, 0.2] },
    { rate_sigma_log: 'x' },
    { rate_sigma_log: null },
    { rate_sigma_log: {} },
  ])('refuses an invalid rate_sigma_log pair %#', ({ rate_sigma_log }) => {
    expect(validate({ ...carrier, rate_sigma_log }), JSON.stringify(validate.errors)).toBe(false);
  });

  it.each(['product', 'sum'])('refuses rate_sigma_log on %s by presence', (operation) => {
    const ordinary = { operation, factor_ids: ['price', 'stock'], stated_in_brief: false };
    expect(validate(ordinary), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...ordinary, rate_sigma_log: [0, 0] }), JSON.stringify(validate.errors)).toBe(false);
    expect(validate({ ...ordinary, rate_sigma_log: [0.136, 0.246] }), JSON.stringify(validate.errors)).toBe(false);
  });

  it('keeps response schemas compatible with Ajv numeric exclusive bounds', () => {
    expect(booleanExclusiveBounds(spec.components.schemas.runResponseV3)).toEqual([]);
  });
});
