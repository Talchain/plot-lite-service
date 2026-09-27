import { describe, expect, it } from 'vitest';
import { AnalysisEnrichmentSchema } from '@talchain/schemas/boundary';
import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import { getIslSamplingDiagnostics } from '../src/integrations/isl/v2-envelope.js';

describe('enhanced ISL sampling measurements — location, absence and validation', () => {
  it('preserves measured zero, one and opaque edge identities without rounding', () => {
    expect(getIslSamplingDiagnostics({ tie_rate: 0, edge_existence_rates: { 'f->g': 0, 'a::b->goal': 1 } }))
      .toEqual({ values: { tie_rate: 0, edge_existence_rates: { 'f->g': 0, 'a::b->goal': 1 } }, invalid_fields: [] });
  });

  it('distinguishes a computed empty edge map from absent measurements', () => {
    expect(getIslSamplingDiagnostics({ edge_existence_rates: {} }).values).toEqual({ edge_existence_rates: {} });
    expect(getIslSamplingDiagnostics({}).values).toEqual({});
    expect(getIslSamplingDiagnostics(null).values).toEqual({});
  });

  it('never promotes internal/legacy metadata into the enhanced public contract', () => {
    const fields = { tie_rate: 0.31, edge_existence_rates: { 'f->g': 0.42 } };
    expect(getIslSamplingDiagnostics({ _metadata: fields, metadata: fields })).toEqual({ values: {}, invalid_fields: [] });
  });

  it.each([null, '0.5', false, NaN, Infinity, -Infinity, -0.01, 1.01])(
    'refuses malformed tie_rate %s while preserving an independently valid map', (tie_rate) => {
      expect(getIslSamplingDiagnostics({ tie_rate, edge_existence_rates: { 'f->g': 0.42 } }))
        .toEqual({ values: { edge_existence_rates: { 'f->g': 0.42 } }, invalid_fields: ['tie_rate'] });
    },
  );

  it.each([null, [], 'rates', { 'f->g': 0.42, 'bad->g': 1.01 }, { '': 0.5 }, { 'f->g': NaN }])(
    'refuses the entire malformed map %j without publishing a partial population', (edge_existence_rates) => {
      expect(getIslSamplingDiagnostics({ tie_rate: 0.31, edge_existence_rates }))
        .toEqual({ values: { tie_rate: 0.31 }, invalid_fields: ['edge_existence_rates'] });
    },
  );

  it('does not modify input and ignores unrelated metadata', () => {
    const source = Object.freeze({ tie_rate: 0.31, edge_existence_rates: Object.freeze({ 'f->g': 0.42 }) });
    const expected = getIslSamplingDiagnostics(source);
    expect(getIslSamplingDiagnostics({ ...source, timestamp: 'unrelated' })).toEqual(expected);
    expect(source.edge_existence_rates).toEqual({ 'f->g': 0.42 });
  });
});

describe('current .40 shared consumer and published optional contract', () => {
  it('actual vendored .40 consumer preserves positive and absent values without a repin', () => {
    // This is the currently installed old consumer, not a recreated schema.
    const pkg = JSON.parse(readFileSync(new URL('../node_modules/@talchain/schemas/package.json', import.meta.url), 'utf8'));
    expect(pkg.version).toBe('0.40.0');
    const values = { tie_rate: 0.31, edge_existence_rates: { 'f->g': 0.42 } };
    expect(AnalysisEnrichmentSchema.parse(values)).toEqual(values);
    expect(AnalysisEnrichmentSchema.parse({})).toEqual({});
  });

  it('old passthrough acceptance is not validation — the actual ingress refuses its false green', () => {
    const malformed = { tie_rate: 'not-a-rate', edge_existence_rates: { 'f->g': 'not-a-rate' } };
    expect(AnalysisEnrichmentSchema.safeParse(malformed).success).toBe(true);
    expect(getIslSamplingDiagnostics(malformed)).toEqual({ values: {}, invalid_fields: ['tie_rate', 'edge_existence_rates'] });
  });

  it('public response documents optional rate domains and unchanged edge identities', () => {
    const spec = loadYaml(readFileSync(new URL('../contracts/openapi.yaml', import.meta.url), 'utf8')) as any;
    const schema = spec.components.schemas.runResponseV3;
    expect(schema.required).not.toContain('tie_rate');
    expect(schema.required).not.toContain('edge_existence_rates');
    expect(schema.properties.tie_rate).toMatchObject({ type: 'number', minimum: 0, maximum: 1 });
    expect(schema.properties.edge_existence_rates.additionalProperties).toEqual({ type: 'number', minimum: 0, maximum: 1 });
  });
});
