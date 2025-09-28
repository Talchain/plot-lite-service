#!/usr/bin/env node
// tools/ci/pr-verify.cjs
// Summarize required workflows, run local smoke (non-fatal),
// upsert a PR comment via gh api, and exit nonzero iff required workflows failed.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const LOGDIR = path.join(ROOT, 'reports', 'warp');
fs.mkdirSync(LOGDIR, { recursive: true });
const LOG = path.join(LOGDIR, 'pr2-verify.log');

const BR = process.env.BRANCH || 'chore/lockfile-sync-ci';
const BASE = process.env.BASE_BRANCH || 'main';
const REQUIRED = ['OpenAPI Examples Roundtrip', 'engine-safety', 'tests-smoke'];

function run(cmd, args, opts={}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI:'1', NO_COLOR:'1', GIT_PAGER:'cat', PAGER:'cat' },
    ...opts
  });
  const out = (res.stdout||'') + (res.stderr||'');
  fs.appendFileSync(LOG, `\n$ ${cmd} ${args.join(' ')}\n${out}`);
  return res;
}
function ghOut(args, opts={}) {
  const r = run('gh', args, opts);
  if (r.status !== 0) throw new Error(`gh ${args.join(' ')} failed`);
  return (r.stdout || '').trim();
}
function ghJson(args, opts={}) {
  const out = ghOut(args, opts);
  return JSON.parse(out || 'null');
}
function prNumberForBranch(branch) {
  let n = null;
  try {
    const j = ghJson(['pr','view','--json','number']);
    n = j && j.number || null;
  } catch {}
  if (!n) {
    try {
      const arr = ghJson(['pr','list','--head', branch, '--json','number']);
      n = Array.isArray(arr) && arr[0] ? arr[0].number : null;
    } catch {}
  }
  return n;
}
function requireTools() {
  for (const t of ['git','gh','node']) {
    const r = spawnSync(t, ['--version'], { encoding:'utf8' });
    if (r.status !== 0) throw new Error(`Missing dependency: ${t}`);
  }
}

(async function main(){
  try {
    requireTools();

    // Ensure branch exists/pushed and draft PR open (idempotent)
    run('git',['checkout','-B',BR]);
    run('git',['fetch','--all','--prune']);
    run('git',['push','-u','origin',BR]);
    let prnum = prNumberForBranch(BR);
    if (!prnum) {
      const r = run('gh',['pr','create','--fill','--draft','--head',BR,'--base',BASE]);
      if (r.status !== 0) throw new Error('Failed to create PR');
      prnum = prNumberForBranch(BR);
    }
    if (!prnum) throw new Error(`No PR found for ${BR}`);

    // Summarize workflow runs (limit 20)
    const runs = ghJson(['run','list','--branch',BR,'--limit','20','--json','name,conclusion,status,headSha']);
    const requiredFailures = runs.filter(r =>
      REQUIRED.includes(r.name) &&
      r.status === 'completed' &&
      r.conclusion && r.conclusion !== 'success'
    );
    const failCount = requiredFailures.length;

    // Local smoke (non-fatal)
    run(process.execPath, [path.join('tools','run-tests.cjs')]);

    // Local tests summary
    let localSummary = '(no local report)';
    try {
      const j = JSON.parse(fs.readFileSync(path.join('reports','tests.json'),'utf8'));
      localSummary = j && j.summary ? `tests ${j.summary.ok}/${j.summary.total} ok` : 'tests summary missing';
    } catch {}

    // Checks page URL (JSON → .url)
    const prView = ghJson(['pr','view', String(prnum), '--json', 'url']);
    const checksUrl = `${prView.url}/checks`;

    // Build comment body
    const compact = runs.map(r => ({
      name: r.name,
      status: r.status,
      conclusion: r.conclusion || '',
      headSha: (r.headSha||'').slice(0,7)
    }));
    const body =
`CI status for \`${BR}\`:

- Checks page: ${checksUrl}
- Local smoke: ${localSummary}

<details><summary>Latest workflow runs</summary>

\`\`\`json
${JSON.stringify(compact, null, 2)}
\`\`\`
</details>`;

    // Upsert PR comment via gh api (find by marker → PATCH by id; else POST)
    const ownerRepo = ghJson(['repo','view','--json','nameWithOwner']).nameWithOwner;
    const comments = ghJson(['api', `repos/${ownerRepo}/issues/${prnum}/comments`]);
    const marker = `CI status for \`${BR}\`:`;
    const existing = Array.isArray(comments) ? comments.find(c => (c.body || '').startsWith(marker)) : null;

    if (existing && existing.id) {
      run('gh', ['api', '--method', 'PATCH', `repos/${ownerRepo}/issues/comments/${existing.id}`, '-f', 'body=@-'], { input: body });
    } else {
      run('gh', ['api', '--method', 'POST', `repos/${ownerRepo}/issues/${prnum}/comments`, '-f', 'body=@-'], { input: body });
    }

    if (failCount > 0) {
      console.log(`ERR: CI shows ${failCount} failed required run(s) — see ${checksUrl} (log: ${LOG})`);
      process.exit(1);
    } else {
      console.log(`OK: CI green (or running without failures) — see ${checksUrl} (log: ${LOG})`);
    }
  } catch (e) {
    fs.appendFileSync(LOG, `\nEXC: ${e && e.stack || e}\n`);
    console.log(`ERR: ${e && e.message || e} (log: ${LOG})`);
    process.exit(1);
  }
})();
