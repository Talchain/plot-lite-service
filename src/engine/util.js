export function nowMs() {
  return Date.now();
}

export function get(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
    else return undefined;
  }
  return cur;
}

export function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
