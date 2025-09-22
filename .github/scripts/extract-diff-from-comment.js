/*
  Extract a unified diff from an issue comment body and write it to stdout as a file path.
  Usage: node .github/scripts/extract-diff-from-comment.js > warp.patch
*/
const fs = require('fs');

function getEvent() {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p || !fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function extractDiffFromBody(body) {
  if (!body || typeof body !== 'string') return null;
  const fence = /```(?:diff|patch)?\n([\s\S]*?)```/m;
  const m = body.match(fence);
  if (m && m[1]) return m[1].trim() + '\n';
  return null;
}

(function main() {
  const evt = getEvent();
  const body = evt && evt.comment && evt.comment.body ? evt.comment.body : '';
  const diff = extractDiffFromBody(body);
  const out = diff || '';
  const outPath = 'warp.patch';
  fs.writeFileSync(outPath, out, 'utf8');
  console.log(outPath);
})();
