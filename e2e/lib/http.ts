export async function post(url: string, body: any, headers = {}) {
  const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return {status: res.status, json, text};
}
export async function get(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return {status: res.status, json, text};
}
