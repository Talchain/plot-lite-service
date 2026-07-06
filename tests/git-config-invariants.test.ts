/**
 * Git-config invariants — regression guard for the `core.bare` corruption.
 *
 * Background: this repo runs with `extensions.worktreeConfig=true`, which makes
 * `core.bare` worktree-scoped. A concurrent or interrupted git write can leave
 * `core.bare=true` in a worktree scope, overriding the correct shared `false`.
 * When that happens EVERY work-tree git command (starting with the pre-push
 * gate's `git rev-parse --show-toplevel`) dies with "fatal: this operation must
 * be run in a work tree", silently blocking all pushes from that worktree.
 *
 * These tests fail LOUDLY inside the suite if the invariant is violated — so a
 * corruption is caught in CI/local test runs rather than only surfacing as a
 * mysterious blocked push. They also prove the invariant is currently held and
 * that nothing in the suite itself leaves `core.bare` set.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Repo root: the working directory of the test run (vitest root === repo root).
const REPO_ROOT = process.cwd();

// Read git config WITHOUT trusting an inherited GIT_DIR/GIT_WORK_TREE — those
// are set when git runs a hook and would otherwise point elsewhere.
function gitConfig(args: string[]): string {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  try {
    return execFileSync('git', ['config', ...args], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    }).trim();
  } catch {
    return ''; // unset key → non-zero exit → treat as empty
  }
}

describe('git config invariants (core.bare corruption guard)', () => {
  it('is a checked-out worktree, not a bare repo (package.json present at root)', () => {
    expect(existsSync(resolve(REPO_ROOT, 'package.json'))).toBe(true);
  });

  it('core.bare is NOT true — a checked-out worktree must never resolve as bare', () => {
    const bare = gitConfig(['--get', 'core.bare']) || 'false';
    expect(
      bare,
      'core.bare resolved true in a checked-out worktree — this is the ' +
        'extensions.worktreeConfig corruption; run `git config --worktree ' +
        'core.bare false` (or `git config core.bare false`) to clear it.',
    ).not.toBe('true');
  });

  it('git can resolve the work tree (the operation the pre-push gate depends on)', () => {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    }).trim();
    expect(top.length).toBeGreaterThan(0);
  });
});
