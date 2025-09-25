import http from "node:http";
import https from "node:https";
export const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
export const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
export function fetchKA(url, opts = {}) {
  const u = new URL(url);
  const agent = u.protocol === "https:" ? httpsAgent : httpAgent;
  return fetch(url, { agent, ...opts });
}
