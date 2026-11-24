import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitIn, makeBatch, removeWorktree } from './batch.mjs';
import { conflictRepairer, markConflicts, mergeResolved, resolutionIn, resolveConflicts } from './conflict.mjs';
import { resolveConfig } from './config.mjs';
import { batchAndTest } from './land.mjs';
import { leftOutIn } from './leftOut.mjs';

const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'skulkr-conflict-'));
  dirs.push(d);
  return d;
};
const fleetWas = process.env.SKULKR_FLEET;
beforeEach(() => {
  process.env.SKULKR_FLEET = scratch();
});
afterEach(() => {
  if (fleetWas === undefined) delete process.env.SKULKR_FLEET;
  else process.env.SKULKR_FLEET = fleetWas;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A checkout whose two area branches each add a test at the end of one file, so the second conflicts with the first. */
const round = () => {
  const root = scratch();
  const git = gitIn(root);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'skulkr@example.invalid');
  git('config', 'user.name', 'skulkr');
  const put = (text: string, message: string) => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/api.test.ts'), text);
    git('add', '-A');
    git('commit', '-q', '-m', message);
  };
  put('one\n', 'base');
  const commit = git('rev-parse', 'HEAD');
  for (const id of ['part1', 'part2']) {
    git('checkout', '-q', '-b', `audit5-${id}`, commit);
    put(`one\n${id} test\n`, `fix ${id}`);
  }
  git('checkout', '-q', 'main');
  return { root, git, commit, branches: ['audit5-part1', 'audit5-part2'] };
};

/** What a conflict repair job does, done here: the marked merge with every marker line dropped, keeping both sides. */
const keepBoth = (root: string, nightDir: string) => async (branch: string, { batch }: { batch: { tree: string, name: string } }) => {
  const marked = markConflicts(root, { batchTree: batch.tree, branch, name: 'b', mboxPath: join(nightDir, `${branch}.mbox`) });
  const git = gitIn(marked.tree);
  try {
    git('am', '-q', marked.mbox);
    for (const p of marked.paths) {
      const at = join(marked.tree, p);
      writeFileSync(at, readFileSync(at, 'utf8').split('\n').filter((l) => !/^(<{7}|={7}|>{7})/.test(l)).join('\n'));
    }
    git('commit', '-qam', 'keep both tests');
    const resolved = join(nightDir, `${branch}.resolved.mbox`);
    writeFileSync(resolved, git('format-patch', '--stdout', `${marked.tip}..HEAD`));
    git('reset', '-q', '--hard', marked.tip);
    return { ok: true, ...resolutionIn(marked.tree, resolved, marked.paths) };
  } finally {
    removeWorktree(root, marked.tree);
  }
};

const cfgFor = (state: string) => resolveConfig({ name: 't', state, git: { push: false }, gate: { name: 'test', command: ['true'], cwd: 'batch', failPrefix: 'fleet-fail:' } });

describe('a conflict repair', () => {
  it('merges a conflicting branch into the batch with the resolution, as a merge of that branch', async () => {
    const r = round();
    const cfg = cfgFor(scratch());
    const made = makeBatch(cfg, r.root, { round: 5, date: '2026-11-23', commit: r.commit, branches: r.branches });
    expect(made.conflicted.map((c: { branch: string }) => c.branch)).toEqual(['audit5-part2']);
    const said: string[] = [];
    const merged = await resolveConflicts({ made, kept: new Map(), resolve: keepBoth(r.root, scratch()), say: (l: string) => said.push(l) });
    expect(merged).toEqual(['audit5-part2']);
    expect(made.merged).toEqual(r.branches);
    expect(made.conflicted).toEqual([]);
    expect(readFileSync(join(made.tree, 'src/api.test.ts'), 'utf8')).toBe('one\npart1 test\npart2 test\n');
    const git = gitIn(made.tree);
    expect(git('log', '-1', '--format=%P %s').split(' ').length).toBeGreaterThan(2);
    expect(git('log', '-1', '--format=%s')).toBe(`Merge branch 'audit5-part2' into ${made.name}`);
    expect(said).toEqual(['batch: audit5-part2 merged after a conflict repair of src/api.test.ts']);
  });

  it('reuses a kept resolution on a rebuilt batch rather than repairing again', async () => {
    const r = round();
    const cfg = cfgFor(scratch());
    const kept = new Map();
    const first = makeBatch(cfg, r.root, { round: 5, date: '2026-11-23', commit: r.commit, branches: r.branches });
    await resolveConflicts({ made: first, kept, resolve: keepBoth(r.root, scratch()), say: () => {} });
    removeWorktree(r.root, first.tree);
    const again = makeBatch(cfg, r.root, { round: 5, date: '2026-11-23', commit: r.commit, branches: r.branches });
    const said: string[] = [];
    let asked = 0;
    await resolveConflicts({ made: again, kept, resolve: async () => ({ ok: !!++asked }), say: (l: string) => said.push(l) });
    expect(asked).toBe(0);
    expect(again.merged).toEqual(r.branches);
    expect(said).toEqual(['batch: audit5-part2 merged with the resolution of its conflict kept from an earlier build']);
  });

  it('leaves the batch as it was where a resolution still holds a marker', () => {
    const r = round();
    const made = makeBatch(cfgFor(scratch()), r.root, { round: 5, date: '2026-11-23', commit: r.commit, branches: r.branches });
    const tip = gitIn(made.tree)('rev-parse', 'HEAD');
    expect(mergeResolved(made.tree, { branch: 'audit5-part2', message: 'm', patch: '' })).toMatchObject({ ok: false, why: expect.stringContaining('conflict markers left') });
    expect(gitIn(made.tree)('rev-parse', 'HEAD')).toBe(tip);
    expect(gitIn(made.tree)('status', '--porcelain')).toBe('');
  });
});

describe('conflictRepairer', () => {
  it("runs a repair job from the batch's tip on the marked merge, and answers the resolution its verify passed", async () => {
    const r = round();
    const cfg = resolveConfig({ name: 't', state: scratch(), checks: { verify: { command: 'run {files}' } } });
    const made = makeBatch(cfg, r.root, { round: 5, date: '2026-11-23', commit: r.commit, branches: r.branches });
    const tip = gitIn(made.tree)('rev-parse', 'HEAD');
    const jobs: { cwd: string, env: Record<string, string>, about: string, prompt: string, ours: string }[] = [];
    const said: string[] = [];
    const reply = JSON.stringify({ type: 'result', is_error: false, result: 'resolved', total_cost_usd: 1 });
    const ctx = {
      cfg, round: 5, commit: r.commit, frozen: scratch(), nightDir: scratch(), base: 'b', frozenTree: 'frozen', identity: {},
      budget: { fix: 15 }, say: (l: string) => said.push(l), usage: () => {}, refuse: () => {},
      acquire: async () => ({ node: 'studio', release: () => {} }),
      runner: {
        // The job, done here: the marked merge applied, its markers dropped, both commits handed back, verify passing.
        run: async (job: { to: string, env: Record<string, string>, about: string }, { cwd }: { cwd: string }) => {
          const inDir = join(cwd, '.skulkr/in/part2');
          jobs.push({ cwd, env: job.env, about: job.about, prompt: readFileSync(join(inDir, 'repair.md'), 'utf8'), ours: readFileSync(join(inDir, 'ours.patch'), 'utf8') });
          const git = gitIn(cwd);
          git('am', '-q', join(inDir, 'area.mbox'));
          const at = join(cwd, 'src/api.test.ts');
          writeFileSync(at, readFileSync(at, 'utf8').split('\n').filter((l) => !/^(<{7}|={7}|>{7})/.test(l)).join('\n'));
          git('commit', '-qam', 'keep both tests');
          mkdirSync(job.to, { recursive: true });
          writeFileSync(join(job.to, 'fix.mbox'), git('format-patch', '--stdout', `${tip}..HEAD`));
          git('reset', '-q', '--hard', tip);
          for (const [f, t] of Object.entries({ exit: '0', 'claude.json': reply, 'verify.exit': '0', 'verify.log': ' Test Files  1 passed (1)', 'verify.files': 'src/api.test.ts' })) writeFileSync(join(job.to, f), t);
          return { status: 0 };
        },
      },
    };
    const got = await conflictRepairer(ctx, { root: r.root })('audit5-part2', { batch: made, label: `conflict-${tip.slice(0, 10)}` });
    expect(got).toMatchObject({ ok: true, verify: { ok: true, conflict: true } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.cwd).not.toBe(ctx.frozen);
    expect(jobs[0]!.env.FROZEN_TREE).toBe(gitIn(r.root)('rev-parse', `${tip}^{tree}`));
    expect(jobs[0]!.prompt).toContain("`audit5-part2` conflict with what the batch");
    expect(jobs[0]!.prompt).toContain('`src/api.test.ts`');
    expect(jobs[0]!.ours).toContain('+part1 test');
    expect(said).toEqual([expect.stringMatching(/^repair part2 conflict on studio: 1 commits, [\d.]+ min; verify passed$/)]);
    expect(mergeResolved(made.tree, { branch: 'audit5-part2', message: 'm', patch: got.patch! })).toEqual({ ok: true });
    expect(readFileSync(join(made.tree, 'src/api.test.ts'), 'utf8')).toBe('one\npart1 test\npart2 test\n');
    // The scratch worktree is gone.
    expect(gitIn(r.root)('worktree', 'list').split('\n')).toHaveLength(2);
  });
});

describe('the batch with conflict repair', () => {
  type Resolve = (branch: string, o: { batch: { tree: string, name: string } }) => Promise<{ ok: boolean, patch?: string, why?: string }>;
  const land = async (resolveFor: (root: string) => Resolve) => {
    const r = round();
    const resolve = resolveFor(r.root);
    const state = scratch();
    const said: string[] = [];
    const outcomes: Record<string, string> = {};
    const results = ['part1', 'part2'].map((id) => ({
      id, files: ['src/api.test.ts'], read: { A: 1, B: 1 }, a: 1, b: 1, m: 1, distinct: 1, patches: 1, questions: 0, fixCommits: [],
      jobs: { minutes: {}, weightedTokens: 0, costUsd: 0 },
    }));
    const report = await batchAndTest({
      cfg: cfgFor(state), root: r.root, git: r.git, round: 5, commit: r.commit, date: '2026-11-23', nightDir: scratch(), branches: r.branches,
      results, sweep: undefined, outcomes, merge: true, say: (l: string) => said.push(l), setStep: () => {}, repair: undefined, baseline: undefined, resolve,
    });
    return { r, state, said, outcomes, report };
  };

  it('lands a branch its conflict repair merged, its outcome saying so', async () => {
    const { r, outcomes, report, state } = await land((root) => keepBoth(root, scratch()));
    expect(report).toMatch(/^main fast-forwarded/);
    expect(outcomes.part2).toBe('`audit5-part2`, merged after a conflict repair');
    const record = JSON.parse(readFileSync(join(r.root, 'docs/audits/round-5/part2/area.json'), 'utf8'));
    expect(record.conflictRepaired).toBe(true);
    expect(readFileSync(join(r.root, 'docs/audits/round-5/README.md'), 'utf8')).toContain('merged after a conflict repair');
    expect(readFileSync(join(r.root, 'src/api.test.ts'), 'utf8')).toBe('one\npart1 test\npart2 test\n');
    expect(leftOutIn(state)).toEqual([]);
  });

  it('leaves out a branch whose conflict repair fails, as before, saying it was tried', async () => {
    const { said, outcomes, state } = await land(() => async () => ({ ok: false, why: 'its resolution failed verify' }));
    expect(said).toContain('batch: conflict repair of audit5-part2 failed: its resolution failed verify');
    expect(outcomes.part2).toBe('`audit5-part2`, left out: merge conflict in src/api.test.ts; its conflict repair failed');
    expect(leftOutIn(state).map((e: { branch: string }) => e.branch)).toEqual(['audit5-part2']);
  });
});
