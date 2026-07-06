/**
 * file:-dependency policy — scripts/validate-file-deps.sh
 *
 * The pre-push gate (check 5) forbids file: dependencies EXCEPT the one narrow
 * allowance: an in-repo, git-tracked, sha256-manifested vendored
 * talchain-schemas tarball. These fixtures prove the allowance stays narrow:
 * every historical failure mode (file:../, absolute paths, home paths,
 * arbitrary tarballs, unmanifested/untracked artefacts, hash mismatch) still
 * fails the gate.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../scripts/validate-file-deps.sh');

interface FixtureOpts {
  readonly specifier: string;
  readonly lockSpecifier?: string;
  readonly tarball?: { name: string; manifest: 'valid' | 'mismatch' | 'missing'; tracked?: boolean };
  readonly gitInit?: boolean;
}

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
}

function makeFixture(opts: FixtureOpts): string {
  const dir = mkdtempSync(join(tmpdir(), 'file-dep-policy-'));
  cleanups.push(dir);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', dependencies: { '@talchain/schemas': opts.specifier } }, null, 2),
  );
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      name: 'fixture',
      lockfileVersion: 3,
      packages: { '': { dependencies: { '@talchain/schemas': opts.lockSpecifier ?? opts.specifier } } },
    }, null, 2),
  );
  if (opts.tarball) {
    mkdirSync(join(dir, 'vendor'), { recursive: true });
    const tgzPath = join(dir, 'vendor', opts.tarball.name);
    const bytes = Buffer.from(`tarball-fixture:${opts.tarball.name}`);
    writeFileSync(tgzPath, bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (opts.tarball.manifest === 'valid') writeFileSync(`${tgzPath}.sha256`, `${sha}\n`);
    if (opts.tarball.manifest === 'mismatch') writeFileSync(`${tgzPath}.sha256`, `${'0'.repeat(64)}\n`);
  }
  if (opts.gitInit ?? true) {
    git(dir, 'init', '--quiet');
    git(dir, 'add', 'package.json', 'package-lock.json');
    if (opts.tarball && (opts.tarball.tracked ?? true)) git(dir, 'add', '--all', 'vendor');
  }
  return dir;
}

function runPolicy(dir: string): { status: number; output: string } {
  try {
    const output = execFileSync('bash', [SCRIPT, dir], { encoding: 'utf8' });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('file:-dependency policy (pre-push check 5)', () => {
  it('allows an in-repo, tracked, sha256-manifested talchain-schemas tarball (./vendor form)', () => {
    const dir = makeFixture({
      specifier: 'file:./vendor/talchain-schemas-0.13.1.tgz',
      lockSpecifier: 'file:vendor/talchain-schemas-0.13.1.tgz', // npm lockfile spelling
      tarball: { name: 'talchain-schemas-0.13.1.tgz', manifest: 'valid' },
    });
    const res = runPolicy(dir);
    expect(res.output).toContain('POLICY OK');
    expect(res.status).toBe(0);
  });

  it('still fails file:../ escapes', () => {
    const res = runPolicy(makeFixture({ specifier: 'file:../talchain-schemas' }));
    expect(res.status).not.toBe(0);
    expect(res.output).toContain('disallowed file: dependency');
  });

  it('still fails absolute local paths', () => {
    const res = runPolicy(makeFixture({ specifier: 'file:/Users/someone/talchain-schemas-0.13.1.tgz' }));
    expect(res.status).not.toBe(0);
    expect(res.output).toContain('disallowed file: dependency');
  });

  it('still fails home-directory paths', () => {
    const res = runPolicy(makeFixture({ specifier: 'file:~/vendor/talchain-schemas-0.13.1.tgz' }));
    expect(res.status).not.toBe(0);
    expect(res.output).toContain('disallowed file: dependency');
  });

  it('still fails arbitrary vendored tarballs (allowance is talchain-schemas only)', () => {
    const res = runPolicy(makeFixture({
      specifier: 'file:./vendor/other-package-1.0.0.tgz',
      tarball: { name: 'other-package-1.0.0.tgz', manifest: 'valid' },
    }));
    expect(res.status).not.toBe(0);
    expect(res.output).toContain('disallowed file: dependency');
  });

  it('fails an allowed-pattern tarball with NO sha256 manifest', () => {
    const res = runPolicy(makeFixture({
      specifier: 'file:./vendor/talchain-schemas-0.13.1.tgz',
      tarball: { name: 'talchain-schemas-0.13.1.tgz', manifest: 'missing' },
    }));
    expect(res.status).not.toBe(0);
    expect(res.output).toMatch(/sha256 manifest .* not git-tracked|missing sha256 manifest/);
  });

  it('fails an allowed-pattern tarball whose sha256 does not match the manifest', () => {
    const res = runPolicy(makeFixture({
      specifier: 'file:./vendor/talchain-schemas-0.13.1.tgz',
      tarball: { name: 'talchain-schemas-0.13.1.tgz', manifest: 'mismatch' },
    }));
    expect(res.status).not.toBe(0);
    expect(res.output).toContain('sha256 mismatch');
  });

  it('fails an untracked tarball even with a valid manifest', () => {
    const res = runPolicy(makeFixture({
      specifier: 'file:./vendor/talchain-schemas-0.13.1.tgz',
      tarball: { name: 'talchain-schemas-0.13.1.tgz', manifest: 'valid', tracked: false },
    }));
    expect(res.status).not.toBe(0);
    expect(res.output).toContain('not git-tracked');
  });

  it('fails a stray file:../ hiding in the lockfile even when package.json is clean', () => {
    const res = runPolicy(makeFixture({
      specifier: 'file:./vendor/talchain-schemas-0.13.1.tgz',
      lockSpecifier: 'file:../escaped/talchain-schemas-0.13.1.tgz',
      tarball: { name: 'talchain-schemas-0.13.1.tgz', manifest: 'valid' },
    }));
    expect(res.status).not.toBe(0);
    expect(res.output).toContain('disallowed file: dependency');
  });

  it('passes THIS repo: the real vendored pin satisfies the policy end-to-end', () => {
    const res = runPolicy(resolve(__dirname, '..'));
    expect(res.output).toContain('POLICY OK');
    expect(res.status).toBe(0);
  });
});
