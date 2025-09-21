import { readFileSync } from 'fs';
import { resolve } from 'path';
let compiled = null;
let lastErrors = null;
async function getValidator() {
    if (compiled)
        return compiled;
    const AjvCtor = (await import('ajv')).default;
    const ajv = new AjvCtor({ strict: true, allErrors: true });
    const schemaPath = resolve(process.cwd(), 'schemas', 'flow.schema.json');
    const flowSchema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    // Normalise schema for Ajv by removing the $schema meta if present
    if (flowSchema.$schema)
        delete flowSchema.$schema;
    const validateFn = ajv.compile(flowSchema);
    compiled = (data) => {
        const ok = validateFn(data);
        lastErrors = (validateFn.errors || null);
        return ok;
    };
    return compiled;
}
export async function warmValidator() {
    await getValidator();
}
export async function validateFlowAsync(value) {
    const validator = await getValidator();
    const ok = validator(value);
    if (ok)
        return { ok: true };
    const err = lastErrors?.[0];
    const hint = err ? `${err.instancePath || '/'} ${err.message}` : 'Schema validation failed';
    return { ok: false, hint };
}
