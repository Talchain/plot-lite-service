import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { CODE, MESSAGE, REASONS, refusal, useGoalThresholdHarness } from './helpers/goal-threshold-reason-carrier.js';

describe('GOAL-REACH 3a — ISL refusal reason on the PLoT→CEE wire', () => {
  const run = useGoalThresholdHarness();

  it.each(REASONS)('carries the %s ISL response fixture', async reason => {
    const { body, warnings, events } = await run([refusal({ reason })]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].detail).toEqual(reason === 'root_goal'
      ? { reason, root_case: 'unknown' }
      : { reason });
    expect(warnings[0].message).toBe(MESSAGE);
    expect(events).toEqual([{ event: 'goal_threshold_not_convertible', reason, root_case: 'unknown' }]);
    expect(body.option_comparison.map((option: { win_probability: number }) => option.win_probability)).toEqual([0.7, 0.3]);
    expect(body._meta.evidence.enrichment_contract_ok).toBe(true);
  });

  it.each([
    ['unrecognised', { reason: 'private user content must not become a reason' }],
    ['absent', {}],
    ['non-string', { reason: { private: 'user content' } }],
    ['null', { reason: null }],
  ])('maps an %s reason to unknown', async (_name, detail) => {
    const { warnings, events } = await run([refusal(detail)]);
    expect(warnings[0].detail).toEqual({ reason: 'unknown' });
    expect(warnings[0].message).toBe(MESSAGE);
    expect(events).toEqual([{ event: 'goal_threshold_not_convertible', reason: 'unknown', root_case: 'unknown' }]);
  });

  it('maps an entirely absent ISL detail to unknown', async () => {
    const { warnings, events } = await run([{ code: CODE, severity: 'warning', message: MESSAGE }]);
    expect(warnings[0].detail).toEqual({ reason: 'unknown' });
    expect(warnings[0].message).toBe(MESSAGE);
    expect(events).toEqual([{ event: 'goal_threshold_not_convertible', reason: 'unknown', root_case: 'unknown' }]);
  });

  it.each([
    ['root_value_source', { root_value_source: 'default' }],
    ['root_intercept', { root_intercept: 0.25 }],
    ['root_intercept', { root_intercept: 0 }],
    ['unknown', {}],
    ['unknown', { root_value_source: 'default', root_intercept: 0.25 }],
    ['unknown', { root_case: 'root_intercept' }],
  ])('derives root_goal case %s from ISL detail key presence (%j)', async (rootCase, detail) => {
    const { warnings, events } = await run([refusal({ reason: 'root_goal', ...detail })]);
    expect(warnings[0].detail).toEqual({ reason: 'root_goal', root_case: rootCase });
    expect(warnings[0].message).toBe(MESSAGE);
    expect(events).toEqual([{ event: 'goal_threshold_not_convertible', reason: 'root_goal', root_case: rootCase }]);
  });

  it('preserves flat-message precedence byte-for-byte', async () => {
    const message = ' Legacy message.\n\t';
    const { warnings } = await run([{ ...refusal({ reason: 'missing_goal_baseline' }), message }]);
    expect(warnings[0].message).toBe(message);
    expect(warnings[0].detail).toEqual({ reason: 'missing_goal_baseline' });
  });

  it('retains the historical reason-as-message fallback', async () => {
    const { warnings } = await run([{ code: CODE, severity: 'warning', detail: { reason: 'root_goal' } }]);
    expect(warnings[0].message).toBe('root_goal');
    expect(warnings[0].detail).toEqual({ reason: 'root_goal', root_case: 'unknown' });
  });

  it('logs once per emitted occurrence after deduplication, with no user content', async () => {
    const source = refusal({ reason: 'root_goal', root_intercept: 123456, node_id: 'private-node' });
    const { warnings, events } = await run([
      source, source,
      refusal({ reason: 'missing_goal_baseline', node_id: 'another-private-node', root_value_source: 'private-source' }),
    ]);
    expect(warnings).toHaveLength(2);
    expect(events).toEqual([
      { event: 'goal_threshold_not_convertible', reason: 'root_goal', root_case: 'root_intercept' },
      { event: 'goal_threshold_not_convertible', reason: 'missing_goal_baseline', root_case: 'unknown' },
    ]);
    expect(warnings[1].detail).toEqual({ reason: 'missing_goal_baseline' });
  });

  it('does not alter other ISL warning detail or message behaviour', async () => {
    const { body, events } = await run([{ code: 'OTHER_ISL_WARNING', severity: 'info', detail: { message: MESSAGE, reason: 'root_goal' } }]);
    expect(body.inference_warnings.find((warning: { code: string }) => warning.code === 'OTHER_ISL_WARNING')).toEqual({ code: 'OTHER_ISL_WARNING', message: MESSAGE, severity: 'info' });
    expect(events).toEqual([]);
  });

  it.each(['openapi/openapi-plot-lite-v1.yaml', 'contracts/openapi.yaml'])('Ajv accepts emitted details and rejects invalid reasons/cases in %s', async path => {
    const spec = parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
    const response = spec.components.schemas.V2RunResponse ?? spec.components.schemas.runResponseV3;
    const warningItems = response.properties.inference_warnings?.items;
    expect(warningItems, 'response schema must declare inference_warnings').toBeDefined();
    function dereference(value: any): any {
      if (Array.isArray(value)) return value.map(dereference);
      if (!value || typeof value !== 'object') return value;
      if (value.$ref) return dereference(value.$ref.split('/').slice(1).reduce((node: any, key: string) => node[key], spec));
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, dereference(child)]));
    }
    const schema = dereference(warningItems);
    expect(schema.properties.detail, 'detail must be typed, not silently accepted as an additional property').toBeDefined();
    const validate = new Ajv({ strict: false, validateFormats: false }).compile(schema);
    const { warnings } = await run(REASONS.map(reason => refusal({ reason, node_id: reason })));
    expect(warnings).toHaveLength(REASONS.length);
    for (const warning of warnings) expect(validate(warning), JSON.stringify(validate.errors)).toBe(true);
    for (const root_case of ['root_value_source', 'root_intercept', 'unknown']) {
      expect(validate({ code: CODE, message: MESSAGE, detail: { reason: 'root_goal', root_case } })).toBe(true);
    }
    expect(validate({ code: CODE, message: MESSAGE, detail: { reason: 'unknown' } })).toBe(true);
    expect(validate({ code: CODE, message: MESSAGE, detail: { reason: 'unrecognised' } })).toBe(false);
    expect(validate({ code: CODE, message: MESSAGE, detail: { reason: 'root_goal', root_case: 'unrecognised' } })).toBe(false);
    expect(validate({ code: CODE, message: MESSAGE, detail: { reason: 'root_goal' } })).toBe(false);
    expect(validate({ code: CODE, message: MESSAGE })).toBe(false);
    expect(validate({ code: 'OTHER_ISL_WARNING', message: MESSAGE, severity: 'info' })).toBe(true);
  });
});
