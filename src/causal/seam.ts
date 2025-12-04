import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { DAG, SCM } from './types.js';

let _ajv: any;
async function getAjv() {
  if (_ajv) return _ajv;
  const AjvCtor = (await import('ajv')).default as any;
  _ajv = new AjvCtor({ allErrors: true, strict: false });
  return _ajv;
}

function getSchema() {
  const p = resolve(process.cwd(), 'contracts', 'schemas', 'scm.v1.schema.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

export async function toSCM(graph: { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> }, _params?: any): Promise<SCM> {
  const dag: DAG = {
    nodes: graph.nodes.map(n => n.id),
    edges: graph.edges.map(e => [e.from, e.to]),
  };

  // Validate DAG shape against schema (seam only checks dag for now)
  const schema = getSchema();
  const ajv = await getAjv();
  const validate = ajv.compile(schema);
  const doc = { dag };
  const ok = validate(doc);
  if (!ok) {
    const msg = ajv.errorsText(validate.errors, { separator: '; ' });
    throw new Error(`SCM seam validation failed: ${msg}`);
  }

  // Minimal SCM with identity structural equations (pass-through of parents avg + exogenous)
  const f: SCM['f'] = {};
  for (const v of dag.nodes) {
    f[v] = (parents, u) => {
      const keys = Object.keys(parents).sort();
      const avg = keys.length ? keys.reduce((acc, k) => acc + (parents as any)[k], 0) / keys.length : 0;
      return avg + (u[v] ?? 0);
    };
  }
  const U: SCM['U'] = {};
  for (const v of dag.nodes) U[v] = { dist: 'uniform', params: {} };

  return { dag, f, U };
}
