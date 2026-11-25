import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../config.mjs';
import { createLocalRunner, createProgressReader, durationMs } from './local.mjs';

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

  it("runs a job on its working tree's own commit and edits, not on the ref it syncs against", async () => {
    const s = setup();
    writeFileSync(join(s.frozen, 'b.txt'), 'b\n');
    git(s.frozen, 'add', '-A');
    git(s.frozen, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'two');
    writeFileSync(join(s.frozen, 'b.txt'), 'b edited\n');
    rmSync(join(s.frozen, 'a.txt'));
    const r = await run(s, 'mkdir -p .skulkr/out; cat b.txt > .skulkr/out/got; ls a.txt 2>/dev/null >> .skulkr/out/got; true');
    expect(readFileSync(join(r.to, 'got'), 'utf8')).toBe('b edited\n');
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

  it('kills a timed-out job that ignores SIGTERM once its grace runs out', async () => {
    const s = setup();
    const runner = createLocalRunner(resolveConfig({ name: 't', state: join(s.dir, 'state') }), { graceMs: 300 });
    const t0 = Date.now();
    const r = await run({ ...s, runner }, "trap '' TERM; sleep 30", { timeout: '1s' });
    expect(r.status).not.toBe(0);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('deletes job records past a week as it runs a job', async () => {
    const s = setup();
    const jobs = join(s.dir, 'state', 'local-jobs');
    mkdirSync(jobs, { recursive: true });
    const old = join(jobs, 'old.json');
    writeFileSync(old, '{}');
    const week = new Date(Date.now() - 8 * 24 * 3_600_000);
    utimesSync(old, week, week);
    await run(s, 'true');
    expect(existsSync(old)).toBe(false);
    expect(readdirSync(jobs)).toHaveLength(1);
  });

  it('kills its running jobs when the process running them is told to stop', async () => {
    const s = setup();
    const pidFile = join(s.dir, 'job.pid');
    const script = `
      import { createWriteStream } from 'node:fs';
      import { resolveConfig } from ${JSON.stringify(new URL('../config.mjs', import.meta.url).pathname)};
      import { createLocalRunner } from ${JSON.stringify(new URL('./local.mjs', import.meta.url).pathname)};
      const runner = createLocalRunner(resolveConfig({ name: 't', state: ${JSON.stringify(join(s.dir, 'state'))} }));
      const job = { kind: 'fix', task: 't', ref: ${JSON.stringify(s.base)}, timeout: '1m', out: '.skulkr/out', to: ${JSON.stringify(s.dir)},
        shell: 'echo $$ > ${pidFile}; sleep 30' };
      runner.run(job, { cwd: ${JSON.stringify(s.frozen)}, log: createWriteStream('/dev/null') });
    `;
    const night = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore' });
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((done) => setTimeout(done, 50));
    const job = Number(readFileSync(pidFile, 'utf8'));
    const alive = () => {
      try {
        process.kill(-job, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive()).toBe(true);
    night.kill('SIGTERM');
    await new Promise((done) => night.on('close', done));
    for (let i = 0; i < 40 && alive(); i++) await new Promise((done) => setTimeout(done, 50));
    expect(alive()).toBe(false);
  });

  it('reads runner durations', () => {
    expect([durationMs('55m'), durationMs('90s'), durationMs('2h'), durationMs('none')]).toEqual([3_300_000, 90_000, 7_200_000, undefined]);
  });
});

describe('local progress', () => {
  it("keeps each of a job's counters in its own slot, and its latest note", () => {
    const { feed } = createProgressReader();
    expect(feed('nothing here\n')).toBeUndefined();
    expect(feed('x\nonto: progress 10/10\nonto: progress 6/7 che')).toEqual({ done: 10, total: 10 });
    const p = feed('cks\nonto: failed 2/7 checks\nonto: progress 84/84 tests\nskulkr: running: npx vitest run a.test.ts\n');
    expect(p).toMatchObject({ done: 10, total: 10, checks: { done: 6, total: 7, failed: 2 }, tests: { done: 84, total: 84, failed: 0 } });
    expect(p!.now!.text).toBe('running: npx vitest run a.test.ts');
    expect(feed('skulkr: finding {"claim":"Drops an event","where":"a.ts:1"}\n')!.now!.text).toBe('found: Drops an event');
  });

  it("answers a running job's count by its task, and none once it ends", async () => {
    const s = setup();
    const job = run(s, 'echo "onto: progress 1/3"; sleep 1; mkdir -p .skulkr/out', { task: 'audit1-x-fix' });
    for (let i = 0; i < 50 && !s.runner.progress().size; i++) await new Promise((r) => setTimeout(r, 20));
    expect(s.runner.progress().get('audit1-x-fix')).toEqual({ done: 1, total: 3 });
    await job;
    expect(s.runner.progress().size).toBe(0);
  });
});
