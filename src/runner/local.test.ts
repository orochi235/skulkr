import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../config.mjs';
import { createLocalRunner, durationMs } from './local.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

/** A repository with one commit, a detached worktree of it (the frozen tree) holding `.skulkr/in/note`, and a runner. */
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'skulkr-local-'));
  dirs.push(dir);
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'one');
  const frozen = join(dir, 'frozen');
  git(repo, 'worktree', 'add', '-q', '--detach', frozen, 'main');
  mkdirSync(join(frozen, '.skulkr/in'), { recursive: true });
  writeFileSync(join(frozen, '.skulkr/in/note'), 'hello\n');
  const cfg = resolveConfig({ name: 't', state: join(dir, 'state') });
  return { dir, frozen, base: git(repo, 'rev-parse', 'HEAD'), runner: createLocalRunner(cfg) };
};

const run = async (s: ReturnType<typeof setup>, shell: string, extra = {}) => {
  const to = join(s.dir, `to-${Math.random()}`);
  mkdirSync(to);
  const log = createWriteStream(join(s.dir, 'log'), { flags: 'a' });
  const job = { kind: 'review', task: 'audit1-x-A', ref: s.base, timeout: '1m', out: '.skulkr/out', to, env: { K: 'v' }, shell, ...extra };
  const r = await s.runner.run(job, { cwd: s.frozen, log });
  await new Promise((done) => log.end(done));
  return { ...r, to };
};

describe('the local runner', () => {
  it('runs a job in a clone holding the frozen tree and .skulkr/in, and brings .skulkr/out home', async () => {
    const s = setup();
    const r = await run(s, 'mkdir -p .skulkr/out && cat .skulkr/in/note a.txt > .skulkr/out/got && echo "$K" >> .skulkr/out/got && touch stray');
    expect(r).toMatchObject({ status: 0, busy: false, refused: false });
    expect(readFileSync(join(r.to, 'got'), 'utf8')).toBe('hello\na\nv\n');
    const again = await run(s, 'mkdir -p .skulkr/out; ls stray 2>/dev/null > .skulkr/out/stray; echo x > a.txt');
    expect(readFileSync(join(again.to, 'stray'), 'utf8')).toBe('');
    const third = await run(s, 'mkdir -p .skulkr/out; cp a.txt .skulkr/out/');
    expect(readFileSync(join(third.to, 'a.txt'), 'utf8')).toBe('a\n');
  });

  it('hands a fixer a tree that commits to the frozen tree', async () => {
    const s = setup();
    const frozenTree = git(s.frozen, 'rev-parse', 'HEAD^{tree}');
    const r = await run(s, [
      'mkdir -p .skulkr/out',
      'grep -qx ".skulkr/" .git/info/exclude 2>/dev/null || echo ".skulkr/" >> .git/info/exclude',
      'git add -A && git -c user.name=s -c user.email=s@s commit -q --allow-empty -m frozen',
      'git rev-parse "HEAD^{tree}" > .skulkr/out/tree',
    ].join(' && '));
    expect(r.status).toBe(0);
    expect(readFileSync(join(r.to, 'tree'), 'utf8').trim()).toBe(frozenTree);
  });

  it('keeps node_modules between jobs and answers the jobs it ran', async () => {
    const s = setup();
    await run(s, 'mkdir -p node_modules && echo kept > node_modules/m');
    const r = await run(s, 'mkdir -p .skulkr/out && cat node_modules/m > .skulkr/out/m; exit 3');
    expect(r.status).toBe(3);
    expect(readFileSync(join(r.to, 'm'), 'utf8')).toBe('kept\n');
    const jobs = s.runner.jobs(new Date(Date.now() - 60_000).toISOString());
    expect(jobs.map((j: { state: string }) => j.state).sort()).toEqual(['done', 'failed']);
    expect(jobs[0]).toMatchObject({ task: 'audit1-x-A', node: 'local' });
  });

  it('stops a job at its timeout', async () => {
    const s = setup();
    const t0 = Date.now();
    const r = await run(s, 'sleep 30', { timeout: '1s' });
    expect(r.status).not.toBe(0);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(existsSync(join(r.to, 'got'))).toBe(false);
  });

  it('answers a failed job, and keeps no lease, when its clone cannot be made', async () => {
    const s = setup();
    rmSync(join(s.dir, 'repo', '.git', 'objects'), { recursive: true, force: true });
    const r = await run(s, 'true');
    expect(r.status).not.toBe(0);
    const pool = join(s.dir, 'state', 'trees');
    expect(existsSync(pool) ? readdirSync(pool).filter((n) => n.endsWith('.lease')) : []).toEqual([]);
  });

  it('reads runner durations', () => {
    expect([durationMs('55m'), durationMs('90s'), durationMs('2h'), durationMs('none')]).toEqual([3_300_000, 90_000, 7_200_000, undefined]);
  });
});
